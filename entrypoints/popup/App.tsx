import { useEffect, useState } from 'preact/hooks';
import { serverUrl, userKeyB64, vaultCiphersRaw, lastEmail } from '@/lib/store/settings';
import { VaultwardenClient } from '@/lib/vaultwarden/client';
import { loginAndSync } from '@/lib/vaultwarden/auth';

type View = 'loading' | 'setup' | 'login' | 'vault';

export default function App() {
  const [view, setView] = useState<View>('loading');
  const [url, setUrl] = useState('');

  useEffect(() => {
    (async () => {
      const saved = await serverUrl.getValue();
      setUrl(saved);
      if (!saved) setView('setup');
      else setView((await userKeyB64.getValue()) ? 'vault' : 'login');
    })();
  }, []);

  if (view === 'loading') return null;

  return (
    <div class="w-80 text-sm">
      <header class="flex items-center justify-between bg-blue-700 px-4 py-3 text-white">
        <h1 class="font-bold">钥匣 KeyCask</h1>
        {url && view !== 'setup' && (
          <button
            class="text-xs text-blue-200 hover:text-white"
            title="更换服务器"
            onClick={() => setView('setup')}
          >
            {new URL(url).host}
          </button>
        )}
      </header>

      {view === 'setup' && (
        <SetupView
          initialUrl={url}
          onDone={(u) => {
            setUrl(u);
            setView('login');
          }}
        />
      )}
      {view === 'login' && <LoginView baseUrl={url} onSuccess={() => setView('vault')} />}
      {view === 'vault' && <VaultPlaceholder onLock={() => setView('login')} />}
    </div>
  );
}

// ---------- 服务器配置（内嵌在 popup，参考官方登录环境选择） ----------

function SetupView(props: { initialUrl: string; onDone: (url: string) => void }) {
  const [url, setUrl] = useState(props.initialUrl);
  const [status, setStatus] = useState<{ kind: 'idle' | 'testing' | 'fail'; msg?: string }>({
    kind: 'idle',
  });

  const saveAndContinue = async () => {
    const target = url.trim().replace(/\/+$/, '');
    if (!target) return;
    setStatus({ kind: 'testing' });
    try {
      await new VaultwardenClient(target).getConfig();
      await serverUrl.setValue(target);
      props.onDone(target);
    } catch (e) {
      setStatus({ kind: 'fail', msg: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div class="p-4">
      <label class="mb-1 block font-medium">自建服务器地址</label>
      <input
        type="url"
        class="w-full rounded border border-gray-300 px-3 py-2"
        placeholder="https://vault.example.com"
        value={url}
        onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && saveAndContinue()}
      />
      <p class="mt-1 text-xs text-gray-500">你的 Vaultwarden 地址（需 HTTPS）</p>
      {status.kind === 'fail' && (
        <p class="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">连接失败：{status.msg}</p>
      )}
      <button
        class="mt-3 w-full rounded bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={!url.trim() || status.kind === 'testing'}
        onClick={saveAndContinue}
      >
        {status.kind === 'testing' ? '连接测试中…' : '保存并继续'}
      </button>
    </div>
  );
}

// ---------- 登录 ----------

function LoginView(props: { baseUrl: string; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    lastEmail.getValue().then(setEmail);
  }, []);

  const login = async () => {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      await loginAndSync(props.baseUrl, email, password);
      props.onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      class="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        login();
      }}
    >
      <input
        type="email"
        class="mb-2 w-full rounded border border-gray-300 px-3 py-2"
        placeholder="邮箱"
        autocomplete="username"
        value={email}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setEmail(v);
          // 输入即记忆，不依赖登录成功
          lastEmail.setValue(v.trim());
        }}
      />
      <input
        type="password"
        class="w-full rounded border border-gray-300 px-3 py-2"
        placeholder="主密码"
        autocomplete="current-password"
        value={password}
        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
      />
      {error && <p class="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <button
        type="submit"
        class="mt-3 w-full rounded bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={!email.trim() || !password || busy}
      >
        {busy ? '登录并同步中…' : '登录'}
      </button>
    </form>
  );
}

// ---------- 保险库占位（M2 将替换为解密后的列表） ----------

function VaultPlaceholder(props: { onLock: () => void }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    vaultCiphersRaw.getValue().then((c) => setCount(c?.length ?? 0));
  }, []);

  const lock = async () => {
    await userKeyB64.setValue(null);
    props.onLock();
  };

  return (
    <div class="p-4">
      <p class="rounded bg-green-50 p-3 text-green-800">
        登录成功，已同步 {count} 个条目（密文）。
      </p>
      <p class="mt-2 text-xs text-gray-500">条目列表将在 M2（宽容解密）接入。</p>
      <button
        class="mt-3 w-full rounded border border-gray-300 px-3 py-2 hover:bg-gray-50"
        onClick={lock}
      >
        锁定
      </button>
    </div>
  );
}
