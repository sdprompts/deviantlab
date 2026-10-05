import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { beginLogin } from "./lib/auth/pkce";
import { getSession, setSession, subscribeSession, type Session } from "./lib/auth/session";
import { readSettings, readWatermark } from "./lib/settings";
import { syncStudioConfig, syncStudioSession, syncStudioWatermark } from "./lib/studio/queueClient";

type LabContextValue = {
  session: Session | null;
  signIn: () => void;
  signOut: () => void;
};

const LabContext = createContext<LabContextValue | null>(null);

export function LabProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => getSession());

  useEffect(() => subscribeSession(setSessionState), []);

  useEffect(() => {
    syncStudioSession(session);
    syncStudioConfig(readSettings());
    syncStudioWatermark(readWatermark());
  }, [session]);

  const signOut = useCallback(() => {
    setSession(null);
  }, []);

  const value = useMemo<LabContextValue>(
    () => ({
      session,
      signIn: () => void beginLogin(),
      signOut,
    }),
    [session, signOut],
  );

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab(): LabContextValue {
  const value = useContext(LabContext);
  if (!value) throw new Error("useLab must be used inside LabProvider");
  return value;
}
