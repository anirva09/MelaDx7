import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarDays,
  ChevronRight,
  Clock,
  Cpu,
  LogOut,
  Mail,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { authApi } from "@/api/endpoints";
import { useModelInfo } from "@/api/queries";
import { AboutSheet } from "@/components/shell/AboutSheet";
import { TabTopBar } from "@/components/shell/MobileTopBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { DesktopHeader, Divider, MetaRow, Page, PageTitle } from "@/components/ui/page";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { cn, errorMessage, formatDateTime } from "@/lib/utils";

const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Enter your name.").max(120, "Use at most 120 characters."),
});

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z
      .string()
      .min(10, "Use at least 10 characters.")
      .max(128)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letters and numbers."),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "The passwords do not match." });

/** A titled group of settings (reference card language: 16px radius, muted section label). */
function Group({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = `group-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2", className)}>
      <h2 id={id} className="px-1 text-md font-semibold uppercase text-muted">
        {title}
      </h2>
      <div className="overflow-hidden rounded-lg bg-surface">{children}</div>
    </section>
  );
}

/** A tappable settings row: label on the left, icon on the right (reference menu rows). */
function Row({
  label,
  icon,
  hint,
  to,
  onClick,
  destructive,
}: {
  label: string;
  icon: ReactNode;
  hint?: ReactNode;
  to?: string;
  onClick?: () => void;
  destructive?: boolean;
}) {
  const className = cn(
    "press-soft flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-active [&+&]:border-t [&+&]:border-line",
    "[&_svg]:size-[22px] [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
    destructive ? "text-danger" : "text-ink",
  );
  const content = (
    <>
      <span className="min-w-0">
        <span className="block text-base tracking-ref">{label}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
      {icon}
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function ProfileForm() {
  const { user, setUser } = useAuth();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { full_name: user?.full_name ?? "" },
  });
  const save = form.handleSubmit(async (values) => {
    try {
      setUser(await authApi.updateProfile(values.full_name));
      toast.success("Profile saved");
    } catch (error) {
      toast.error("Profile not saved", { description: errorMessage(error) });
    }
  });
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4 p-4">
      <Field label="Full name" error={form.formState.errors.full_name?.message}>
        <Input autoComplete="name" enterKeyHint="done" {...form.register("full_name")} />
      </Field>
      <Button
        type="submit"
        variant="secondary"
        loading={form.formState.isSubmitting}
        disabled={!form.formState.isDirty}
        className="self-start"
      >
        Save profile
      </Button>
    </form>
  );
}

function PasswordForm() {
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: "", next: "", confirm: "" },
  });
  const change = form.handleSubmit(async (values) => {
    try {
      await authApi.changePassword(values.current, values.next);
      form.reset();
      toast.success("Password changed", { description: "Other sessions were signed out." });
    } catch (error) {
      form.setError("current", { message: errorMessage(error) });
    }
  });
  return (
    <form onSubmit={change} noValidate className="flex flex-col gap-4 p-4">
      <p className="text-md text-ink-2">Changing your password signs out all other sessions.</p>
      <Field label="Current password" error={form.formState.errors.current?.message}>
        <PasswordInput autoComplete="current-password" {...form.register("current")} />
      </Field>
      <Field
        label="New password"
        error={form.formState.errors.next?.message}
        hint="At least 10 characters, with letters and numbers."
      >
        <PasswordInput autoComplete="new-password" {...form.register("next")} />
      </Field>
      <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
        <PasswordInput autoComplete="new-password" enterKeyHint="done" {...form.register("confirm")} />
      </Field>
      <Button type="submit" variant="secondary" loading={form.formState.isSubmitting} className="self-start">
        Change password
      </Button>
    </form>
  );
}

function useDeleteAccountDialog() {
  const { deleteAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount(password);
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  };
  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !deleting && setOpen(next)}
      title="Delete your account?"
      confirmLabel="Delete account and data"
      pending={deleting}
      onConfirm={() => {
        if (password) void confirm();
        else setError("Enter your password to confirm.");
      }}
      description={
        <div className="flex flex-col gap-4">
          <p>All analyses, images and explanations in this account will be permanently deleted.</p>
          <Field label="Password" error={error ?? undefined}>
            <PasswordInput
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>
      }
    />
  );
  const ask = () => {
    setPassword("");
    setError(null);
    setOpen(true);
  };
  return { ask, dialog };
}

export function ProfilePage() {
  useDocumentTitle("Profile");
  const desktop = useIsDesktop();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const model = useModelInfo();
  const [about, setAbout] = useState(false);
  const { ask, dialog } = useDeleteAccountDialog();
  if (!user) return null;

  const signOut = () => void logout().then(() => navigate("/login", { replace: true }));
  const modelHint =
    model.data?.status === "ready"
      ? `${model.data.display_name} v${model.data.version}`
      : model.data?.status === "untrained"
        ? "Untrained pipeline-verification model"
        : model.data?.status === "unavailable"
          ? "No model weights loaded"
          : undefined;

  const groups = (
    <>
      <Group title="Appearance">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-base tracking-ref text-ink">Theme</span>
          <ThemeToggle labels />
        </div>
      </Group>
      <Group title="Model and safety">
        <Row label="Model card" hint={modelHint} icon={<Cpu aria-hidden />} to="/app/model" />
        <Row
          label="About & safety"
          hint="Disclaimer, Grad-CAM, privacy"
          icon={<ShieldCheck aria-hidden />}
          onClick={() => setAbout(true)}
        />
      </Group>
      <Group title="Profile">
        <ProfileForm />
      </Group>
      <Group title="Password">
        <PasswordForm />
      </Group>
      <Group title="Account">
        <Row label="Sign out" icon={<LogOut aria-hidden />} onClick={signOut} />
        <Row
          label="Delete account"
          hint="Permanently deletes every analysis, image and map"
          icon={<Trash2 aria-hidden />}
          onClick={ask}
          destructive
        />
      </Group>
    </>
  );

  const meta = (
    <div className="flex flex-col gap-4">
      <MetaRow icon={<Mail aria-hidden />} label="Email">
        <span className="block truncate">{user.email}</span>
      </MetaRow>
      <MetaRow icon={<UserRound aria-hidden />} label="Role">
        <Badge tone="tag">{user.role === "admin" ? "Administrator" : "Researcher"}</Badge>
      </MetaRow>
      <MetaRow icon={<CalendarDays aria-hidden />} label="Joined">
        <span className="block truncate">{formatDateTime(user.created_at)}</span>
      </MetaRow>
      <MetaRow icon={<Clock aria-hidden />} label="Last sign-in">
        <span className="block truncate">{formatDateTime(user.last_login_at)}</span>
      </MetaRow>
    </div>
  );

  if (!desktop) {
    return (
      <>
        <TabTopBar />
        <Page className="gap-0">
          <PageTitle>{user.full_name}</PageTitle>
          <div className="mt-5">{meta}</div>
          <Divider className="mb-6 mt-4" />
          <div className="flex flex-col gap-7">{groups}</div>
        </Page>
        <AboutSheet open={about} onOpenChange={setAbout} />
        {dialog}
      </>
    );
  }

  return (
    <Page>
      <DesktopHeader title="Settings" subtitle="Your profile, password and display preferences." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="rounded-lg bg-surface p-5" aria-label="Account">
          <p className="text-xl font-semibold tracking-ref text-ink">{user.full_name}</p>
          <div className="mt-4">{meta}</div>
          <Link to="/app/model" className="mt-5 flex items-center gap-1 text-md text-muted hover:text-ink">
            Model card <ChevronRight className="size-4" aria-hidden />
          </Link>
        </section>
        <div className="flex flex-col gap-6">{groups}</div>
      </div>
      <AboutSheet open={about} onOpenChange={setAbout} />
      {dialog}
    </Page>
  );
}
