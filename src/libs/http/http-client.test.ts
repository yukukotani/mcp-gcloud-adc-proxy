import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./http-client.js";
import type { HttpRequestConfig } from "./types.js";

// fetchのモック
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("HttpClient", () => {
  let httpClient: ReturnType<typeof createHttpClient>;
  let mockAbortController: {
    abort: ReturnType<typeof vi.fn>;
    signal: { aborted: boolean };
  };

  beforeEach(() => {
    httpClient = createHttpClient();
    vi.clearAllMocks();

    mockAbortController = {
      abort: vi.fn(),
      signal: { aborted: false },
    };
    global.AbortController = vi
      .fn()
      .mockImplementation(() => mockAbortController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("post", () => {
    it("成功したPOSTリクエストを処理する", async () => {
      const mockResponseData = { message: "success" };
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "application/json"]]),
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponseData)),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: { Authorization: "Bearer token" },
        body: { test: "data" },
        timeout: 5000,
      };

      const result = await httpClient.post(config);

      expect(mockFetch).toHaveBeenCalledWith("https://example.com/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: '{"test":"data"}',
        signal: mockAbortController.signal,
        redirect: "manual",
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.data).toEqual(mockResponseData);
        expect(result.status).toBe(200);
      }
    });

    it("HTTPエラーレスポンスを処理する", async () => {
      const errorBody = "Not Found";
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Map(),
        text: vi.fn().mockResolvedValue(errorBody),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 5000,
      };

      const result = await httpClient.post(config);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.kind).toBe("http-error");
        if (result.error.kind === "http-error") {
          expect(result.error.status).toBe(404);
          expect(result.error.message).toContain("404");
          expect(result.error.body).toBe(errorBody);
        }
      }
    });

    it("タイムアウトエラーを処理する", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 1000,
      };

      const result = await httpClient.post(config);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.kind).toBe("timeout");
        expect(result.error.message).toContain("1000ms");
      }
    });

    it("ネットワークエラーを処理する", async () => {
      const networkError = new Error("Network connection failed");
      mockFetch.mockRejectedValue(networkError);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 5000,
      };

      const result = await httpClient.post(config);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.kind).toBe("network-error");
        expect(result.error.message).toBe("Network connection failed");
        if (result.error.kind === "network-error") {
          expect(result.error.originalError).toBe(networkError);
        }
      }
    });

    it("JSON解析エラーを処理する", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map(),
        text: vi.fn().mockResolvedValue("invalid json"),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 5000,
      };

      const result = await httpClient.post(config);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.kind).toBe("parse-error");
        expect(result.error.message).toContain(
          "Failed to parse response as JSON",
        );
      }
    });

    it("空のレスポンスを処理する", async () => {
      const mockResponse = {
        ok: true,
        status: 204,
        statusText: "No Content",
        headers: new Map(),
        text: vi.fn().mockResolvedValue(""),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 5000,
      };

      const result = await httpClient.post(config);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.kind).toBe("parse-error");
      }
    });
  });

  describe("postStream", () => {
    it("ストリーミングレスポンスを処理する", async () => {
      const chunks = ['{"data": 1}\n', '{"data": 2}\n', '{"data": 3}'];
      let chunkIndex = 0;

      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const chunk = chunks[chunkIndex++];
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode(chunk),
            });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
        releaseLock: vi.fn(),
      };

      const mockResponse = {
        ok: true,
        status: 200,
        body: {
          getReader: () => mockReader,
        },
      };

      mockFetch.mockResolvedValue(mockResponse);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 5000,
      };

      const results: string[] = [];
      const isLastFlags: boolean[] = [];

      for await (const chunk of httpClient.postStream(config)) {
        if (chunk.type === "data") {
          results.push(chunk.data);
          isLastFlags.push(chunk.isLast);
        }
      }

      expect(results).toEqual(['{"data": 1}', '{"data": 2}', '{"data": 3}']);
      expect(isLastFlags).toEqual([false, false, true]);
      expect(mockReader.releaseLock).toHaveBeenCalled();
    });

    it("ストリームエラーを処理する", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: vi.fn().mockResolvedValue("Server error"),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 5000,
      };

      const chunks: { type: string; error?: unknown }[] = [];

      for await (const chunk of httpClient.postStream(config)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "error",
        error: {
          kind: "http-error",
          message: expect.stringContaining("HTTP 500"),
          status: 500,
        },
      });
    });

    it("ストリームタイムアウトを処理する", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      const config: HttpRequestConfig = {
        url: "https://example.com/api",
        headers: {},
        body: {},
        timeout: 1000,
      };

      const chunks: { type: string; error?: unknown }[] = [];

      for await (const chunk of httpClient.postStream(config)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "error",
        error: {
          kind: "timeout",
          message: "Request timed out after 1000ms",
        },
      });
    });
  });
});

describe("リダイレクト", () => {
  let httpClient: ReturnType<typeof createHttpClient>;

  beforeEach(() => {
    httpClient = createHttpClient();
    vi.clearAllMocks();
    global.AbortController = vi.fn().mockImplementation(() => ({
      abort: vi.fn(),
      signal: { aborted: false },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const config: HttpRequestConfig = {
    url: "https://example.com/api",
    headers: { "x-impersonator-id-token": "dummy-token" },
    body: {},
    timeout: 5000,
  };

  const redirectResponse = {
    ok: false,
    status: 302,
    statusText: "Found",
    headers: new Map([["location", "https://example.com/login"]]),
    text: vi.fn().mockResolvedValue(""),
  };

  it("postはリダイレクトを追わない", async () => {
    mockFetch.mockResolvedValue(redirectResponse);

    const result = await httpClient.post(config);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(result).toMatchObject({
      type: "error",
      error: { kind: "http-error", status: 302 },
    });
  });

  it("postはリダイレクト先を理由に添える", async () => {
    mockFetch.mockResolvedValue(redirectResponse);

    const result = await httpClient.post(config);

    expect(result.type).toBe("error");
    if (result.type !== "error" || result.error.kind !== "http-error") {
      throw new Error("unexpected result");
    }
    expect(result.error.message).toContain("Redirect");
    expect(result.error.message).toContain("https://example.com/login");
  });

  it("postStreamはリダイレクトを追わない", async () => {
    mockFetch.mockResolvedValue(redirectResponse);

    const chunks = [];
    for await (const chunk of httpClient.postStream(config)) {
      chunks.push(chunk);
    }

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(chunks[0]).toMatchObject({
      type: "error",
      error: { kind: "http-error", status: 302 },
    });
  });
});

describe("createHttpClient", () => {
  it("HttpClientのインスタンスを作成する", () => {
    const client = createHttpClient();
    expect(client).toBeTruthy();
    expect(typeof client.post).toBe("function");
    expect(typeof client.postStream).toBe("function");
  });
});
