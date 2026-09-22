import type {
  ConfigResponse,
  LegacyPreloginResponse,
  PasswordPreloginResponse,
  TokenResponse,
} from '@/lib/protocol/types';
import { CLIENT_ID, DEVICE_TYPE_CHROME_EXTENSION } from '@/lib/protocol/types';

export type PreloginResult =
  | { kind: 'modern'; res: PasswordPreloginResponse }
  | { kind: 'legacy'; res: LegacyPreloginResponse };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class TwoFactorRequiredError extends Error {
  constructor(public providers: unknown) {
    super('该账号启用了二步验证，当前版本暂不支持（计划 M5）');
    this.name = 'TwoFactorRequiredError';
  }
}

/**
 * Vaultwarden HTTP 客户端。
 * M1：prelogin / token / sync。
 */
export class VaultwardenClient {
  private accessToken: string | null = null;

  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  withToken(token: string): this {
    this.accessToken = token;
    return this;
  }

  async getConfig(): Promise<ConfigResponse> {
    return this.get('/api/config');
  }

  async prelogin(email: string): Promise<PreloginResult> {    // 新端点优先；老版 Vaultwarden 没有 /prelogin/password，回退到老端点
    try {
      const res = await this.postJson<PasswordPreloginResponse>(
        '/identity/accounts/prelogin/password',
        { email },
      );
      return { kind: 'modern', res };
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      const res = await this.postJson<LegacyPreloginResponse>('/identity/accounts/prelogin', {
        email,
      });
      return { kind: 'legacy', res };
    }
  }

  async loginWithPassword(params: {
    email: string;
    masterPasswordHash: string;
    deviceIdentifier: string;
    deviceName: string;
  }): Promise<TokenResponse> {
    const body = new URLSearchParams({
      scope: 'api offline_access',
      client_id: CLIENT_ID,
      grant_type: 'password',
      username: params.email,
      password: params.masterPasswordHash,
      deviceType: String(DEVICE_TYPE_CHROME_EXTENSION),
      deviceIdentifier: params.deviceIdentifier,
      deviceName: params.deviceName,
    });

    const res = await fetch(`${this.baseUrl}/identity/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      // 2FA 触发时响应里带 TwoFactorProviders2
      if (/twofactor|two factor/i.test(text)) {
        throw new TwoFactorRequiredError(text);
      }
      throw new ApiError(res.status, extractErrorMessage(text, res.status));
    }
    return (await res.json()) as TokenResponse;
  }

  async refreshTokens(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });
    const res = await fetch(`${this.baseUrl}/identity/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, extractErrorMessage(text, res.status));
    }
    return (await res.json()) as TokenResponse;
  }

  async putJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, extractErrorMessage(text, res.status));
    }
    return (await res.json()) as T;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, extractErrorMessage(text, res.status));
    }
    return (await res.json()) as T;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.accessToken) h.Authorization = `Bearer ${this.accessToken}`;
    return h;
  }
}

function extractErrorMessage(text: string, status: number): string {
  try {
    const j = JSON.parse(text);
    return (
      j.error_description ?? j.errorModel?.message ?? j.message ?? j.error ?? `HTTP ${status}`
    );
  } catch {
    // 非 JSON 响应（如反向代理返回的 HTML 错误页），不要原样塞进 UI
    return `HTTP ${status}`;
  }
}
