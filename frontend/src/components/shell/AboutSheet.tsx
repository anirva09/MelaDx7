import { BottomSheet } from "@/components/ui/sheet";
import { GRADCAM_NOTE, MEDICAL_DISCLAIMER } from "@/lib/copy";

/** Safety, explainability and privacy statements in one place. */
export function AboutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const sections = [
    { title: "Medical disclaimer", body: MEDICAL_DISCLAIMER },
    { title: "About Grad-CAM", body: GRADCAM_NOTE },
    {
      title: "Research use",
      body: "LesionLens is a research and clinical decision-support prototype. It has not been cleared or approved as a medical device.",
    },
    {
      title: "Privacy",
      body: "Uploaded images are re-encoded without metadata (EXIF, GPS) before storage. Do not upload images that show faces, names or other identifying details.",
    },
  ];
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="About & safety"
      description="How to read LesionLens results safely."
      size="auto"
    >
      <div className="flex flex-col gap-3 pb-2">
        {sections.map((section) => (
          <section key={section.title} className="rounded-[16px] bg-[var(--paper)] p-4 dark:bg-[#1d1d1d]">
            <h3 className="text-base font-medium tracking-ref text-ink">{section.title}</h3>
            <p className="mt-1.5 text-md leading-relaxed text-ink-2">{section.body}</p>
          </section>
        ))}
      </div>
    </BottomSheet>
  );
}
