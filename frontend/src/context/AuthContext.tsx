import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { refreshAccessToken, setSessionExpiredHandler, tokenStore } from "@/api/client";
import { authApi } from "@/api/endpoints";
import type { TokenResponse, User } from "@/api/types";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: Status;
  user: User | null;
  /** True when the last session ended because it expired (not a manual sign-out). */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (fullName: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Permanently delete the account (re-authenticated with the password), then end the session. */
  deleteAccount: (password: string) => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const refreshTimer = useRef<number | undefined>(undefined);

  const scheduleRefresh = useCallback((expiresIn: number) => {
    window.clearInterval(refreshTimer.current);
    // Refresh proactively at 80% of the access-token lifetime; stop if the session is gone.
    refreshTimer.current = window.setInterval(
      () => {
        void refreshAccessToken().then((token) => {
          if (!token) window.clearInterval(refreshTimer.current);
        });
      },
      Math.max(30, expiresIn * 0.8) * 1000,
    );
  }, []);

  const acceptSession = useCallback(
    (response: TokenResponse) => {
      tokenStore.set(response.access_token);
      setUser(response.user);
      setStatus("authenticated");
      setSessionExpired(false);
      scheduleRefresh(response.expires_in);
      return response.user;
    },
    [scheduleRefresh],
  );

  const endSession = useCallback(
    (expired: boolean) => {
      window.clearInterval(refreshTimer.current);
      tokenStore.set(null);
      setUser(null);
      setStatus("anonymous");
      setSessionExpired(expired);
      queryClient.clear();
    },
    [queryClient],
  );

  // Restore a session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await refreshAccessToken();
      if (cancelled) return;
      if (!token) {
        setStatus("anonymous");
        return;
      }
      try {
        const me = await authApi.me();
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
        scheduleRefresh(15 * 60);
      } catch {
        if (!cancelled) setStatus("anonymous");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    setSessionExpiredHandler(() => endSession(true));
    return () => setSessionExpiredHandler(null);
  }, [endSession]);

  useEffect(() => () => window.clearInterval(refreshTimer.current), []);

  const login = useCallback(
    async (email: string, password: string) => acceptSession(await authApi.login(email, password)),
    [acceptSession],
  );

  const register = useCallback(
    async (fullName: string, email: string, password: string) =>
      acceptSession(await authApi.register(fullName, email, password)),
    [acceptSession],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      endSession(false);
    }
  }, [endSession]);

  const deleteAccount = useCallback(async (password: string) => {
    await authApi.deleteAccount(password);
    window.clearInterval(refreshTimer.current);
    tokenStore.set(null);
    // A full page load discards every cached query that held the deleted account's data.
    window.location.replace("/?account=deleted");
  }, []);

  const value = useMemo(
    () => ({ status, user, sessionExpired, login, register, logout, deleteAccount, setUser }),
    [status, user, sessionExpired, login, register, logout, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
