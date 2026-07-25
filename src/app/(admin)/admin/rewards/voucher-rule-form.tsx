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
}: {
  id: string;
  label: string;
  pointsCost: number;
  durationMinutes: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
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

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="flex items-end gap-4">
          <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Saving" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
