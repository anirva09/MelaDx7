import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { MEDICAL_DISCLAIMER } from "@/lib/copy";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-stage p-10 text-white lg:flex">
        <Link to="/" aria-label="MelaDx7 home" className="[&_span]:text-white">
          <Logo />
        </Link>
        <div className="relative max-w-md">
          <FieldOfView />
          <p className="text-3xl font-medium leading-tight tracking-tight">
            See the prediction, and where the model looked.
          </p>
          <p className="mt-4 text-white/65">
            A Vision Transformer classifies dermoscopic images and pairs every result with a Grad-CAM
            attribution map, calibrated class probabilities and a full reproducibility record.
          </p>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-white/55">{MEDICAL_DISCLAIMER}</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 pb-[max(2.5rem,var(--safe-bottom))] pt-[max(2.5rem,calc(var(--safe-top)+1rem))] sm:px-8">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 inline-block lg:hidden" aria-label="MelaDx7 home">
            <Logo />
          </Link>
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-10 text-xs leading-relaxed text-muted lg:hidden">{MEDICAL_DISCLAIMER}</p>
        </div>
      </main>
    </div>
  );
}

/** Decorative concentric rings echoing a dermatoscope's circular field of view. */
function FieldOfView() {
  return (
    <svg
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -right-40 -top-56 size-[26rem] opacity-40"
      aria-hidden
    >
      {[92, 72, 52, 32].map((r, i) => (
        <circle
          key={r}
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity={0.18 + i * 0.12}
          strokeWidth="0.6"
        />
      ))}
    </svg>
  );
}
