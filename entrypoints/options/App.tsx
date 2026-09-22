import { useEffect, useState } from 'preact/hooks';
import { serverUrl } from '@/lib/store/settings';
import { VaultwardenClient } from '@/lib/vaultwarden/client';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; version: string; serverName?: string }
  | { kind: 'fail'; message: string };

export default function App() {
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    serverUrl.getValue().then(setUrl);
  }, []);

  const save = async () => {
    await serverUrl.setValue(url.trim());
    setSaved(true);
    setTest({ kind: 'idle' });
    setTimeout(() => setSaved(false), 2000);
  };

  const testConnection = async () => {
    const target = url.trim();
    if (!target) return;
    setTest({ kind: 'testing' });
    try {
      const cfg = await new VaultwardenClient(target).getConfig();
      setTest({ kind: 'ok', version: cfg.version, serverName: cfg.server?.name });
    } catch (e) {
      setTest({ kind: 'fail', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div class="mx-auto max-w-xl p-8 text-sm">
      <h1 class="mb-6 text-xl font-bold">钥匣 KeyCask 设置</h1>

      <label class="mb-1 block font-medium" for="server-url">
        Vaultwarden 服务器地址
      </label>
      <input
        id="server-url"
        type="url"
        class="w-full rounded border border-gray-300 px-3 py-2"
        placeholder="https://vault.example.com"
        value={url}
        onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
      />
      <p class="mt-1 text-gray-500">自建 Vaultwarden 的访问地址（需 HTTPS，localhost 除外）</p>

      <div class="mt-4 flex gap-2">
        <button
          class="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={save}
          disabled={!url.trim()}
        >
          {saved ? '已保存 ✓' : '保存'}
        </button>
        <button
          class="rounded border border-gray-300 px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
          onClick={testConnection}
          disabled={!url.trim() || test.kind === 'testing'}
        >
          {test.kind === 'testing' ? '测试中…' : '测试连接'}
        </button>
      </div>

      {test.kind === 'ok' && (
        <p class="mt-4 rounded bg-green-50 p-3 text-green-800">
          连接成功 · Web Vault 版本 {test.version}
          {test.serverName ? ` · ${test.serverName}` : ''}
        </p>
      )}
      {test.kind === 'fail' && (
        <p class="mt-4 rounded bg-red-50 p-3 text-red-800">连接失败：{test.message}</p>
      )}
    </div>
  );
}
