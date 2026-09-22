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

/**
 * 条目是否匹配当前页面 URL（Domain 策略 + startsWith 兜底）。
 * 任一 URI 匹配即算命中。
 */
export function uriMatches(itemUris: string[], pageUrl: string): boolean {
  const pageHost = getHostname(pageUrl);
  if (!pageHost) return false;
  const pageDomain = getRegistrableDomain(pageHost);

  for (const raw of itemUris) {
    if (!raw) continue;
    const itemHost = getHostname(raw);
    if (!itemHost) {
      // 无法解析的 URI：退化为主页 URL 前缀匹配
      if (pageUrl.toLowerCase().startsWith(raw.toLowerCase())) return true;
      continue;
    }
    // 完整 host 相同，或可注册域名相同
    if (itemHost === pageHost) return true;
    if (getRegistrableDomain(itemHost) === pageDomain) return true;
  }
  return false;
}
