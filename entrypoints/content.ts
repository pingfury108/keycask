import { findLoginFields, fillInput, isLoginField } from '@/lib/autofill/detect';
import { generateTotp, parseTotp } from '@/lib/crypto/totp';
import type { MatchItem, MatchResult } from '@/lib/vaultwarden/matches';

/**
 * M4 自动填充 content script（复刻官方 overlay 的核心交互，精简实现）：
 * - 合格登录字段获得焦点 → 字段右缘显示钥匙按钮 + 列表自动弹出
 * - Shadow DOM 隔离；点击 = 用户手势触发填充（满足 Chrome 手势要求）
 * - 键盘：↑↓ 导航、Enter 填充、Esc 关闭
 * - 表单提交时检测新登录 → 顶部提示条询问保存
 * - 所有 frame 注入；SPA 导航后旧快照作废
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  allFrames: true,
  main() {
    const menu = new InlineMenu();
    const saveBanner = new SaveBanner();

    document.addEventListener(
      'focusin',
      (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) || menu.owns(el)) return;
        if (!isLoginField(el)) return;
        void menu.showFor(el);
      },
      true,
    );
    document.addEventListener(
      'focusout',
      () => {
        // 延迟关闭：点击菜单项/按钮时焦点会先离开输入框
        setTimeout(() => {
          if (!menu.containsFocus() && document.activeElement !== menu.currentField) {
            menu.hide();
          }
        }, 150);
      },
      true,
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') menu.hide();
      },
      true,
    );
    // 滚动/缩放时重定位（节流）
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener(
      'scroll',
      () => {
        if (scrollTimer) return;
        scrollTimer = setTimeout(() => {
          scrollTimer = null;
          menu.reposition();
        }, 50);
      },
      { capture: true, passive: true },
    );
    window.addEventListener('resize', () => menu.reposition(), { passive: true });

    // SPA 导航后旧快照作废（官方教训：绝不把 A 站的密码填到 B 站）
    window.addEventListener('popstate', () => menu.invalidate());
    window.addEventListener('hashchange', () => menu.invalidate());

    // 表单提交 → 检测是否值得提示保存（仅 top frame 弹条，避免多 frame 重复）
    if (window.top === window) {
      document.addEventListener(
        'submit',
        () => {
          const { username, password } = findLoginFields();
          if (!password?.value) return;
          void saveBanner.maybeShow(location.href, username?.value ?? '', password.value);
        },
        true,
      );
    }

    browser.runtime.onMessage.addListener(
      (msg: { type?: string; item?: MatchItem }, _sender, sendResponse) => {
        // popup / 快捷键 / 右键菜单的填充命令：各 frame 自行判断有没有表单
        if (msg.type === 'keycask:fill' && msg.item) {
          const filled = fillLogin(msg.item);
          sendResponse({ filled });
          return true;
        }
      },
    );
  },
});

/** 填充当前 frame 的登录表单；返回是否真的填了（iframe 无表单时返回 false） */
function fillLogin(item: MatchItem): boolean {
  const { username, password } = findLoginFields();
  if (!username && !password) return false;
  if (username && item.username) fillInput(username, item.username);
  if (password && item.password) fillInput(password, item.password);

  // 官方同款：填充后把 TOTP 验证码复制到剪贴板
  if (item.totp) {
    try {
      void generateTotp(parseTotp(item.totp)).then((code) =>
        navigator.clipboard.writeText(code).catch(() => {}),
      );
    } catch {
      /* TOTP secret 解析失败静默 */
    }
  }
  return true;
}

const CSS = `
  :host { all: initial; }
  .btn {
    position: fixed; z-index: 2147483646; display: flex; align-items: center; justify-content: center;
    background: none; border: 0; cursor: pointer; border-radius: 6px; padding: 0;
  }
  .btn:hover { background: rgba(37, 99, 235, .12); }
  .menu {
    position: fixed; z-index: 2147483647; min-width: 220px; max-width: 320px; max-height: 260px;
    overflow-y: auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,.14); font: 13px/1.4 system-ui, sans-serif;
  }
  .item {
    display: flex; flex-direction: column; gap: 1px; width: 100%;
    padding: 8px 12px; border: 0; background: none; cursor: pointer; text-align: left;
  }
  .item:hover, .item.active { background: #eff6ff; }
  .name { font-weight: 600; color: #111827; }
  .user { font-size: 11px; color: #9ca3af; }
  .empty { padding: 10px 12px; color: #6b7280; }
  .banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
    display: flex; align-items: center; gap: 10px; padding: 10px 16px;
    background: #1e40af; color: #fff; font: 13px/1.4 system-ui, sans-serif;
    box-shadow: 0 2px 12px rgba(0,0,0,.2);
  }
  .banner .spacer { flex: 1; }
  .banner button {
    border: 0; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13px;
  }
  .banner .save { background: #fff; color: #1e40af; font-weight: 600; }
  .banner .ghost { background: transparent; color: #bfdbfe; }
  .banner .ghost:hover { color: #fff; }
`;

/** 钥匙孔 logo（内联按钮用）：解锁蓝色 / 锁定灰色（复刻官方 logo / logoLocked 双态） */
function keyholeIcon(color: string): string {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="${color}"><circle cx="12" cy="9.5" r="5.2"/><path d="M9.8 13.2h4.4l1.6 8.8H8.2z"/></svg>`;
}
const ICON_UNLOCKED = keyholeIcon('#2563eb');
const ICON_LOCKED = keyholeIcon('#9ca3af');

function shadowHost(id: string, css: string): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement('div');
  host.id = id;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return { host, shadow };
}

class InlineMenu {
  currentField: HTMLInputElement | null = null;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private items: MatchItem[] = [];
  private locked = false;
  private activeIdx = -1;
  private pageUrl = location.href;
  private menuOpen = false;

  owns(el: Element): boolean {
    return this.host?.contains(el) ?? false;
  }

  async showFor(field: HTMLInputElement): Promise<void> {
    this.currentField = field;
    if (this.pageUrl !== location.href) this.invalidate();

    const result: MatchResult = await browser.runtime.sendMessage({
      type: 'keycask:get-matches',
      url: location.href,
    });
    if (this.pageUrl !== location.href || this.currentField !== field) return;

    this.locked = result.locked;
    this.items = result.items;
    this.activeIdx = -1;
    // 复刻官方：聚焦即有匹配时自动展开列表
    this.menuOpen = this.items.length > 0 || this.locked;
    this.render();
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
    this.menuOpen = false;
    this.currentField = null;
  }

  reposition(): void {
    if (this.host && this.currentField) this.layout();
  }

  private toggle(): void {
    this.menuOpen = !this.menuOpen;
    this.render();
  }

  private render(): void {
    if (!this.currentField) return;
    if (!this.host) {
      const { host, shadow } = shadowHost('keycask-inline-menu', CSS);
      this.host = host;
      this.shadow = shadow;
    } else {
      this.shadow!.querySelectorAll('.btn,.menu').forEach((n) => n.remove());
    }

    // 字段右缘钥匙按钮（复刻官方 menu-button；锁定态灰色）
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.title = this.locked ? '钥匣 KeyCask（已锁定）' : '钥匣 KeyCask';
    btn.innerHTML = this.locked ? ICON_LOCKED : ICON_UNLOCKED;
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // 不抢焦点
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggle();
    });
    this.shadow!.appendChild(btn);

    if (this.menuOpen) {
      const menu = document.createElement('div');
      menu.className = 'menu';
      menu.setAttribute('role', 'listbox');

      if (this.locked) {
        const p = document.createElement('div');
        p.className = 'empty';
        p.textContent = '🔒 保险库已锁定，请先解锁 KeyCask';
        menu.appendChild(p);
      } else {
        this.items.forEach((item, i) => {
          const el = document.createElement('button');
          el.className = `item${i === this.activeIdx ? ' active' : ''}`;
          el.type = 'button';
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = item.name;
          el.appendChild(name);
          if (item.username) {
            const user = document.createElement('span');
            user.className = 'user';
            user.textContent = item.username;
            el.appendChild(user);
          }
          el.addEventListener('mousedown', (e) => e.preventDefault());
          el.addEventListener('click', () => {
            fillLogin(item);
            this.hide();
          });
          menu.appendChild(el);
        });
      }
      this.shadow!.appendChild(menu);
    }

    this.layout();
    this.bindKeyboard();
  }

  private layout(): void {
    if (!this.host || !this.currentField) return;
    const rect = this.currentField.getBoundingClientRect();
    const size = Math.min(rect.height - 8, 28);
    const btn = this.shadow!.querySelector<HTMLElement>('.btn');
    if (btn) {
      btn.style.top = `${rect.top + (rect.height - size) / 2}px`;
      btn.style.left = `${rect.right - size - 6}px`;
      btn.style.width = `${size}px`;
      btn.style.height = `${size}px`;
    }
    const menu = this.shadow!.querySelector<HTMLElement>('.menu');
    if (menu) {
      menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 280)}px`;
      menu.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`;
      menu.style.minWidth = `${Math.max(rect.width, 220)}px`;
    }
  }

  private bindKeyboard(): void {
    if (!this.currentField) return;
    this.currentField.onkeydown = (e) => {
      if (!this.menuOpen || this.locked) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        this.activeIdx =
          (this.activeIdx + delta + this.items.length) % Math.max(this.items.length, 1);
        this.render();
        this.shadow?.querySelector('.item.active')?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && this.activeIdx >= 0) {
        e.preventDefault();
        const item = this.items[this.activeIdx];
        if (item) {
          fillLogin(item);
          this.hide();
        }
      }
    };
  }
}

/** 「保存新密码」提示条（复刻官方 notification bar，精简版） */
class SaveBanner {
  private host: HTMLElement | null = null;
  private pageUrl = location.href;

  async maybeShow(url: string, username: string, password: string): Promise<void> {
    const verdict: string = await browser.runtime.sendMessage({
      type: 'keycask:save-prompt',
      url,
      username,
    });
    if (verdict !== 'ask' || this.pageUrl !== location.href) return;
    this.render(url, username, password);
  }

  private render(url: string, username: string, password: string): void {
    this.hide();
    const { host, shadow } = shadowHost('keycask-save-banner', CSS);
    this.host = host;

    const bar = document.createElement('div');
    bar.className = 'banner';

    const text = document.createElement('span');
    text.textContent = `是否将此网站的登录信息保存到钥匣？${username ? `（${username}）` : ''}`;
    bar.appendChild(text);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    bar.appendChild(spacer);

    const save = document.createElement('button');
    save.className = 'save';
    save.textContent = '保存';
    save.addEventListener('click', async () => {
      save.textContent = '保存中…';
      const ok: boolean = await browser.runtime.sendMessage({
        type: 'keycask:save-cipher',
        url,
        username,
        password,
      });
      save.textContent = ok ? '已保存 ✓' : '保存失败';
      setTimeout(() => this.hide(), 1200);
    });
    bar.appendChild(save);

    const never = document.createElement('button');
    never.className = 'ghost';
    never.textContent = '不再提示此网站';
    never.addEventListener('click', async () => {
      await browser.runtime.sendMessage({ type: 'keycask:never-domain', url });
      this.hide();
    });
    bar.appendChild(never);

    const close = document.createElement('button');
    close.className = 'ghost';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    bar.appendChild(close);

    shadow.appendChild(bar);
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
  }
}
