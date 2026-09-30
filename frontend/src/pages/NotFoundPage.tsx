import { Link } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper px-4 text-center">
      <Logo />
      <div>
        <h1 className="text-2xl font-semibold text-ink">This page does not exist</h1>
        <p className="mt-2 text-sm text-muted">The link may be mistyped, or the page may have moved.</p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/app">Go to overview</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
