"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FormValues = { currentPassword: string; newPassword: string };

export function PasswordForm() {
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>();

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const res = await fetch("/api/user/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Password changed");
      reset();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Something went wrong. Please try again.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              aria-invalid={!!errors.currentPassword}
              {...register("currentPassword", { required: true })}
            />
            {errors.currentPassword && (
              <p className="text-sm text-destructive">Current password is required</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              aria-invalid={!!errors.newPassword}
              {...register("newPassword", { required: true, minLength: 8 })}
            />
            {errors.newPassword && (
              <p className="text-sm text-destructive">
                Password must be at least 8 characters
              </p>
            )}
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Saving" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
