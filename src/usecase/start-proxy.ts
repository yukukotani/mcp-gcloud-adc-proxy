import packageInfo from "../../package.json" with { type: "json" };
import { createAuthClient } from "../libs/auth/google-auth.js";
import { createHttpClient } from "../libs/http/http-client.js";
import { logger } from "../libs/logging/logger.js";
import { setupSimpleMcpServer } from "../presentation/mcp-server-simple.js";
import { createMcpProxy } from "./mcp-proxy/handler.js";
import { createSessionManager } from "./mcp-proxy/session-manager.js";
import type { ProxyOptions } from "./mcp-proxy/types.js";

type StartProxyResult =
  | { type: "success" }
  | { type: "error"; error: { kind: string; message: string } };

export async function startProxy(
  options: ProxyOptions,
): Promise<StartProxyResult> {
  logger.info(
    { url: options.url, timeout: options.timeout },
    "Starting proxy initialization",
  );

  // URLの検証
  if (!options.url) {
    logger.warn("URL validation failed: URL is required");
    return {
      type: "error",
      error: { kind: "validation-error", message: "URL is required" },
    };
  }

  if (
    !options.url.startsWith("https://") &&
    !options.url.startsWith("http://")
  ) {
    logger.warn(
      { url: options.url },
      "URL validation failed: must be HTTP or HTTPS",
    );
    return {
      type: "error",
      error: { kind: "validation-error", message: "URL must be HTTP or HTTPS" },
    };
  }

  try {
    // 認証クライアントの初期化
    logger.debug("Initializing auth client");
    const authClient = createAuthClient({
      ...(options.impersonateServiceAccount && {
        serviceAccountEmail: options.impersonateServiceAccount,
      }),
      ...(options.includeEmail !== undefined && {
        includeEmail: options.includeEmail,
      }),
      // --forward-impersonator-token 指定かつインパーソネーション時のみ、
      // 元ユーザーのIDトークンを X-Impersonator-Id-Token で上流へ送出する。
      emitImpersonatorToken: Boolean(
        options.impersonateServiceAccount && options.forwardImpersonatorToken,
      ),
    });

    // HTTPクライアントの初期化
    logger.debug("Initializing HTTP client");
    const httpClient = createHttpClient();

    // セッションマネージャーの初期化
    logger.debug("Initializing session manager");
    const sessionManager = createSessionManager();

    // プロキシ設定の作成
    const proxyConfig = {
      targetUrl: options.url,
      timeout: options.timeout,
      authClient,
      httpClient,
      sessionManager,
      ...(options.audiences && { audiences: options.audiences }),
    };

    // プロキシハンドラーの作成
    logger.debug("Creating MCP proxy handler");
    const proxy = createMcpProxy(proxyConfig);

    // MCPサーバーのセットアップと接続
    logger.info("Setting up MCP server");
    await setupSimpleMcpServer({
      name: "mcp-gcloud-adc-proxy",
      version: packageInfo.version,
      proxy,
    });

    // グレースフルシャットダウンの設定
    setupGracefulShutdown();

    logger.info("Proxy started successfully, waiting for requests");

    // プロセスが終了するまで待機
    await new Promise((resolve) => {
      process.on("SIGINT", resolve);
      process.on("SIGTERM", resolve);
    });

    return { type: "success" };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to start proxy",
    );
    return {
      type: "error",
      error: {
        kind: "initialization-error",
        message:
          error instanceof Error ? error.message : "Failed to start proxy",
      },
    };
  }
}

function setupGracefulShutdown(): void {
  const shutdown = () => {
    logger.info("Graceful shutdown initiated");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.on("uncaughtException", (error) => {
    logger.error({ error: error.message }, "Uncaught exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
    process.exit(1);
  });
}
