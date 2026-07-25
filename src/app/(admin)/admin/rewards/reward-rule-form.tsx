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

const MATERIAL_LABEL: Record<string, string> = {
  PET_BOTTLE: "Plastic bottle",
  ALUMINUM_CAN: "Aluminum can",
  REJECTED: "Rejected item",
};

type FormValues = { pointsPerItem: number };

export function RewardRuleForm({
  id,
  materialType,
  pointsPerItem,
}: {
  id: string;
  materialType: string;
  pointsPerItem: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: { pointsPerItem },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const res = await fetch("/api/admin/rewards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "reward",
        rewardRuleId: id,
        pointsPerItem: Number(values.pointsPerItem),
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Reward rule updated");
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
          className="flex items-end justify-between gap-4"
        >
          <div className="space-y-2">
            <Label>{MATERIAL_LABEL[materialType] ?? materialType}</Label>
            <Input
              type="number"
              min={0}
              className="w-32 tabular-nums"
              {...register("pointsPerItem", { required: true, valueAsNumber: true })}
            />
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
