/** TOTP（RFC 6238）：解析 otpauth:// URI 或裸 base32 secret，WebCrypto HMAC 算码 */

export interface TotpParams {
  secret: Uint8Array;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
}

export function parseTotp(input: string): TotpParams {
  const trimmed = input.trim();
  if (trimmed.startsWith('otpauth://')) {
    const url = new URL(trimmed);
    const secret = url.searchParams.get('secret');
    if (!secret) throw new Error('TOTP URI 缺少 secret');
    const algo = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
    return {
      secret: base32Decode(secret),
      digits: Number(url.searchParams.get('digits') ?? 6),
      period: Number(url.searchParams.get('period') ?? 30),
      algorithm: algo === 'SHA256' ? 'SHA-256' : algo === 'SHA512' ? 'SHA-512' : 'SHA-1',
    };
  }
  // 裸 secret（base32，可带空格）
  return { secret: base32Decode(trimmed), digits: 6, period: 30, algorithm: 'SHA-1' };
}

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, '').toUpperCase();
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let idx = 0;
  for (const ch of clean) {
    const val = B32_ALPHABET.indexOf(ch);
    if (val < 0) throw new Error(`非法 base32 字符: ${ch}`);
    buffer = (buffer << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[idx++] = (buffer >>> bits) & 0xff;
    }
  }
  return out.subarray(0, idx);
}

export async function generateTotp(
  params: TotpParams,
  timestampMs: number = Date.now(),
): Promise<string> {
  const counter = Math.floor(timestampMs / 1000 / params.period);
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setUint32(4, counter, false);

  const key = await crypto.subtle.importKey(
    'raw',
    params.secret as BufferSource,
    { name: 'HMAC', hash: params.algorithm },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));

  // 动态截断（RFC 4226）
  const offset = mac[mac.length - 1]! & 0x0f;
  const code =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(code % 10 ** params.digits).padStart(params.digits, '0');
}
