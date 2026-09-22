import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [preact(), tailwindcss()],
  }),
  manifest: {
    name: '钥匣 KeyCask',
    description: 'Vaultwarden 兼容的密码管理器插件（宽容解密，抗版本错配）',
    permissions: ['storage', 'alarms'],
    // 自建服务器地址不可预知，需要全量 host 权限以绕过扩展页的 CORS 限制
    host_permissions: ['https://*/*', 'http://*/*'],
    // hash-wasm（Argon2id）需要在扩展页实例化 WASM
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
