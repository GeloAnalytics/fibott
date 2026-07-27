"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Recycle, CheckCircle, Clock, AlertCircle } from "lucide-react";

type Phase =
  | { name: "idle" }
  | { name: "creating" }
  | { name: "active"; sessionId: string; expiresAt: Date }
  | { name: "completed"; pointsAwarded: number }
  | { name: "expired" }
  | { name: "error"; message: string };

function useCountdown(expiresAt: Date | null): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const update = () => setRemaining(Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, [expiresAt]);

  return remaining;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecyclingSession() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // On mount — check if there is already an active session for this user
  useEffect(() => {
    let cancelled = false;
    fetch("/api/kiosk/session")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.active && data.sessionId) {
          setPhase({ name: "active", sessionId: data.sessionId, expiresAt: new Date(data.expiresAt) });
        }
      })
      .catch(() => {/* silently ignore — just show idle */});
    return () => { cancelled = true; };
  }, []);

  // Poll for session completion while ACTIVE
  useEffect(() => {
    if (phase.name !== "active") {
      stopPolling();
      return;
    }
    const { sessionId } = phase;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/kiosk/session?id=${sessionId}`);
        const text = await res.text();
        console.log(`[poll] ${res.status} ${res.url}`, text);
        if (!res.ok) return;
        const data = JSON.parse(text);

        if (data.status === "COMPLETED") {
          stopPolling();
          setPhase({ name: "completed", pointsAwarded: data.pointsAwarded ?? 0 });
          router.refresh();
        } else if (data.status === "EXPIRED" || data.status === "CANCELLED") {
          stopPolling();
          setPhase({ name: "expired" });
        }
      } catch (e) {
        console.log("[poll] error", e);
      }
    }, 2000);

    return stopPolling;
  }, [phase, stopPolling, router]);

  // When countdown hits 0, do a final server check before declaring expired
  // (the deposit may have completed in the last polling window)
  const expiresAt = phase.name === "active" ? phase.expiresAt : null;
  const remaining = useCountdown(expiresAt);
  useEffect(() => {
    if (phase.name !== "active" || remaining !== 0) return;
    // Guard against a stale `remaining` from the moment this phase became
    // active (useCountdown only settles its first real value inside its own
    // effect, one render after the transition) — recheck the real deadline
    // before treating this as a genuine countdown-hit-zero.
    if (phase.expiresAt.getTime() - Date.now() > 0) return;
    const { sessionId } = phase;
    fetch(`/api/kiosk/session?id=${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        stopPolling();
        if (data.status === "COMPLETED") {
          setPhase({ name: "completed", pointsAwarded: data.pointsAwarded ?? 0 });
          router.refresh();
        } else {
          setPhase({ name: "expired" });
        }
      })
      .catch(() => {
        stopPolling();
        setPhase({ name: "expired" });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name, remaining]);

  async function handleStart() {
    setPhase({ name: "creating" });
    try {
      const res = await fetch("/api/kiosk/session", { method: "POST" });
      const data = await res.json();

      if (res.status === 409) {
        setPhase({ name: "error", message: "The kiosk is already in use. Please wait a moment and try again." });
        return;
      }
      if (!res.ok) {
        setPhase({ name: "error", message: data.error ?? "Something went wrong." });
        return;
      }

      setPhase({ name: "active", sessionId: data.sessionId, expiresAt: new Date(data.expiresAt) });
    } catch {
      setPhase({ name: "error", message: "Network error. Please try again." });
    }
  }

  function handleReset() {
    stopPolling();
    setPhase({ name: "idle" });
  }

  return (
    <Card>
      <CardContent className="p-6">
        {phase.name === "idle" && (
          <div className="flex flex-col items-start gap-4">
            <div>
              <p className="font-medium">Ready to recycle?</p>
              <p className="text-sm text-muted-foreground mt-1">
                Press the button, then insert a bottle or can at the kiosk to earn points.
              </p>
            </div>
            <Button onClick={handleStart} className="gap-2">
              <Recycle className="size-4" />
              Start Recycling
            </Button>
          </div>
        )}

        {phase.name === "creating" && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">Starting session…</span>
          </div>
        )}

        {phase.name === "active" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-primary">Session active</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Insert a bottle or can at the kiosk now.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                <Clock className="size-4" />
                {formatTime(remaining)}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Waiting for deposit…</span>
            </div>
          </div>
        )}

        {phase.name === "completed" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="size-6 text-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-reward-foreground">Deposit successful!</p>
                {phase.pointsAwarded > 0 && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    +{phase.pointsAwarded} points added to your balance.
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="gap-2 w-fit">
              <Recycle className="size-4" />
              Recycle Again
            </Button>
          </div>
        )}

        {phase.name === "expired" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Clock className="size-6 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Session expired</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  No deposit was detected in time. Please try again.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="gap-2 w-fit">
              Try Again
            </Button>
          </div>
        )}

        {phase.name === "error" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-6 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Unable to start session</p>
                <p className="text-sm text-muted-foreground mt-0.5">{phase.message}</p>
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="gap-2 w-fit">
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
