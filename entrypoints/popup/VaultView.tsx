import { useEffect, useMemo, useState } from 'preact/hooks';
import { fromB64 } from '@/lib/crypto/encoding';
import { decryptCiphers, type DecryptedCipher, type FailedCipher } from '@/lib/crypto/decrypt';
import { userKeyB64, orgKeysB64, vaultCiphersRaw } from '@/lib/store/settings';
import type { CipherResponse } from '@/lib/protocol/types';
import { CipherType } from '@/lib/protocol/types';

const TYPE_LABEL: Record<number, string> = {
  [CipherType.Login]: '登录',
  [CipherType.SecureNote]: '笔记',
  [CipherType.Card]: '卡片',
  [CipherType.Identity]: '身份',
  [CipherType.SshKey]: 'SSH',
};

async function loadOrgKeys(): Promise<Map<string, Uint8Array>> {
  const raw = (await orgKeysB64.getValue()) ?? {};
  return new Map(Object.entries(raw).map(([id, b64]) => [id, fromB64(b64)]));
}

export default function VaultView(props: { onLock: () => void }) {
  const [items, setItems] = useState<DecryptedCipher[]>([]);
  const [failed, setFailed] = useState<FailedCipher[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DecryptedCipher | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const keyB64 = await userKeyB64.getValue();
        const raw = (await vaultCiphersRaw.getValue()) ?? [];
        if (!keyB64) {
          props.onLock();
          return;
        }
        const { ok, failed } = await decryptCiphers(
          raw as CipherResponse[],
          fromB64(keyB64),
          await loadOrgKeys(),
        );
        setItems(ok);
        setFailed(failed);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.username?.toLowerCase().includes(q) ||
            i.uris.some((u) => u.toLowerCase().includes(q)),
        )
      : items;
    // 收藏优先，其次按名称
    return [...list].sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name),
    );
  }, [items, query]);

  if (selected) {
    return <ItemDetail item={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div class="flex h-[480px] flex-col">
      <div class="border-b border-gray-200 p-2">
        <input
          type="search"
          class="w-full rounded border border-gray-300 px-3 py-1.5"
          placeholder={`搜索 ${items.length} 个条目…`}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="flex-1 overflow-y-auto">
        {error && <p class="m-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}

        {filtered.map((item) => (
          <button
            key={item.id}
            class="flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50"
            onClick={() => setSelected(item)}
          >
            <span class="w-10 shrink-0 rounded bg-gray-100 px-1 py-0.5 text-center text-[10px] text-gray-500">
              {TYPE_LABEL[item.type] ?? `T${item.type}`}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{item.name}</span>
              {item.username && (
                <span class="block truncate text-xs text-gray-500">{item.username}</span>
              )}
            </span>
            {item.favorite && <span class="text-amber-500">★</span>}
          </button>
        ))}

        {!error && filtered.length === 0 && (
          <p class="p-4 text-center text-gray-400">
            {items.length === 0 ? '保险库为空' : '无匹配条目'}
          </p>
        )}
      </div>

      {/* 宽容解密：失败条目单独可见，绝不白屏 */}
      {failed.length > 0 && (
        <details class="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          <summary class="cursor-pointer">{failed.length} 条无法解密（点击查看原因）</summary>
          <ul class="mt-1 max-h-24 overflow-y-auto">
            {failed.map((f) => (
              <li key={f.id} class="truncate" title={f.id}>
                {f.id.slice(0, 8)}…：{f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div class="border-t border-gray-200 p-2">
        <button
          class="w-full rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
          onClick={props.onLock}
        >
          锁定
        </button>
      </div>
    </div>
  );
}

function ItemDetail(props: { item: DecryptedCipher; onBack: () => void }) {
  const { item } = props;
  return (
    <div class="flex h-[480px] flex-col">
      <div class="border-b border-gray-200 p-2">
        <button class="text-blue-600 hover:underline" onClick={props.onBack}>
          ← 返回
        </button>
      </div>
      <div class="flex-1 space-y-3 overflow-y-auto p-3">
        <h2 class="text-base font-bold">{item.name}</h2>

        {item.username && <CopyRow label="用户名" value={item.username} />}
        {item.password && <CopyRow label="密码" value={item.password} secret />}
        {item.totp && <CopyRow label="TOTP 密钥" value={item.totp} secret />}
        {item.uris.map((u) => (
          <div key={u}>
            <p class="text-xs text-gray-500">网址</p>
            <a
              class="block truncate text-blue-600 hover:underline"
              href={u}
              target="_blank"
              rel="noreferrer"
            >
              {u}
            </a>
          </div>
        ))}
        {item.notes && (
          <div>
            <p class="text-xs text-gray-500">备注</p>
            <p class="whitespace-pre-wrap rounded bg-gray-50 p-2">{item.notes}</p>
          </div>
        )}
        {item.fields.map((f, i) => (
          <CopyRow key={i} label={f.name || '自定义字段'} value={f.value} secret={f.type === 1} />
        ))}
      </div>
    </div>
  );
}

function CopyRow(props: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(props.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <p class="text-xs text-gray-500">{props.label}</p>
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1 font-mono">
          {props.secret && !show ? '••••••••' : props.value}
        </span>
        {props.secret && (
          <button
            class="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            onClick={() => setShow(!show)}
          >
            {show ? '隐藏' : '显示'}
          </button>
        )}
        <button
          class="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
          onClick={copy}
        >
          {copied ? '✓' : '复制'}
        </button>
      </div>
    </div>
  );
}
