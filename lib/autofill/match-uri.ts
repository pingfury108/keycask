/**
 * URI 匹配（复刻官方 login-uri.view.ts 的默认策略：Domain 匹配）。
 * 简化：不内置完整 public suffix 列表，用常见二级 TLD 兜底。
 */

/** 常见二级后缀（registrable domain 需要多取一段） */
const SECOND_LEVEL_TLDS = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'co.jp', 'or.jp', 'ne.jp',
  'com.au', 'net.au', 'org.au',
  'com.tw', 'org.tw', 'com.hk',
  'co.kr', 'or.kr',
]);

export function getHostname(uri: string): string | null {
  try {
    // 容错：允许用户存了不带协议的 URI
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `https://${uri}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 取可注册域名：example.com / example.com.cn */
export function getRegistrableDomain(hostname: string): string {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  const last2 = parts.slice(-2).join('.');
  if (SECOND_LEVEL_TLDS.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return last2;
}

/** 官方 UriMatchStrategy 枚举（条目级可覆盖默认 Domain） */
export const enum UriMatchStrategy {
  Domain = 0,
  Host = 1,
  StartsWith = 2,
  Exact = 3,
  RegularExpression = 4,
  Never = 5,
}

/**
 * 单条 URI 是否匹配页面（strategy 缺省走 Domain）。
 */
export function uriMatch(
  itemUri: string,
  pageUrl: string,
  strategy: UriMatchStrategy | null = null,
): boolean {
  if (!itemUri) return false;
  const s = strategy ?? UriMatchStrategy.Domain;
  if (s === UriMatchStrategy.Never) return false;

  if (s === UriMatchStrategy.Exact) return itemUri.toLowerCase() === pageUrl.toLowerCase();
  if (s === UriMatchStrategy.StartsWith)
    return pageUrl.toLowerCase().startsWith(itemUri.toLowerCase());
  if (s === UriMatchStrategy.RegularExpression) {
    try {
      return new RegExp(itemUri, 'i').test(pageUrl);
    } catch {
      return false; // 非法正则视为不匹配（官方同行为）
    }
  }

  const pageHost = getHostname(pageUrl);
  const itemHost = getHostname(itemUri);
  if (!pageHost || !itemHost) return false;

  if (s === UriMatchStrategy.Host) return itemHost === pageHost;
  // Domain：可注册域名相同（含 host 全同）
  return itemHost === pageHost || getRegistrableDomain(itemHost) === getRegistrableDomain(pageHost);
}

/**
 * 条目是否匹配当前页面 URL（Domain 策略 + 条目级覆盖）。
 * 任一 URI 匹配即算命中。
 */
export function uriMatches(
  itemUris: { uri: string; match?: number | null }[],
  pageUrl: string,
): boolean {
  return itemUris.some((u) => uriMatch(u.uri, pageUrl, u.match as UriMatchStrategy | null));
}
