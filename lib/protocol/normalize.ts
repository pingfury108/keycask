import type { CipherResponse, FieldResponse, SyncResponse } from './types';

/**
 * 老版 Vaultwarden（≤1.30.x）的响应字段是 PascalCase，新版是 camelCase。
 * 所有协议字段访问统一走 g()，双大小写兼容。
 */
export function g<T = unknown>(obj: Record<string, unknown> | null | undefined, key: string): T | undefined {
  if (obj == null) return undefined;
  return (obj[key] ?? obj[key[0]!.toLowerCase() + key.slice(1)]) as T | undefined;
}

/** 已知的 cipher 字段名（其余收编进 _unknown，绝不参与类型断言） */
const KNOWN_CIPHER_KEYS = new Set([
  'id', 'organizationId', 'folderId', 'type', 'name', 'notes', 'favorite',
  'deletedDate', 'revisionDate', 'reprompt', 'key', 'login', 'secureNote',
  'card', 'identity', 'fields', 'passwordHistory', 'object', 'edit', 'viewPassword',
  'organizationUseTotp', 'permissions', 'attachments', 'collectionIds', 'creationDate',
]);

function normalizeCipher(raw: Record<string, unknown>): CipherResponse {
  const login = g<Record<string, unknown>>(raw, 'Login');
  const fields = (g<Record<string, unknown>[]>(raw, 'Fields') ?? []).map(
    (f): FieldResponse => ({
      name: g<string>(f, 'Name') ?? null,
      value: g<string>(f, 'Value') ?? null,
      type: g<number>(f, 'Type') ?? 0,
      linkedId: g<number>(f, 'LinkedId') ?? null,
    }),
  );

  const unknown: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    const camel = k[0]!.toLowerCase() + k.slice(1);
    if (!KNOWN_CIPHER_KEYS.has(camel)) unknown[k] = raw[k];
  }

  return {
    id: g<string>(raw, 'Id') ?? '',
    organizationId: g<string>(raw, 'OrganizationId') ?? null,
    folderId: g<string>(raw, 'FolderId') ?? null,
    type: g(raw, 'Type') ?? 1,
    name: g<string>(raw, 'Name') ?? '',
    notes: g<string>(raw, 'Notes') ?? null,
    favorite: g<boolean>(raw, 'Favorite') ?? false,
    deletedDate: g<string>(raw, 'DeletedDate') ?? null,
    revisionDate: g<string>(raw, 'RevisionDate') ?? '',
    reprompt: g<number>(raw, 'Reprompt') ?? 0,
    key: g<string>(raw, 'Key') ?? null,
    login: login
      ? {
          username: g<string>(login, 'Username') ?? null,
          password: g<string>(login, 'Password') ?? null,
          totp: g<string>(login, 'Totp') ?? null,
          uris: (g<Record<string, unknown>[]>(login, 'Uris') ?? []).map((u) => ({
            uri: g<string>(u, 'Uri') ?? null,
            match: g<number>(u, 'Match') ?? null,
          })),
        }
      : null,
    secureNote: g(raw, 'SecureNote') ?? null,
    card: g(raw, 'Card') ?? null,
    identity: g(raw, 'Identity') ?? null,
    fields,
    passwordHistory: null, // M2 暂不解析
    _unknown: Object.keys(unknown).length ? unknown : undefined,
  };
}

/** 规范化整个 sync 响应（PascalCase/camelCase 双兼容 + 未知字段收编） */
export function normalizeSyncResponse(raw: Record<string, unknown>): SyncResponse {
  const profile = g<Record<string, unknown>>(raw, 'Profile') ?? {};
  return {
    profile: {
      id: g<string>(profile, 'Id') ?? '',
      email: g<string>(profile, 'Email') ?? '',
      name: g<string>(profile, 'Name') ?? null,
      key: g<string>(profile, 'Key') ?? undefined,
      privateKey: g<string>(profile, 'PrivateKey') ?? undefined,
    },
    folders: (g<Record<string, unknown>[]>(raw, 'Folders') ?? []).map((f) => ({
      id: g<string>(f, 'Id') ?? '',
      name: g<string>(f, 'Name') ?? '',
      revisionDate: g<string>(f, 'RevisionDate') ?? '',
    })),
    collections: g(raw, 'Collections') ?? [],
    ciphers: (g<Record<string, unknown>[]>(raw, 'Ciphers') ?? []).map(normalizeCipher),
    domains: g(raw, 'Domains'),
    policies: g(raw, 'Policies'),
    sends: g(raw, 'Sends'),
  };
}
