/** 密码生成器：crypto.getRandomValues 安全随机 */

export interface GenerateOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  /** 排除易混淆字符（Il1O0 等） */
  excludeAmbiguous: boolean;
}

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*',
};
const AMBIGUOUS = new Set('Il1O0');

export function generatePassword(opts: GenerateOptions): string {
  let pool = '';
  if (opts.upper) pool += SETS.upper;
  if (opts.lower) pool += SETS.lower;
  if (opts.digits) pool += SETS.digits;
  if (opts.symbols) pool += SETS.symbols;
  if (opts.excludeAmbiguous) pool = [...pool].filter((c) => !AMBIGUOUS.has(c)).join('');
  if (!pool || opts.length < 1) throw new Error('至少选择一种字符集');

  // 拒绝采样，消除取模偏差
  const maxValid = Math.floor(256 / pool.length) * pool.length;
  const out: string[] = [];
  while (out.length < opts.length) {
    for (const b of crypto.getRandomValues(new Uint8Array(opts.length))) {
      if (b < maxValid && out.length < opts.length) out.push(pool[b % pool.length]!);
    }
  }
  return out.join('');
}
