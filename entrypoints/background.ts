import { serverUrl } from '@/lib/store/settings';
import { VaultwardenClient } from '@/lib/vaultwarden/client';

export default defineBackground(() => {
  console.log('[keycask] background started', { id: browser.runtime.id });

  // M0 连通性自检：已配置服务器时，启动即验证 /api/config 可达
  serverUrl.getValue().then(async (url) => {
    if (!url) return;
    try {
      const cfg = await new VaultwardenClient(url).getConfig();
      console.log('[keycask] server reachable:', cfg.version, cfg.server?.name);
    } catch (e) {
      console.warn('[keycask] server unreachable:', e);
    }
  });
});
