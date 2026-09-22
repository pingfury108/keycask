import { deriveMasterKey, masterPasswordHash, parsePrelogin, stretchMasterKey } from '@/lib/crypto/kdf';
import { decryptToBytes, parseEncString } from '@/lib/crypto/enc-string';
import { rsaOaepSha1Decrypt } from '@/lib/crypto/rsa';
import { toB64 } from '@/lib/crypto/encoding';
import type { SyncResponse } from '@/lib/protocol/types';
import { normalizeSyncResponse } from '@/lib/protocol/normalize';
import { VaultwardenClient } from './client';
import {
  accessToken,
  getOrCreateDeviceId,
  lastSyncAt,
  orgKeysB64,
  userKeyB64,
  vaultCiphersRaw,
  vaultFoldersRaw,
} from '@/lib/store/settings';

export interface LoginResult {
  cipherCount: number;
  folderCount: number;
}

/**
 * M1 登录流程：
 * prelogin → KDF → masterPasswordHash → token → sync → 解密 User Key（存会话）
 */
export async function loginAndSync(
  baseUrl: string,
  email: string,
  masterPassword: string,
): Promise<LoginResult> {
  const client = new VaultwardenClient(baseUrl);

  const preloginRes = await client.prelogin(email);
  const kdf = parsePrelogin(preloginRes);

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
  const encryptedUserKey = token.Key ?? token.key ?? sync.profile?.key;
  if (!encryptedUserKey) throw new Error('服务端未返回用户密钥（token.Key / profile.key 均缺失）');
  const stretched = await stretchMasterKey(masterKey);
  const userKey = await decryptToBytes(parseEncString(encryptedUserKey), stretched);

  // 组织密钥链：私钥（token.PrivateKey / profile.privateKey，User Key 加密）
  //   → 解开 profile.organizations[].key（RSA-OAEP-SHA1，type 4）得到各组织对称密钥
  // 单个组织失败不阻塞整体登录
  const orgKeys: Record<string, string> = {};
  const encPrivateKey = token.PrivateKey ?? token.privateKey ?? sync.profile?.privateKey;
  if (encPrivateKey) {
    try {
      const privateKeyDer = await decryptToBytes(parseEncString(encPrivateKey), userKey);
      for (const org of sync.profile?.organizations ?? []) {
        if (!org.key || !org.id) continue;
        try {
          const parsed = parseEncString(org.key);
          const raw = await rsaOaepSha1Decrypt(parsed.data, privateKeyDer);
          orgKeys[org.id] = toB64(raw);
        } catch (e) {
          console.warn(`[keycask] 组织密钥解密失败: ${org.name ?? org.id}`, e);
        }
      }
    } catch (e) {
      console.warn('[keycask] RSA 私钥解密失败，组织条目将不可解密', e);
    }
  }

  // 状态落地：token / User Key 只在会话；密文缓存持久化
  await accessToken.setValue(token.access_token);
  await userKeyB64.setValue(toB64(userKey));
  await orgKeysB64.setValue(orgKeys);
  await vaultCiphersRaw.setValue(sync.ciphers ?? []);
  await vaultFoldersRaw.setValue(sync.folders ?? []);
  await lastSyncAt.setValue(Date.now());

  return {
    cipherCount: sync.ciphers?.length ?? 0,
    folderCount: sync.folders?.length ?? 0,
  };
}
