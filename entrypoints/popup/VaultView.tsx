import { useEffect, useMemo, useState } from 'preact/hooks';
import { fromB64 } from '@/lib/crypto/encoding';
import { decryptCiphers, type DecryptedCipher, type FailedCipher } from '@/lib/crypto/decrypt';
import { loadOrgKeys, lock, recordSyncStats, syncVault } from '@/lib/vaultwarden/auth';
import { trashCipher } from '@/lib/vaultwarden/ciphers';
import { userKeyB64, vaultCiphersRaw, vaultFoldersRaw, lastSyncAt } from '@/lib/store/settings';
import type { CipherResponse, FolderResponse } from '@/lib/protocol/types';
import { CipherType } from '@/lib/protocol/types';
import { parseTotp, generateTotp } from '@/lib/crypto/totp';
import { parseAndDecrypt } from '@/lib/crypto/enc-string';
import { uriMatches } from '@/lib/autofill/match-uri';
import EditView from './EditView';

const TYPE_LABEL: Record<number, string> = {
  [CipherType.Login]: '登录',
  [CipherType.SecureNote]: '笔记',
  [CipherType.Card]: '卡片',
  [CipherType.Identity]: '身份',
  [CipherType.SshKey]: 'SSH',
};

const TYPE_COLOR: Record<number, string> = {
  [CipherType.Login]: 'bg-blue-100 text-blue-700',
  [CipherType.SecureNote]: 'bg-gray-100 text-gray-600',
  [CipherType.Card]: 'bg-emerald-100 text-emerald-700',
  [CipherType.Identity]: 'bg-violet-100 text-violet-700',
  [CipherType.SshKey]: 'bg-amber-100 text-amber-700',
};

/** 解密文件夹名（用户密钥），失败的文件夹静默跳过 */
async function loadFolderNames(key: Uint8Array): Promise<Map<string, string>> {
  const raw = ((await vaultFoldersRaw.getValue()) ?? []) as FolderResponse[];
  const map = new Map<string, string>();
  for (const f of raw) {
    try {
      map.set(f.id, await parseAndDecrypt(f.name, key));
    } catch {
      /* 单个文件夹失败不影响 */
    }
  }
  return map;
}

export default function VaultView(props: { onLock: () => void; onLogout: () => void }) {
  const [items, setItems] = useState<DecryptedCipher[]>([]);
  const [failed, setFailed] = useState<FailedCipher[]>([]);
  const [query, setQuery] = useState('');
  const [folders, setFolders] = useState<Map<string, string>>(new Map());
  const [folderFilter, setFolderFilter] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [error, setError] = useState('');
  const [tabUrl, setTabUrl] = useState('');
  // 路由：列表 / 详情 / 编辑（新建是 edit 无 item）
  const [route, setRoute] = useState<
    { name: 'list' } | { name: 'detail'; item: DecryptedCipher } | { name: 'edit'; item: DecryptedCipher | null }
  >({ name: 'list' });

  const reload = async () => {
    const keyB64 = await userKeyB64.getValue();
    const raw = (await vaultCiphersRaw.getValue()) ?? [];
    if (!keyB64) {
      props.onLock();
      return;
    }
    const userKey = fromB64(keyB64);
    const { ok, failed } = await decryptCiphers(
      raw as CipherResponse[],
      userKey,
      await loadOrgKeys(),
    );
    setItems(ok);
    setFailed(failed);
    setFolders(await loadFolderNames(userKey));
    await recordSyncStats(ok.length, failed);
  };

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // 当前标签页 URL（host 权限已够，无需 tabs 权限）
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url && /^https?:/.test(tab.url)) setTabUrl(tab.url);
    });
  }, []);

  /** 当前网站匹配的条目（置顶区，点击即填充） */
  const tabMatches = useMemo(
    () =>
      tabUrl
        ? items.filter(
            (i) =>
              i.type === CipherType.Login &&
              !i.deletedDate &&
              i.uris.length > 0 &&
              uriMatches(i.uris, tabUrl),
          )
        : [],
    [items, tabUrl],
  );

  const fillToTab = async (item: DecryptedCipher) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await browser.tabs.sendMessage(tab.id, {
        type: 'keycask:fill',
        item: { id: item.id, name: item.name, username: item.username, password: item.password },
      });
      window.close();
    } catch {
      // 页面未加载 content script（扩展重载前的旧标签页）：提示刷新
      setError('当前页面未加载填充脚本，请刷新页面后重试');
    }
  };

  const doSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg('');
    try {
      const r = await syncVault();
      await reload();
      setSyncMsg(`已同步 ${r.cipherCount} 条`);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : '同步失败');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(''), 3000);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) => {
      if (i.deletedDate) return false; // 回收站条目不进主列表
      if (folderFilter === '__none__' && i.folderId) return false;
      if (folderFilter && folderFilter !== '__none__' && i.folderId !== folderFilter) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.username?.toLowerCase().includes(q) ||
        i.uris.some((u) => u.toLowerCase().includes(q))
      );
    });
    return [...list].sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name),
    );
  }, [items, query, folderFilter]);

  if (route.name === 'edit') {
    return (
      <EditView
        item={route.item}
        folders={folders}
        onDone={async (changed) => {
          setRoute({ name: 'list' });
          if (changed) {
            await doSync();
          }
        }}
      />
    );
  }

  if (route.name === 'detail') {
    return (
      <ItemDetail
        item={route.item}
        folders={folders}
        onBack={() => setRoute({ name: 'list' })}
        onEdit={() => setRoute({ name: 'edit', item: route.item })}
        onTrash={async () => {
          await trashCipher(route.item.id);
          await doSync();
          setRoute({ name: 'list' });
        }}
      />
    );
  }

  return (
    <div class="flex h-full flex-col overflow-hidden bg-white">
      {/* 搜索 + 操作区（固定） */}
      <div class="shrink-0 space-y-1.5 border-b border-gray-100 p-2.5">
        <div class="flex gap-1.5">
          <input
            type="search"
            class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            placeholder={`搜索 ${items.length} 个条目…`}
            value={query}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          <button
            class="shrink-0 rounded-lg border border-gray-200 px-2.5 text-gray-500 transition hover:bg-gray-50 disabled:opacity-50"
            title="同步"
            disabled={syncing}
            onClick={doSync}
          >
            <span class={syncing ? 'inline-block animate-spin' : ''}>↻</span>
          </button>
          <button
            class="shrink-0 rounded-lg bg-blue-600 px-2.5 text-white transition hover:bg-blue-700"
            title="新建条目"
            onClick={() => setRoute({ name: 'edit', item: null })}
          >
            ＋
          </button>
        </div>
        {folders.size > 0 && (
          <select
            class="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600"
            value={folderFilter}
            onChange={(e) => setFolderFilter((e.target as HTMLSelectElement).value)}
          >
            <option value="">全部文件夹</option>
            {[...folders.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            <option value="__none__">无文件夹</option>
          </select>
        )}
        {syncMsg && <p class="text-xs text-gray-400">{syncMsg}</p>}
      </div>

      {/* 列表：唯一滚动区 */}
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && <p class="m-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

        {tabMatches.length > 0 && !query && (
          <>
            <p class="bg-gray-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              当前网站
            </p>
            {tabMatches.map((item) => (
              <div
                key={item.id}
                class="flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2.5 transition hover:bg-blue-50/50"
              >
                <button
                  class="flex min-w-0 flex-1 items-center gap-3 text-left"
                  title="点击填充到当前页面"
                  onClick={() => fillToTab(item)}
                >
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                    {item.name[0]?.toUpperCase() ?? '?'}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium leading-tight">{item.name}</span>
                    <span class="block truncate text-xs leading-tight text-gray-400">
                      {item.username ?? ''}
                    </span>
                  </span>
                </button>
                <button
                  class="shrink-0 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-100"
                  title="查看详情"
                  onClick={() => setRoute({ name: 'detail', item })}
                >
                  ›
                </button>
              </div>
            ))}
            <p class="bg-gray-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              全部条目
            </p>
          </>
        )}

        {filtered.map((item) => (
          <button
            key={item.id}
            class="group flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2.5 text-left transition hover:bg-blue-50/50"
            onClick={() => setRoute({ name: 'detail', item })}
          >
            <span
              class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                TYPE_COLOR[item.type] ?? 'bg-gray-100 text-gray-600'
              }`}
            >
              {item.name[0]?.toUpperCase() ?? '?'}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium leading-tight">
                {item.favorite && <span class="mr-1 text-amber-400">★</span>}
                {item.name}
              </span>
              <span class="block truncate text-xs leading-tight text-gray-400">
                {TYPE_LABEL[item.type] ?? `类型${item.type}`}
                {item.username ? ` · ${item.username}` : ''}
              </span>
            </span>
          </button>
        ))}

        {!error && filtered.length === 0 && (
          <div class="p-8 text-center text-gray-300">
            <p class="text-3xl">🗝️</p>
            <p class="mt-2 text-sm text-gray-400">
              {items.length === 0 ? '保险库为空，点右上角 ＋ 新建' : '无匹配条目'}
            </p>
          </div>
        )}
      </div>

      {/* 宽容解密：失败条目单独可见，绝不白屏（固定，不随列表滚动） */}
      {failed.length > 0 && (
        <details class="max-h-32 shrink-0 overflow-y-auto border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
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

      {/* 底部状态栏（固定）：同步时间 + 锁定 */}
      <div class="flex shrink-0 items-center justify-between border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
        <LastSyncLabel />
        <button
          class="rounded px-2 py-0.5 text-gray-500 transition hover:bg-gray-100"
          onClick={async () => {
            await lock();
            props.onLock();
          }}
        >
          🔒 锁定
        </button>
      </div>
    </div>
  );
}

function LastSyncLabel() {
  const [label, setLabel] = useState('');
  useEffect(() => {
    lastSyncAt.getValue().then((t) => {
      if (t) setLabel(`上次同步 ${new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
    });
  }, []);
  return <span>{label}</span>;
}

// ---------- 详情 ----------

function ItemDetail(props: {
  item: DecryptedCipher;
  folders: Map<string, string>;
  onBack: () => void;
  onEdit: () => void;
  onTrash: () => Promise<void>;
}) {
  const { item } = props;
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const folderName = item.folderId ? props.folders.get(item.folderId) : undefined;

  const trash = async () => {
    if (!confirmTrash) {
      setConfirmTrash(true);
      setTimeout(() => setConfirmTrash(false), 3000);
      return;
    }
    setBusy(true);
    await props.onTrash();
  };

  return (
    <div class="flex h-full flex-col bg-white">
      <div class="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <button class="text-blue-600 transition hover:underline" onClick={props.onBack}>
          ← 返回
        </button>
        <div class="flex gap-1.5">
          <button
            class="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-50"
            onClick={props.onEdit}
          >
            编辑
          </button>
          <button
            class={`rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-50 ${
              confirmTrash
                ? 'border-red-300 bg-red-50 text-red-600'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            disabled={busy}
            onClick={trash}
          >
            {busy ? '删除中…' : confirmTrash ? '确认删除？' : '删除'}
          </button>
        </div>
      </div>

      <div class="flex-1 space-y-3.5 overflow-y-auto p-4">
        <div class="flex items-center gap-3">
          <span
            class={`flex h-11 w-11 items-center justify-center rounded-full text-lg font-semibold ${
              TYPE_COLOR[item.type] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {item.name[0]?.toUpperCase() ?? '?'}
          </span>
          <div>
            <h2 class="text-base font-bold leading-tight">{item.name}</h2>
            <p class="text-xs text-gray-400">
              {TYPE_LABEL[item.type] ?? `类型${item.type}`}
              {folderName ? ` · ${folderName}` : ''}
              {item.deletedDate ? ' · 回收站' : ''}
            </p>
          </div>
        </div>

        {item.username && <CopyRow label="用户名" value={item.username} />}
        {item.password && <CopyRow label="密码" value={item.password} secret />}
        {item.totp && <TotpRow secret={item.totp} />}

        {item.card && (
          <div class="space-y-3">
            <SectionTitle>卡片</SectionTitle>
            {item.card.cardholderName && <CopyRow label="持卡人" value={item.card.cardholderName} />}
            {item.card.number && <CopyRow label="卡号" value={item.card.number} secret />}
            {item.card.code && <CopyRow label="安全码" value={item.card.code} secret />}
            {(item.card.expMonth || item.card.expYear) && (
              <Field label="有效期" value={`${item.card.expMonth ?? ''}/${item.card.expYear ?? ''}`} />
            )}
            {item.card.brand && <Field label="品牌" value={item.card.brand} />}
          </div>
        )}

        {item.identity && (
          <div class="space-y-3">
            <SectionTitle>身份</SectionTitle>
            {(item.identity.firstName || item.identity.lastName) && (
              <Field
                label="姓名"
                value={`${item.identity.firstName ?? ''} ${item.identity.lastName ?? ''}`.trim()}
              />
            )}
            {item.identity.email && <CopyRow label="邮箱" value={item.identity.email} />}
            {item.identity.phone && <CopyRow label="电话" value={item.identity.phone} />}
            {item.identity.address1 && <Field label="地址" value={item.identity.address1} />}
          </div>
        )}

        {item.uris.length > 0 && (
          <div>
            <SectionTitle>网址</SectionTitle>
            {item.uris.map((u) => (
              <a
                key={u}
                class="block truncate text-blue-600 hover:underline"
                href={u}
                target="_blank"
                rel="noreferrer"
              >
                {u}
              </a>
            ))}
          </div>
        )}

        {item.notes && (
          <div>
            <SectionTitle>备注</SectionTitle>
            <p class="whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-gray-700">{item.notes}</p>
          </div>
        )}

        {item.fields.map((f, i) => (
          <CopyRow key={i} label={f.name || '自定义字段'} value={f.value} secret={f.type === 1} />
        ))}
      </div>
    </div>
  );
}

function SectionTitle(props: { children: string }) {
  return (
    <p class="border-b border-gray-100 pb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
      {props.children}
    </p>
  );
}

function Field(props: { label: string; value: string }) {
  return (
    <div>
      <p class="text-xs text-gray-500">{props.label}</p>
      <p class="rounded-lg bg-gray-50 px-2 py-1">{props.value}</p>
    </div>
  );
}

/** TOTP 实时验证码：每秒刷新，显示剩余秒数，点复制拿当前码 */
function TotpRow(props: { secret: string }) {
  const [code, setCode] = useState('');
  const [remain, setRemain] = useState(30);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let params: ReturnType<typeof parseTotp>;
    try {
      params = parseTotp(props.secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const tick = async () => {
      setCode(await generateTotp(params));
      setRemain(params.period - (Math.floor(Date.now() / 1000) % params.period));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [props.secret]);

  if (error) return <p class="text-xs text-red-600">TOTP 解析失败：{error}</p>;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <p class="text-xs text-gray-500">验证码</p>
      <div class="flex items-center gap-2">
        <code class="flex-1 rounded-lg bg-blue-50 px-2.5 py-1.5 font-mono text-lg tracking-[0.2em] text-blue-700">
          {code.slice(0, 3)} {code.slice(3)}
        </code>
        <span class={`text-xs tabular-nums ${remain <= 5 ? 'font-medium text-red-500' : 'text-gray-400'}`}>
          {remain}s
        </span>
        <button
          class="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs transition hover:bg-gray-50"
          onClick={copy}
        >
          {copied ? '✓' : '复制'}
        </button>
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
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1 truncate rounded-lg bg-gray-50 px-2.5 py-1.5 font-mono">
          {props.secret && !show ? '••••••••' : props.value}
        </span>
        {props.secret && (
          <button
            class="shrink-0 rounded-lg border border-gray-200 px-2 py-1.5 text-xs transition hover:bg-gray-50"
            onClick={() => setShow(!show)}
          >
            {show ? '隐藏' : '显示'}
          </button>
        )}
        <button
          class="shrink-0 rounded-lg border border-gray-200 px-2 py-1.5 text-xs transition hover:bg-gray-50"
          onClick={copy}
        >
          {copied ? '✓' : '复制'}
        </button>
      </div>
    </div>
  );
}
