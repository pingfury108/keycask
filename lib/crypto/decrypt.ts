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
  uris: { uri: string; match?: number | null }[];
  notes?: string;
  favorite: boolean;
  folderId?: string | null;
  organizationId?: string | null;
  /** 卡片字段（type 3）：cardholderName/number/brand/expMonth/expYear/code */
  card?: Record<string, string>;
  /** 身份字段（type 4）：firstName/lastName/email/phone/address1 等 */
  identity?: Record<string, string>;
  fields: { name: string; value: string; type: number }[];
  deletedDate?: string | null;
  unknownFields?: string[];
  /** 原始密文字段，编辑回写时原样带回 */
  rawFields?: unknown[];
  rawPasswordHistory?: unknown[];
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
 * 组织条目（organizationId）用对应的组织密钥解密。
 */
export async function decryptCiphers(
  ciphers: CipherResponse[],
  key: Uint8Array,
  orgKeys?: Map<string, Uint8Array>,
): Promise<DecryptAllResult> {
  const ok: DecryptedCipher[] = [];
  const failed: FailedCipher[] = [];

  for (const c of ciphers) {
    try {
      let itemKey = key;
      if (c.organizationId) {
        const orgKey = orgKeys?.get(c.organizationId);
        if (!orgKey) throw new Error('缺少该条目的组织密钥');
        itemKey = orgKey;
      }
      ok.push(await decryptCipher(c, itemKey));
    } catch (e) {
      failed.push({ id: c.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

async function decryptCipher(c: CipherResponse, key: Uint8Array): Promise<DecryptedCipher> {
  // 注意：老版本 cipher.key 可能存在于条目级（条目密钥），M2 先按无条目密钥处理
  const uris: DecryptedCipher['uris'] = [];
  if (c.login?.uris) {
    for (const u of c.login.uris) {
      const uri = await dec(u.uri, key);
      if (uri) uris.push({ uri, match: u.match });
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
    organizationId: c.organizationId,
    card: await decryptStringMap(c.card, key),
    identity: await decryptStringMap(c.identity, key),
    fields,
    deletedDate: c.deletedDate,
    unknownFields: c._unknown ? Object.keys(c._unknown) : undefined,
    rawFields: c.fields ?? [],
    rawPasswordHistory: c.passwordHistory ?? [],
  };
}

/** Card/Identity：整个子对象的每个字段都是独立 EncString */
async function decryptStringMap(
  obj: Record<string, string | null> | null | undefined,
  key: Uint8Array,
): Promise<Record<string, string> | undefined> {
  if (!obj) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const plain = await dec(v, key);
    if (plain) out[k] = plain;
  }
  return out;
}
