import { describe, expect, it } from 'vitest';
import { hkdfExpand, masterPasswordHash, normalizeEmail, parsePrelogin, pbkdf2Sha256 } from '@/lib/crypto/kdf';
import {
  decryptToBytes,
  encryptType2,
  MacMismatchError,
  parseEncString,
  UnsupportedEncryptionTypeError,
} from '@/lib/crypto/enc-string';
import { fromB64, toB64, utf8 } from '@/lib/crypto/encoding';

function toHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

describe('PBKDF2-SHA256', () => {
  it('RFC 6070 向量', async () => {
    const out = await pbkdf2Sha256(utf8('password'), utf8('salt'), 1, 32);
    expect(toHex(out)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  });
});

describe('HKDF-Expand', () => {
  it('RFC 5869 Test Case 1（多轮 expand）', async () => {
    // Test Case 1 中 Extract 输出的 PRK；Expand 输入 info=0xf0..f9，L=42
    const prk = new Uint8Array(
      '077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5'
        .match(/../g)!
        .map((h) => parseInt(h, 16)),
    );
    const info = new Uint8Array([...Array(10).keys()].map((i) => 0xf0 + i));
    const okm = await hkdfExpand(prk, info, 42);
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a' +
        '2d2d0a90cf1a5a4c5db02d56ecc4c5bf' +
        '34007208d5b887185865',
    );
  });
});

describe('normalizeEmail', () => {
  it('trim + 小写', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });
});

describe('masterPasswordHash', () => {
  it('确定性：MasterKey 为密码输入、主密码为盐、迭代 1', async () => {
    const masterKey = new Uint8Array(32).fill(7);
    const h1 = await masterPasswordHash('correct horse', masterKey);
    const h2 = await masterPasswordHash('correct horse', masterKey);
    expect(h1).toBe(h2);
    // 方向锁定：pbkdf2(password=masterKey, salt=utf8(主密码), 1)
    const expectB64 = toB64(await pbkdf2Sha256(masterKey, utf8('correct horse'), 1, 32));
    expect(h1).toBe(expectB64);
  });
});

describe('EncString', () => {
  it('type 2 加密-解析-解密回环', async () => {
    const key = crypto.getRandomValues(new Uint8Array(64));
    const raw = await encryptType2(utf8('我的密码 hunter2'), key);
    expect(raw.startsWith('2.')).toBe(true);

    const parsed = parseEncString(raw);
    expect(parsed.type).toBe(2);
    const plain = await decryptToBytes(parsed, key);
    expect(new TextDecoder().decode(plain)).toBe('我的密码 hunter2');
  });

  it('MAC 被篡改时拒绝解密', async () => {
    const key = crypto.getRandomValues(new Uint8Array(64));
    const raw = await encryptType2(utf8('data'), key);
    const parsed = parseEncString(raw);
    parsed.data = new Uint8Array(parsed.data); // 复制避免改到原引用
    parsed.data[0]! ^= 0xff;
    await expect(decryptToBytes(parsed, key)).rejects.toBeInstanceOf(MacMismatchError);
  });

  it('type 7（CoseEncrypt0）走明确的不支持错误，而不是崩溃', async () => {
    const raw = `7.${toB64(utf8('fake-cose-payload'))}`;
    const parsed = parseEncString(raw);
    await expect(decryptToBytes(parsed, new Uint8Array(64))).rejects.toBeInstanceOf(
      UnsupportedEncryptionTypeError,
    );
  });

  it('解析 type 0（无 MAC）', async () => {
    const iv = toB64(new Uint8Array(16));
    const data = toB64(utf8('0123456789abcdef'));
    const parsed = parseEncString(`0.${iv}|${data}`);
    expect(parsed.type).toBe(0);
    expect(parsed.iv?.length).toBe(16);
    expect(parsed.mac).toBeUndefined();
  });
});

describe('parsePrelogin 防降级校验', () => {
  it('Argon2id 迭代数 3 是合法的（不能与 PBKDF2 共用一个下限）', () => {
    const cfg = parsePrelogin({
      kind: 'legacy',
      res: { Kdf: 1, KdfIterations: 3, KdfMemory: 64, KdfParallelism: 4 },
    });
    expect(cfg.type).toBe(1);
    expect(cfg.iterations).toBe(3);
  });

  it('老端点 camelCase 响应也能解析', () => {
    const cfg = parsePrelogin({
      kind: 'legacy',
      res: { kdf: 0, kdfIterations: 100_000 },
    });
    expect(cfg.type).toBe(0);
    expect(cfg.iterations).toBe(100_000);
  });

  it('PBKDF2 迭代数低于 5000 拒绝（防降级攻击）', () => {
    expect(() =>
      parsePrelogin({ kind: 'legacy', res: { Kdf: 0, KdfIterations: 100 } }),
    ).toThrow(/低于安全下限/);
  });

  it('Argon2id 迭代数低于 2 拒绝', () => {
    expect(() =>
      parsePrelogin({
        kind: 'legacy',
        res: { Kdf: 1, KdfIterations: 1, KdfMemory: 64, KdfParallelism: 4 },
      }),
    ).toThrow(/低于下限/);
  });
});

describe('encoding', () => {
  it('base64 回环', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(33));
    expect(fromB64(toB64(bytes))).toEqual(bytes);
  });
});
