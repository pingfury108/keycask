import { useEffect, useState } from 'preact/hooks';
import { generatePassword, type GenerateOptions } from '@/lib/crypto/generate';

export default function GeneratorView() {
  const [opts, setOpts] = useState<GenerateOptions>({
    length: 16,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
  });
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const regenerate = (o = opts) => {
    try {
      setPassword(generatePassword(o));
    } catch {
      setPassword('');
    }
  };

  useEffect(regenerate, []);

  const update = (patch: Partial<GenerateOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    regenerate(next);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="p-4">
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded bg-gray-100 px-3 py-2 font-mono">
          {password || '请选择字符集'}
        </code>
        <button
          class="shrink-0 rounded border border-gray-300 px-2 py-2 text-xs hover:bg-gray-50"
          onClick={() => regenerate()}
          title="重新生成"
        >
          ↻
        </button>
        <button
          class="shrink-0 rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={copy}
          disabled={!password}
        >
          {copied ? '✓' : '复制'}
        </button>
      </div>

      <label class="mt-4 block text-xs text-gray-500">长度：{opts.length}</label>
      <input
        type="range"
        min="8"
        max="64"
        value={opts.length}
        class="w-full"
        onInput={(e) => update({ length: Number((e.target as HTMLInputElement).value) })}
      />

      <div class="mt-2 space-y-1.5">
        {(
          [
            ['upper', '大写字母 A-Z'],
            ['lower', '小写字母 a-z'],
            ['digits', '数字 0-9'],
            ['symbols', '符号 !@#$%^&*'],
            ['excludeAmbiguous', '排除易混淆字符（Il1O0）'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={opts[key]}
              onChange={(e) => update({ [key]: (e.target as HTMLInputElement).checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
