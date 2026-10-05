import { DA_CLIENT_ID, DA_REDIRECT_URI } from "../da/app";

const CLIENT_ID = import.meta.env.VITE_DA_CLIENT_ID || DA_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_DA_REDIRECT_URI || DA_REDIRECT_URI;
const SCOPE = "browse user stash publish";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomUrlSafe(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return base64url(bytes);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function beginLogin(): Promise<void> {
  const verifier = randomUrlSafe(32);
  const state = randomUrlSafe(16);
  sessionStorage.setItem("da.pkce", verifier);
  sessionStorage.setItem("da.state", state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
  });
  window.location.assign(`https://www.deviantart.com/oauth2/authorize?${params}`);
}

export function takeVerifier(state: string | null): string | null {
  const expected = sessionStorage.getItem("da.state");
  const verifier = sessionStorage.getItem("da.pkce");
  sessionStorage.removeItem("da.state");
  sessionStorage.removeItem("da.pkce");
  if (!state || !expected || state !== expected || !verifier) return null;
  return verifier;
}

export { REDIRECT_URI };
