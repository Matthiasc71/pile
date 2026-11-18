# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(PWA installed on the owner's iPhone home screen, iOS 16.4+; also opened on a computer browser. Dark mode only, French only.)

## Stack

Vite + TypeScript + Preact, hand-made SVG charts (no chart library), served as static assets by the same Cloudflare Worker that exposes `/api/*`. Decided in the brief (`docs/plan.md`).

## Users

One person: the owner. Confirmed: they open Pile mostly **on an alert** — a push notification about a buy, a sell, or a safety problem — and want, in seconds, to see what happened, why, and whether anything needs them (pause, cut everything).

## Product Purpose

Pile is a personal, educational test bench. Claude day-trades on its own, without asking, on a dedicated **Alpaca paper account** (fictitious money) that started at **50 €** (55.00 $ at the ECB rate of 0.91 on 2026-11-17, day 0). The app shows, live:

- the money in euros at the day's ECB rate, against the fixed 50 € line;
- the S&P 500 (the same 50 € left in SPY) and the "ghost" strategy (the skill used raw, like everyone else);
- every buy and sell, on the curve and in the history, with Claude's reason;
- a pause button and a hold-to-cut-everything control.

Success: the owner can tell at a glance whether the bot beats doing nothing and the crowd, and trusts what they see.

## Positioning

An honest instrument, not a trading app. It compares itself against doing nothing (S&P) and against the crowd using the same skill (ghost), shows slippage, and never promises winning trades. The name comes from the skill's own verdict on its flagship example: "close to a coin flip" (pile ou face).

## Operating Context

- Opened from a push notification, on a phone, often outside, for a few seconds.
- The New York session runs 15:30–22:00 Paris time; Claude passes at 15:15, 15:47, 18:00, 22:15 Paris (computed from New York, never hard-coded).
- Between passes only the watcher acts, executing plans already validated.
- iOS home-screen PWAs have storage separate from Safari: pairing happens inside the installed app.

## Capabilities and Constraints

- Paper only, forever; the watcher refuses any account that is not the dedicated one.
- Terminology (French): toi, S&P, fantôme, achat, vente, objectif, stop, clôture, glissement, indice de foule, passage, veilleur, pause, tout couper.
- Data during the session refreshes every 10 s in the foreground, every 5 min otherwise; offline shows the last state with its time.
- Milestone 3 has no trades yet: history, positions and the crowd index must have honest empty states. Notifications arrive at milestone 7.

## Brand Commitments

- Name: **PILE**, always with the **PAPER** mention visible.
- Visual direction chosen by the owner and binding: "Oscilloscope", logo in Tilt Prism. References: `design/maquettes/Oscillo-Prism-Lancement.html`, `design/maquettes/Oscillo-Prism-Tableau.html`, and section 9 of the brief (tokens, fonts, motion, rules). Priority: the brief > Impeccable > UI UX Pro Max.
- Voice: plain French, short, factual. No hype, no emoji.

## Evidence on Hand

Real data from the live watcher (equity points, SPY points, ECB rates, day 0). No trades exist yet. Never fabricate trades, results, testimonials or performance claims.

## Product Principles

1. Honesty over comfort: show the comparison that could embarrass the bot.
2. A glance must be enough: the number, the curve, the last event.
3. Safety controls are always one tap (pause) or one deliberate hold (cut everything) away.
4. Every word earns its place.

## Accessibility & Inclusion

Text contrast ≥ 4.5:1; colors that must be told apart also differ in lightness; touch targets ≥ 48 px; nothing below 12 px; all motion off under `prefers-reduced-motion`.
