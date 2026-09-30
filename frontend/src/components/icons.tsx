import type { SVGProps } from "react";

/**
 * Icons that have no close Lucide equivalent. Drawn on Lucide's 24px grid with the
 * reference's 1.5 stroke so they sit naturally next to Lucide icons.
 */
export function OverviewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="7" cy="7" r="3.25" />
      <circle cx="17" cy="7" r="3.25" />
      <circle cx="7" cy="17" r="3.25" />
      <path d="M17 13.5v7M13.5 17h7" />
    </svg>
  );
}

/** Dermatoscope field of view with a lesion mark: the LesionLens mark. */
export function LensMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="12" cy="12" r="3.25" fill="var(--accent)" />
    </svg>
  );
}
