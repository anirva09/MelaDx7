import { ArrowUp, Camera, FolderOpen, Image as ImageIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { PillButton } from "@/components/shell/Glass";
import { ACCEPTED_EXTENSIONS, checkFile, MAX_UPLOAD_BYTES, MIN_IMAGE_SIDE } from "@/lib/files";
import { setPendingFile } from "@/lib/pendingUpload";

interface ComposerContextValue {
  openComposer: () => void;
}

const ComposerContext = createContext<ComposerContextValue>({ openComposer: () => undefined });

// eslint-disable-next-line react-refresh/only-export-components
export function useComposer(): ComposerContextValue {
  return useContext(ComposerContext);
}

const IMAGE_ACCEPT = ["image/jpeg", "image/png", "image/webp"].join(",");
const FILE_ACCEPT = [...ACCEPTED_EXTENSIONS, "image/jpeg", "image/png", "image/webp"].join(",");

/**
 * The action composer behind the floating "+" button (reference: "Home - Create").
 * It rises over a blurred page with the image sources as an action pill; picking an image
 * opens the analysis screen with an immediate preview.
 */
export function ComposerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  const openComposer = useCallback(() => {
    setProblem(null);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ openComposer }), [openComposer]);

  const accept = (file: File | undefined) => {
    if (!file) return;
    const issue = checkFile(file, MAX_UPLOAD_BYTES);
    if (issue) {
      setProblem(issue.message);
      return;
    }
    setPendingFile(file);
    setOpen(false);
    navigate("/app/analyze");
  };

  const input = (ref: React.RefObject<HTMLInputElement | null>, acceptTypes: string, capture?: boolean) => (
    <input
      ref={ref}
      type="file"
      accept={acceptTypes}
      capture={capture ? "environment" : undefined}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        accept(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );

  return (
    <ComposerContext.Provider value={value}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="data-open-fade fixed inset-0 z-50 bg-[rgb(20_20_20/0.3)] backdrop-blur-[16px]" />
          <Dialog.Content
            className="data-open-rise fixed inset-x-0 z-50 mx-auto flex max-w-[480px] flex-col px-4 focus:outline-none"
            style={{ bottom: "var(--tabbar-bottom)" }}
            aria-describedby="composer-hint"
          >
            <Dialog.Title className="sr-only">New analysis</Dialog.Title>
            {input(camera, IMAGE_ACCEPT, true)}
            {input(library, IMAGE_ACCEPT)}
            {input(files, FILE_ACCEPT)}
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="mx-auto mb-3 flex h-6 w-16 items-center justify-center"
              >
                <span className="glass block h-1 w-[50px] rounded-full" aria-hidden />
              </button>
            </Dialog.Close>
            <div className="glass relative min-h-[113px] rounded-[20px]">
              <button
                type="button"
                onClick={() => library.current?.click()}
                className="press-soft flex min-h-[113px] w-full flex-col items-start gap-1 rounded-[20px] px-4 pb-12 pt-4 text-left"
              >
                <span className="text-lg font-semibold tracking-ref text-[#949494]">
                  Add a dermoscopic image
                </span>
                <span id="composer-hint" className="text-md text-muted">
                  JPEG, PNG or WebP · up to {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB · at least{" "}
                  {MIN_IMAGE_SIDE} px
                </span>
              </button>
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-3 right-4 flex size-8 items-center justify-center rounded-full bg-accent text-white"
              >
                <ArrowUp className="size-5" strokeWidth={1.8} />
              </span>
            </div>
            {problem && (
              <p role="alert" className="mt-3 px-1 text-md font-medium text-danger">
                {problem}
              </p>
            )}
            <div className="mt-4 flex items-center justify-between">
              <div
                role="group"
                aria-label="Image source"
                className="glass inline-flex h-[50px] items-center gap-3 rounded-full px-2"
              >
                <PillButton label="Take a photo" onClick={() => camera.current?.click()}>
                  <Camera aria-hidden />
                </PillButton>
                <PillButton label="Choose from photos" onClick={() => library.current?.click()}>
                  <ImageIcon aria-hidden />
                </PillButton>
                <PillButton label="Browse files" onClick={() => files.current?.click()}>
                  <FolderOpen aria-hidden />
                </PillButton>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ComposerContext.Provider>
  );
}
