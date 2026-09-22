import { concat, fromB64, fromUtf8, timingSafeEqual, toB64, utf8 } from './encoding';

/**
 * EncString 序列化格式：`<type>.<iv>|<data>[|<mac>]`，各段 base64。
 *
 * 权威枚举（bitwarden/clients 2026.9.1 源码核对）：
 * - type 1 已删除；type 7 是 CoseEncrypt0（XChaCha20-Poly1305 / XAES-256-GCM），不是 AES-GCM
 * - RSA 类型（3–6）实际走 UnsignedSharedKey 平行结构，这里仅识别不实现
 * - 密钥长度即类型：32B → type 0；64B → type 2；>64B → type 7
 */
export const enum EncryptionType {
  AesCbc256_B64 = 0,
  AesCbc256_HmacSha256_B64 = 2,
  Rsa2048_OaepSha256_B64 = 3,
  Rsa2048_OaepSha1_B64 = 4,
  Rsa2048_OaepSha256_HmacSha256_B64 = 5,
  Rsa2048_OaepSha1_HmacSha256_B64 = 6,
  CoseEncrypt0 = 7,
}

export interface ParsedEncString {
  type: EncryptionType;
  iv?: Uint8Array;
  data: Uint8Array;
  mac?: Uint8Array;
}

export class UnsupportedEncryptionTypeError extends Error {
  constructor(public encType: number) {
    super(`暂不支持的加密类型 ${encType}（M1 仅支持 type 0/2，type 7 计划 M5）`);
    this.name = 'UnsupportedEncryptionTypeError';
  }
}

export class MacMismatchError extends Error {
  constructor() {
    super('MAC 校验失败：密钥错误或数据被篡改');
    this.name = 'MacMismatchError';
  }
}

export function parseEncString(raw: string): ParsedEncString {
  const dot = raw.indexOf('.');
  if (dot < 0) throw new Error('非法 EncString：缺少类型前缀');
  const type = Number(raw.slice(0, dot)) as EncryptionType;
  const parts = raw.slice(dot + 1).split('|');

  switch (type) {
    case EncryptionType.AesCbc256_B64: {
      const [iv, data] = parts;
      if (!iv || !data || parts.length !== 2) throw new Error('非法 type 0 EncString');
      return { type, iv: fromB64(iv), data: fromB64(data) };
    }
    case EncryptionType.AesCbc256_HmacSha256_B64: {
      const [iv, data, mac] = parts;
      if (!iv || !data || !mac || parts.length !== 3) throw new Error('非法 type 2 EncString');
      return { type, iv: fromB64(iv), data: fromB64(data), mac: fromB64(mac) };
    }
    case EncryptionType.Rsa2048_OaepSha256_B64:
    case EncryptionType.Rsa2048_OaepSha1_B64: {
      const [data] = parts;
      if (!data || parts.length !== 1) throw new Error('非法 RSA EncString');
      return { type, data: fromB64(data) };
    }
    case EncryptionType.Rsa2048_OaepSha256_HmacSha256_B64:
    case EncryptionType.Rsa2048_OaepSha1_HmacSha256_B64: {
      const [data, mac] = parts;
      if (!data || !mac || parts.length !== 2) throw new Error('非法 RSA+MAC EncString');
      return { type, data: fromB64(data), mac: fromB64(mac) };
    }
    case EncryptionType.CoseEncrypt0:
      return { type, data: fromB64(parts.join('|')) };
    default:
      throw new Error(`未知 EncString 类型：${raw.slice(0, dot)}`);
  }
}

/**
 * 用 32B（type 0）或 64B（type 2）对称密钥解密。
 * type 2 是 encrypt-then-MAC：MAC 覆盖 iv ‖ ciphertext，无长度前缀、无 AAD，先验 MAC 再解密。
 */
export async function decryptToBytes(enc: ParsedEncString, key: Uint8Array): Promise<Uint8Array> {
  if (enc.type === EncryptionType.AesCbc256_B64) {
    return aesCbcDecrypt(key, enc.iv!, enc.data);
  }
  if (enc.type === EncryptionType.AesCbc256_HmacSha256_B64) {
    if (key.length !== 64) throw new Error('type 2 需要 64 字节密钥（enc ‖ mac）');
    const encKey = key.subarray(0, 32);
    const macKey = key.subarray(32, 64);
    const expectMac = await hmacSha256(macKey, concat(enc.iv!, enc.data));
    if (!timingSafeEqual(expectMac, enc.mac!)) throw new MacMismatchError();
    return aesCbcDecrypt(encKey, enc.iv!, enc.data);
  }
  throw new UnsupportedEncryptionTypeError(enc.type);
}

export async function decryptToUtf8(enc: ParsedEncString, key: Uint8Array): Promise<string> {
  return fromUtf8(await decryptToBytes(enc, key));
}

/** 序列化并加密（type 2），主要用于测试与后续的写入路径 */
export async function encryptType2(plain: Uint8Array, key: Uint8Array): Promise<string> {
  if (key.length !== 64) throw new Error('type 2 需要 64 字节密钥');
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const data = await aesCbcEncrypt(key.subarray(0, 32), iv, plain);
  const mac = await hmacSha256(key.subarray(32, 64), concat(iv, data));
  return `2.${toB64(iv)}|${toB64(data)}|${toB64(mac)}`;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}

async function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, [
    'encrypt',
  ]);
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource),
  );
}

async function aesCbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-CBC', false, [
    'decrypt',
  ]);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource),
  );
}

export function parseAndDecrypt(raw: string, key: Uint8Array): Promise<string> {
  return decryptToUtf8(parseEncString(raw), key);
}
