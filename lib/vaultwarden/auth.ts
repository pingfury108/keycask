import {
  deriveMasterKey,
  masterPasswordHash,
  parsePrelogin,
  stretchMasterKey,
  type KdfConfig,
} from '@/lib/crypto/kdf';
import { decryptToBytes, encryptType2, parseEncString } from '@/lib/crypto/enc-string';
import { rsaOaepSha1Decrypt } from '@/lib/crypto/rsa';
import { fromB64, fromUtf8, toB64, utf8 } from '@/lib/crypto/encoding';
import { normalizeSyncResponse } from '@/lib/protocol/normalize';
import type { SyncResponse } from '@/lib/protocol/types';
import { VaultwardenClient } from './client';
import {
  accessToken,
  encryptedPrivateKey,
  encryptedUserKey,
  encryptedOrgKeys,
  getOrCreateDeviceId,
  kdfConfig,
  lastActivity,
  lastEmail,
  lastSyncAt,
  lastSyncStats,
  orgKeysB64,
  orgNames,
  refreshToken,
  serverUrl,
  userKeyB64,
  vaultCiphersRaw,
  vaultFoldersRaw,
} from '@/lib/store/settings';

export interface LoginResult {
  cipherCount: number;
  folderCount: number;
}

/**
 * 完整登录：prelogin → KDF → masterPasswordHash → token → sync → 解 User Key。
 * 同时把解锁所需的密文材料（KDF 参数 / 加密 User Key / 加密私钥）持久化。
 */
export async function loginAndSync(
  baseUrl: string,
  email: string,
  masterPassword: string,
): Promise<LoginResult> {
  const client = new VaultwardenClient(baseUrl);

  const kdf = parsePrelogin(await client.prelogin(email));
  const masterKey = await deriveMasterKey(masterPassword, email, kdf);
  const hash = await masterPasswordHash(masterPassword, masterKey);

  const token = await client.loginWithPassword({
    email,
    masterPasswordHash: hash,
    deviceIdentifier: await getOrCreateDeviceId(),
    deviceName: 'chrome',
  });
  client.withToken(token.access_token);

  // 老版服务端响应是 PascalCase，统一归一化为 camelCase
  const sync = normalizeSyncResponse(await client.get<Record<string, unknown>>('/api/sync'));

  // 解密 User Key：老版服务端在 token.Key（PascalCase），新版在 profile.key
  const encUserKey = token.Key ?? token.key ?? sync.profile?.key;
  if (!encUserKey) throw new Error('服务端未返回用户密钥（token.Key / profile.key 均缺失）');
  const encPrivateKey = token.PrivateKey ?? token.privateKey ?? sync.profile?.privateKey;

  const stretched = await stretchMasterKey(masterKey);
  const userKey = await decryptToBytes(parseEncString(encUserKey), stretched);
  const orgKeys = await decryptOrgKeys(userKey, encPrivateKey, sync);

  // 持久化解锁材料（全是密文）+ 会话态
  await kdfConfig.setValue(JSON.stringify(kdf));
  await encryptedUserKey.setValue(encUserKey);
  await encryptedPrivateKey.setValue(encPrivateKey ?? null);
  await refreshToken.setValue(token.refresh_token ?? null);
  // 组织密钥用 User Key 加密缓存，解锁时离线恢复
  await encryptedOrgKeys.setValue(
    await encryptType2(utf8(JSON.stringify(orgKeys)), userKey),
  );
  await activateSession(token.access_token, userKey, orgKeys, sync);

  return {
    cipherCount: sync.ciphers?.length ?? 0,
    folderCount: sync.folders?.length ?? 0,
  };
}

/**
 * 主密码解锁（不走网络登录）：
 * KDF 重新派生 → 解加密 User Key（MAC 失败 = 主密码错误）→ 解组织密钥。
 */
export async function unlockWithPassword(masterPassword: string): Promise<void> {
  const [email, kdfJson, encUserKey, encPrivateKey] = await Promise.all([
    lastEmail.getValue(),
    kdfConfig.getValue(),
    encryptedUserKey.getValue(),
    encryptedPrivateKey.getValue(),
  ]);
  if (!email || !kdfJson || !encUserKey) {
    throw new Error('本地缺少解锁材料，请重新登录');
  }

  const kdf = JSON.parse(kdfJson) as KdfConfig;
  const masterKey = await deriveMasterKey(masterPassword, email, kdf);
  const stretched = await stretchMasterKey(masterKey);

  let userKey: Uint8Array;
  try {
    userKey = await decryptToBytes(parseEncString(encUserKey), stretched);
  } catch {
    throw new Error('主密码错误');
  }

  // 组织密钥：从 User Key 加密的本地缓存离线恢复
  let orgKeys: Record<string, string> = {};
  const encOrgKeys = await encryptedOrgKeys.getValue();
  if (encOrgKeys) {
    try {
      orgKeys = JSON.parse(fromUtf8(await decryptToBytes(parseEncString(encOrgKeys), userKey)));
    } catch {
      console.warn('[keycask] 组织密钥缓存解密失败');
    }
  }

  // 刷新 access token（失败不阻塞解锁，同步时会再提示）
  const [baseUrl, rt] = await Promise.all([serverUrl.getValue(), refreshToken.getValue()]);
  let token: string | null = null;
  if (baseUrl && rt) {
    try {
      const t = await new VaultwardenClient(baseUrl).refreshTokens(rt);
      token = t.access_token;
      if (t.refresh_token) await refreshToken.setValue(t.refresh_token);
    } catch (e) {
      console.warn('[keycask] 解锁后刷新 token 失败', e);
    }
  }

  await accessToken.setValue(token);
  await userKeyB64.setValue(toB64(userKey));
  await orgKeysB64.setValue(orgKeys);
  await lastActivity.setValue(Date.now());
}

/** 手动/定时同步：用会话里的 token 拉全量（老版无增量协议） */
export async function syncVault(): Promise<LoginResult> {
  const [baseUrl, token] = await Promise.all([serverUrl.getValue(), accessToken.getValue()]);
  if (!token) throw new Error('会话已过期，请解锁后重试');
  const client = new VaultwardenClient(baseUrl).withToken(token);
  const sync = normalizeSyncResponse(await client.get<Record<string, unknown>>('/api/sync'));

  await vaultCiphersRaw.setValue(sync.ciphers ?? []);
  await vaultFoldersRaw.setValue(sync.folders ?? []);
  await lastSyncAt.setValue(Date.now());
  await lastActivity.setValue(Date.now());
  return { cipherCount: sync.ciphers?.length ?? 0, folderCount: sync.folders?.length ?? 0 };
}

/** 锁定：清会话态，保留本地密文缓存（解锁后秒开） */
export async function lock(): Promise<void> {
  await accessToken.setValue(null);
  await userKeyB64.setValue(null);
  await orgKeysB64.setValue(null);
}

// ---------- 内部 ----------

async function activateSession(
  token: string,
  userKey: Uint8Array,
  orgKeys: Record<string, string>,
  sync: SyncResponse,
): Promise<void> {
  await accessToken.setValue(token);
  await userKeyB64.setValue(toB64(userKey));
  await orgKeysB64.setValue(orgKeys);
  await vaultCiphersRaw.setValue(sync.ciphers ?? []);
  await vaultFoldersRaw.setValue(sync.folders ?? []);
  await orgNames.setValue(
    Object.fromEntries((sync.profile?.organizations ?? []).map((o) => [o.id, o.name ?? o.id])),
  );
  await lastSyncAt.setValue(Date.now());
  await lastActivity.setValue(Date.now());
}

/**
 * 组织密钥链：私钥（User Key 加密）→ 解 organizations[].key（RSA-OAEP-SHA1）。
 * 单个组织失败不阻塞整体。
 */
async function decryptOrgKeys(
  userKey: Uint8Array,
  encPrivateKey: string | null | undefined,
  sync: SyncResponse,
): Promise<Record<string, string>> {
  if (!encPrivateKey) return {};
  try {
    const privateKeyDer = await decryptToBytes(parseEncString(encPrivateKey), userKey);
    const orgKeys: Record<string, string> = {};
    for (const org of sync.profile?.organizations ?? []) {
      if (!org.key || !org.id) continue;
      try {
        const raw = await rsaOaepSha1Decrypt(parseEncString(org.key).data, privateKeyDer);
        orgKeys[org.id] = toB64(raw);
      } catch (e) {
        console.warn(`[keycask] 组织密钥解密失败: ${org.name ?? org.id}`, e);
      }
    }
    return orgKeys;
  } catch (e) {
    console.warn('[keycask] RSA 私钥解密失败，组织条目将不可解密', e);
    return {};
  }
}

/** 记录同步失败统计（诊断页展示；只存 id+原因） */
export async function recordSyncStats(cipherCount: number, failed: { id: string; reason: string }[]) {
  await lastSyncStats.setValue({ at: Date.now(), cipherCount, failed });
}

/** 工具：base64 → bytes map（供 UI 层取组织密钥） */
export async function loadOrgKeys(): Promise<Map<string, Uint8Array>> {
  const raw = (await orgKeysB64.getValue()) ?? {};
  return new Map(Object.entries(raw).map(([id, b64]) => [id, fromB64(b64)]));
}
