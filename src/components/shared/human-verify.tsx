"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { CheckSquare2, X, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─────────────────────────── challenge data ─────────────────────────── */

type Picture = {
  src: string;
  alt: string;
  kind: string;
  target?: boolean;
  [key: string]: unknown;
};

const COLORS: Picture[] = [
  { src: "/captcha/Color/blue.jpg",   alt: "Blue color",   kind: "color", name: "blue"   },
  { src: "/captcha/Color/Green.png",  alt: "Green color",  kind: "color", name: "green"  },
  { src: "/captcha/Color/orange.png", alt: "Orange color", kind: "color", name: "orange" },
  { src: "/captcha/Color/red.jfif",   alt: "Red color",    kind: "color", name: "red"    },
];

const DICE: Picture[] = [
  { src: "/captcha/Dice/Dice more.jpg",             alt: "Colorful dice",       kind: "dice"              },
  { src: "/captcha/Dice/Dice.jfif",                 alt: "Dice variety",        kind: "dice"              },
  { src: "/captcha/Dice/purple dice.jfif",          alt: "Purple dice",         kind: "dice", key: "purple" },
  { src: "/captcha/Dice/random sort of dice.jpg",   alt: "Tray of dice",        kind: "dice"              },
];

const DOGS: Picture[] = [
  { src: "/captcha/Dog/black dog.jpg",            alt: "Black dog 1", kind: "dog", black: true  },
  { src: "/captcha/Dog/black dog.webp",           alt: "Black dog 2", kind: "dog", black: true  },
  { src: "/captcha/Dog/black dog2.jpg",           alt: "Black dog 3", kind: "dog", black: true  },
  { src: "/captcha/Dog/white-dogs-westie.avif",   alt: "White dog",   kind: "dog", black: false },
];

const FLAGS: Picture[] = [
  { src: "/captcha/Flag/Flag_of_the_Philippines.svg.webp",                              alt: "Flag of the Philippines",  kind: "flag", name: "Philippines"  },
  { src: "/captcha/Flag/Flag_of_the_People's_Republic_of_China.svg.webp",               alt: "Flag of China",            kind: "flag", name: "China"         },
  { src: "/captcha/Flag/Flag_of_the_United_States_(DDD-F-416E_specifications).svg.webp",alt: "Flag of the United States",kind: "flag", name: "United States" },
  { src: "/captcha/Flag/Flag-South-Korea.webp",                                          alt: "Flag of South Korea",      kind: "flag", name: "South Korea"   },
];

const POOL: Picture[] = [...COLORS, ...DICE, ...DOGS, ...FLAGS];

type Task = {
  prompt: string;
  matches: (p: Picture) => boolean;
};

const TASKS: Task[] = [
  { prompt: "Select the purple dice",       matches: (p) => p.kind === "dice" && p.key === "purple"  },
  { prompt: "Select all the black dogs",    matches: (p) => p.kind === "dog"  && !!p.black           },
  { prompt: "Select the blue color",        matches: (p) => p.kind === "color" && p.name === "blue"  },
  { prompt: "Select the green color",       matches: (p) => p.kind === "color" && p.name === "green" },
  { prompt: "Select the red color",         matches: (p) => p.kind === "color" && p.name === "red"   },
  { prompt: "Select the orange color",      matches: (p) => p.kind === "color" && p.name === "orange"},
  { prompt: "Select the flag of the Philippines",   matches: (p) => p.kind === "flag" && p.name === "Philippines"  },
  { prompt: "Select the flag of China",             matches: (p) => p.kind === "flag" && p.name === "China"         },
  { prompt: "Select the flag of the United States", matches: (p) => p.kind === "flag" && p.name === "United States" },
  { prompt: "Select the flag of South Korea",       matches: (p) => p.kind === "flag" && p.name === "South Korea"   },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

function buildChallenge() {
  const task = TASKS[Math.floor(Math.random() * TASKS.length)];
  const targets = POOL.filter(task.matches);
  const distractors = pickRandom(POOL.filter((p) => !task.matches(p)), 4 - targets.length);
  const pictures = shuffle([...targets, ...distractors]).map((p) => ({
    ...p,
    target: task.matches(p),
  }));
  return { prompt: task.prompt, pictures, targetCount: targets.length };
}

/* ─────────────────────────── component ─────────────────────────── */

interface HumanVerifyProps {
  /** Called once when the user successfully completes the challenge */
  onVerified: () => void;
}

export function HumanVerify({ onVerified }: HumanVerifyProps) {
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const [challenge, setChallenge] = useState(() => buildChallenge());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [statusMsg, setStatusMsg] = useState("");

  const resetChallenge = useCallback(() => {
    setChallenge(buildChallenge());
    setSelected(new Set());
    setStatusMsg("");
  }, []);

  function openModal() {
    if (verified) return;
    resetChallenge();
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  function toggle(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
    setStatusMsg("");
  }

  function verify() {
    if (selected.size === 0) {
      setStatusMsg("Please select at least one picture.");
      return;
    }
    const targets = new Set(
      challenge.pictures.map((p, i) => (p.target ? i : null)).filter((x): x is number => x !== null)
    );
    const correct =
      selected.size === targets.size && [...targets].every((i) => selected.has(i));

    if (correct) {
      setVerified(true);
      setOpen(false);
      onVerified();
    } else {
      setStatusMsg("That doesn't match. Try again.");
      setSelected(new Set());
      setTimeout(resetChallenge, 800);
    }
  }

  return (
    <>
      {/* ── Checkbox row ── */}
      <button
        type="button"
        id="human-verify-trigger"
        onClick={openModal}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
          verified
            ? "border-green-500/40 bg-green-50 dark:bg-green-950/30"
            : "border-border hover:border-primary/40 hover:bg-muted/50"
        )}
        aria-label={verified ? "Verification complete" : "Click to verify you are human"}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
            verified ? "border-green-500 bg-green-500 text-white" : "border-muted-foreground/50"
          )}
          aria-hidden="true"
        >
          {verified && <CheckSquare2 className="size-3.5" />}
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium leading-none">
            {verified ? "Verified — you're human!" : "I'm not a robot"}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {verified ? "Human check complete." : "Complete a quick picture check to continue"}
          </span>
        </span>
        {verified && <ShieldCheck className="size-4 text-green-500 shrink-0" />}
      </button>

      {/* ── Modal backdrop ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="captcha-title"
        >
          <div className="relative w-full max-w-sm rounded-2xl border bg-card p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Close */}
            <button
              type="button"
              onClick={closeModal}
              className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>

            {/* Header */}
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
              Human Check
            </p>
            <h2 id="captcha-title" className="mt-1 text-xl font-semibold tracking-tight">
              Quick verification
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {challenge.targetCount > 1
                ? "Select all pictures that match."
                : "Select the picture that matches."}
            </p>

            {/* Challenge box */}
            <div className="mt-4 rounded-xl border bg-muted/30 p-3">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-base" aria-hidden="true">
                  ▧
                </span>
                <div>
                  <p className="text-sm font-semibold">{challenge.prompt}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {challenge.targetCount > 1 ? "Tap each matching picture" : "Tap the matching picture"}
                  </p>
                </div>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-2 gap-2">
                {challenge.pictures.map((pic, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggle(idx)}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-xl border-2 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      selected.has(idx)
                        ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.15)]"
                        : "border-transparent"
                    )}
                    aria-pressed={selected.has(idx)}
                    aria-label={pic.alt}
                  >
                    <Image
                      src={pic.src}
                      alt={pic.alt}
                      fill
                      sizes="(max-width: 400px) 50vw, 160px"
                      className={cn(
                        "object-cover",
                        pic.kind === "flag" && "object-contain bg-white"
                      )}
                    />
                    {selected.has(idx) && (
                      <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            {statusMsg && (
              <p className="mt-2 text-center text-xs text-destructive" role="status">
                {statusMsg}
              </p>
            )}

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              <Button type="button" onClick={verify} className="flex-1" size="sm">
                Verify
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetChallenge}
                className="w-10 px-0"
                aria-label="New pictures"
                title="New pictures"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
