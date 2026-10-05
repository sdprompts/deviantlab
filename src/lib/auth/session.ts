const KEY = "da.session";

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username: string;
  usericon: string;
};

let memory: Session | null = read();
const listeners = new Set<(session: Session | null) => void>();

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return memory;
}

export function setSession(session: Session | null): void {
  memory = session;
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
  listeners.forEach((listener) => listener(session));
}

export function subscribeSession(listener: (session: Session | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    memory = read();
    listeners.forEach((listener) => listener(memory));
  });
}

export function sessionFromToken(payload: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}, previous?: Session | null, profile?: { username: string; usericon: string }): Session {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previous?.refreshToken || "",
    expiresAt: Date.now() + payload.expires_in * 1000,
    username: profile?.username || previous?.username || "",
    usericon: profile?.usericon || previous?.usericon || "",
  };
}
