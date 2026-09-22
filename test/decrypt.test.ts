import { describe, expect, it } from 'vitest';
import { encryptType2 } from '@/lib/crypto/enc-string';
import { decryptCiphers } from '@/lib/crypto/decrypt';
import { normalizeSyncResponse, g } from '@/lib/protocol/normalize';
import { toB64, utf8 } from '@/lib/crypto/encoding';
import type { CipherResponse } from '@/lib/protocol/types';

describe('g() 双大小写取值', () => {
  it('PascalCase 和 camelCase 都能取到', () => {
    expect(g({ Name: 'a' }, 'Name')).toBe('a');
    expect(g({ name: 'b' }, 'Name')).toBe('b');
    expect(g({}, 'Name')).toBeUndefined();
    expect(g(null, 'Name')).toBeUndefined();
  });
});

describe('normalizeSyncResponse', () => {
  it('老版 PascalCase 响应归一化为 camelCase，未知字段收编 _unknown', () => {
    const raw = {
      Profile: { Id: 'u1', Email: 'a@b.c', Key: 'k' },
      Folders: [{ Id: 'f1', Name: 'enc-folder' }],
      Ciphers: [
        {
          Id: 'c1',
          Type: 1,
          Name: 'enc-name',
          Login: { Username: 'enc-user', Password: 'enc-pass', Uris: [{ Uri: 'enc-uri' }] },
          FutureFieldFromNewServer: { nested: true },
        },
      ],
    };
    const sync = normalizeSyncResponse(raw);
    expect(sync.profile.email).toBe('a@b.c');
    expect(sync.ciphers).toHaveLength(1);
    expect(sync.ciphers[0]!.id).toBe('c1');
    expect(sync.ciphers[0]!.login?.username).toBe('enc-user');
    expect(sync.ciphers[0]!._unknown).toEqual({ FutureFieldFromNewServer: { nested: true } });
  });

  it('新版 camelCase 响应同样可用', () => {
    const sync = normalizeSyncResponse({
      profile: { id: 'u1', email: 'a@b.c' },
      ciphers: [{ id: 'c1', type: 1, name: 'x' }],
    });
    expect(sync.ciphers[0]!.name).toBe('x');
  });
});

describe('decryptCiphers（宽容解密）', () => {
  it('坏条目不影响好条目', async () => {
    const key = crypto.getRandomValues(new Uint8Array(64));
    const enc = (s: string) => encryptType2(utf8(s), key);

    const good: CipherResponse = {
      id: 'good',
      type: 1,
      name: await enc('GitHub'),
      revisionDate: '',
      login: { username: await enc('xiaoming'), password: await enc('hunter2') },
    };
    // MAC 全零的坏条目：必失败
    const bad: CipherResponse = {
      id: 'bad',
      type: 1,
      name: `2.${toB64(new Uint8Array(16))}|${toB64(new Uint8Array(32))}|${toB64(new Uint8Array(32))}`,
      revisionDate: '',
    };
    // type 7 条目：明确的不支持
    const future: CipherResponse = {
      id: 'future',
      type: 1,
      name: `7.${toB64(utf8('cose-payload'))}`,
      revisionDate: '',
    };

    const { ok, failed } = await decryptCiphers([good, bad, future], key);

    expect(ok).toHaveLength(1);
    expect(ok[0]!.name).toBe('GitHub');
    expect(ok[0]!.username).toBe('xiaoming');
    expect(ok[0]!.password).toBe('hunter2');

    expect(failed).toHaveLength(2);
    expect(failed.map((f) => f.id).sort()).toEqual(['bad', 'future']);
    expect(failed.find((f) => f.id === 'future')!.reason).toMatch(/暂不支持/);
  });

  it('null/空字段不误报失败', async () => {
    const key = crypto.getRandomValues(new Uint8Array(64));
    const c: CipherResponse = {
      id: 'minimal',
      type: 2,
      name: await encryptType2(utf8('笔记'), key),
      revisionDate: '',
      notes: null,
      login: null,
    };
    const { ok, failed } = await decryptCiphers([c], key);
    expect(failed).toHaveLength(0);
    expect(ok[0]!.name).toBe('笔记');
    expect(ok[0]!.notes).toBeUndefined();
  });
});
