# 钥匣 KeyCask

Vaultwarden 兼容的密码管理器浏览器插件（MV3）。纯 TypeScript 实现协议与加密，核心设计目标是**抗脆弱**：服务端多一个字段不会整列白屏，单条数据损坏不影响其他条目。

## 特性

- 🔐 **完整密钥链**：PBKDF2-SHA256 / Argon2id KDF、HKDF 拉伸、EncString（AES-256-CBC + HMAC）解密、组织密钥（RSA-OAEP-SHA1）
- 🛡️ **宽容解密**：逐条 try/catch，失败条目单独列出原因，绝不拖垮整列
- 🔌 **老版本优先**：兼容 Vaultwarden 1.30.x 世代的 PascalCase 协议，自动回退新旧端点
- ⚡ **自动填充**：字段内嵌按钮、聚焦自动弹出匹配列表、⌘⇧L 快捷键（重复按轮循多账号）、iframe 表单、Shadow DOM 穿透
- 💾 **保存密码提示条**：登录提交后询问保存，支持「不再提示此网站」
- 🔢 **TOTP**：实时验证码 + 倒计时，填充后自动复制到剪贴板
- 🎲 **密码生成器**：拒绝采样消除取模偏差
- 🗂️ 文件夹筛选、卡片/身份展示、条目增删改（回收站）、工具栏匹配数角标、超时自动锁定

## 开发

```bash
pnpm install
pnpm dev        # 开发模式（自动加载到 Chrome）
pnpm build      # 构建到 .output/chrome-mv3
pnpm test       # Vitest（RFC 标准向量 + 宽容解密回归）
pnpm compile    # 类型检查
node scripts/gen-icons.mjs  # 从 assets-src/logo.svg 重新生成图标
```

## 架构

```
entrypoints/
  background.ts     Service Worker：同步、锁定、快捷键、右键菜单、角标、消息路由
  popup/            Preact：保险库 / 生成器 / 登录 / 解锁
  content.ts        自动填充：内联菜单 + 保存提示条（Shadow DOM 隔离）
  options/          设置 + 诊断页（脱敏导出）
lib/
  protocol/         协议类型（唯一事实来源）+ PascalCase/camelCase 归一化
  crypto/           KDF / EncString / RSA / TOTP / 生成器（纯 WebCrypto + hash-wasm）
  vaultwarden/      HTTP 客户端、登录解锁编排、匹配、CRUD
  autofill/         字段识别、URI 匹配（官方六种策略）
```

关键架构决策：**状态是传输层**——popup 直接读 `chrome.storage` 而不依赖 Service Worker 存活；消息通道只传动作与事件。

## 安全说明

- User Key 只在 `chrome.storage.session`（浏览器关闭即清）；本地持久化的只有密文缓存
- 主密码哈希方向、KDF 防降级下限（PBKDF2 ≥ 5000）、MAC 先验后解，均有测试锁定
- background 只向页面回传**域名匹配**的条目；SPA 导航后填充快照立即失效
- 锁定后工具栏图标变灰；超时阈值可在设置页配置

## 许可

MIT。本项目为干净重写实现（协议为公开标准），与 Bitwarden Inc. 无关；「Compatible with Vaultwarden」。图标为原创设计。
