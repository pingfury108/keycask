import { describe, expect, it } from 'vitest';
import { getHostname, getRegistrableDomain, uriMatches } from '@/lib/autofill/match-uri';

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

describe('uriMatches（Domain 策略）', () => {
  it('同域名不同子域匹配', () => {
    expect(uriMatches(['https://example.com'], 'https://login.example.com/signin')).toBe(true);
  });
  it('不同域名不匹配', () => {
    expect(uriMatches(['https://example.com'], 'https://evil-example.com')).toBe(false);
  });
  it('同 host 匹配', () => {
    expect(uriMatches(['https://a.example.com'], 'https://a.example.com/other')).toBe(true);
  });
  it('二级 TLD 场景', () => {
    expect(uriMatches(['https://example.com.cn'], 'https://app.example.com.cn')).toBe(true);
    expect(uriMatches(['https://a.com.cn'], 'https://b.com.cn')).toBe(false);
  });
  it('无协议的条目 URI 也能匹配', () => {
    expect(uriMatches(['example.com'], 'https://www.example.com')).toBe(true);
  });
  it('多 URI 任一命中即匹配', () => {
    expect(uriMatches(['https://foo.com', 'https://bar.com'], 'https://www.bar.com')).toBe(true);
  });
  it('空 URI 列表不匹配', () => {
    expect(uriMatches([], 'https://example.com')).toBe(false);
  });
});
