import type {
  JSONRPCRequest,
  JSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AuthClient } from "../../libs/auth/types.js";
import type { HttpClient } from "../../libs/http/types.js";
import { createMcpProxy } from "./handler.js";
import type { ProxyConfig, SessionManager } from "./types.js";

describe("McpProxy", () => {
  let mockAuthClient: AuthClient;
  let mockHttpClient: HttpClient;
  let mockSessionManager: SessionManager;
  let config: ProxyConfig;
  let proxy: ReturnType<typeof createMcpProxy>;

  beforeEach(() => {
    mockAuthClient = {
      getIdToken: vi.fn() as Mock,
      refreshToken: vi.fn() as Mock,
    };

    mockHttpClient = {
      post: vi.fn() as Mock,
      postStream: vi.fn() as Mock,
    };

    mockSessionManager = {
      getSessionId: vi.fn() as Mock,
      setSessionId: vi.fn() as Mock,
      clearSession: vi.fn() as Mock,
    };

    config = {
      targetUrl: "https://example.com/api",
      timeout: 5000,
      authClient: mockAuthClient,
      httpClient: mockHttpClient,
      sessionManager: mockSessionManager,
    };

    proxy = createMcpProxy(config);
  });

  describe("handleRequest", () => {
    it("成功したリクエストを処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      const expectedResponse: JSONRPCResponse = {
        jsonrpc: "2.0" as const,
        id: 1,
        result: { tools: [] },
      };

      (mockSessionManager.getSessionId as Mock).mockReturnValue(null);
      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });

      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "success",
        data: expectedResponse,
        status: 200,
        headers: {},
      });

      const result = await proxy.handleRequest(request);

      expect(mockSessionManager.getSessionId).toHaveBeenCalled();
      expect(mockAuthClient.getIdToken).toHaveBeenCalledWith(
        "https://example.com/api",
      );
      expect(mockHttpClient.post).toHaveBeenCalledWith({
        url: "https://example.com/api",
        headers: {
          Authorization: "Bearer mock-token",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: request,
        timeout: 5000,
      });
      expect(result).toEqual(expectedResponse);
    });

    it("認証エラーを処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      (mockSessionManager.getSessionId as Mock).mockReturnValue(null);
      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "error",
        error: {
          kind: "no-credentials",
          message: "No credentials found",
        },
      });

      const result = await proxy.handleRequest(request);

      expect(result).toEqual({
        jsonrpc: "2.0" as const,
        id: 1,
        error: {
          code: -32603,
          message: "Authentication failed: No credentials found",
          data: {
            kind: "no-credentials",
            message: "No credentials found",
          },
        },
      });
    });

    it("HTTPエラーを処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });

      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "error",
        error: {
          kind: "http-error",
          status: 404,
          message: "Not Found",
          body: "Resource not found",
        },
      });

      const result = await proxy.handleRequest(request);

      expect(result).toEqual({
        jsonrpc: "2.0" as const,
        id: 1,
        error: {
          code: -32601,
          message: "HTTP error: Not Found",
          data: {
            kind: "http-error",
            status: 404,
            body: "Resource not found",
          },
        },
      });
    });

    it("ネットワークエラーを処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });

      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "error",
        error: {
          kind: "network-error",
          message: "Connection failed",
        },
      });

      const result = await proxy.handleRequest(request);

      expect(result).toEqual({
        jsonrpc: "2.0" as const,
        id: 1,
        error: {
          code: -32603,
          message: "Network error: Connection failed",
          data: {
            kind: "network-error",
          },
        },
      });
    });

    it("タイムアウトエラーを処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });

      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "error",
        error: {
          kind: "timeout",
          message: "Request timed out after 5000ms",
        },
      });

      const result = await proxy.handleRequest(request);

      expect(result).toEqual({
        jsonrpc: "2.0" as const,
        id: 1,
        error: {
          code: -32603,
          message: "Request timeout: Request timed out after 5000ms",
          data: {
            kind: "timeout",
          },
        },
      });
    });

    it("無効なレスポンス形式を処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });

      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "success",
        data: { invalid: "response" },
        status: 200,
        headers: {},
      });

      const result = await proxy.handleRequest(request);

      expect(result).toEqual({
        jsonrpc: "2.0" as const,
        id: 1,
        error: {
          code: -32603,
          message: "Invalid response format from target server",
          data: {
            received: { invalid: "response" },
          },
        },
      });
    });

    it("予期しないエラーを処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      (mockAuthClient.getIdToken as Mock).mockRejectedValue(
        new Error("Unexpected error"),
      );

      const result = await proxy.handleRequest(request);

      expect(result).toEqual({
        jsonrpc: "2.0" as const,
        id: 1,
        error: {
          code: -32603,
          message: "Internal error: Unexpected error",
          data: expect.any(Error),
        },
      });
    });
  });

  describe("handleMessage", () => {
    it("リクエストメッセージを処理する", async () => {
      const request: JSONRPCRequest = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
        params: {},
      };

      const expectedResponse: JSONRPCResponse = {
        jsonrpc: "2.0" as const,
        id: 1,
        result: { tools: [] },
      };

      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });

      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "success",
        data: expectedResponse,
        status: 200,
        headers: {},
      });

      const result = await proxy.handleMessage(request);

      expect(result).toEqual(expectedResponse);
    });

    it("通知メッセージを処理する", async () => {
      const notification = {
        jsonrpc: "2.0" as const,
        method: "notifications/cancelled",
        params: {},
      };

      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });

      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "success",
        data: null,
        status: 200,
        headers: {},
      });

      const result = await proxy.handleMessage(notification);

      expect(result).toEqual(notification);
      expect(mockHttpClient.post).toHaveBeenCalledWith({
        url: "https://example.com/api",
        headers: {
          Authorization: "Bearer mock-token",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: notification,
        timeout: 5000,
      });
    });
  });

  describe("X-Impersonator-Id-Token ヘッダー", () => {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/list",
      params: {},
    };
    const okResponse: JSONRPCResponse = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: { tools: [] },
    };

    beforeEach(() => {
      (mockSessionManager.getSessionId as Mock).mockReturnValue(null);
      (mockAuthClient.getIdToken as Mock).mockResolvedValue({
        type: "success",
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000),
      });
      (mockHttpClient.post as Mock).mockResolvedValue({
        type: "success",
        data: okResponse,
        status: 200,
        headers: {},
      });
    });

    it("getImpersonatorIdToken 成功時にヘッダーを付与する", async () => {
      mockAuthClient.getImpersonatorIdToken = vi.fn().mockResolvedValue({
        type: "success",
        token: "impersonator-token",
        expiresAt: new Date(Date.now() + 3600000),
      }) as Mock;
      const p = createMcpProxy(config);

      await p.handleRequest(request);

      const postArg = (mockHttpClient.post as Mock).mock.calls[0]?.[0] as {
        headers: Record<string, string>;
      };
      expect(postArg.headers["X-Impersonator-Id-Token"]).toBe(
        "impersonator-token",
      );
    });

    it("getImpersonatorIdToken 失敗時はヘッダーを付与せず続行する", async () => {
      mockAuthClient.getImpersonatorIdToken = vi.fn().mockResolvedValue({
        type: "error",
        error: { kind: "no-credentials", message: "no user credential" },
      }) as Mock;
      const p = createMcpProxy(config);

      const result = await p.handleRequest(request);

      const postArg = (mockHttpClient.post as Mock).mock.calls[0]?.[0] as {
        headers: Record<string, string>;
      };
      expect("X-Impersonator-Id-Token" in postArg.headers).toBe(false);
      expect(result).toEqual(okResponse);
    });

    it("getImpersonatorIdToken 未定義時はヘッダーを付与しない", async () => {
      const p = createMcpProxy(config);

      await p.handleRequest(request);

      const postArg = (mockHttpClient.post as Mock).mock.calls[0]?.[0] as {
        headers: Record<string, string>;
      };
      expect("X-Impersonator-Id-Token" in postArg.headers).toBe(false);
    });
  });
});

describe("createMcpProxy", () => {
  it("McpProxyのインスタンスを作成する", () => {
    const config: ProxyConfig = {
      targetUrl: "https://example.com/api",
      timeout: 5000,
      authClient: {} as AuthClient,
      httpClient: {} as HttpClient,
      sessionManager: {} as SessionManager,
    };

    const proxy = createMcpProxy(config);
    expect(proxy).toBeTruthy();
    expect(typeof proxy.handleRequest).toBe("function");
    expect(typeof proxy.handleMessage).toBe("function");
  });
});

describe("Session Management", () => {
  let mockAuthClient: AuthClient;
  let mockHttpClient: HttpClient;
  let mockSessionManager: SessionManager;
  let config: ProxyConfig;
  let proxy: ReturnType<typeof createMcpProxy>;

  beforeEach(() => {
    mockAuthClient = {
      getIdToken: vi.fn() as Mock,
      refreshToken: vi.fn() as Mock,
    };

    mockHttpClient = {
      post: vi.fn() as Mock,
      postStream: vi.fn() as Mock,
    };

    mockSessionManager = {
      getSessionId: vi.fn() as Mock,
      setSessionId: vi.fn() as Mock,
      clearSession: vi.fn() as Mock,
    };

    config = {
      targetUrl: "https://example.com/api",
      timeout: 5000,
      authClient: mockAuthClient,
      httpClient: mockHttpClient,
      sessionManager: mockSessionManager,
    };

    proxy = createMcpProxy(config);
  });

  it("セッションIDがある場合はヘッダーに含める", async () => {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "initialize",
      params: {},
    };

    const sessionId = "session-123";
    (mockSessionManager.getSessionId as Mock).mockReturnValue(sessionId);
    (mockAuthClient.getIdToken as Mock).mockResolvedValue({
      type: "success",
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000),
    });

    (mockHttpClient.post as Mock).mockResolvedValue({
      type: "success",
      data: { jsonrpc: "2.0", id: 1, result: {} },
      status: 200,
      headers: {},
    });

    await proxy.handleRequest(request);

    expect(mockHttpClient.post).toHaveBeenCalledWith({
      url: "https://example.com/api",
      headers: {
        Authorization: "Bearer mock-token",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: request,
      timeout: 5000,
    });
  });

  it("initializeレスポンスからセッションIDを保存する", async () => {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "initialize",
      params: {},
    };

    const responseSessionId = "new-session-456";
    (mockSessionManager.getSessionId as Mock).mockReturnValue(null);
    (mockAuthClient.getIdToken as Mock).mockResolvedValue({
      type: "success",
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000),
    });

    (mockHttpClient.post as Mock).mockResolvedValue({
      type: "success",
      data: { jsonrpc: "2.0", id: 1, result: {} },
      status: 200,
      headers: { "Mcp-Session-Id": responseSessionId },
    });

    await proxy.handleRequest(request);

    expect(mockSessionManager.setSessionId).toHaveBeenCalledWith(
      responseSessionId,
    );
  });

  it("initialize以外のリクエストではセッションIDを保存しない", async () => {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/list",
      params: {},
    };

    const responseSessionId = "should-not-be-saved";
    (mockSessionManager.getSessionId as Mock).mockReturnValue(
      "existing-session",
    );
    (mockAuthClient.getIdToken as Mock).mockResolvedValue({
      type: "success",
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000),
    });

    (mockHttpClient.post as Mock).mockResolvedValue({
      type: "success",
      data: { jsonrpc: "2.0", id: 1, result: {} },
      status: 200,
      headers: { "Mcp-Session-Id": responseSessionId },
    });

    await proxy.handleRequest(request);

    expect(mockSessionManager.setSessionId).not.toHaveBeenCalled();
  });

  it("HTTP 404でセッションをクリアする", async () => {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/list",
      params: {},
    };

    (mockSessionManager.getSessionId as Mock).mockReturnValue("session-123");
    (mockAuthClient.getIdToken as Mock).mockResolvedValue({
      type: "success",
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000),
    });

    (mockHttpClient.post as Mock).mockResolvedValue({
      type: "error",
      error: {
        kind: "http-error",
        status: 404,
        message: "Not Found",
      },
    });

    await proxy.handleRequest(request);

    expect(mockSessionManager.clearSession).toHaveBeenCalled();
  });
});
