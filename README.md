# mcp-gcloud-adc-proxy

[日本語](./README_ja.md)

An auth proxy for accessing remote MCP servers using Google Cloud Application Default Credentials (ADC)

## Overview

This tool runs as a stdio MCP server and forwards all requests to a remote MCP server, automatically attaching an `Authorization` header with a Google Cloud Application Default Credentials (ADC) token.

It allows you to connect to remote MCP servers hosted on IAM-protected services such as Cloud Run.

## Usage

### Prerequisites

You need to configure Google Cloud authentication. Choose one of the following methods:

```bash
# Method 1: User authentication using gcloud CLI
gcloud auth application-default login

# Method 2: Using service account key
export GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account.json"
```

See the [Google Cloud documentation](https://cloud.google.com/docs/authentication/provide-credentials-adc) for more details.

### Basic Usage

```bash
# Start MCP proxy
npx mcp-gcloud-adc-proxy --url https://your-cloud-run-service.run.app

# With service account impersonation
npx mcp-gcloud-adc-proxy --url https://your-cloud-run-service.run.app --impersonate-service-account sa@project.iam.gserviceaccount.com

# With custom audience
npx mcp-gcloud-adc-proxy --url https://your-cloud-run-service.run.app --audiences https://example.com
```

### Service Account Impersonation

You can use service account impersonation to generate ID tokens for a specific service account instead of using the default ADC credentials:

```bash
npx mcp-gcloud-adc-proxy \
  --url https://your-cloud-run-service.run.app \
  --impersonate-service-account your-sa@your-project.iam.gserviceaccount.com
```

**Requirements:**
- The ADC principal must have the `roles/iam.serviceAccountTokenCreator` role on the target service account
- The target service account must have the necessary permissions to access the remote MCP server

#### Forwarding the original user's identity

When impersonation is enabled **and** `--forward-impersonator-token` is passed,
the proxy also attaches an `X-Impersonator-Id-Token` header containing an ID token
of the **original ADC user** (the human who ran the proxy), in addition to the
impersonated service account token in `Authorization`.

```bash
npx mcp-gcloud-adc-proxy \
  --url https://your-cloud-run-service.run.app \
  --impersonate-service-account your-sa@your-project.iam.gserviceaccount.com \
  --forward-impersonator-token
```

This lets a remote MCP server that authenticates via the service account still
learn who the real caller is (e.g. to scope per-user permissions). It is **off by
default**; without the flag, only the service account token is sent. The header is
attached only when the ADC is a user credential (`gcloud auth application-default
login`); it is omitted for service-account keys and other non-user credentials.
If the original user's token cannot be obtained, the request still proceeds
without the header.

### Custom Audience

By default, the target URL is used as the audience for the ID token. You can override this with the `--audiences` option:

```bash
npx mcp-gcloud-adc-proxy \
  --url https://your-cloud-run-service.run.app \
  --audiences https://custom-audience.example.com
```

### Setup to Claude Code

```bash
# Add to user scope (available across all projects)
claude mcp add foobar -s user -- npx -y mcp-gcloud-adc-proxy -u https://foobar.run.app

# Or add to project scope to share with your team
claude mcp add foobar -s project -- npx -y mcp-gcloud-adc-proxy -u https://foobar.run.app

# With service account impersonation
claude mcp add foobar -s user -- npx -y mcp-gcloud-adc-proxy -u https://foobar.run.app --impersonate-service-account sa@project.iam.gserviceaccount.com
```

## License

Apache 2.0 License
