"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type FormValues = { label: string; pointsCost: number; durationMinutes: number };

export function VoucherRuleCreateForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { label: "", pointsCost: 50, durationMinutes: 30 },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const res = await fetch("/api/admin/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "voucher",
        label: values.label.trim(),
        pointsCost: Number(values.pointsCost),
        durationMinutes: Number(values.durationMinutes),
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("New voucher option added");
      reset({ label: "", pointsCost: 50, durationMinutes: 30 });
      router.refresh();
    } else {
      toast.error("Something went wrong. Please try again.");
    }
  }

  return (
    <Card className="border-dashed">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <p className="text-sm font-medium">Add a new voucher option</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="new-voucher-label" className="text-xs">
                Label
              </Label>
              <Input
                id="new-voucher-label"
                placeholder="e.g. 30 Min WiFi"
                {...register("label", { required: true })}
              />
              {errors.label && (
                <p className="text-xs text-destructive">A label is required</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-voucher-points" className="text-xs">
                Points cost
              </Label>
              <Input
                id="new-voucher-points"
                type="number"
                min={1}
                className="w-full tabular-nums sm:w-28"
                {...register("pointsCost", { required: true, valueAsNumber: true, min: 1 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-voucher-minutes" className="text-xs">
                Minutes
              </Label>
              <Input
                id="new-voucher-minutes"
                type="number"
                min={1}
                className="w-full tabular-nums sm:w-28"
                {...register("durationMinutes", { required: true, valueAsNumber: true, min: 1 })}
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {submitting ? "Adding" : "Add voucher option"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
