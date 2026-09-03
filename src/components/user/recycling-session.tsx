"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Recycle, CheckCircle, Clock, AlertCircle, LogOut, AlertTriangle, Camera, Radio } from "lucide-react";

type Phase =
  | { name: "idle" }
  | { name: "creating" }
  | { name: "active"; sessionId: string; expiresAt: Date }
  | { name: "completed"; pointsAwarded: number }
  | { name: "expired" }
  | { name: "cancelled" }
  | { name: "busy" }
  | { name: "error"; message: string };

// A lazy useState initializer here previously only ran once, while
// expiresAt was still null on the idle render, leaving `remaining` stuck at
// 0 the instant the session became active. Recomputing inside the effect
// (a real subscription to the "expiresAt changed" + "one second elapsed"
// external events) keeps it correct without ever reading Date.now() during
// render, which the React Compiler's purity rule forbids.
function useCountdown(expiresAt: Date | null): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) return;
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
  const [ending, setEnding] = useState(false);
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

  const [kioskConnected, setKioskConnected] = useState(false);
  const [lastDeposit, setLastDeposit] = useState<{
    id: string;
    status: string;
    materialType: string;
    classificationLabel: string;
    pointsAwarded: number;
    createdAt: string;
  } | null>(null);

  // Poll for session completion and real-time status while ACTIVE (every 1 second)
  useEffect(() => {
    if (phase.name !== "active") {
      stopPolling();
      return;
    }
    const { sessionId } = phase;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/kiosk/session?id=${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();

        setKioskConnected(Boolean(data.kioskConnected));
        if (data.lastDeposit) {
          setLastDeposit(data.lastDeposit);
        }

        if (data.status === "COMPLETED") {
          stopPolling();
          setPhase({ name: "completed", pointsAwarded: data.pointsAwarded ?? 0 });
          router.refresh();
        } else if (data.status === "EXPIRED") {
          stopPolling();
          setPhase({ name: "expired" });
        } else if (data.status === "CANCELLED") {
          stopPolling();
          setPhase({ name: "cancelled" });
        }
      } catch (e) {
        console.log("[poll] error", e);
      }
    }, 1000);

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
    setLastDeposit(null);     // clear previous session's deposit banner
    setKioskConnected(false); // reset kiosk handshake indicator
    try {
      const res = await fetch("/api/kiosk/session", { method: "POST" });
      const data = await res.json();

      if (res.status === 409) {
        setPhase({ name: "busy" });
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

  async function handleEndSession() {
    if (phase.name !== "active") return;
    setEnding(true);
    try {
      const res = await fetch(`/api/kiosk/session?id=${phase.sessionId}`, { method: "DELETE" });
      stopPolling();
      if (res.ok) {
        setPhase({ name: "cancelled" });
      } else {
        // If end fails, just go back to idle
        setPhase({ name: "idle" });
      }
    } catch {
      stopPolling();
      setPhase({ name: "idle" });
    } finally {
      setEnding(false);
    }
  }

  function handleReset() {
    stopPolling();
    setPhase({ name: "idle" });
  }

  // Countdown urgency colour
  const isUrgent = phase.name === "active" && remaining <= 15;

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
            <Button onClick={handleStart} className="w-full gap-2 sm:w-fit">
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
            {/* Header with countdown and kiosk indicator */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">Session Active</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    kioskConnected
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 animate-pulse"
                  }`}>
                    <Radio className="size-3" />
                    {kioskConnected ? "Kiosk Ready" : "Connecting Kiosk..."}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Place bottle or can in front of kiosk camera lens to scan & deposit
                </p>
              </div>
              <div
                className={`flex items-center gap-1.5 text-sm tabular-nums font-mono transition-colors ${
                  isUrgent ? "text-destructive font-semibold" : "text-muted-foreground"
                }`}
              >
                <Clock className={`size-4 ${isUrgent ? "animate-pulse" : ""}`} />
                {formatTime(remaining)}
              </div>
            </div>

            {/* Real-Time Live Status Cards */}
            {lastDeposit && lastDeposit.status === "REJECTED" ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-900 dark:text-amber-200 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0" />
                  Item Rejected / Unrecognized
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Detected label: <span className="font-mono font-bold">"{lastDeposit.classificationLabel}"</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  💡 Tip: Hold a plastic bottle or aluminum can directly facing the camera lens and hold steady for 1 second.
                </p>
              </div>
            ) : lastDeposit && lastDeposit.status === "ACCEPTED" ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-900 dark:text-emerald-200">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <CheckCircle className="size-4 text-emerald-500 shrink-0" />
                  Deposit Accepted! (+{lastDeposit.pointsAwarded} pts)
                </div>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                  Gate opening... You can deposit another item now or end session when done.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3.5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Camera className="size-4 text-primary animate-pulse" />
                  <span>Kiosk camera active & scanning chute area…</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground mt-1">
                  <div className={`p-2 rounded border text-center font-medium ${kioskConnected ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" : "bg-muted"}`}>
                    1. Kiosk Ready
                  </div>
                  <div className="p-2 rounded border bg-muted text-center font-medium">
                    2. Position Item
                  </div>
                  <div className="p-2 rounded border bg-muted text-center font-medium">
                    3. Auto Scan & Gate
                  </div>
                </div>
              </div>
            )}

            {/* End Session button — user voluntarily ends the session */}
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Done depositing? End session to free up kiosk.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleEndSession}
                disabled={ending}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                {ending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LogOut className="size-3.5" />
                )}
                {ending ? "Ending…" : "End Session"}
              </Button>
            </div>
          </div>
        )}

        {phase.name === "completed" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="size-6 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-foreground">Deposit Successful!</p>
                {phase.pointsAwarded > 0 && (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                    +{phase.pointsAwarded} points added to your account balance!
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Kiosk is ready for another item. Start another deposit or redeem your points below.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleStart} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Recycle className="size-4" />
                Recycle Another Item
              </Button>
              <Button variant="outline" onClick={() => router.push("/dashboard/wallet")}>
                View Wallet & Vouchers →
              </Button>
            </div>
          </div>
        )}

        {phase.name === "cancelled" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="size-6 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Session ended</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Your recycling session has been closed. Start a new one anytime.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="gap-2 w-fit">
              <Recycle className="size-4" />
              Start New Session
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
                  No deposit was detected within 1 minute. Please try again.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="gap-2 w-fit">
              Try Again
            </Button>
          </div>
        )}

        {phase.name === "busy" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Clock className="size-6 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">System currently in use</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Another user is currently recycling. Please wait a moment, then try again.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="w-full gap-2 sm:w-fit">
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
