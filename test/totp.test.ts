import { describe, expect, it } from 'vitest';
import { base32Decode, generateTotp, parseTotp } from '@/lib/crypto/totp';
import { generatePassword } from '@/lib/crypto/generate';

describe('base32Decode', () => {
  it('RFC 4648 向量', () => {
    expect(new TextDecoder().decode(base32Decode('MY======'))).toBe('f');
    expect(new TextDecoder().decode(base32Decode('MZXQ===='))).toBe('fo');
    expect(new TextDecoder().decode(base32Decode('MZXW6YQ='))).toBe('foob');
    // 容忍空格与小写
    expect(new TextDecoder().decode(base32Decode('mzxw 6yq'))).toBe('foob');
  });
});

describe('generateTotp', () => {
  // RFC 6238 附录 B 测试向量（secret 为 ASCII '12345678901234567890'）
  const secret = new TextEncoder().encode('12345678901234567890');

  it('RFC 6238 SHA-1 向量', async () => {
    const p = { secret, digits: 8, period: 30, algorithm: 'SHA-1' as const };
    expect(await generateTotp(p, 59_000)).toBe('94287082');
    expect(await generateTotp(p, 1_111_111_109_000)).toBe('07081804');
    expect(await generateTotp(p, 2_000_000_000_000)).toBe('69279037');
  });

  it('RFC 6238 SHA-256 向量（SHA-256 用 32 字节 secret）', async () => {
    const secret32 = new TextEncoder().encode('12345678901234567890123456789012');
    const p = { secret: secret32, digits: 8, period: 30, algorithm: 'SHA-256' as const };
    expect(await generateTotp(p, 59_000)).toBe('46119246');
  });
});

describe('parseTotp', () => {
  it('解析 otpauth:// URI 的参数', () => {
    const p = parseTotp('otpauth://totp/a@b?secret=MZXW6YQ&digits=8&period=60&algorithm=SHA256');
    expect(p.digits).toBe(8);
    expect(p.period).toBe(60);
    expect(p.algorithm).toBe('SHA-256');
  });

  it('裸 secret 走默认值', () => {
    const p = parseTotp('MZXW6YQ');
    expect(p.digits).toBe(6);
    expect(p.period).toBe(30);
    expect(p.algorithm).toBe('SHA-1');
  });
});

describe('generatePassword', () => {
  it('长度与字符集正确', () => {
    const p = generatePassword({ length: 32, upper: true, lower: false, digits: false, symbols: false, excludeAmbiguous: false });
    expect(p).toHaveLength(32);
    expect(/^[A-Z]+$/.test(p)).toBe(true);
  });

  it('排除易混淆字符', () => {
    const p = generatePassword({ length: 64, upper: true, lower: true, digits: true, symbols: false, excludeAmbiguous: true });
    expect(/[Il1O0]/.test(p)).toBe(false);
  });

  it('全不选时报错', () => {
    expect(() =>
      generatePassword({ length: 16, upper: false, lower: false, digits: false, symbols: false, excludeAmbiguous: false }),
    ).toThrow();
  });
});
