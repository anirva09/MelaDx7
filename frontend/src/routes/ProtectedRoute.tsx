import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { useAuth } from "@/context/AuthContext";

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper" role="status">
      <Logo />
      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-accent" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Renders child routes only for signed-in users; otherwise redirects to sign-in. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}

/**
 * Keeps signed-in users away from the sign-in and registration pages. After signing in,
 * users return to the protected page they originally requested.
 */
export function GuestRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "authenticated") {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from?.startsWith("/app") ? from : "/app"} replace />;
  }
  return <Outlet />;
}
