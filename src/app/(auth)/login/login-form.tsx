"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleIcon } from "@/components/shared/google-icon";

type FormValues = { email: string; password: string };

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Incorrect email or password.",
  EMAIL_NOT_VERIFIED: "Please verify your email before signing in.",
  ACCOUNT_SUSPENDED: "This account has been suspended. Contact support.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(
    searchParams.get("error")
      ? (ERROR_MESSAGES[searchParams.get("error")!] ?? "Something went wrong. Please try again.")
      : null
  );
  const [submitting, setSubmitting] = useState(false);
  const verified = searchParams.get("verified") === "1";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>();

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setSubmitting(true);
    await signIn("credentials", {
      email: values.email,
      password: values.password,
      callbackUrl: "/",
    });
    setSubmitting(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {verified && (
          <p className="rounded-md bg-success px-3 py-2 text-sm text-success-foreground">
            Email verified. You can now sign in.
          </p>
        )}
        {serverError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError}
          </p>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email", { required: true })}
            />
            {errors.email && (
              <p className="text-sm text-destructive">Email is required</p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password", { required: true })}
            />
            {errors.password && (
              <p className="text-sm text-destructive">Password is required</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Signing in" : "Sign in"}
          </Button>
        </form>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => signIn("google", { callbackUrl: "/" })}
        >
          <GoogleIcon className="size-4" />
          Continue with Google
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-foreground hover:underline">
            Register
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
