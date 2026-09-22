import { useEffect, useState } from 'preact/hooks';
import {
  serverUrl,
  userKeyB64,
  lastEmail,
  encryptedUserKey,
  lastActivity,
} from '@/lib/store/settings';
import { VaultwardenClient } from '@/lib/vaultwarden/client';
import { loginAndSync, unlockWithPassword, syncVault } from '@/lib/vaultwarden/auth';
import VaultView from './VaultView';
import GeneratorView from './GeneratorView';

type View = 'loading' | 'setup' | 'login' | 'unlock' | 'vault' | 'generator';

export default function App() {
  const [view, setView] = useState<View>('loading');
  const [url, setUrl] = useState('');

  useEffect(() => {
    (async () => {
      const saved = await serverUrl.getValue();
      setUrl(saved);
      if (!saved) {
        setView('setup');
        return;
      }
      if (await userKeyB64.getValue()) {
        setView('vault');
      } else if (await encryptedUserKey.getValue()) {
        setView('unlock'); // 有本地解锁材料 → 只需主密码
      } else {
        setView('login');
      }
    })();
  }, []);

  // 打开 popup 即算活跃
  useEffect(() => {
    lastActivity.setValue(Date.now());
  }, [view]);

  if (view === 'loading') return null;

  return (
    <div class="flex h-full w-full flex-col overflow-hidden bg-gray-50 text-sm text-gray-900">
      <header class="flex shrink-0 items-center justify-between bg-blue-700 px-4 py-2.5 text-white shadow-sm">
        <h1 class="text-[15px] font-bold tracking-wide">钥匣 KeyCask</h1>
        {url && view !== 'setup' && (
          <button
            class="rounded px-1.5 py-0.5 text-[11px] text-blue-200 transition hover:bg-blue-600 hover:text-white"
            title="更换服务器"
            onClick={() => setView('setup')}
          >
            {new URL(url).host}
          </button>
        )}
      </header>

      {view === 'setup' && (
        <div class="min-h-0 flex-1 overflow-y-auto">
          <SetupView
            initialUrl={url}
            onDone={(u) => {
              setUrl(u);
              setView('login');
            }}
          />
        </div>
      )}
      {view === 'login' && (
        <div class="min-h-0 flex-1 overflow-y-auto">
          <LoginView baseUrl={url} onSuccess={() => setView('vault')} />
        </div>
      )}
      {view === 'unlock' && (
        <div class="min-h-0 flex-1 overflow-y-auto">
          <UnlockView onSuccess={() => setView('vault')} />
        </div>
      )}

      {(view === 'vault' || view === 'generator') && (
        <>
          {/* 内容区只占剩余空间，内部自己滚动；TabBar 固定底部 */}
          <div class="min-h-0 flex-1 overflow-hidden">
            {view === 'vault' ? (
              <VaultView
                onLock={() => setView('unlock')}
                onLogout={() => setView('login')}
              />
            ) : (
              <div class="h-full overflow-y-auto">
                <GeneratorView />
              </div>
            )}
          </div>
          <TabBar current={view} onChange={setView} />
        </>
      )}
    </div>
  );
}

function TabBar(props: {
  current: 'vault' | 'generator';
  onChange: (v: 'vault' | 'generator') => void;
}) {
  const tab = (v: 'vault' | 'generator', label: string) => (
    <button
      class={`flex-1 py-3 text-[13px] transition ${
        props.current === v
          ? 'border-t-2 border-blue-600 font-medium text-blue-700'
          : 'border-t-2 border-transparent text-gray-400 hover:text-gray-600'
      }`}
      onClick={() => props.onChange(v)}
    >
      {label}
    </button>
  );
  return (
    <div class="flex shrink-0 border-t border-gray-200 bg-white">
      {tab('vault', '保险库')}
      {tab('generator', '生成器')}
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
    <div class="p-5">
      <h2 class="mb-1 text-base font-semibold">连接到你的服务器</h2>
      <p class="mb-4 text-xs text-gray-500">自建 Vaultwarden 的访问地址（需 HTTPS）</p>
      <input
        type="url"
        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        placeholder="https://vault.example.com"
        value={url}
        onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && saveAndContinue()}
      />
      {status.kind === 'fail' && (
        <p class="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">连接失败：{status.msg}</p>
      )}
      <button
        class="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
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
      class="p-5"
      onSubmit={(e) => {
        e.preventDefault();
        login();
      }}
    >
      <h2 class="mb-4 text-base font-semibold">登录</h2>
      <input
        type="email"
        class="mb-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        placeholder="主密码"
        autocomplete="current-password"
        value={password}
        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
      />
      {error && <p class="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <button
        type="submit"
        class="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        disabled={!email.trim() || !password || busy}
      >
        {busy ? '登录并同步中…' : '登录'}
      </button>
    </form>
  );
}

// ---------- 主密码解锁（本地材料，不重复登录） ----------

function UnlockView(props: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    lastEmail.getValue().then(setEmail);
  }, []);

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await unlockWithPassword(password);
      // 后台同步，不阻塞进入保险库
      syncVault().catch((e) => console.warn('[keycask] 解锁后同步失败', e));
      props.onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      class="p-5"
      onSubmit={(e) => {
        e.preventDefault();
        unlock();
      }}
    >
      <div class="mb-4 flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg font-bold text-blue-700">
          {email ? email[0]!.toUpperCase() : '?'}
        </div>
        <div class="min-w-0">
          <p class="truncate font-medium">{email}</p>
          <p class="text-xs text-gray-500">保险库已锁定</p>
        </div>
      </div>
      <input
        type="password"
        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        placeholder="主密码"
        autocomplete="current-password"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={password}
        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
      />
      {error && <p class="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <button
        type="submit"
        class="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        disabled={!password || busy}
      >
        {busy ? '解锁中…' : '解锁'}
      </button>
    </form>
  );
}
