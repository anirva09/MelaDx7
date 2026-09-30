import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Preference = "light" | "dark" | "system";

interface ThemeContextValue {
  preference: Preference;
  resolved: "light" | "dark";
  setPreference: (value: Preference) => void;
}

const STORAGE_KEY = "lesionlens-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): Preference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    // Dark is the default: the product's reference design is a dark interface.
    return value === "light" || value === "system" ? value : "dark";
  } catch {
    return "dark";
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<Preference>(readPreference);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#141414" : "#f2f2f2");
  }, [resolved]);

  const setPreference = useCallback((value: Preference) => {
    setPreferenceState(value);
    try {
      if (value === "dark") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage may be unavailable (private mode); the choice still applies for this session.
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
