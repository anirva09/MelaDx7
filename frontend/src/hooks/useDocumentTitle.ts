import { useEffect } from "react";

export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · LesionLens` : "LesionLens";
  }, [title]);
}
