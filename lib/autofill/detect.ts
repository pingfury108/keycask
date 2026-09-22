/**
 * 登录表单字段识别（复刻官方 qualification.ts 的思路，精简实现）：
 * - autocomplete 属性是最强信号（username / email / current-password）
 * - 其次是 name/id/placeholder/aria-label 的关键词
 * - 用户名字段取密码框之前最近的候选
 */

export interface LoginFields {
  username: HTMLInputElement | null;
  password: HTMLInputElement | null;
}

const USERNAME_KEYWORDS = [
  'user', 'username', 'email', 'mail', 'login', 'account',
  'phone', 'mobile', 'tel', '账号', '账户', '用户名', '邮箱', '手机',
];
const USERNAME_AUTOCOMPLETE = new Set(['username', 'email', 'tel']);
const PASSWORD_AUTOCOMPLETE_BLOCK = new Set(['new-password', 'one-time-code']);

export function fieldKeywords(el: HTMLInputElement): string {
  return [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label'), el.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** 递归收集所有 input（穿透 open shadow root；closed shadow 无解，官方也一样） */
function collectInputs(root: ParentNode, out: HTMLInputElement[] = []): HTMLInputElement[] {
  for (const el of root.querySelectorAll('input')) out.push(el);
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) collectInputs(el.shadowRoot, out);
  }
  return out;
}

export function isVisible(el: HTMLElement): boolean {
  if (el.hidden || el.closest('[hidden],[aria-hidden="true"]')) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isFillableText(el: HTMLInputElement): boolean {
  return (
    !el.disabled &&
    !el.readOnly &&
    ['text', 'email', 'tel', 'url', ''].includes(el.type)
  );
}

/** 在文档（含 open shadow root）里找登录字段 */
export function findLoginFields(root: ParentNode = document): LoginFields {
  const inputs = collectInputs(root).filter((el) => isVisible(el));

  // 密码框：排除注册/验证码场景
  const passwords = inputs.filter(
    (el) => el.type === 'password' && !PASSWORD_AUTOCOMPLETE_BLOCK.has(el.autocomplete),
  );
  if (passwords.length === 0) return { username: null, password: null };
  const password = passwords.find((p) => p.autocomplete === 'current-password') ?? passwords[0]!;

  // 用户名：密码框之前的可见文本输入
  const before = inputs.filter(
    (el) =>
      isFillableText(el) &&
      (el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );

  const username =
    before.find((el) => USERNAME_AUTOCOMPLETE.has(el.autocomplete)) ??
    before.find((el) => USERNAME_KEYWORDS.some((k) => fieldKeywords(el).includes(k))) ??
    before[before.length - 1] ??
    null;

  return { username, password };
}

/** 判断聚焦的元素是否是登录相关字段（决定是否弹内联菜单） */
export function isLoginField(el: Element | null, root: ParentNode = document): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const { username, password } = findLoginFields(root);
  return el === username || el === password;
}

/**
 * 填充值并触发页面可感知的事件（复刻官方 InsertAutofillContentService 的核心动作）。
 * 用原生 setter 绕过 React/Vue 等框架的受控组件拦截。
 */
export function fillInput(el: HTMLInputElement, value: string): void {
  if (el.disabled || el.readOnly) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  el.focus();
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
}
