import { parseAndDecrypt } from './enc-string';
import type { CipherResponse } from '@/lib/protocol/types';
import { CipherType } from '@/lib/protocol/types';

export interface DecryptedCipher {
  id: string;
  type: CipherType;
  name: string;
  username?: string;
  password?: string;
  totp?: string;
  uris: string[];
  notes?: string;
  favorite: boolean;
  folderId?: string | null;
  fields: { name: string; value: string; type: number }[];
  deletedDate?: string | null;
  unknownFields?: string[];
}

export interface FailedCipher {
  id: string;
  reason: string;
}

export interface DecryptAllResult {
  ok: DecryptedCipher[];
  failed: FailedCipher[];
}

/** 空值友好解密：null/undefined/空串 → undefined */
async function dec(s: string | null | undefined, key: Uint8Array): Promise<string | undefined> {
  if (!s) return undefined;
  return parseAndDecrypt(s, key);
}

/**
 * 逐条宽容解密（本项目的核心差异化设计）：
 * 单条失败绝不拖垮整列——失败的进 failed 清单，UI 单独展示原因。
 */
export async function decryptCiphers(
  ciphers: CipherResponse[],
  key: Uint8Array,
): Promise<DecryptAllResult> {
  const ok: DecryptedCipher[] = [];
  const failed: FailedCipher[] = [];

  for (const c of ciphers) {
    try {
      ok.push(await decryptCipher(c, key));
    } catch (e) {
      failed.push({ id: c.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

async function decryptCipher(c: CipherResponse, key: Uint8Array): Promise<DecryptedCipher> {
  // 注意：老版本 cipher.key 可能存在于条目级（条目密钥），M2 先按无条目密钥处理
  const uris: string[] = [];
  if (c.login?.uris) {
    for (const u of c.login.uris) {
      const uri = await dec(u.uri, key);
      if (uri) uris.push(uri);
    }
  }

  const fields: DecryptedCipher['fields'] = [];
  for (const f of c.fields ?? []) {
    fields.push({
      name: (await dec(f.name, key)) ?? '',
      value: (await dec(f.value, key)) ?? '',
      type: f.type,
    });
  }

  return {
    id: c.id,
    type: c.type,
    name: (await dec(c.name, key)) ?? '(未命名)',
    username: await dec(c.login?.username, key),
    password: await dec(c.login?.password, key),
    totp: await dec(c.login?.totp, key),
    uris,
    notes: await dec(c.notes, key),
    favorite: c.favorite ?? false,
    folderId: c.folderId,
    fields,
    deletedDate: c.deletedDate,
    unknownFields: c._unknown ? Object.keys(c._unknown) : undefined,
  };
}
