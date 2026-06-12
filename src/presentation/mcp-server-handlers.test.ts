import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  JSONRPCMessage,
  JSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { McpProxy } from "../usecase/mcp-proxy/types.js";
import { registerProxyHandlers } from "./mcp-server-handlers.js";

type RequestHandler = (
  request: { method: string; params?: unknown },
  extra: unknown,
) => Promise<unknown>;

const buildServerStub = () => {
  let initializeHandler: RequestHandler | undefined;
  const server = {
    setRequestHandler: (_schema: unknown, handler: RequestHandler) => {
      initializeHandler = handler;
    },
    fallbackRequestHandler: undefined as RequestHandler | undefined,
  };
  return {
    server: server as unknown as Server,
    getInitializeHandler: () => initializeHandler,
    getFallbackHandler: () => server.fallbackRequestHandler,
  };
};

const buildProxyStub = (response: JSONRPCResponse): McpProxy => ({
  handleRequest: async () => response,
  handleMessage: async (message: JSONRPCMessage) => message,
});

const successResponse = {
  jsonrpc: "2.0",
  id: "proxy-1",
  result: { content: [{ type: "text", text: "調査結果" }] },
} as JSONRPCResponse;

const errorResponse = {
  jsonrpc: "2.0",
  id: "proxy-1",
  error: {
    code: -32603,
    message: "Invalid response format from target server",
  },
} as unknown as JSONRPCResponse;

describe("registerProxyHandlers", () => {
  describe("fallbackRequestHandler", () => {
    it("成功レスポンスのresultをそのまま返す", async () => {
      const { server, getFallbackHandler } = buildServerStub();
      registerProxyHandlers(server, {
        proxy: buildProxyStub(successResponse),
        idGenerator: () => "proxy-1",
      });

      const handler = getFallbackHandler();
      const result = await handler?.({ method: "tools/call" }, {});

      expect(result).toEqual({ content: [{ type: "text", text: "調査結果" }] });
    });

    it("エラーレスポンスを空のresultに変換せずMcpErrorとして伝播する", async () => {
      const { server, getFallbackHandler } = buildServerStub();
      registerProxyHandlers(server, {
        proxy: buildProxyStub(errorResponse),
        idGenerator: () => "proxy-1",
      });

      const handler = getFallbackHandler();

      await expect(handler?.({ method: "tools/call" }, {})).rejects.toThrow(
        McpError,
      );
      await expect(handler?.({ method: "tools/call" }, {})).rejects.toThrow(
        /Invalid response format from target server/,
      );
    });
  });

  describe("initializeハンドラ", () => {
    it("成功レスポンスのresultをそのまま返す", async () => {
      const { server, getInitializeHandler } = buildServerStub();
      registerProxyHandlers(server, {
        proxy: buildProxyStub(successResponse),
        idGenerator: () => "proxy-1",
      });

      const handler = getInitializeHandler();
      const result = await handler?.({ method: "initialize", params: {} }, {});

      expect(result).toEqual({ content: [{ type: "text", text: "調査結果" }] });
    });

    it("エラーレスポンスをMcpErrorとして伝播する", async () => {
      const { server, getInitializeHandler } = buildServerStub();
      registerProxyHandlers(server, {
        proxy: buildProxyStub(errorResponse),
        idGenerator: () => "proxy-1",
      });

      const handler = getInitializeHandler();

      await expect(
        handler?.({ method: "initialize", params: {} }, {}),
      ).rejects.toThrow(McpError);
    });
  });
});
