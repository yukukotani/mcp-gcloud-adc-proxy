import { GoogleAuth } from "google-auth-library";
import { logger } from "../logging/logger.js";
import type {
  AuthClient,
  AuthConfig,
  GetIdTokenResult,
  TokenCache,
} from "./types.js";

type GoogleAuthState = {
  googleAuth: GoogleAuth;
  tokenCache: TokenCache;
  serviceAccountEmail?: string;
  includeEmail: boolean;
  emitImpersonatorToken: boolean;
  // インパーソネーション元トークンは aud 固定のため単一エントリでキャッシュする。
  // Authorization 用の tokenCache とはキー空間を分離する。
  impersonatorTokenCache: TokenCache;
};

// インパーソネーション元トークンのキャッシュキー（aud は固定だが、形式を
// tokenCache に揃えるための内部キー）。
const IMPERSONATOR_CACHE_KEY = "impersonator";

const isValidAudience = (
  audience: string,
  serviceAccountEmail?: string,
): boolean => {
  // サービスアカウントインパーソネーション使用時は、Client IDなどの非URL形式も許可
  if (serviceAccountEmail) {
    return audience.trim().length > 0;
  }

  // 通常のADC使用時はHTTPS URLのみ許可
  try {
    const url = new URL(audience);
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

const getCachedToken = (state: GoogleAuthState, audience: string) => {
  return state.tokenCache[audience];
};

const isTokenValid = (expiresAt: Date): boolean => {
  const now = new Date();
  const buffer = 5 * 60 * 1000; // 5分のバッファ
  return expiresAt.getTime() - now.getTime() > buffer;
};

const extractTokenExpiration = (token: string): Date => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return new Date(Date.now() + 60 * 60 * 1000);
    }

    const payloadPart = parts[1];
    if (!payloadPart) {
      return new Date(Date.now() + 60 * 60 * 1000);
    }

    const payload = JSON.parse(Buffer.from(payloadPart, "base64").toString());
    const exp = payload.exp;
    if (typeof exp === "number") {
      return new Date(exp * 1000);
    }
  } catch {
    // JWTの解析に失敗した場合はデフォルトの有効期限を設定
  }

  // デフォルトで1時間の有効期限
  return new Date(Date.now() + 60 * 60 * 1000);
};

const fetchTokenWithImpersonation = async (
  state: GoogleAuthState,
  audience: string,
): Promise<GetIdTokenResult> => {
  try {
    const serviceAccountEmail = state.serviceAccountEmail;
    if (!serviceAccountEmail) {
      return {
        type: "error",
        error: {
          kind: "impersonation-failed",
          message: "Service account email is required for impersonation",
        },
      };
    }

    logger.debug(
      { serviceAccountEmail, audience },
      "Fetching ID token via service account impersonation",
    );

    // ADCからアクセストークンを取得
    const client = await state.googleAuth.getClient();
    if (!client) {
      return {
        type: "error",
        error: {
          kind: "no-credentials",
          message:
            'No credentials found. Please run "gcloud auth application-default login" or set GOOGLE_APPLICATION_CREDENTIALS environment variable.',
        },
      };
    }

    const accessTokenResponse = await client.getAccessToken();
    if (!accessTokenResponse.token) {
      return {
        type: "error",
        error: {
          kind: "impersonation-failed",
          message: "Failed to get access token from ADC",
        },
      };
    }

    // IAM Credentials API を使用してIDトークンを生成
    const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateIdToken`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessTokenResponse.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audience,
        includeEmail: state.includeEmail,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          serviceAccountEmail,
          status: response.status,
          error: errorText,
        },
        "Failed to generate ID token via impersonation",
      );
      return {
        type: "error",
        error: {
          kind: "impersonation-failed",
          message: `Failed to generate ID token for service account ${serviceAccountEmail}: ${response.status} ${errorText}`,
        },
      };
    }

    const data = (await response.json()) as { token: string };
    const idToken = data.token;

    if (!idToken || typeof idToken !== "string") {
      return {
        type: "error",
        error: {
          kind: "invalid-token",
          message: "Failed to retrieve a valid ID token from impersonation",
        },
      };
    }

    const expiresAt = extractTokenExpiration(idToken);

    state.tokenCache[audience] = {
      token: idToken,
      expiresAt,
    };

    logger.debug(
      { audience, expiresAt, serviceAccountEmail },
      "Successfully fetched and cached impersonated ID token",
    );

    return {
      type: "success",
      token: idToken,
      expiresAt,
    };
  } catch (error) {
    logger.error(
      {
        serviceAccountEmail: state.serviceAccountEmail,
        audience,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Failed to fetch ID token via impersonation",
    );
    return {
      type: "error",
      error: {
        kind: "impersonation-failed",
        message: `Failed to fetch ID token via impersonation: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
};

const fetchNewToken = async (
  state: GoogleAuthState,
  audience: string,
): Promise<GetIdTokenResult> => {
  try {
    logger.debug({ audience }, "Fetching new ID token from Google Auth");

    // サービスアカウントインパーソネーションが指定されている場合
    if (state.serviceAccountEmail && state.serviceAccountEmail.trim() !== "") {
      logger.debug(
        { serviceAccount: state.serviceAccountEmail },
        "Using service account impersonation",
      );
      return await fetchTokenWithImpersonation(state, audience);
    }

    // 通常のADC処理
    const client = await state.googleAuth.getClient();

    if (!client) {
      logger.warn("No Google Auth client available");
      return {
        type: "error",
        error: {
          kind: "no-credentials",
          message:
            'No credentials found. Please run "gcloud auth application-default login" or set GOOGLE_APPLICATION_CREDENTIALS environment variable.',
        },
      };
    }

    if (!("fetchIdToken" in client)) {
      logger.warn("Google Auth client does not support ID token generation");
      return {
        type: "error",
        error: {
          kind: "no-credentials",
          message:
            "The authenticated client does not support ID token generation.",
        },
      };
    }

    const idToken = await (
      client as { fetchIdToken: (audience: string) => Promise<string> }
    ).fetchIdToken(audience);

    if (!idToken || typeof idToken !== "string") {
      logger.warn("Failed to retrieve valid ID token");
      return {
        type: "error",
        error: {
          kind: "invalid-token",
          message: "Failed to retrieve a valid ID token.",
        },
      };
    }

    const expiresAt = extractTokenExpiration(idToken);

    state.tokenCache[audience] = {
      token: idToken,
      expiresAt,
    };

    logger.debug(
      { audience, expiresAt },
      "Successfully fetched and cached new ID token",
    );

    return {
      type: "success",
      token: idToken,
      expiresAt,
    };
  } catch (error) {
    logger.error(
      {
        audience,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Failed to fetch ID token",
    );
    return {
      type: "error",
      error: {
        kind: "token-fetch-failed",
        message: `Failed to fetch ID token: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
};

// インパーソネーションを「挟まない」素のADCクライアント（gcloudユーザー）から
// refresh_token グラントでIDトークンを取得する。target_audience を指定しない
// ため `gcloud auth print-identity-token` 相当となり、email クレームを含み
// aud は gcloud の client id になる。
const fetchImpersonatorIdToken = async (
  state: GoogleAuthState,
): Promise<GetIdTokenResult> => {
  try {
    const client = await state.googleAuth.getClient();
    if (!client) {
      return {
        type: "error",
        error: {
          kind: "no-credentials",
          message:
            'No credentials found. Please run "gcloud auth application-default login".',
        },
      };
    }

    // refresh_token グラントで素のIDトークンを返せるのは UserRefreshClient のみ。
    // SAキーやCompute等の非ユーザー資格情報では impersonator トークンを出さない。
    if (!("refreshTokenNoCache" in client)) {
      return {
        type: "error",
        error: {
          kind: "no-credentials",
          message:
            "ADC is not a user credential; cannot emit an impersonator ID token.",
        },
      };
    }

    // refreshTokenNoCache は UserRefreshClient 上では型定義上 protected だが、
    // 実行時は public（refreshclient.js）。unknown 経由でキャストして呼ぶ。
    const { tokens } = await (
      client as unknown as {
        refreshTokenNoCache: () => Promise<{ tokens: { id_token?: string } }>;
      }
    ).refreshTokenNoCache();
    const idToken = tokens.id_token;

    if (!idToken || typeof idToken !== "string") {
      return {
        type: "error",
        error: {
          kind: "invalid-token",
          message: "Refresh response did not include an id_token.",
        },
      };
    }

    const expiresAt = extractTokenExpiration(idToken);
    state.impersonatorTokenCache[IMPERSONATOR_CACHE_KEY] = {
      token: idToken,
      expiresAt,
    };

    logger.debug(
      { expiresAt },
      "Successfully fetched and cached impersonator ID token",
    );

    return { type: "success", token: idToken, expiresAt };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to fetch impersonator ID token",
    );
    return {
      type: "error",
      error: {
        kind: "token-fetch-failed",
        message: `Failed to fetch impersonator ID token: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
};

const getImpersonatorIdToken = async (
  state: GoogleAuthState,
): Promise<GetIdTokenResult> => {
  const cached = state.impersonatorTokenCache[IMPERSONATOR_CACHE_KEY];
  if (cached && isTokenValid(cached.expiresAt)) {
    logger.debug("Using cached impersonator token");
    return {
      type: "success",
      token: cached.token,
      expiresAt: cached.expiresAt,
    };
  }
  return fetchImpersonatorIdToken(state);
};

const getIdToken = async (
  state: GoogleAuthState,
  audience: string,
): Promise<GetIdTokenResult> => {
  logger.debug({ audience }, "Getting ID token");

  if (!isValidAudience(audience, state.serviceAccountEmail)) {
    logger.warn({ audience }, "Invalid audience provided");
    return {
      type: "error",
      error: {
        kind: "invalid-audience",
        message: state.serviceAccountEmail
          ? `Invalid audience: ${audience}. Must be a non-empty string.`
          : `Invalid audience: ${audience}. Must be a valid HTTPS URL.`,
      },
    };
  }

  const cached = getCachedToken(state, audience);
  if (cached && isTokenValid(cached.expiresAt)) {
    logger.debug({ audience }, "Using cached token");
    return {
      type: "success",
      token: cached.token,
      expiresAt: cached.expiresAt,
    };
  }

  logger.debug({ audience }, "Fetching new token");
  return fetchNewToken(state, audience);
};

const refreshToken = async (
  state: GoogleAuthState,
  audience: string,
): Promise<GetIdTokenResult> => {
  logger.debug({ audience }, "Refreshing token");
  delete state.tokenCache[audience];
  return getIdToken(state, audience);
};

const createGoogleAuthState = (config: AuthConfig = {}): GoogleAuthState => {
  const authOptions: {
    scopes: string[];
    keyFilename?: string;
    projectId?: string;
  } = {
    // インパーソネーション時にはcloud-platformスコープが必要
    scopes: config.serviceAccountEmail
      ? ["https://www.googleapis.com/auth/cloud-platform"]
      : [],
  };

  if (config.credentialsPath) {
    authOptions.keyFilename = config.credentialsPath;
  }

  if (config.projectId) {
    authOptions.projectId = config.projectId;
  }

  return {
    googleAuth: new GoogleAuth(authOptions),
    tokenCache: {},
    impersonatorTokenCache: {},
    includeEmail: config.includeEmail ?? true,
    emitImpersonatorToken: config.emitImpersonatorToken ?? false,
    ...(config.serviceAccountEmail && {
      serviceAccountEmail: config.serviceAccountEmail,
    }),
  };
};

export function createAuthClient(config: AuthConfig = {}): AuthClient {
  logger.debug({ config }, "Creating Google Auth client");
  const state = createGoogleAuthState(config);

  return {
    getIdToken: (audience: string) => getIdToken(state, audience),
    refreshToken: (audience: string) => refreshToken(state, audience),
    // インパーソネーション有効かつ送出フラグが立っているときのみ生やす。
    ...(state.emitImpersonatorToken && state.serviceAccountEmail
      ? { getImpersonatorIdToken: () => getImpersonatorIdToken(state) }
      : {}),
  };
}
