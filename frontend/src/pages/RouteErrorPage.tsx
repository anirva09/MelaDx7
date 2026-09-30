import { RefreshCw } from "lucide-react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

/**
 * Shown when a page throws while rendering or a code-split chunk fails to load
 * (typically after a new deployment). Details go to the console, not to the user.
 */
export function RouteErrorPage({ inline = false }: { inline?: boolean }) {
  const error = useRouteError();
  const chunkFailed =
    error instanceof TypeError &&
    /dynamically imported module|Importing a module script failed/i.test(error.message);
  if (error) console.error(error);

  const title =
    isRouteErrorResponse(error) && error.status === 404
      ? "This page does not exist"
      : "This page stopped working";
  const message = chunkFailed
    ? "A newer version of LesionLens is available. Reload to continue."
    : "An unexpected error occurred while displaying this page. Your data is safe. Reload the page or go back to the overview.";

  const Wrapper = inline ? "div" : "main";
  return (
    <Wrapper
      role="alert"
      className={
        inline
          ? "flex flex-col items-center gap-6 rounded-lg border border-line bg-surface px-4 py-16 text-center"
          : "flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper px-4 text-center"
      }
    >
      {!inline && <Logo />}
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
      </div>
      <div className="flex gap-3">
        <Button onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden /> Reload
        </Button>
        <Button asChild variant="secondary">
          <Link to="/app">Go to overview</Link>
        </Button>
      </div>
    </Wrapper>
  );
}
