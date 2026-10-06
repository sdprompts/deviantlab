import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { DA_CLIENT_ID, DA_REDIRECT_URI } from "./app";
import { DA_CLIENT_SECRET } from "./appSecret";
import { handleQueue, refreshStoredSession, startQueue } from "../studio/queueServer";
import { listComfyClips, runVision, type VisionRequest } from "../studio/visionServer";

const USER_AGENT = "DeviantLab/0.1 (dev)";

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return readRaw(req).then((body) => body.toString("utf8"));
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function daProxy(env: Record<string, string>): Plugin {
  return {
    name: "da-proxy",
    configureServer(server) {
      startQueue(env);
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        try {
          if (url.startsWith("/da-queue")) {
            await handleQueue(req, res);
            return;
          }
          if (url.startsWith("/da-token")) {
            await proxyToken(req, res, env);
            return;
          }
          if (url.startsWith("/da-vision")) {
            await proxyVision(req, res);
            return;
          }
          if (url.startsWith("/da-api/")) {
            await proxyApi(req, res);
            return;
          }
        } catch (error) {
          sendJson(res, 502, {
            error: "proxy_error",
            error_description: error instanceof Error ? error.message : "Proxy failed.",
          });
          return;
        }
        next();
      });
    },
  };
}

async function proxyToken(req: IncomingMessage, res: ServerResponse, env: Record<string, string>) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method" });
    return;
  }
  const secret = env.DA_CLIENT_SECRET || DA_CLIENT_SECRET;
  const clientId = env.VITE_DA_CLIENT_ID || DA_CLIENT_ID;
  if (!secret || !clientId) {
    sendJson(res, 500, { error: "missing_server_env", error_description: "DeviantArt app credentials are missing from .env." });
    return;
  }
  const incoming = JSON.parse(await readBody(req)) as Record<string, string>;
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    grant_type: incoming.grant_type || "",
    redirect_uri: incoming.redirect_uri || env.VITE_DA_REDIRECT_URI || DA_REDIRECT_URI,
  });
  if (incoming.grant_type === "refresh_token") {
    try {
      const session = await refreshStoredSession(incoming.refresh_token);
      sendJson(res, 200, {
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_in: Math.max(1, Math.round((session.expiresAt - Date.now()) / 1000)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign out and sign in again. This login is no longer valid.";
      sendJson(res, 401, { error: "invalid_grant", error_description: message });
    }
    return;
  }
  if (incoming.code) form.set("code", incoming.code);
  if (incoming.code_verifier) form.set("code_verifier", incoming.code_verifier);

  const response = await fetch("https://www.deviantart.com/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    body: form,
  });
  const text = await response.text();
  res.statusCode = response.status;
  res.setHeader("content-type", "application/json");
  res.end(text);
}

async function proxyVision(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url || "").split("?")[0];
  if (req.method === "GET" && path === "/da-vision/clips") {
    const base = new URL(req.url || "", "http://localhost").searchParams.get("base") || "";
    try {
      sendJson(res, 200, { clips: await listComfyClips(base) });
    } catch (error) {
      sendJson(res, 502, {
        error: "comfy",
        error_description: error instanceof Error ? error.message : "ComfyUI is not running.",
      });
    }
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method" });
    return;
  }
  const raw = await readBody(req);
  if (raw.length > 8_000_000) {
    sendJson(res, 413, { error: "too_large", error_description: "That image is too large to title." });
    return;
  }
  try {
    const result = await runVision(JSON.parse(raw) as VisionRequest);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 502, {
      error: "vision_failed",
      error_description: error instanceof Error ? error.message : "Could not generate a title.",
    });
  }
}

async function proxyApi(req: IncomingMessage, res: ServerResponse) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    sendJson(res, 405, { error: "method" });
    return;
  }
  const incoming = new URL(req.url || "/", "http://127.0.0.1");
  const path = incoming.pathname.replace(/^\/da-api/, "");
  const target = new URL(`https://www.deviantart.com/api/v1/oauth2${path}`);
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/json",
    "dA-minor-version": "20240701",
  };
  const authorization = req.headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    headers.authorization = authorization;
  }
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method === "POST") {
    const raw = await readRaw(req);
    const copy = new ArrayBuffer(raw.byteLength);
    new Uint8Array(copy).set(raw);
    body = new Uint8Array(copy);
    const type = req.headers["content-type"];
    if (typeof type === "string") headers["content-type"] = type;
  }
  const response = await fetch(target, {
    method,
    headers,
    body,
  });
  if (response.status >= 400) console.warn(`[da-api] ${response.status} ${path}`);
  const text = await response.text();
  res.statusCode = response.status;
  res.setHeader("content-type", response.headers.get("content-type") || "application/json");
  res.end(text);
}

