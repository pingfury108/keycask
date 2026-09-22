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

// ---- 解锁页所需的持久化材料（均为密文，安全） ----

/** 账号 KDF 参数（登录时记录，解锁时重新派生用） */
export const kdfConfig = storage.defineItem<string | null>('local:kdfConfig', {
  fallback: null,
});

/** EncString 形式的用户密钥（解锁时重新解出 User Key） */
export const encryptedUserKey = storage.defineItem<string | null>('local:encryptedUserKey', {
  fallback: null,
});

/** EncString 形式的 RSA 私钥（解锁时重新解组织密钥） */
export const encryptedPrivateKey = storage.defineItem<string | null>('local:encryptedPrivateKey', {
  fallback: null,
});

/** 组织 ID → 名称（明文在服务端本就可读，持久化无碍） */
export const orgNames = storage.defineItem<Record<string, string>>('local:orgNames', {
  fallback: {},
});

/** 超时锁定（分钟），0 = 不自动锁 */
export const lockTimeoutMin = storage.defineItem<number>('local:lockTimeoutMin', {
  fallback: 15,
});

/** 最近一次活跃时间（popup 打开/操作时刷新） */
export const lastActivity = storage.defineItem<number>('local:lastActivity', {
  fallback: 0,
});

/** 上次同步统计（诊断页用；只存 id+原因，不含明文） */
export interface SyncStats {
  at: number;
  cipherCount: number;
  failed: { id: string; reason: string }[];
}
export const lastSyncStats = storage.defineItem<SyncStats | null>('local:lastSyncStats', {
  fallback: null,
});

/** refresh token（离线解锁后换新 access token 用） */
export const refreshToken = storage.defineItem<string | null>('local:refreshToken', {
  fallback: null,
});

/** 组织密钥 Map 的 EncString（User Key 加密），解锁时离线恢复组织密钥 */
export const encryptedOrgKeys = storage.defineItem<string | null>('local:encryptedOrgKeys', {
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
