import { useState } from 'preact/hooks';
import { generatePassword } from '@/lib/crypto/generate';
import type { DecryptedCipher } from '@/lib/crypto/decrypt';
import { createCipher, updateCipher, type CipherInput } from '@/lib/vaultwarden/ciphers';

/** 新建 / 编辑条目（登录类型） */
export default function EditView(props: {
  item: DecryptedCipher | null; // null = 新建
  folders: Map<string, string>;
  onDone: (changed: boolean) => Promise<void>;
}) {
  const existing = props.item;
  const [form, setForm] = useState<CipherInput>({
    name: existing?.name ?? '',
    username: existing?.username ?? '',
    password: existing?.password ?? '',
    uri: existing?.uris[0]?.uri ?? '',
    notes: existing?.notes ?? '',
    totp: existing?.totp ?? '',
    folderId: existing?.folderId ?? null,
    favorite: existing?.favorite ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);

  const set = (patch: Partial<CipherInput>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (existing) {
        await updateCipher(existing.id, form, existing);
      } else {
        await createCipher(form);
      }
      await props.onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const fillGenerated = () => {
    set({
      password: generatePassword({
        length: 20,
        upper: true,
        lower: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: false,
      }),
    });
    setShowPw(true);
  };

  const inputCls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

  return (
    <div class="flex h-full flex-col bg-white">
      <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <button
          class="text-gray-500 transition hover:text-gray-700"
          onClick={() => props.onDone(false)}
        >
          取消
        </button>
        <h2 class="font-semibold">{existing ? '编辑条目' : '新建条目'}</h2>
        <button
          class="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          disabled={!form.name.trim() || busy}
          onClick={save}
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>

      <div class="flex-1 space-y-3 overflow-y-auto p-4">
        <Field label="名称 *">
          <input
            class={inputCls}
            value={form.name}
            onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
          />
        </Field>

        <Field label="用户名">
          <input
            class={inputCls}
            value={form.username}
            onInput={(e) => set({ username: (e.target as HTMLInputElement).value })}
          />
        </Field>

        <Field label="密码">
          <div class="flex gap-1.5">
            <input
              type={showPw ? 'text' : 'password'}
              class={`${inputCls} font-mono`}
              value={form.password}
              onInput={(e) => set({ password: (e.target as HTMLInputElement).value })}
            />
            <button
              class="shrink-0 rounded-lg border border-gray-200 px-2 text-xs hover:bg-gray-50"
              title="生成密码"
              onClick={fillGenerated}
            >
              🎲
            </button>
            <button
              class="shrink-0 rounded-lg border border-gray-200 px-2 text-xs hover:bg-gray-50"
              onClick={() => setShowPw(!showPw)}
            >
              {showPw ? '隐藏' : '显示'}
            </button>
          </div>
        </Field>

        <Field label="网址">
          <input
            type="url"
            class={inputCls}
            placeholder="https://"
            value={form.uri}
            onInput={(e) => set({ uri: (e.target as HTMLInputElement).value })}
          />
        </Field>

        <Field label="TOTP 密钥（otpauth:// 或 base32）">
          <input
            class={`${inputCls} font-mono text-xs`}
            value={form.totp}
            onInput={(e) => set({ totp: (e.target as HTMLInputElement).value })}
          />
        </Field>

        {props.folders.size > 0 && (
          <Field label="文件夹">
            <select
              class={inputCls}
              value={form.folderId ?? ''}
              onChange={(e) =>
                set({ folderId: (e.target as HTMLSelectElement).value || null })
              }
            >
              <option value="">无文件夹</option>
              {[...props.folders.entries()].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="备注">
          <textarea
            class={`${inputCls} min-h-16 resize-y`}
            value={form.notes}
            onInput={(e) => set({ notes: (e.target as HTMLTextAreaElement).value })}
          />
        </Field>

        <label class="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={form.favorite}
            onChange={(e) => set({ favorite: (e.target as HTMLInputElement).checked })}
          />
          收藏（置顶显示）
        </label>

        {error && <p class="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}

function Field(props: { label: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <p class="mb-1 text-xs text-gray-500">{props.label}</p>
      {props.children}
    </div>
  );
}
