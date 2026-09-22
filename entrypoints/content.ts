import { findLoginFields, fillInput, isLoginField } from '@/lib/autofill/detect';
import type { MatchItem, MatchResult } from '@/lib/vaultwarden/matches';

/**
 * M4 自动填充 content script（复刻官方的核心交互，精简实现）：
 * - 聚焦登录字段时弹出内联菜单（Shadow DOM 隔离，防页面样式污染）
 * - 点击菜单项 = 用户手势，执行填充（满足 Chrome 手势要求）
 * - 只处理 top frame（iframe 支持留到后续）
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    const menu = new InlineMenu();

    document.addEventListener(
      'focusin',
      (e) => {
        if (!isLoginField(e.target as Element)) return;
        menu.showFor(e.target as HTMLInputElement);
      },
      true,
    );
    document.addEventListener(
      'focusout',
      () => {
        // 延迟关闭：点击菜单项时焦点会先离开输入框
        setTimeout(() => {
          if (!menu.containsFocus()) menu.hide();
        }, 150);
      },
      true,
    );
    document.addEventListener('keydown', (e) => e.key === 'Escape' && menu.hide(), true);
    // SPA 导航后旧快照作废（官方教训：绝不把 A 站的密码填到 B 站）
    window.addEventListener('popstate', () => menu.invalidate());
    window.addEventListener('hashchange', () => menu.invalidate());

    // popup 点击「当前网站」条目的填充命令
    browser.runtime.onMessage.addListener((msg: { type?: string; item?: MatchItem }) => {
      if (msg.type === 'keycask:fill' && msg.item) {
        fillLogin(msg.item);
      }
    });
  },
});

function fillLogin(item: MatchItem): void {
  const { username, password } = findLoginFields();
  if (username && item.username) fillInput(username, item.username);
  if (password && item.password) fillInput(password, item.password);
}

class InlineMenu {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private items: MatchItem[] = [];
  private field: HTMLInputElement | null = null;
  private pageUrl = location.href;

  async showFor(field: HTMLInputElement): Promise<void> {
    this.field = field;
    if (this.pageUrl !== location.href) this.invalidate();

    const result: MatchResult = await browser.runtime.sendMessage({
      type: 'keycask:get-matches',
      url: location.href,
    });
    // 等待期间页面可能已跳转
    if (this.pageUrl !== location.href) return;

    if (result.locked) {
      this.render([], true);
      return;
    }
    this.items = result.items;
    if (this.items.length === 0) {
      this.hide();
      return;
    }
    this.render(this.items, false);
  }

  invalidate(): void {
    this.items = [];
    this.pageUrl = location.href;
    this.hide();
  }

  containsFocus(): boolean {
    return this.host?.contains(document.activeElement) ?? false;
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  private render(items: MatchItem[], locked: boolean): void {
    if (!this.field) return;
    this.hide();

    this.host = document.createElement('div');
    this.host.id = 'keycask-inline-menu';
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const rect = this.field.getBoundingClientRect();
    const style = document.createElement('style');
    style.textContent = `
      .menu {
        position: absolute; z-index: 2147483647;
        top: ${rect.bottom + window.scrollY + 4}px; left: ${rect.left + window.scrollX}px;
        min-width: ${Math.max(rect.width, 220)}px; max-width: 320px; max-height: 260px;
        overflow-y: auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.12); font: 13px/1.4 system-ui, sans-serif;
      }
      .item {
        display: flex; flex-direction: column; gap: 1px; width: 100%;
        padding: 8px 12px; border: 0; background: none; cursor: pointer; text-align: left;
      }
      .item:hover { background: #eff6ff; }
      .name { font-weight: 600; color: #111827; }
      .user { font-size: 11px; color: #9ca3af; }
      .empty { padding: 10px 12px; color: #6b7280; }
    `;
    this.shadow.appendChild(style);

    const menu = document.createElement('div');
    menu.className = 'menu';

    if (locked) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = '🔒 保险库已锁定，请先解锁 KeyCask';
      menu.appendChild(p);
    } else {
      for (const item of items) {
        const btn = document.createElement('button');
        btn.className = 'item';
        btn.type = 'button';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.name;
        btn.appendChild(name);
        if (item.username) {
          const user = document.createElement('span');
          user.className = 'user';
          user.textContent = item.username;
          btn.appendChild(user);
        }
        btn.addEventListener('click', () => {
          fillLogin(item);
          this.hide();
        });
        menu.appendChild(btn);
      }
    }

    this.shadow.appendChild(menu);
    document.documentElement.appendChild(this.host);
  }
}
