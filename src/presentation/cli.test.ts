import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as startProxyModule from "../usecase/start-proxy.js";
import {
  type CliOptions,
  executeProxyCommand,
  validateCliOptions,
} from "./cli.js";

// モック関数
const mockStartProxy = vi.fn();

describe("CLI", () => {
  let mockStderr: ReturnType<typeof vi.spyOn>;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockStderr = vi
      .spyOn(process.stderr, "write")
      // biome-ignore lint/suspicious/noExplicitAny: Mock型の制約により必要
      .mockImplementation(() => true) as any;
    mockExit = vi
      .spyOn(process, "exit")
      // biome-ignore lint/suspicious/noExplicitAny: Mock型の制約により必要
      .mockImplementation(() => undefined as never) as any;
    vi.spyOn(startProxyModule, "startProxy").mockImplementation(mockStartProxy);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("バリデーション", () => {
    it("有効なオプションを受け入れる", () => {
      expect(() =>
        validateCliOptions({
          url: "https://example.com",
          timeout: 60000,
        }),
      ).not.toThrow();
    });

    it("HTTPとHTTPSの両方を受け入れる", () => {
      expect(() =>
        validateCliOptions({
          url: "http://example.com",
          timeout: 60000,
        }),
      ).not.toThrow();

      expect(() =>
        validateCliOptions({
          url: "https://example.com",
          timeout: 60000,
        }),
      ).not.toThrow();
    });

    it("無効なURL形式を拒否する", () => {
      expect(() =>
        validateCliOptions({
          url: "https://[invalid-url",
          timeout: 60000,
        }),
      ).toThrow("Invalid URL format");
    });

    it("負のタイムアウトを拒否する", () => {
      expect(() =>
        validateCliOptions({
          url: "https://example.com",
          timeout: -1,
        }),
      ).toThrow("Timeout must be positive");
    });

    it("大きなタイムアウトを許可する", () => {
      expect(() =>
        validateCliOptions({
          url: "https://example.com",
          timeout: 1800000,
        }),
      ).not.toThrow();
    });
  });

  describe("executeProxyCommand", () => {
    it("有効なオプションでstartProxyを呼び出す", async () => {
      const options: CliOptions = {
        url: "https://example.com",
        timeout: 60000,
      };
      mockStartProxy.mockResolvedValue({ type: "success" });

      await executeProxyCommand(options);

      expect(mockStartProxy).toHaveBeenCalledWith(options);
    });

    it("ログ出力を適切に処理する", async () => {
      const options: CliOptions = {
        url: "https://example.com",
        timeout: 120000,
      };
      mockStartProxy.mockResolvedValue({ type: "success" });

      await executeProxyCommand(options);

      // プロキシが正しいオプションで呼び出されることを確認
      expect(mockStartProxy).toHaveBeenCalledWith({
        url: "https://example.com",
        timeout: 120000,
      });
    });

    it("startProxyのエラーを処理する", async () => {
      const options: CliOptions = {
        url: "https://example.com",
        timeout: 120000,
      };
      mockStartProxy.mockResolvedValue({
        type: "error",
        error: { kind: "connection-error", message: "Connection failed" },
      });

      await executeProxyCommand(options);

      expect(mockStderr).toHaveBeenCalledWith(
        "Failed to start proxy: Connection failed\n",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("予期しないエラーを処理する", async () => {
      const options: CliOptions = {
        url: "https://example.com",
        timeout: 120000,
      };
      mockStartProxy.mockResolvedValue({
        type: "error",
        error: { kind: "unknown-error", message: "Unknown error" },
      });

      await executeProxyCommand(options);

      expect(mockStderr).toHaveBeenCalledWith(
        "Failed to start proxy: Unknown error\n",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("無効なプロトコルでバリデーションエラーを投げる", async () => {
      const options: CliOptions = {
        url: "ftp://example.com", // HTTPでもHTTPSでもない
        timeout: 120000,
      };

      await expect(executeProxyCommand(options)).rejects.toThrow(
        "URL must be HTTP or HTTPS",
      );
    });
  });
});
