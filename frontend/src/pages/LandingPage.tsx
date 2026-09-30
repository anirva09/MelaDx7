import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { Notice } from "@/components/Notice";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { MEDICAL_DISCLAIMER } from "@/lib/copy";

const PIPELINE = [
  {
    title: "Validate",
    body: "Format, size and integrity checks on the file's contents. EXIF and GPS metadata are stripped.",
  },
  {
    title: "Preprocess",
    body: "Resized to the model's input size and normalised exactly as during training.",
  },
  {
    title: "Classify",
    body: "An EfficientNet-B0 fine-tuned from ImageNet weights scores every lesion class.",
  },
  {
    title: "Calibrate",
    body: "Temperature scaling turns scores into probabilities; low-confidence results are flagged.",
  },
  {
    title: "Explain",
    body: "Grad-CAM highlights the regions that most increased the predicted class score.",
  },
  {
    title: "Record",
    body: "Saved with model version, weights checksum and timings, and exportable as a PDF report.",
  },
];

const CLASSES: { name: string; group: string }[] = [
  { name: "Melanoma", group: "malignant" },
  { name: "Basal cell carcinoma", group: "malignant" },
  { name: "Actinic keratosis / intraepithelial carcinoma", group: "pre-malignant" },
  { name: "Benign keratosis-like lesion", group: "benign" },
  { name: "Melanocytic nevus", group: "benign" },
  { name: "Dermatofibroma", group: "benign" },
  { name: "Vascular lesion", group: "benign" },
];

const STACK: { area: string; items: string[] }[] = [
  {
    area: "Model",
    items: [
      "PyTorch and torchvision",
      "EfficientNet-B0 transfer learning",
      "Grad-CAM (own implementation)",
      "Temperature scaling",
      "scikit-learn evaluation",
    ],
  },
  {
    area: "Service",
    items: [
      "FastAPI with async SQLAlchemy",
      "PostgreSQL and Alembic",
      "JWT with rotating refresh tokens",
      "Argon2id password hashing",
      "Local or S3-compatible storage",
    ],
  },
  {
    area: "Interface",
    items: [
      "React and TypeScript",
      "Vite and Tailwind CSS",
      "TanStack Query",
      "Canvas-based Grad-CAM viewer",
      "Recharts and Radix UI",
    ],
  },
  {
    area: "Operations",
    items: [
      "Docker Compose",
      "Nginx reverse proxy",
      "Structured JSON logs",
      "pytest, Vitest and Playwright",
      "Versioned model cards",
    ],
  },
];

const LIMITS = [
  "Trained on a single public dataset (HAM10000). Performance on other populations, skin tones, devices or clinics is unknown.",
  "Built for dermoscopic images. Ordinary clinical photographs are outside its training distribution.",
  "It can only answer with the classes it was trained on. A lesion of any other type is still assigned to one of them.",
  "Grad-CAM maps are coarse (a 7×7 grid, upsampled) and show where evidence was found, not why, and not causation.",
  "It has not been clinically validated and gives no treatment recommendations.",
];

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 border-t border-line py-16 sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 id={`${id}-title`} className="text-2xl font-semibold text-ink sm:text-[2rem] sm:leading-tight">
            {title}
          </h2>
          {lead && <p className="mt-4 text-base text-ink-2 sm:text-lg">{lead}</p>}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** Illustrative figure (clearly labelled): attribution contours over a stylised lesion. */
function HeroFigure() {
  return (
    <figure className="overflow-hidden rounded-xl bg-stage ring-1 ring-stage-line">
      <div className="stage-checker relative flex aspect-[5/4] items-center justify-center">
        <svg
          viewBox="0 0 400 320"
          className="h-full w-full"
          role="img"
          aria-label="Illustration: contour lines of an attribution map over part of a stylised skin lesion"
        >
          <defs>
            <radialGradient id="hero-skin" cx="50%" cy="46%" r="58%">
              <stop offset="0%" stopColor="#d4a78e" />
              <stop offset="62%" stopColor="#b98469" />
              <stop offset="100%" stopColor="#6d4636" />
            </radialGradient>
            <radialGradient id="hero-lesion" cx="44%" cy="46%" r="64%">
              <stop offset="0%" stopColor="#2e1a13" />
              <stop offset="55%" stopColor="#4d2c20" />
              <stop offset="100%" stopColor="#8a5a44" stopOpacity="0.15" />
            </radialGradient>
            <filter id="hero-soft">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <clipPath id="hero-field">
              <circle cx="200" cy="160" r="140" />
            </clipPath>
          </defs>
          <g clipPath="url(#hero-field)">
            <rect width="400" height="320" fill="url(#hero-skin)" />
            <path
              filter="url(#hero-soft)"
              d="M118 150c-4-38 30-72 74-78 30-4 50 10 72 4 30-8 60 12 62 44 2 26-20 38-18 62 2 30-30 54-66 52-24-2-36-16-60-12-34 6-62-12-64-40-1-12 2-22 0-32z"
              fill="url(#hero-lesion)"
            />
            {[
              [150, 132],
              [176, 118],
              [208, 124],
              [236, 142],
              [196, 170],
              [162, 176],
              [226, 190],
              [250, 168],
            ].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="3.2" fill="#1c0f0a" opacity="0.7" />
            ))}
            {[
              "M214 98c34-10 72 6 80 38 8 30-12 58-44 62-30 4-58-14-62-42-3-24 6-50 26-58z",
              "M226 112c24-6 50 6 54 28 4 20-10 38-32 40-20 2-38-10-40-28-2-16 4-34 18-40z",
              "M238 126c12-3 26 4 28 16 2 11-6 20-18 21-11 1-20-6-21-16-1-9 3-18 11-21z",
            ].map((d, i) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.2 + i * 0.6}
                strokeOpacity={0.5 + i * 0.2}
              />
            ))}
          </g>
          <circle cx="200" cy="160" r="140" fill="none" stroke="#ffffff" strokeOpacity="0.14" />
        </svg>
      </div>
      <figcaption className="border-t border-white/10 px-4 py-3 text-xs text-white/60">
        Illustration of an attribution map, not model output. In the application, maps are computed per image
        from the network's own gradients.
      </figcaption>
    </figure>
  );
}

export function LandingPage() {
  useDocumentTitle(undefined);
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const [params] = useSearchParams();
  const accountDeleted = params.get("account") === "deleted";

  return (
    <div className="min-h-dvh bg-paper">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="LesionLens home">
            <Logo />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-6 text-sm text-ink-2 md:flex">
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <a href="#explainability" className="hover:text-ink">
              Explainability
            </a>
            <a href="#limitations" className="hover:text-ink">
              Limitations
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="hidden sm:inline-flex" />
            {signedIn ? (
              <Button asChild size="sm">
                <Link to="/app">Open workspace</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Create account</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="content">
        {accountDeleted && (
          <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
            <Notice tone="info" title="Your account was deleted" announce>
              Your account, analyses, stored images and explanations have been permanently removed.
            </Notice>
          </div>
        )}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pb-24">
          <div>
            <h1 className="text-[2.5rem] font-semibold leading-[1.08] tracking-[-0.025em] text-ink sm:text-[3.4rem]">
              Interpretable AI for dermoscopic skin lesion analysis
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-2">
              A convolutional neural network classifies a dermoscopic image, reports a calibrated probability
              for every lesion class, and shows which regions of the image drove its prediction.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to={signedIn ? "/app/analyze" : "/register"}>Start an analysis</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <a href="#how">How it works</a>
              </Button>
            </div>
            <p className="mt-6 max-w-lg text-sm text-muted">
              A research and clinical decision-support prototype. It does not diagnose, and its output must be
              interpreted by a qualified professional.
            </p>
          </div>
          <HeroFigure />
        </section>

        <Section
          id="purpose"
          title="Why interpretability matters"
          lead="Early detection improves outcomes for skin cancer, but visual examination of lesions is time-consuming and depends on the examiner's experience. A model that only returns a label is hard to trust."
        >
          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                title: "Evidence, not just a label",
                body: "Each prediction comes with a Grad-CAM map, so a reviewer can check whether the model attended to the lesion rather than to hair, rulers or ink markings.",
              },
              {
                title: "Honest probabilities",
                body: "Scores are calibrated on held-out data and every class is shown. Close calls are flagged as uncertain instead of being rounded into a single answer.",
              },
              {
                title: "Reproducible records",
                body: "Every result stores the model version, weights checksum, preprocessing and timings, and can be re-run when a better model is trained.",
              },
            ].map((item) => (
              <div key={item.title} className="border-l-2 border-accent pl-4">
                <h3 className="font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="how"
          title="How the analysis works"
          lead="Six steps run for every uploaded image, in this order."
        >
          <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {PIPELINE.map((step, i) => (
              <li key={step.title} className="bg-surface p-6">
                <span className="tabular text-sm font-semibold text-accent">{i + 1}</span>
                <h3 className="mt-2 font-semibold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="explainability"
          title="Grad-CAM, briefly"
          lead="Gradient-weighted Class Activation Mapping asks which feature maps in the last convolutional layer increase the score of a class, and where in the image those features respond."
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-xl bg-stage p-6 text-white ring-1 ring-stage-line">
              <p className="text-xs text-white/55">
                For class c and feature maps A<sup>k</sup>
              </p>
              <p className="mt-4 font-mono text-[15px] leading-8">
                α<sub>k</sub>
                <sup>c</sup> = (1/Z) Σ<sub>i</sub>Σ<sub>j</sub> ∂y<sup>c</sup> / ∂A<sup>k</sup>
                <sub>ij</sub>
              </p>
              <p className="font-mono text-[15px] leading-8">
                L<sup>c</sup> = ReLU( Σ<sub>k</sub> α<sub>k</sub>
                <sup>c</sup> A<sup>k</sup> )
              </p>
              <p className="mt-4 text-sm leading-relaxed text-white/70">
                The weights α average the gradients of the class score over each feature map. The weighted sum
                is clipped at zero, upsampled to the image size and scaled to its own maximum.
              </p>
              <p className="mt-3 text-xs text-white/50">Selvaraju et al., ICCV 2017.</p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="font-semibold text-ink">What the map shows</h3>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-2">
                  <li>Where the model found evidence for the selected class.</li>
                  <li>Relative strength within this one image.</li>
                  <li>A map for any class, not only the predicted one.</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-ink">What it does not show</h3>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-2">
                  <li>Clinical evidence or a lesion boundary.</li>
                  <li>Comparable intensity between different images.</li>
                  <li>Fine detail finer than the network's 7×7 feature grid.</li>
                </ul>
              </div>
              <p className="text-sm text-muted sm:col-span-2">
                The viewer lets you change overlay opacity, hide weak attribution, switch colour maps, compare
                with the original and zoom into the lesion.
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="classes"
          title="What it classifies"
          lead="The default model uses the seven diagnostic categories of the public HAM10000 dermoscopy dataset. Classes come from a configuration file and are recorded in every model card, so a model trained on another label set works without code changes."
        >
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {CLASSES.map((c) => (
              <li
                key={c.name}
                className="flex items-baseline justify-between gap-4 border-b border-line pb-3"
              >
                <span className="text-ink">{c.name}</span>
                <span className="text-xs text-muted">{c.group}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="technology"
          title="How it is built"
          lead="An end-to-end system: training pipeline, inference service, database and interface, with the model replaceable through its model card."
        >
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STACK.map((group) => (
              <div key={group.area}>
                <h3 className="text-sm font-semibold text-ink">{group.area}</h3>
                <ul className="mt-3 flex flex-col gap-1.5 text-sm text-ink-2">
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section id="limitations" title="Limitations and responsible use">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <p className="rounded-xl border border-line bg-surface p-6 text-base leading-relaxed text-ink">
              {MEDICAL_DISCLAIMER}
            </p>
            <ul className="flex flex-col gap-3 text-sm leading-relaxed text-ink-2">
              {LIMITS.map((item) => (
                <li key={item} className="border-b border-line pb-3 last:border-0">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <section className="border-t border-line bg-stage py-16 text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Run the full workflow</h2>
              <p className="mt-2 max-w-xl text-white/65">
                Upload an image, inspect the probabilities and the Grad-CAM map, then export a report.
              </p>
            </div>
            <Button asChild size="lg">
              <Link to={signedIn ? "/app/analyze" : "/register"}>
                {signedIn ? "New analysis" : "Create an account"}
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-muted sm:px-6 md:flex-row md:justify-between">
          <p>
            Interpretable Deep Learning for Skin Cancer Detection and Subtype Classification. Major project,
            Vidya Jyothi Institute of Technology, Hyderabad.
          </p>
          <p>For research and education. Not a medical device.</p>
        </div>
      </footer>
    </div>
  );
}
