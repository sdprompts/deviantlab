import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { REDIRECT_URI, takeVerifier } from "../lib/auth/pkce";
import { getSession, sessionFromToken, setSession } from "../lib/auth/session";
import { exchangeCode, loadWhoami } from "../lib/da/api";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Signing in…");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const described = params.get("error_description") || params.get("error");
    if (described) {
      setMessage(described);
      return;
    }
    const code = params.get("code");
    const verifier = takeVerifier(params.get("state"));
    if (!code || !verifier) {
      setMessage("Login could not be confirmed. Start it again from DeviantLab.");
      return;
    }
    exchangeCode(code, verifier, REDIRECT_URI)
      .then(async (token) => {
        setSession(sessionFromToken(token));
        const profile = await loadWhoami();
        const current = getSession();
        if (current) setSession({ ...current, username: profile.username, usericon: profile.usericon });
        navigate("/", { replace: true });
      })
      .catch((err: unknown) => {
        setMessage(err instanceof Error ? err.message : "Login failed.");
      });
  }, [navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-lab px-6 text-center text-sm text-zinc-300">
      <p className="max-w-md">{message}</p>
    </div>
  );
}
