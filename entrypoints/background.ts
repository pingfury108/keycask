import { serverUrl, accessToken, lastActivity, lockTimeoutMin } from '@/lib/store/settings';
import { lock, syncVault } from '@/lib/vaultwarden/auth';
import { getLoginMatches, watchMatchCache } from '@/lib/vaultwarden/matches';
import { VaultwardenClient } from '@/lib/vaultwarden/client';

const SYNC_ALARM = 'keycask-sync';
const LOCK_ALARM = 'keycask-lock-check';

export default defineBackground(() => {
  console.log('[keycask] background started', { id: browser.runtime.id });

  // 启动连通性自检
  serverUrl.getValue().then(async (url) => {
    if (!url) return;
    try {
      const cfg = await new VaultwardenClient(url).getConfig();
      console.log('[keycask] server reachable:', cfg.server?.version ?? cfg.version);
    } catch (e) {
      console.warn('[keycask] server unreachable:', e);
    }
  });

  // MV3：长定时器必须走 alarms（最小 0.5 分钟）
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  browser.alarms.create(LOCK_ALARM, { periodInMinutes: 1 });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void onSyncAlarm();
    if (alarm.name === LOCK_ALARM) void onLockAlarm();
  });

  // content script 的匹配请求：只回传与页面域名匹配的条目
  browser.runtime.onMessage.addListener((msg: { type?: string; url?: string }) => {
    if (msg.type === 'keycask:get-matches' && msg.url) {
      return getLoginMatches(msg.url);
    }
  });

  watchMatchCache();
});

/** 自动同步：仅在有会话时执行，失败静默（下次再说） */
async function onSyncAlarm() {
  if (!(await accessToken.getValue())) return;
  try {
    const r = await syncVault();
    console.log(`[keycask] 自动同步完成: ${r.cipherCount} 条`);
  } catch (e) {
    console.warn('[keycask] 自动同步失败', e);
  }
}

/** 超时锁定：距上次活跃超过阈值即清会话密钥 */
async function onLockAlarm() {
  const [timeout, last, hasKey] = await Promise.all([
    lockTimeoutMin.getValue(),
    lastActivity.getValue(),
    accessToken.getValue(),
  ]);
  if (!timeout || !hasKey || !last) return;
  if (Date.now() - last > timeout * 60_000) {
    await lock();
    console.log('[keycask] 超时自动锁定');
  }
}
