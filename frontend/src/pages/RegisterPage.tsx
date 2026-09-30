import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { Notice } from "@/components/Notice";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { AuthLayout } from "@/layouts/AuthLayout";
import { cn, errorMessage } from "@/lib/utils";

const RULES = [
  { test: (v: string) => v.length >= 10, label: "At least 10 characters" },
  { test: (v: string) => /[A-Za-z]/.test(v) && /\d/.test(v), label: "Letters and numbers" },
  { test: (v: string) => new Set(v).size >= 5, label: "Not repetitive" },
];

const schema = z
  .object({
    full_name: z.string().trim().min(1, "Enter your name.").max(120, "Use at most 120 characters."),
    email: z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address."),
    password: z
      .string()
      .max(128, "Use at most 128 characters.")
      .refine((v) => RULES.every((rule) => rule.test(v)), "The password does not meet the requirements."),
    confirm: z.string(),
    acknowledge: z.boolean().refine((v) => v, "Please confirm to continue."),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "The passwords do not match.",
  });
type Values = z.infer<typeof schema>;

export function RegisterPage() {
  useDocumentTitle("Create account");
  const { register: createAccount } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: "", confirm: "", acknowledge: false },
  });
  const password = useWatch({ control, name: "password" });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createAccount(values.full_name, values.email, values.password);
      navigate("/app", { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <AuthLayout
      title="Create an account"
      subtitle={
        <>
          Already registered?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && (
          <Notice tone="danger" title="Could not create the account" announce>
            {formError}
          </Notice>
        )}
        <Field label="Full name" error={errors.full_name?.message}>
          <Input autoComplete="name" {...register("full_name")} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field
          label="Password"
          error={errors.password?.message}
          hint={
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {RULES.map((rule) => {
                const ok = rule.test(password ?? "");
                return (
                  <span key={rule.label} className={cn("inline-flex items-center gap-1", ok && "text-good")}>
                    <Check className={cn("size-3", !ok && "opacity-30")} aria-hidden />
                    {rule.label}
                    <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
                  </span>
                );
              })}
            </span>
          }
        >
          <PasswordInput autoComplete="new-password" {...register("password")} />
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...register("confirm")} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-3 text-sm text-ink-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              aria-invalid={errors.acknowledge ? true : undefined}
              {...register("acknowledge")}
            />
            <span>
              I understand MelaDx7 is a research and decision-support prototype. Its outputs are not a
              medical diagnosis.
            </span>
          </label>
          {errors.acknowledge && (
            <p className="pl-7 text-xs font-medium text-danger" role="alert">
              {errors.acknowledge.message}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
