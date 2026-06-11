export type AuthClient = {
  getIdToken: (audience: string) => Promise<GetIdTokenResult>;
  refreshToken: (audience: string) => Promise<GetIdTokenResult>;
  // インパーソネーション有効時のみ生える。インパーソネーション元（実ユーザー）の
  // 素のIDトークン（gcloud client id を aud に持ち email を含む）を返す。
  getImpersonatorIdToken?: () => Promise<GetIdTokenResult>;
};

export type GetIdTokenResult =
  | { type: "success"; token: string; expiresAt: Date }
  | { type: "error"; error: AuthError };

type AuthError =
  | { kind: "no-credentials"; message: string }
  | { kind: "invalid-audience"; message: string }
  | { kind: "token-fetch-failed"; message: string }
  | { kind: "invalid-token"; message: string }
  | { kind: "impersonation-failed"; message: string };

export type TokenCache = {
  [audience: string]: {
    token: string;
    expiresAt: Date;
  };
};

export type AuthConfig = {
  credentialsPath?: string;
  projectId?: string;
  serviceAccountEmail?: string;
  includeEmail?: boolean;
  // インパーソネーション元の実ユーザーのIDトークンを X-Impersonator-Id-Token
  // ヘッダーで上流へ送るかどうか。
  emitImpersonatorToken?: boolean;
};
