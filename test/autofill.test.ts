import { describe, expect, it } from 'vitest';
import { getHostname, getRegistrableDomain, uriMatch, uriMatches, UriMatchStrategy } from '@/lib/autofill/match-uri';

const u = (uri: string, match: number | null = null) => ({ uri, match });

describe('getHostname', () => {
  it('解析带协议的 URL', () => {
    expect(getHostname('https://Login.Example.COM:8443/path')).toBe('login.example.com');
  });
  it('容忍无协议的 URI', () => {
    expect(getHostname('example.com/login')).toBe('example.com');
  });
  it('非法 URI 返回 null', () => {
    expect(getHostname('')).toBeNull();
  });
});

describe('getRegistrableDomain', () => {
  it('常规域名取后两段', () => {
    expect(getRegistrableDomain('login.example.com')).toBe('example.com');
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });
  it('二级 TLD 取后三段', () => {
    expect(getRegistrableDomain('mail.example.com.cn')).toBe('example.com.cn');
    expect(getRegistrableDomain('www.example.co.uk')).toBe('example.co.uk');
  });
});

describe('uriMatches（默认 Domain 策略）', () => {
  it('同域名不同子域匹配', () => {
    expect(uriMatches([u('https://example.com')], 'https://login.example.com/signin')).toBe(true);
  });
  it('不同域名不匹配', () => {
    expect(uriMatches([u('https://example.com')], 'https://evil-example.com')).toBe(false);
  });
  it('同 host 匹配', () => {
    expect(uriMatches([u('https://a.example.com')], 'https://a.example.com/other')).toBe(true);
  });
  it('二级 TLD 场景', () => {
    expect(uriMatches([u('https://example.com.cn')], 'https://app.example.com.cn')).toBe(true);
    expect(uriMatches([u('https://a.com.cn')], 'https://b.com.cn')).toBe(false);
  });
  it('无协议的条目 URI 也能匹配', () => {
    expect(uriMatches([u('example.com')], 'https://www.example.com')).toBe(true);
  });
  it('多 URI 任一命中即匹配', () => {
    expect(uriMatches([u('https://foo.com'), u('https://bar.com')], 'https://www.bar.com')).toBe(true);
  });
  it('空 URI 列表不匹配', () => {
    expect(uriMatches([], 'https://example.com')).toBe(false);
  });
});

describe('uriMatch 条目级策略覆盖', () => {
  const page = 'https://login.example.com/auth?next=/home';

  it('Host：子域不同不匹配', () => {
    expect(uriMatch('https://example.com', page, UriMatchStrategy.Host)).toBe(false);
    expect(uriMatch('https://login.example.com', page, UriMatchStrategy.Host)).toBe(true);
  });
  it('StartsWith', () => {
    expect(uriMatch('https://login.example.com/auth', page, UriMatchStrategy.StartsWith)).toBe(true);
    expect(uriMatch('https://login.example.com/other', page, UriMatchStrategy.StartsWith)).toBe(false);
  });
  it('Exact：严格相等', () => {
    expect(uriMatch(page, page, UriMatchStrategy.Exact)).toBe(true);
    expect(uriMatch('https://login.example.com/auth', page, UriMatchStrategy.Exact)).toBe(false);
  });
  it('RegularExpression：非法正则不匹配', () => {
    expect(uriMatch('example\\.com.*auth', page, UriMatchStrategy.RegularExpression)).toBe(true);
    expect(uriMatch('[invalid', page, UriMatchStrategy.RegularExpression)).toBe(false);
  });
  it('Never：永不匹配', () => {
    expect(uriMatch('https://login.example.com', page, UriMatchStrategy.Never)).toBe(false);
  });
  it('uriMatches 中策略为 Never 的 URI 被跳过', () => {
    expect(uriMatches([u('https://login.example.com', 5)], page)).toBe(false);
  });
});
