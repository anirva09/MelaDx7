import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { authApi } from "@/api/endpoints";
import { PageHeader } from "@/components/PageHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { errorMessage, formatDateTime } from "@/lib/utils";

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

export function SettingsPage() {
  useDocumentTitle("Settings");
  const { user, setUser, logout, deleteAccount } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(deletePassword);
    } catch (error) {
      setDeleteError(errorMessage(error));
      setDeleting(false);
    }
  };
  const navigate = useNavigate();

  const profile = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { full_name: user?.full_name ?? "" },
  });
  const password = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: "", next: "", confirm: "" },
  });

  const saveProfile = profile.handleSubmit(async (values) => {
    try {
      setUser(await authApi.updateProfile(values.full_name));
      toast.success("Profile saved");
    } catch (error) {
      toast.error("Profile not saved", { description: errorMessage(error) });
    }
  });

  const changePassword = password.handleSubmit(async (values) => {
    try {
      await authApi.changePassword(values.current, values.next);
      password.reset();
      toast.success("Password changed", { description: "Other sessions were signed out." });
    } catch (error) {
      password.setError("current", { message: errorMessage(error) });
    }
  });

  if (!user) return null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description="Your profile, password and display preferences." />

      <Card>
        <form onSubmit={saveProfile} noValidate>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Signed in as {user.email}
              {user.role === "admin" && (
                <Badge tone="accent" className="ml-2">
                  Administrator
                </Badge>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Full name" error={profile.formState.errors.full_name?.message}>
              <Input autoComplete="name" {...profile.register("full_name")} />
            </Field>
            <p className="text-xs text-muted">
              Member since {formatDateTime(user.created_at)}. Last sign-in{" "}
              {formatDateTime(user.last_login_at)}.
            </p>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              loading={profile.formState.isSubmitting}
              disabled={!profile.formState.isDirty}
            >
              Save profile
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <form onSubmit={changePassword} noValidate>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Changing your password signs out all other sessions.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Current password"
              error={password.formState.errors.current?.message}
              className="sm:col-span-2"
            >
              <PasswordInput autoComplete="current-password" {...password.register("current")} />
            </Field>
            <Field
              label="New password"
              error={password.formState.errors.next?.message}
              hint="At least 10 characters, with letters and numbers."
            >
              <PasswordInput autoComplete="new-password" {...password.register("next")} />
            </Field>
            <Field label="Confirm new password" error={password.formState.errors.confirm?.message}>
              <PasswordInput autoComplete="new-password" {...password.register("confirm")} />
            </Field>
          </CardContent>
          <CardFooter>
            <Button type="submit" loading={password.formState.isSubmitting}>
              Change password
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            The image viewer keeps a dark surround in every theme so heatmap colours stay comparable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Sign out of LesionLens on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
            onClick={() => void logout().then(() => navigate("/login", { replace: true }))}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>

      <Card className="border-danger-line">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently deletes your account, every analysis, and every stored image and Grad-CAM map. This
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="danger-ghost"
            className="border border-danger-line"
            onClick={() => {
              setDeletePassword("");
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            Delete account
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => !deleting && setDeleteOpen(open)}
        title="Delete your account?"
        confirmLabel="Delete account and data"
        pending={deleting}
        onConfirm={() => {
          if (deletePassword) void confirmDelete();
          else setDeleteError("Enter your password to confirm.");
        }}
        description={
          <div className="flex flex-col gap-4">
            <p>All analyses, images and explanations in this account will be permanently deleted.</p>
            <Field label="Password" error={deleteError ?? undefined}>
              <PasswordInput
                autoComplete="current-password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </Field>
          </div>
        }
      />
    </div>
  );
}
