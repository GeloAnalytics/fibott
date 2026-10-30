"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FormValues = {
  name: string;
  phone: string;
  address: string;
};

export function ProfileForm({
  name,
  email,
  phone,
  address,
}: {
  name: string;
  email: string;
  phone: string;
  address: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { name, phone, address } });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const res = await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Profile updated");
      router.refresh();
    } else {
      toast.error("Something went wrong. Please try again.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Full name */}
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              aria-invalid={!!errors.name}
              {...register("name", { required: true })}
            />
            {errors.name && <p className="text-sm text-destructive">Name is required</p>}
          </div>

          {/* Email (read-only) */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled />
          </div>

          {/* Contact number */}
          <div className="space-y-2">
            <Label htmlFor="phone">Contact number</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="e.g. +63 912 345 6789"
              aria-invalid={!!errors.phone}
              {...register("phone", {
                maxLength: { value: 30, message: "Phone number is too long" },
              })}
            />
            {errors.phone && (
              <p className="text-sm text-destructive">{errors.phone.message}</p>
            )}
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              rows={3}
              placeholder="Street, Barangay, City, Province"
              aria-invalid={!!errors.address}
              {...register("address", {
                maxLength: { value: 500, message: "Address is too long" },
              })}
            />
            {errors.address && (
              <p className="text-sm text-destructive">{errors.address.message}</p>
            )}
          </div>

          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Saving" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
