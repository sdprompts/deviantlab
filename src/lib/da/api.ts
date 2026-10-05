import { getSession, sessionFromToken, setSession } from "../auth/session";

type ErrorBody = {
  error?: string;
  error_description?: string;
};

export class DaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaError";
  }
}

const PAUSE_KEY = "da.rateLimitUntil";
const PAUSE_MS = 15 * 60 * 1000;
const GAP_MS = 350;

let refreshing: Promise<void> | null = null;
let tail: Promise<void> = Promise.resolve();

function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function pauseUntil(): number {
  const raw = Number(browserStorage()?.getItem(PAUSE_KEY) || 0);
  return Number.isFinite(raw) ? raw : 0;
}

export function apiPaused(): boolean {
  return Date.now() < pauseUntil();
}

function pauseFor(ms: number) {
  const storage = browserStorage();
  if (!storage) return;
  const until = Date.now() + ms;
  storage.setItem(PAUSE_KEY, String(Math.max(until, pauseUntil())));
}

function limitedMessage(): string {
  const minutes = Math.max(1, Math.ceil((pauseUntil() - Date.now()) / 60000));
  return `DeviantArt paused this account for too many requests. Wait about ${minutes} minutes, then refresh. Refreshing sooner makes the wait longer.`;
}

async function refresh(): Promise<void> {
  const current = getSession();
  if (!current?.refreshToken) throw new DaError("Sign in again.");
  const response = await fetch("/da-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: current.refreshToken }),
  });
  const payload = (await response.json()) as ErrorBody & {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    const message = payload.error_description || payload.error || "Sign in again.";
    if (response.status === 401 || /refresh_token|invalid_grant|no longer valid/i.test(message)) setSession(null);
    throw new DaError(message);
  }
  setSession(sessionFromToken(
    { access_token: payload.access_token, refresh_token: payload.refresh_token, expires_in: payload.expires_in },
    current,
  ));
}

export function restoreSession(): Promise<void> {
  return refresh();
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type PostBody = { form: URLSearchParams } | { file: FormData };

async function request<T>(path: string, attempt: number, post?: PostBody): Promise<T> {
  if (Date.now() < pauseUntil()) throw new DaError(limitedMessage());
  const session = getSession();
  if (!session) throw new DaError("Sign in to DeviantArt.");
  if (attempt === 0 && session.expiresAt < Date.now() + 30_000) {
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    await refreshing;
  }
  const token = getSession()?.accessToken;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (post && "form" in post) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = post.form;
  } else if (post && "file" in post) {
    body = post.file;
  }
  let response: Response;
  try {
    response = await fetch(`/da-api${path}`, {
      method: post ? "POST" : "GET",
      headers,
      body,
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
  }
  const payload = (await response.json()) as T & ErrorBody;
  if (response.status === 401 && attempt === 0) {
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    await refreshing;
    return request<T>(path, 1, post);
  }
  if (!response.ok || payload.error) {
    const message = payload.error_description || payload.error || `DeviantArt returned ${response.status}.`;
    if (response.status === 429 || /request limit/i.test(message)) {
      pauseFor(PAUSE_MS);
      throw new DaError(limitedMessage());
    }
    throw new DaError(message);
  }
  return payload;
}

export function apiGet<T>(path: string): Promise<T> {
  return enqueue(() => request<T>(path, 0));
}

export function apiPost<T>(path: string, post: PostBody): Promise<T> {
  return enqueue(() => request<T>(path, 0, post));
}

export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const response = await fetch("/da-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  const payload = (await response.json()) as ErrorBody & {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new DaError(payload.error_description || payload.error || "Login failed.");
  }
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: payload.expires_in,
  };
}

export async function loadWhoami(): Promise<{ username: string; usericon: string }> {
  const payload = await apiGet<{ username?: string; usericon?: string }>("/user/whoami");
  return { username: payload.username || "deviant", usericon: payload.usericon || "" };
}
