import { storage } from 'wxt/utils/storage';

/** 自建 Vaultwarden 服务器地址（持久化） */
export const serverUrl = storage.defineItem<string>('local:serverUrl', {
  fallback: '',
});

/** 上次登录的邮箱（仅记忆，不存任何凭据） */
export const lastEmail = storage.defineItem<string>('local:lastEmail', {
  fallback: '',
});

/** 设备标识：用于「记住设备」/会话记录，生成一次后持久化 */
export const deviceId = storage.defineItem<string | null>('local:deviceId', {
  fallback: null,
});

// ---- 会话态（浏览器关闭即清，User Key 不落盘）----

export const accessToken = storage.defineItem<string | null>('session:accessToken', {
  fallback: null,
});

export const userKeyB64 = storage.defineItem<string | null>('session:userKey', {
  fallback: null,
});

/** 组织密钥（orgId → 64B 密钥的 base64），仅会话期 */
export const orgKeysB64 = storage.defineItem<Record<string, string> | null>('session:orgKeys', {
  fallback: null,
});

/** 最近一次同步拿到的密文缓存（M2 起供 popup 直接读取渲染） */
export const vaultCiphersRaw = storage.defineItem<unknown[] | null>('local:vaultCiphers', {
  fallback: null,
});

export const vaultFoldersRaw = storage.defineItem<unknown[] | null>('local:vaultFolders', {
  fallback: null,
});

export const lastSyncAt = storage.defineItem<number | null>('local:lastSyncAt', {
  fallback: null,
});

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await deviceId.getValue();
  if (!id) {
    id = crypto.randomUUID();
    await deviceId.setValue(id);
  }
  return id;
}
