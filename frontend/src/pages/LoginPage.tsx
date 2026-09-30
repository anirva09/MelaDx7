import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { ApiError } from "@/api/client";
import { Notice } from "@/components/Notice";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { AuthLayout } from "@/layouts/AuthLayout";
import { errorMessage } from "@/lib/utils";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  useDocumentTitle("Sign in");
  const { login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/app";
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      navigate(from.startsWith("/app") ? from : "/app", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429 && error.retryAfter) {
        setFormError(`Too many sign-in attempts. Try again in ${error.retryAfter} seconds.`);
      } else {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle={
        <>
          New to MelaDx7?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {sessionExpired && !formError && (
        <Notice tone="info" title="Your session ended" className="mb-5">
          Sign in again to continue where you left off.
        </Notice>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && (
          <Notice tone="danger" title="Could not sign in" announce>
            {formError}
          </Notice>
        )}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...register("password")} />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
