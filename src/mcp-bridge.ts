import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_BRIDGE_URL = process.env.DESIGN_QA_MCP_BRIDGE_URL ?? "ws://localhost:1994/ws";
const DEFAULT_BRIDGE_RETRIES = 3;
const DEFAULT_BRIDGE_RETRY_DELAY_MS = 400;

interface BridgeRequest {
  type: string;
  requestId: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
}

interface BridgeResponse<T = unknown> {
  type: string;
  requestId: string;
  data?: T;
  error?: string;
}

interface ScreenshotResponse {
  exports: Array<{
    nodeId: string;
    nodeName: string;
    format: string;
    base64: string;
    width: number;
    height: number;
  }>;
}

interface MetadataResponse {
  fileName: string;
  currentPageId: string;
  currentPageName: string;
  pageCount: number;
  pages: Array<{ id: string; name: string }>;
}

interface DesignContextNode {
  id: string;
  name: string;
  type: string;
  children?: DesignContextNode[];
  childCount?: number;
  [key: string]: unknown;
}

interface DesignContextResponse {
  fileName: string;
  currentPage: { id: string; name: string };
  selectionCount: number;
  context: DesignContextNode[];
}

export async function probeMcpBridge(url = DEFAULT_BRIDGE_URL, timeoutMs = 2_000) {
  try {
    await connectBridge(url, timeoutMs);
    return { ok: true as const, detail: url };
  } catch (error) {
    return {
      ok: false as const,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchMcpScreenshotToCache({
  nodeId,
  cacheDir,
  scale = 2,
  url = DEFAULT_BRIDGE_URL,
  timeoutMs = 8_000,
}: {
  nodeId: string;
  cacheDir: string;
  scale?: number;
  url?: string;
  timeoutMs?: number;
}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const sanitizedNodeId = nodeId.replaceAll(":", "-");
  const destPath = path.join(cacheDir, `${sanitizedNodeId}.png`);

  const response = await bridgeRequest<ScreenshotResponse>(
    {
      type: "get_screenshot",
      requestId: `design-qa-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      nodeIds: [nodeId],
      params: { format: "PNG", scale },
    },
    { url, timeoutMs },
  );

  const screenshot = response.exports.find((item) => item.nodeId === nodeId) ?? response.exports[0];
  if (!screenshot?.base64) {
    throw new Error(`MCP bridge returned no screenshot for node ${nodeId}`);
  }

  fs.writeFileSync(destPath, Buffer.from(screenshot.base64, "base64"));
  return destPath;
}

export async function fetchMcpMetadata({
  url = DEFAULT_BRIDGE_URL,
  timeoutMs = 5_000,
}: {
  url?: string;
  timeoutMs?: number;
}) {
  return bridgeRequest<MetadataResponse>(
    {
      type: "get_metadata",
      requestId: `design-qa-meta-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    },
    { url, timeoutMs },
  );
}

export async function fetchMcpDesignContext({
  depth = 12,
  url = DEFAULT_BRIDGE_URL,
  timeoutMs = 8_000,
}: {
  depth?: number;
  url?: string;
  timeoutMs?: number;
}) {
  return bridgeRequest<DesignContextResponse>(
    {
      type: "get_design_context",
      requestId: `design-qa-context-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      params: { depth },
    },
    { url, timeoutMs },
  );
}

async function bridgeRequest<T>(
  request: BridgeRequest,
  options: { url: string; timeoutMs: number },
) {
  return withBridgeRetries(() => {
    if (typeof WebSocket !== "undefined") {
      return requestViaNativeWebSocket<T>(request, options);
    }
    return requestViaBun<T>(request, options);
  });
}

async function connectBridge(url: string, timeoutMs: number) {
  return withBridgeRetries(() => {
    if (typeof WebSocket !== "undefined") {
      return connectViaNativeWebSocket(url, timeoutMs);
    }
    return connectViaBun(url, timeoutMs);
  });
}

function connectViaNativeWebSocket(url: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      reject(new Error(`MCP bridge timeout: ${url}`));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {}
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to MCP bridge: ${url}`));
    });
  });
}

function requestViaNativeWebSocket<T>(
  request: BridgeRequest,
  options: { url: string; timeoutMs: number },
) {
  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(options.url);
    const timeout = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      reject(new Error(`MCP bridge timeout: ${options.url}`));
    }, options.timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(request));
    });

    socket.addEventListener("message", (event: MessageEvent<string>) => {
      clearTimeout(timeout);
      try {
        const payload = JSON.parse(event.data) as BridgeResponse<T>;
        if (payload.error) {
          reject(new Error(payload.error));
          return;
        }
        resolve(payload.data as T);
      } catch (error) {
        reject(error);
      } finally {
        try {
          socket.close();
        } catch {}
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to MCP bridge: ${options.url}`));
    });
  });
}

function connectViaBun(url: string, timeoutMs: number) {
  const result = spawnBunBridge({ url, timeoutMs });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Failed to connect to MCP bridge: ${url}`);
  }
}

function requestViaBun<T>(request: BridgeRequest, options: { url: string; timeoutMs: number }) {
  const result = spawnBunBridge({
    url: options.url,
    timeoutMs: options.timeoutMs,
    request,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Failed to connect to MCP bridge: ${options.url}`);
  }
  const payload = JSON.parse(result.stdout) as BridgeResponse<T>;
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.data as T;
}

function spawnBunBridge({
  url,
  timeoutMs,
  request,
}: {
  url: string;
  timeoutMs: number;
  request?: BridgeRequest;
}) {
  const bunCheck = spawnSync("bun", ["--version"], { encoding: "utf-8" });
  if (bunCheck.status !== 0) {
    throw new Error("WebSocket runtime is unavailable");
  }

  const bunScript = `
const request = process.env.DESIGN_QA_BRIDGE_REQUEST ? JSON.parse(process.env.DESIGN_QA_BRIDGE_REQUEST) : null;
const url = process.env.DESIGN_QA_BRIDGE_URL;
const timeoutMs = Number(process.env.DESIGN_QA_BRIDGE_TIMEOUT_MS);
const socket = new WebSocket(url);
const timeout = setTimeout(() => {
  console.error("MCP bridge timeout: " + url);
  process.exit(1);
}, timeoutMs);
socket.addEventListener("open", () => {
  if (!request) {
    clearTimeout(timeout);
    console.log(JSON.stringify({ ok: true }));
    socket.close();
    process.exit(0);
  }
  socket.send(JSON.stringify(request));
});
socket.addEventListener("message", (event) => {
  clearTimeout(timeout);
  console.log(event.data);
  socket.close();
  process.exit(0);
});
socket.addEventListener("error", () => {
  clearTimeout(timeout);
  console.error("Failed to connect to MCP bridge: " + url);
  process.exit(1);
});
`;

  return spawnSync("bun", ["-e", bunScript], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      DESIGN_QA_BRIDGE_REQUEST: request ? JSON.stringify(request) : "",
      DESIGN_QA_BRIDGE_URL: url,
      DESIGN_QA_BRIDGE_TIMEOUT_MS: String(timeoutMs),
    },
  });
}

async function withBridgeRetries<T>(operation: () => Promise<T> | T) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= DEFAULT_BRIDGE_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableBridgeError(message) || attempt === DEFAULT_BRIDGE_RETRIES) {
        throw error;
      }
      await sleep(DEFAULT_BRIDGE_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableBridgeError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to connect") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("socket")
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
