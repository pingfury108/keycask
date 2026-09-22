import { useEffect, useState } from 'preact/hooks';
import {
  serverUrl,
  lockTimeoutMin,
  lastSyncAt,
  lastSyncStats,
  lastEmail,
  deviceId,
  type SyncStats,
} from '@/lib/store/settings';
import { VaultwardenClient } from '@/lib/vaultwarden/client';

export default function App() {
  const [url, setUrl] = useState('');
  const [timeoutMin, setTimeoutMin] = useState(15);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [syncAt, setSyncAt] = useState<number | null>(null);
  const [serverInfo, setServerInfo] = useState<{ vault: string; server?: string } | null>(null);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    (async () => {
      const u = await serverUrl.getValue();
      setUrl(u);
      setTimeoutMin(await lockTimeoutMin.getValue());
      setStats(await lastSyncStats.getValue());
      setSyncAt(await lastSyncAt.getValue());
      if (u) {
        try {
          const cfg = await new VaultwardenClient(u).getConfig();
          setServerInfo({ vault: cfg.version, server: cfg.server?.version });
        } catch {
          /* 离线时跳过 */
        }
      }
    })();
  }, []);

  const saveUrl = async () => {
    await serverUrl.setValue(url.trim().replace(/\/+$/, ''));
  };

  const exportDiagnostics = async () => {
    const data = {
      exportedAt: new Date().toISOString(),
      extension: { name: 'keycask', version: browser.runtime.getManifest().version },
      server: { url: new URL(url).host, ...serverInfo },
      account: { email: await lastEmail.getValue() },
      deviceId: await deviceId.getValue(),
      lastSyncAt: syncAt ? new Date(syncAt).toISOString() : null,
      lastSyncStats: stats,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `keycask-diagnostics-${Date.now()}.json`;
    a.click();
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <div class="mx-auto max-w-xl p-8 text-sm text-gray-900">
      <h1 class="mb-6 text-xl font-bold">钥匣 KeyCask 设置</h1>

      <Section title="服务器">
        <label class="mb-1 block text-gray-600" for="server-url">
          Vaultwarden 地址
        </label>
        <div class="flex gap-2">
          <input
            id="server-url"
            type="url"
            class="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="https://vault.example.com"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            onClick={saveUrl}
          >
            保存
          </button>
        </div>
        {serverInfo && (
          <p class="mt-2 text-xs text-gray-500">
            Web Vault {serverInfo.vault}
            {serverInfo.server ? ` · 服务端 ${serverInfo.server}` : ''}
          </p>
        )}
      </Section>

      <Section title="安全">
        <label class="mb-1 block text-gray-600" for="lock-timeout">
          超时自动锁定
        </label>
        <select
          id="lock-timeout"
          class="rounded-lg border border-gray-300 px-3 py-2"
          value={timeoutMin}
          onChange={(e) => {
            const v = Number((e.target as HTMLSelectElement).value);
            setTimeoutMin(v);
            lockTimeoutMin.setValue(v);
          }}
        >
          <option value={1}>1 分钟</option>
          <option value={5}>5 分钟</option>
          <option value={15}>15 分钟</option>
          <option value={60}>1 小时</option>
          <option value={0}>从不</option>
        </select>
      </Section>

      <Section title="诊断">
        <dl class="space-y-1 text-xs text-gray-600">
          <Row k="上次同步" v={syncAt ? new Date(syncAt).toLocaleString('zh-CN') : '—'} />
          <Row k="条目数" v={stats ? String(stats.cipherCount) : '—'} />
          <Row
            k="解密失败"
            v={stats ? (stats.failed.length ? `${stats.failed.length} 条` : '无') : '—'}
          />
        </dl>
        {stats?.failed.length ? (
          <ul class="mt-2 max-h-32 overflow-y-auto rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            {stats.failed.map((f) => (
              <li key={f.id} class="truncate">
                {f.id.slice(0, 8)}…：{f.reason}
              </li>
            ))}
          </ul>
        ) : null}
        <button
          class="mt-3 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
          onClick={exportDiagnostics}
        >
          {exported ? '已导出 ✓' : '导出诊断信息（已脱敏）'}
        </button>
      </Section>
    </div>
  );
}

function Section(props: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

function Row(props: { k: string; v: string }) {
  return (
    <div class="flex justify-between">
      <dt>{props.k}</dt>
      <dd class="font-mono">{props.v}</dd>
    </div>
  );
}
