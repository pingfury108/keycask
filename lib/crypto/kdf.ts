import { argon2id } from 'hash-wasm';
import { concat, toB64, utf8 } from './encoding';
import { KdfType, PRELOGIN_ITERATIONS_MIN } from '@/lib/protocol/types';
import type { PreloginResult } from '@/lib/vaultwarden/client';

/** 登录前必须 trim + 小写，否则带空格/大小写差异的邮箱 KDF 结果不同 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface KdfConfig {
  type: KdfType;
  iterations: number;
  memoryMiB?: number;
  parallelism?: number;
}

/** 解析 prelogin 响应（兼容新/老端点结构、PascalCase/camelCase），并做防降级下限校验 */
export function parsePrelogin(result: PreloginResult): KdfConfig {
  const cfg: KdfConfig =
    result.kind === 'modern'
      ? {
          type: result.res.kdfSettings.KdfType,
          iterations: result.res.kdfSettings.Iterations,
          memoryMiB: result.res.kdfSettings.Memory,
          parallelism: result.res.kdfSettings.Parallelism,
        }
      : {
          // 老版 vaultwarden 可能返回 PascalCase 或 camelCase
          type: result.res.Kdf ?? result.res.kdf ?? 0,
          iterations: result.res.KdfIterations ?? result.res.kdfIterations ?? 0,
          memoryMiB: result.res.KdfMemory ?? result.res.kdfMemory ?? undefined,
          parallelism: result.res.KdfParallelism ?? result.res.kdfParallelism ?? undefined,
        };
  // 防预登录降级攻击：下限按 KDF 类型区分
  // PBKDF2 迭代数以十万计，Argon2id 的迭代数只是个位数（时间维度不同），不能共用一个下限
  if (cfg.type === KdfType.PBKDF2_SHA256 && cfg.iterations < PRELOGIN_ITERATIONS_MIN) {
    throw new Error(
      `服务端返回的 PBKDF2 迭代数 ${cfg.iterations} 低于安全下限 ${PRELOGIN_ITERATIONS_MIN}，拒绝继续`,
    );
  }
  if (cfg.type === KdfType.Argon2id) {
    if (cfg.iterations < ARGON2_MIN.iterations) {
      throw new Error(`Argon2id 迭代数 ${cfg.iterations} 低于下限 ${ARGON2_MIN.iterations}，拒绝继续`);
    }
    if ((cfg.memoryMiB ?? 0) < ARGON2_MIN.memoryMiB) {
      throw new Error(
        `Argon2id 内存 ${cfg.memoryMiB} MiB 低于下限 ${ARGON2_MIN.memoryMiB} MiB，拒绝继续`,
      );
    }
  }
  return cfg;
}

export const ARGON2_MIN = { iterations: 2, memoryMiB: 16, parallelism: 1 } as const;

/** email + 主密码 → Master Key (32 bytes) */
export async function deriveMasterKey(
  password: string,
  email: string,
  kdf: KdfConfig,
): Promise<Uint8Array> {
  if (kdf.type === KdfType.PBKDF2_SHA256) {
    return pbkdf2Sha256(utf8(password), utf8(normalizeEmail(email)), kdf.iterations, 32);
  }
  // Argon2id：盐是 SHA-256(normalize(email))，不是 prelogin 返回的 salt、也不是邮箱原文
  const argonSalt = new Uint8Array(
    await crypto.subtle.digest('SHA-256', utf8(normalizeEmail(email)) as BufferSource),
  );
  const hash = await argon2id({
    password: utf8(password),
    salt: argonSalt,
    parallelism: kdf.parallelism ?? 4,
    memorySize: (kdf.memoryMiB ?? 32) * 1024, // hash-wasm 单位是 KiB
    iterations: kdf.iterations,
    hashLength: 32,
    outputType: 'binary',
  });
  return new Uint8Array(hash);
}

export async function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', password as BufferSource, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * HKDF-Expand（RFC 5869，手工 HMAC 实现）。
 * ⚠️ 不能用 WebCrypto 的 HKDF：它会先做 Extract（salt 全零时 PRK ≠ 输入），
 * 而 Bitwarden 协议这里是纯 Expand，PRK 就是 masterKey 本身。
 */
export async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    prk as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const out = new Uint8Array(lengthBytes);
  let t = new Uint8Array(0);
  let offset = 0;
  for (let i = 1; offset < lengthBytes; i++) {
    const input = concat(t, info, new Uint8Array([i]));
    t = new Uint8Array(await crypto.subtle.sign('HMAC', key, input as BufferSource));
    out.set(t.subarray(0, Math.min(32, lengthBytes - offset)), offset);
    offset += 32;
  }
  return out;
}

/** Master Key → stretched master key (64 bytes = enc 32 ‖ mac 32) */
export async function stretchMasterKey(masterKey: Uint8Array): Promise<Uint8Array> {
  const enc = await hkdfExpand(masterKey, utf8('enc'), 32);
  const mac = await hkdfExpand(masterKey, utf8('mac'), 32);
  return concat(enc, mac);
}

/**
 * Master Password Hash（发给服务端做认证的凭据）。
 * ⚠️ 方向容易写反：MasterKey 是 PBKDF2 的密码输入，主密码反而是盐；迭代固定 1。
 * 依据：bitwarden clients `hashMasterKey` 与 mywarden 的实现。
 */
export async function masterPasswordHash(
  password: string,
  masterKey: Uint8Array,
): Promise<string> {
  const bits = await pbkdf2Sha256(masterKey, utf8(password), 1, 32);
  return toB64(bits);
}
