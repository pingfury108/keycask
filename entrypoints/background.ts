import {
  serverUrl,
  accessToken,
  lastActivity,
  lockTimeoutMin,
  userKeyB64,
} from '@/lib/store/settings';
import { lock, syncVault } from '@/lib/vaultwarden/auth';
import {
  addNeverDomain,
  checkSavePrompt,
  getLoginMatches,
  invalidateMatchCache,
  watchMatchCache,
  type MatchItem,
} from '@/lib/vaultwarden/matches';
import { createCipher } from '@/lib/vaultwarden/ciphers';
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

  browser.runtime.onMessage.addListener(
    (msg: {
      type?: string;
      item?: MatchItem;
      url?: string;
      username?: string;
      password?: string;
    }) => {
      switch (msg.type) {
        // content script 的匹配请求：只回传与页面域名匹配的条目
        case 'keycask:get-matches':
          if (msg.url) return getLoginMatches(msg.url);
          break;
        // popup 的填充命令：转发到目标 tab（自动探测哪个 frame 有表单）
        case 'keycask:fill':
          if (msg.item) return fillActiveTab(msg.item);
          break;
        case 'keycask:save-prompt':
          if (msg.url && msg.username !== undefined)
            return checkSavePrompt(msg.url, msg.username);
          break;
        case 'keycask:save-cipher':
          if (msg.url && msg.password) return saveCipher(msg.url, msg.username ?? '', msg.password);
          break;
        case 'keycask:never-domain':
          if (msg.url) return addNeverDomain(msg.url).then(() => true);
          break;
      }
    },
  );

  // 快捷键自动填充（官方 autofill_login = Ctrl/⌘+Shift+L）：重复按轮循匹配条目
  browser.commands?.onCommand.addListener((command) => {
    if (command === 'autofill_login') void onAutofillCommand();
  });

  // 右键菜单：输入框上右键 → 填充第一个匹配
  browser.contextMenus?.create({
    id: 'keycask-fill',
    title: '钥匣 KeyCask：自动填充',
    contexts: ['editable'],
  });
  browser.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'keycask-fill' && tab?.id && tab.url) {
      void getLoginMatches(tab.url).then(({ items }) => {
        if (items[0]) void fillTab(tab.id!, items[0], info.frameId ?? 0);
      });
    }
  });

  // 工具栏角标：当前标签页的匹配数
  browser.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'complete' && tab.url) void updateBadge(tabId, tab.url);
  });
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await browser.tabs.get(tabId);
    if (tab.url) void updateBadge(tabId, tab.url);
  });

  watchMatchCache();
});

/** 更新角标：匹配数（0/锁定/无会话时清空） */
async function updateBadge(tabId: number, url: string): Promise<void> {
  if (!/^https?:/.test(url)) return;
  try {
    const { locked, items } = await getLoginMatches(url);
    const text = locked || items.length === 0 ? '' : String(items.length);
    await browser.action.setBadgeText({ tabId, text });
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
  } catch {
    /* tab 可能已关闭 */
  }
}

/** 填充活动标签页：依次尝试各 frame，第一个有表单的 frame 接住 */
async function fillActiveTab(item: MatchItem): Promise<boolean> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  return fillTab(tab.id, item);
}

async function fillTab(tabId: number, item: MatchItem, frameId?: number): Promise<boolean> {
  const frames =
    frameId !== undefined
      ? [{ frameId }]
      : ((await browser.webNavigation?.getAllFrames({ tabId })) ?? [{ frameId: 0 }]);

  for (const frame of frames) {
    try {
      const res: { filled?: boolean } = await browser.tabs.sendMessage(
        tabId,
        { type: 'keycask:fill', item },
        { frameId: frame.frameId },
      );
      if (res?.filled) return true;
    } catch {
      /* 该 frame 未注入脚本，试下一个 */
    }
  }
  return false;
}

// 快捷键轮循状态：同一标签页同一 URL 5 秒内重复按 → 下一个匹配
let cycle: { tabId: number; url: string; index: number; at: number } | null = null;

async function onAutofillCommand() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return;

  const { locked, items } = await getLoginMatches(tab.url);
  if (locked) {
    // 锁定状态：尝试唤起 popup 让用户解锁（官方是弹出解锁窗口）
    try {
      await browser.action.openPopup();
    } catch {
      console.warn('[keycask] 已锁定且无法唤起 popup');
    }
    return;
  }
  if (items.length === 0) return;

  const now = Date.now();
  const index =
    cycle && cycle.tabId === tab.id && cycle.url === tab.url && now - cycle.at < 5000
      ? (cycle.index + 1) % items.length
      : 0;
  cycle = { tabId: tab.id, url: tab.url, index, at: now };

  if (!(await fillTab(tab.id, items[index]!))) {
    console.warn('[keycask] 目标页面未加载填充脚本');
  }
}

/** 保存提示条确认：新建登录条目并触发同步 */
async function saveCipher(url: string, username: string, password: string): Promise<boolean> {
  try {
    const name = new URL(url).hostname;
    await createCipher({
      name,
      username,
      password,
      uri: url,
      notes: '',
      totp: '',
      folderId: null,
      favorite: false,
    });
    await syncVault();
    invalidateMatchCache();
    return true;
  } catch (e) {
    console.warn('[keycask] 保存条目失败', e);
    return false;
  }
}

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
    userKeyB64.getValue(),
  ]);
  if (!timeout || !hasKey || !last) return;
  if (Date.now() - last > timeout * 60_000) {
    await lock();
    console.log('[keycask] 超时自动锁定');
  }
}
