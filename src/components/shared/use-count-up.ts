"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts from 0 to `target` once on mount, ~500ms, easing out.
 * Respects prefers-reduced-motion (jumps straight to target). A timeout
 * fallback guarantees the target renders even if rAF never delivers a
 * frame (backgrounded/throttled tabs) — the animation is décor, the
 * correct number is not optional.
 */
export function useCountUp(target: number, durationMs = 500): number {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const effectiveDuration = reduceMotion ? 0 : durationMs;

    let frame: number;
    function tick(timestamp: number) {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current!;
      const progress =
        effectiveDuration === 0 ? 1 : Math.min(elapsed / effectiveDuration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    const fallback = setTimeout(() => setValue(target), effectiveDuration + 200);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
    };
  }, [target, durationMs]);

  return value;
}
