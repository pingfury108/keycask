import { fromB64 } from '@/lib/crypto/encoding';
import { decryptCiphers, type DecryptedCipher } from '@/lib/crypto/decrypt';
import { getHostname, uriMatches } from '@/lib/autofill/match-uri';
import { CipherType } from '@/lib/protocol/types';
import type { CipherResponse } from '@/lib/protocol/types';
import { neverDomains, orgKeysB64, userKeyB64, vaultCiphersRaw } from '@/lib/store/settings';

export interface MatchItem {
  id: string;
  name: string;
  username?: string;
  password?: string;
  totp?: string;
}

export interface MatchResult {
  locked: boolean;
  items: MatchItem[];
}

// SW 内存缓存：解密整个保险库有成本，storage 变更时失效
let cache: { items: DecryptedCipher[] } | null = null;

export function invalidateMatchCache(): void {
  cache = null;
}

export function watchMatchCache(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (
      (area === 'local' && changes.vaultCiphers) ||
      (area === 'session' && (changes.userKey || changes.orgKeys))
    ) {
      invalidateMatchCache();
    }
  });
}

async function getDecryptedLogins(): Promise<DecryptedCipher[] | null> {
  if (cache) return cache.items;
  const keyB64 = await userKeyB64.getValue();
  if (!keyB64) return null;
  const orgs = (await orgKeysB64.getValue()) ?? {};
  const orgKeys = new Map(Object.entries(orgs).map(([id, b64]) => [id, fromB64(b64)]));
  const raw = ((await vaultCiphersRaw.getValue()) ?? []) as CipherResponse[];
  const { ok } = await decryptCiphers(raw, fromB64(keyB64), orgKeys);
  const items = ok.filter((c) => c.type === CipherType.Login && !c.deletedDate);
  cache = { items };
  return items;
}

/** 当前页面 URL → 匹配的登录条目（条目级策略覆盖，默认 Domain） */
export async function getLoginMatches(pageUrl: string): Promise<MatchResult> {
  const items = await getDecryptedLogins();
  if (!items) return { locked: true, items: [] };
  return {
    locked: false,
    items: items
      .filter((c) => c.uris.length > 0 && uriMatches(c.uris, pageUrl))
      .map((c) => ({ id: c.id, name: c.name, username: c.username, password: c.password, totp: c.totp })),
  };
}

// ---------- 保存新密码提示 ----------

export type SavePromptVerdict = 'ask' | 'exists' | 'never' | 'locked';

/** 是否应向用户弹「保存密码」提示条 */
export async function checkSavePrompt(
  pageUrl: string,
  username: string,
): Promise<SavePromptVerdict> {
  const host = getHostname(pageUrl);
  if (host && (await neverDomains.getValue()).includes(host)) return 'never';

  const items = await getDecryptedLogins();
  if (!items) return 'locked';
  const matched = items.filter((c) => c.uris.length > 0 && uriMatches(c.uris, pageUrl));
  // 同站同名用户已存在 → 不打扰（更新提示留到后续版本）
  if (matched.some((c) => c.username === username)) return 'exists';
  return 'ask';
}

/** 「不再提示此网站」 */
export async function addNeverDomain(pageUrl: string): Promise<void> {
  const host = getHostname(pageUrl);
  if (!host) return;
  const list = await neverDomains.getValue();
  if (!list.includes(host)) await neverDomains.setValue([...list, host]);
}
