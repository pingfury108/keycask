/**
 * Bitwarden / Vaultwarden 协议类型定义 —— 唯一事实来源。
 *
 * ⚠️ 已知陷阱（来自 bitwarden/clients 2026.9.1 源码核对）：
 * - prelogin 响应字段是 PascalCase（KdfType / Iterations / Salt…）
 * - /api/sync 等其余接口是 camelCase
 */

// ---------- KDF ----------

export const enum KdfType {
  PBKDF2_SHA256 = 0,
  Argon2id = 1,
}

/** 防预登录降级攻击的下限（服务端返回低于此值必须拒绝） */
export const PRELOGIN_ITERATIONS_MIN = 5_000;

export const KDF_DEFAULTS = {
  pbkdf2Iterations: 600_000,
  argon2Iterations: 6,
  argon2MemoryMiB: 32,
  argon2Parallelism: 4,
} as const;

// ---------- prelogin ----------

/** 新端点响应（2025+ 客户端协议），PascalCase */
export interface PasswordPreloginResponse {
  kdfSettings: {
    KdfType: KdfType;
    Iterations: number;
    Memory?: number;
    Parallelism?: number;
  };
  /** Argon2id 使用的 salt；PBKDF2 仍以 normalize(email) 为 salt */
  salt?: string;
}

/** 老端点 /identity/accounts/prelogin 的响应（老版 Vaultwarden），PascalCase 或 camelCase */
export interface LegacyPreloginResponse {
  Kdf?: KdfType;
  kdf?: KdfType;
  KdfIterations?: number;
  kdfIterations?: number;
  KdfMemory?: number | null;
  kdfMemory?: number | null;
  KdfParallelism?: number | null;
  kdfParallelism?: number | null;
}

// ---------- POST /identity/connect/token ----------

export const CLIENT_ID = 'browser';
export const DEVICE_TYPE_CHROME_EXTENSION = 2;

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  /**
   * 用户主密钥（EncString）。
   * 老版 Vaultwarden（≤1.30.x）：在 token 响应里，PascalCase `Key`；
   * 新版：移到 /api/sync 的 profile.key（camelCase）。
   */
  Key?: string;
  key?: string;
  /** RSA 私钥（EncString type 2，User Key 加密）；老版 token 响应为 PascalCase */
  PrivateKey?: string;
  privateKey?: string;
  kdf?: KdfType;
  kdfIterations?: number;
  kdfMemory?: number;
  kdfParallelism?: number;
}

// ---------- GET /api/sync ----------

export interface SyncResponse {
  profile: ProfileResponse;
  folders: FolderResponse[];
  collections: CollectionResponse[];
  ciphers: CipherResponse[];
  domains?: unknown;
  policies?: PolicyResponse[];
  sends?: unknown[];
}

export interface ProfileResponse {
  id: string;
  email: string;
  name?: string | null;
  /** EncString：User Symmetric Key，用 stretched master key 解密 */
  key?: string;
  privateKey?: string;
  premium?: boolean;
  organizations?: OrganizationMembership[];
}

/** 组织成员关系：key 是 RSA-OAEP-SHA1 加密的组织对称密钥（type 4） */
export interface OrganizationMembership {
  id: string;
  name?: string;
  key?: string;
}

export interface FolderResponse {
  id: string;
  name: string; // EncString
  revisionDate: string;
}

export interface CollectionResponse {
  id: string;
  organizationId: string;
  name: string; // EncString（组织密钥加密）
}

export const enum CipherType {
  Login = 1,
  SecureNote = 2,
  Card = 3,
  Identity = 4,
  SshKey = 5,
}

export interface CipherResponse {
  id: string;
  organizationId?: string | null;
  folderId?: string | null;
  type: CipherType;
  name: string; // EncString
  notes?: string | null;
  favorite?: boolean;
  deletedDate?: string | null;
  revisionDate: string;
  reprompt?: number;
  key?: string | null;
  login?: LoginData | null;
  secureNote?: { type: number } | null;
  card?: Record<string, string | null> | null;
  identity?: Record<string, string | null> | null;
  fields?: FieldResponse[] | null;
  passwordHistory?: { password: string; lastUsedDate: string }[] | null;
  /**
   * 未知字段统一收编到这里（由解析层填充），
   * 绝不让未知字段参与类型断言 —— 抗版本错配的核心防线。
   */
  _unknown?: Record<string, unknown>;
}

export interface LoginData {
  username?: string | null;
  password?: string | null;
  totp?: string | null;
  uris?: { uri: string | null; match?: number | null }[] | null;
}

export interface FieldResponse {
  name?: string | null;
  value?: string | null;
  type: number; // 0 text, 1 hidden, 2 boolean, 3 linked
  linkedId?: number | null;
}

export interface PolicyResponse {
  id: string;
  organizationId: string;
  type: number;
  enabled: boolean;
  data?: Record<string, unknown> | null;
}

// ---------- GET /api/config ----------

export interface ConfigResponse {
  version: string; // ⚠️ 这是 Web Vault 版本，不是服务端版本
  gitHash?: string;
  server?: { name: string; url: string } | null;
  featureStates?: Record<string, unknown>;
}
