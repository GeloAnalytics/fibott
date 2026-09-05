"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type FormValues = { pointsCost: number; durationMinutes: number };

export function VoucherRuleForm({
  id,
  label,
  pointsCost,
  durationMinutes,
  isActive,
}: {
  id: string;
  label: string;
  pointsCost: number;
  durationMinutes: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: { pointsCost, durationMinutes },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const res = await fetch("/api/admin/rewards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "voucher",
        voucherRuleId: id,
        pointsCost: Number(values.pointsCost),
        durationMinutes: Number(values.durationMinutes),
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Voucher rule updated");
      router.refresh();
    } else {
      toast.error("Something went wrong. Please try again.");
    }
  }

  async function handleToggleActive() {
    setTogglingActive(true);
    const res = await fetch("/api/admin/rewards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "voucher",
        voucherRuleId: id,
        pointsCost,
        durationMinutes,
        isActive: !isActive,
      }),
    });
    setTogglingActive(false);
    if (res.ok) {
      toast.success(isActive ? "Voucher option deactivated" : "Voucher option activated");
      router.refresh();
    } else {
      toast.error("Something went wrong. Please try again.");
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-wrap items-end gap-4"
        >
          <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Input
                type="number"
                min={1}
                className="w-24 tabular-nums"
                {...register("pointsCost", { required: true, valueAsNumber: true })}
              />
              points =
              <Input
                type="number"
                min={1}
                className="w-24 tabular-nums"
                {...register("durationMinutes", { required: true, valueAsNumber: true })}
              />
              minutes
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {submitting ? "Saving" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={togglingActive}
              onClick={handleToggleActive}
            >
              {togglingActive && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {isActive ? "Deactivate" : "Activate"}
            </Button>
          </div>
        </form>
        {!isActive && (
          <p className="mt-2 text-xs text-muted-foreground">
            Hidden from users and the admin grant dialog until reactivated.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
