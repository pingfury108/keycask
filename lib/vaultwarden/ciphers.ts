import { encryptType2 } from '@/lib/crypto/enc-string';
import { fromB64, utf8 } from '@/lib/crypto/encoding';
import { CipherType } from '@/lib/protocol/types';
import type { DecryptedCipher } from '@/lib/crypto/decrypt';
import { VaultwardenClient } from './client';
import { accessToken, orgKeysB64, serverUrl, userKeyB64 } from '@/lib/store/settings';

export interface CipherInput {
  name: string;
  username: string;
  password: string;
  uri: string;
  notes: string;
  totp: string;
  folderId: string | null;
  favorite: boolean;
}

async function authedClient(): Promise<VaultwardenClient> {
  const [baseUrl, token] = await Promise.all([serverUrl.getValue(), accessToken.getValue()]);
  if (!token) throw new Error('会话已过期，请解锁后重试');
  return new VaultwardenClient(baseUrl).withToken(token);
}

/** 组织条目用组织密钥加密，个人条目用用户密钥 */
async function keyFor(organizationId: string | null): Promise<Uint8Array> {
  if (organizationId) {
    const orgs = (await orgKeysB64.getValue()) ?? {};
    const b64 = orgs[organizationId];
    if (!b64) throw new Error('缺少该组织的密钥');
    return fromB64(b64);
  }
  const keyB64 = await userKeyB64.getValue();
  if (!keyB64) throw new Error('会话已过期，请解锁后重试');
  return fromB64(keyB64);
}

function buildPayload(c: CipherInput, key: Uint8Array, extra: Record<string, unknown>) {
  const e = async (s: string) => (s ? await encryptType2(utf8(s), key) : null);
  return (async () => ({
    type: CipherType.Login,
    folderId: c.folderId,
    organizationId: null,
    favorite: c.favorite,
    reprompt: 0,
    name: await e(c.name.trim()),
    notes: await e(c.notes.trim()),
    login: {
      username: await e(c.username.trim()),
      password: await e(c.password),
      totp: await e(c.totp.trim()),
      uris: c.uri.trim() ? [{ uri: await e(c.uri.trim()), match: null }] : [],
    },
    fields: [],
    passwordHistory: [],
    lastKnownRevisionDate: new Date().toISOString(),
    ...extra,
  }))();
}

export async function createCipher(input: CipherInput): Promise<void> {
  const client = await authedClient();
  const payload = await buildPayload(input, await keyFor(null), {});
  await client.postJson('/api/ciphers', payload);
}

export async function updateCipher(id: string, input: CipherInput, existing: DecryptedCipher): Promise<void> {
  const client = await authedClient();
  const orgId = existing.organizationId ?? null;
  const payload = await buildPayload(input, await keyFor(orgId), {
    id,
    organizationId: orgId,
    // 保留原条目的自定义字段/密码历史（本版本不编辑它们，避免数据丢失）
    fields: existing.rawFields ?? [],
    passwordHistory: existing.rawPasswordHistory ?? [],
  });
  await client.putJson(`/api/ciphers/${id}`, payload);
}

/** 移入回收站（软删除，老版服务端协议） */
export async function trashCipher(id: string): Promise<void> {
  const client = await authedClient();
  await client.putJson(`/api/ciphers/${id}/delete`, {});
}

/** 从回收站恢复 */
export async function restoreCipher(id: string): Promise<void> {
  const client = await authedClient();
  await client.putJson(`/api/ciphers/${id}/restore`, {});
}
