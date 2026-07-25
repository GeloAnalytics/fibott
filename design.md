# Design — Fibott

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
modern-minimal

Fibott's admin side is a literal dashboard; the user side is a utility app
(deposit → points → redeem), not a marketing surface. No page here exists to
convert a visitor — every page exists to help someone finish a task.

## Macrostructure family

Fibott has no marketing pages, so the usual marketing/app/content split is
adapted to what the app actually has: an auth family, a user-app family, and
an admin-app family.

- **Auth pages:** No macrostructure from the 21 (they're forms, not landing
  pages). Centered single-column card, deliberately unadorned. Consistent
  across login / register / forgot-password / reset-password / verify-email.
- **User app pages:** **Stat-Led** (04). The points balance is the hero
  number; history, wallet, and the redeem action all support or qualify it.
  Directly matches the use case: make the balance impossible to miss.
- **Admin app pages:** **Bento Grid** (01). Modular blocks of varying size —
  stat cards, tables, config forms — laid out for fast situational awareness,
  not narrative flow.

## Theme

Preserving the existing OKLCH system already built into `src/app/globals.css`
(the "piso-wifi coin machine at night" concept) rather than replacing it —
it's deliberate, on-brief, and the user hasn't asked for a different palette.

- `--color-paper`    oklch(1 0 0) — pure white, no warm/cool tint
- `--color-paper-2`  oklch(0.96 0.01 250) — card/secondary surface, faint cool lean
- `--color-ink`      oklch(0.18 0.014 250) — near-black, faint cool lean
- `--color-ink-2`    oklch(0.48 0.012 250) — muted text (≥4.5:1 on paper)
- `--color-rule`     oklch(0.9 0.008 250) — borders/dividers
- `--color-accent`   oklch(0.5 0.18 250) — signal blue (primary actions, links, active nav, focus)
- `--color-focus`    oklch(0.5 0.18 250) — same as accent
- `--color-reward`   oklch(0.88 0.14 80) / ink `oklch(0.28 0.05 70)` — warm gold,
  reserved exclusively for the points-earned / redeem-success moment. Never used
  for decoration, never used twice on the same screen.

Dark-mode values already exist 1:1 in `globals.css .dark` — preserved as-is.

Style register within modern-minimal: closer to **Cobalt** (cool, instrument-panel,
bordered controls, moderate-not-full-pill radius) than **Coral** (warm, soft pill) —
the existing signal-blue accent and 10px radius already sit there naturally.

## Typography

- Display: Geist Sans, weight 600, normal style
- Body: Geist Sans, weight 400 — same family as display (single-family discipline,
  as modern-minimal requires; this was actually broken until a recent fix —
  `--font-sans` was self-referential and silently fell back to Times New Roman)
- Mono: Geist Mono, weight 400 — voucher codes, device IDs, transaction IDs
- Display tracking: -0.02em
- Type scale anchor: `--text-display` = clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)
  (app-scale, not marketing-scale — Fibott never needs a 6rem hero)

## Spacing

4-point named scale, values live in `tokens.css`. Pages use named tokens
(`var(--space-md)`), never raw values.

## Motion

- Easings: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (only easing needed for an app this size)
- Reveal pattern: none — modern-minimal keeps reveals off; the page is composed,
  not performed. This also matches "utilitarian" tone.
- Micro-motion only: hover/focus/active state transitions (150–200ms), and one
  deliberate moment — the redeem-success voucher-code reveal — gets a slightly
  more noticeable transition since it's the app's one designed payoff.
- Reduced-motion fallback: opacity-only, ≤150ms, everywhere.

## Microinteractions stance

- Silent success for routine actions (profile save, reward-rule edit) — a toast,
  not a modal.
- The redeem action is the one moment that gets more than silent success: the
  voucher code reveal uses the reward color treatment already built.
- Hover delay: 0ms (this is a task-focused app, not a marketing page — no
  affordance-teasing delays). Focus: instant, always.

## CTA voice

- Primary: filled, `--color-accent` background, white text, 10px radius (existing
  `--radius`), no pill.
- Secondary: outlined, `--color-rule` border, ink text.
- Destructive: existing shadcn `destructive` variant (red, low-saturation fill).
- Button copy: verbs, not nouns. "Redeem", "Sign in", "Save changes" — never
  "Submit".

## Per-page allowances

- Auth pages: typography only, no enrichment.
- User/admin app pages: typography only, no enrichment — function carries the
  page. The one exception already built: the reward-gold voucher-code reveal
  on the wallet page is treated as a designed moment, not decoration.

## What pages MUST share

- The "Fibott" / "Fibott Admin" wordmark placement.
- The accent blue and its placement (actions, active states, focus rings only).
- The reward gold, reserved for the points-earned/redeem moment only.
- Geist Sans/Mono, the CTA voice (button shape, radius, padding rhythm).
- The N3 side-rail nav pattern (desktop) + mobile drawer (already built and
  verified working) for both (user) and (admin) route groups.
- No footer inside the authenticated app shell (Linear/Stripe-dashboard
  convention — a footer is marketing chrome an app doesn't need).

## What pages MAY differ on

- Bento Grid block sizing/arrangement per admin page (a table-heavy page like
  Deposit History has different block proportions than the Rewards config page).
- Stat-Led supporting-content shape per user page (history is a table, wallet
  adds the redeem section, leaderboard will be a ranked list once built).

## Exports

### tokens.css
```css
:root {
  --color-paper:      oklch(1 0 0);
  --color-paper-2:    oklch(0.96 0.01 250);
  --color-ink:        oklch(0.18 0.014 250);
  --color-ink-2:      oklch(0.48 0.012 250);
  --color-rule:       oklch(0.9 0.008 250);
  --color-accent:     oklch(0.5 0.18 250);
  --color-accent-ink: oklch(0.98 0 0);
  --color-focus:      oklch(0.5 0.18 250);
  --color-reward:     oklch(0.88 0.14 80);
  --color-reward-ink: oklch(0.28 0.05 70);

  --font-display: "Geist Sans", system-ui, sans-serif;
  --font-body:    "Geist Sans", system-ui, sans-serif;
  --font-mono:    "Geist Mono", ui-monospace, monospace;

  --space-3xs: 0.25rem;  --space-2xs: 0.5rem;  --space-xs: 0.75rem;
  --space-sm:  1rem;     --space-md:  1.5rem;  --space-lg: 2rem;
  --space-xl:  3rem;     --space-2xl: 4.5rem;  --space-3xl: 7rem;

  --text-xs: 0.75rem;  --text-sm: 0.875rem; --text-md: 1.125rem;
  --text-lg: 1.375rem; --text-xl: 1.75rem;  --text-2xl: 2.25rem;
  --text-display: clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem);

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 180ms;
  --radius-card: 10px; --radius-pill: 999px; --radius-input: 10px;
}
```

### Tailwind v4 `@theme`
Already implemented in `src/app/globals.css` `@theme inline` — mirrors the
above via `--color-*` / `--font-*` custom-property references. No duplicate
config needed; this project doesn't use `tailwind.config.*` (Tailwind v4
CSS-first).

### shadcn/ui CSS variables
Already implemented — `src/app/globals.css` `:root`/`.dark` blocks already use
this exact mapping (`--background`, `--foreground`, `--primary`, etc.). This
project's shadcn tokens ARE this design system; nothing to duplicate.
