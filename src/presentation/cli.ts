#!/usr/bin/env node
import { cli, define } from "gunshi";
import packageInfo from "../../package.json" with { type: "json" };
import { logger } from "../libs/logging/logger.js";
import { startProxy } from "../usecase/start-proxy.js";

const proxyCommand = define({
  name: "mcp-gcloud-adc-proxy",
  description: "Google Cloud Run MCP Server Proxy with ADC authentication",
  args: {
    url: {
      type: "string",
      short: "u",
      required: true,
      description: "Cloud Run service URL (HTTP or HTTPS)",
    },
    timeout: {
      type: "number",
      short: "t",
      default: 120000,
      description: "HTTP request timeout in milliseconds",
    },
    "impersonate-service-account": {
      type: "string",
      description: "Service account email for impersonation (optional)",
    },
    audiences: {
      type: "string",
      description: "ID token audience (optional, defaults to target URL)",
    },
    "include-email": {
      type: "boolean",
      description: "Include email in ID token (default: true)",
    },
  },
  examples: `# Basic usage (HTTPS)
$ mcp-gcloud-adc-proxy --url https://my-service-abc123-uc.a.run.app

# Local development (HTTP)
$ mcp-gcloud-adc-proxy --url http://localhost:3000

# With custom timeout
$ mcp-gcloud-adc-proxy -u https://my-service-abc123-uc.a.run.app -t 60000

# With service account impersonation
$ mcp-gcloud-adc-proxy -u https://my-service-abc123-uc.a.run.app --impersonate-service-account sa@project.iam.gserviceaccount.com

# With custom audience
$ mcp-gcloud-adc-proxy -u https://my-service-abc123-uc.a.run.app --audiences https://example.com`,
  run: async (ctx) => {
    const {
      url,
      timeout,
      "impersonate-service-account": impersonateServiceAccount,
      audiences,
      "include-email": includeEmail,
    } = ctx.values;
    await executeProxyCommand({
      url,
      timeout,
      ...(typeof impersonateServiceAccount === "string" && {
        impersonateServiceAccount,
      }),
      ...(typeof audiences === "string" && { audiences }),
      ...(typeof includeEmail === "boolean" && { includeEmail }),
    });
  },
});

export type CliOptions = {
  url: string;
  timeout: number;
  impersonateServiceAccount?: string;
  audiences?: string;
  includeEmail?: boolean;
};

export function validateCliOptions(options: CliOptions): void {
  const { url, timeout } = options;

  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new Error("URL must be HTTP or HTTPS");
  }

  try {
    new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (timeout <= 0) {
    throw new Error("Timeout must be positive");
  }
}

export async function executeProxyCommand(options: CliOptions): Promise<void> {
  logger.info(
    {
      url: options.url,
      timeout: options.timeout,
      impersonateServiceAccount: options.impersonateServiceAccount,
      audiences: options.audiences,
      includeEmail: options.includeEmail,
    },
    "Executing proxy command",
  );

  validateCliOptions(options);

  const result = await startProxy({
    url: options.url,
    timeout: options.timeout,
    ...(options.impersonateServiceAccount && {
      impersonateServiceAccount: options.impersonateServiceAccount,
    }),
    ...(options.audiences && { audiences: options.audiences }),
    ...(options.includeEmail !== undefined && {
      includeEmail: options.includeEmail,
    }),
  });

  if (result.type === "error") {
    logger.error({ error: result.error }, "Failed to start proxy from CLI");
    process.stderr.write(`Failed to start proxy: ${result.error.message}\n`);
    process.exit(1);
  }
}

export async function runCli(): Promise<void> {
  await cli(process.argv.slice(2), proxyCommand, {
    name: "mcp-gcloud-adc-proxy",
    version: packageInfo.version,
    description: "Google Cloud Run MCP Server Proxy with ADC authentication",
    renderHeader: async () => "",
  });
}

// CLI実行をindex.tsに移動（MCP Inspectorとの競合を防ぐため）
