import { describe, expect, it } from 'vitest';
import { VaultwardenClient } from '@/lib/vaultwarden/client';
import { PRELOGIN_ITERATIONS_MIN, KDF_DEFAULTS } from '@/lib/protocol/types';

describe('VaultwardenClient', () => {
  it('规范化 baseUrl 末尾斜杠', async () => {
    const client = new VaultwardenClient('https://vault.example.com/');
    // 通过拦截 fetch 验证最终 URL
    let called = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      called = String(input);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await client.getConfig();
    expect(called).toBe('https://vault.example.com/api/config');
  });
});

describe('协议常量', () => {
  it('预登录迭代下限（防降级攻击）', () => {
    expect(PRELOGIN_ITERATIONS_MIN).toBe(5_000);
    expect(KDF_DEFAULTS.pbkdf2Iterations).toBe(600_000);
  });
});
