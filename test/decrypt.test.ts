import { describe, expect, it } from 'vitest';
import { encryptType2, parseEncString } from '@/lib/crypto/enc-string';
import { decryptCiphers } from '@/lib/crypto/decrypt';
import { rsaOaepSha1Decrypt } from '@/lib/crypto/rsa';
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

describe('组织密钥链', () => {
  it('RSA-OAEP-SHA1 解开组织密钥，组织条目用组织密钥解密', async () => {
    // 生成 RSA 密钥对（模拟服务端分发）
    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
      true,
      ['encrypt', 'decrypt'],
    );
    const privDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

    // 组织密钥 64B，用公钥加密成 type 4 EncString（4.<b64>）
    const orgKey = crypto.getRandomValues(new Uint8Array(64));
    const encOrgKey = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, orgKey as BufferSource),
    );
    const encString = `4.${toB64(encOrgKey)}`;

    // 客户端侧：解析 + 私钥解密
    const parsed = parseEncString(encString);
    const decryptedOrgKey = await rsaOaepSha1Decrypt(parsed.data, privDer);
    expect(decryptedOrgKey).toEqual(orgKey);

    // 组织条目用组织密钥加密的 name，个人条目用用户密钥
    const userKey = crypto.getRandomValues(new Uint8Array(64));
    const orgCipher: CipherResponse = {
      id: 'org-1',
      organizationId: 'org-x',
      type: 1,
      name: await encryptType2(utf8('组织机密'), orgKey),
      revisionDate: '',
    };
    const personal: CipherResponse = {
      id: 'p-1',
      type: 1,
      name: await encryptType2(utf8('个人条目'), userKey),
      revisionDate: '',
    };

    const orgKeys = new Map([['org-x', decryptedOrgKey]]);
    const { ok, failed } = await decryptCiphers([orgCipher, personal], userKey, orgKeys);
    expect(failed).toHaveLength(0);
    expect(ok.map((i) => i.name).sort()).toEqual(['个人条目', '组织机密']);
  });

  it('缺组织密钥时该条进 failed，不影响其他条目', async () => {
    const userKey = crypto.getRandomValues(new Uint8Array(64));
    const orgCipher: CipherResponse = {
      id: 'org-1',
      organizationId: 'org-missing',
      type: 1,
      name: await encryptType2(utf8('x'), userKey),
      revisionDate: '',
    };
    const { ok, failed } = await decryptCiphers([orgCipher], userKey, new Map());
    expect(ok).toHaveLength(0);
    expect(failed[0]!.reason).toMatch(/组织密钥/);
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

  it('null/空字段不误报失败', async () => {    const key = crypto.getRandomValues(new Uint8Array(64));
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
