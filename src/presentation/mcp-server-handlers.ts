import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";
import {
  InitializeRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpProxy } from "../usecase/mcp-proxy/types.js";

type IdGeneratorFn = () => string | number;

type HandlerConfig = {
  proxy: McpProxy;
  idGenerator: IdGeneratorFn;
};

// SDKのリクエストハンドラはthrowされたMcpErrorをJSON-RPCエラーレスポンスとして
// クライアントに返す仕様のため、ここでは tagged union ではなく throw で伝播する。
const unwrapProxyResponse = (
  proxyResponse: JSONRPCResponse,
): Record<string, unknown> => {
  const errorField = (
    proxyResponse as unknown as {
      error?: { code?: number; message?: string; data?: unknown };
    }
  ).error;
  if (errorField) {
    throw new McpError(
      errorField.code ?? -32603,
      errorField.message ?? "Unknown upstream error",
      errorField.data,
    );
  }
  return (proxyResponse.result as Record<string, unknown> | undefined) || {};
};

export function registerProxyHandlers(
  server: Server,
  config: HandlerConfig,
): void {
  const { proxy, idGenerator } = config;

  server.setRequestHandler(InitializeRequestSchema, async (request) => {
    const proxyResponse = await proxy.handleRequest({
      jsonrpc: "2.0",
      id: idGenerator(),
      method: "initialize",
      params: request.params,
    });
    return unwrapProxyResponse(proxyResponse);
  });

  server.fallbackRequestHandler = async (request, _) => {
    const proxyResponse = await proxy.handleRequest({
      jsonrpc: "2.0",
      id: idGenerator(),
      method: request.method,
      params: request.params,
    });
    return unwrapProxyResponse(proxyResponse);
  };
}

export function setupGracefulShutdown(transport: StdioServerTransport): void {
  process.on("SIGINT", () => {
    transport.close?.();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    transport.close?.();
    process.exit(0);
  });
}
