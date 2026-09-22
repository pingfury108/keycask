import { getLoginMatches } from '@/lib/vaultwarden/matches';
import { userKeyB64 } from '@/lib/store/settings';

/**
 * 工具栏角标（复刻官方 BadgeService 的精简版）：
 * - 解锁 + 有匹配 → 数量（>9 显示 9+）
 * - 解锁 + 无匹配 → 清空
 * - 锁定 → 灰色图标（官方高优先级：锁定态覆盖计数）
 * 数据/会话变更时全量刷新；tab 事件单 tab 刷新；100ms 防抖。
 */
const DEFAULT_ICON = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' };
const LOCKED_ICON = { 16: 'icons/icon-gray-16.png', 32: 'icons/icon-gray-32.png' };

export async function refreshBadge(tabId: number, url?: string): Promise<void> {
  try {
    if (!(await userKeyB64.getValue())) {
      await browser.action.setIcon({ tabId, path: LOCKED_ICON });
      await browser.action.setBadgeText({ tabId, text: '' });
      return;
    }
    await browser.action.setIcon({ tabId, path: DEFAULT_ICON });
    if (!url || !/^https?:/.test(url)) {
      await browser.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const { items } = await getLoginMatches(url);
    const text = items.length === 0 ? '' : items.length > 9 ? '9+' : String(items.length);
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
    await browser.action.setBadgeText({ tabId, text });
  } catch {
    /* tab 可能已关闭 */
  }
}

/** 全量刷新（登录/锁定/同步后调用） */
export async function refreshAllBadges(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.allSettled(tabs.map((t) => t.id && refreshBadge(t.id, t.url)));
}

/** 注册 tab 事件 + 存储变更监听（含防抖） */
export function watchBadge(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debouncedAll = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refreshAllBadges(), 100);
  };

  browser.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'complete' && tab.url) void refreshBadge(tabId, tab.url);
  });
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await browser.tabs.get(tabId);
      await refreshBadge(tabId, tab.url);
    } catch {
      /* ignore */
    }
  });

  // 保险库数据或锁定态变化 → 全量刷新
  browser.storage.onChanged.addListener((changes, area) => {
    if (
      (area === 'local' && changes.vaultCiphers) ||
      (area === 'session' && changes.userKey)
    ) {
      debouncedAll();
    }
  });
}
