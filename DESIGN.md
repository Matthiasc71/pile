# Design — Pile, direction « Oscilloscope »

Source of truth, in order: the brief (`docs/plan.md`, original spec section 9) > Impeccable > UI UX Pro Max. Visual reference: `design/maquettes/`. This file records the system as shipped in `app/src/styles.css`.

## World

A measuring instrument, not a trading app: a phosphor oscilloscope on a near-black screen. The money is a trace, the 50 € start is the trigger level, the S&P and the ghost are other channels. Dark only (used at a glance, often at night, from a notification).

## Tokens

| Role | Value | Use |
|---|---|---|
| Background | `#050806`, radial vignette `#0B140E` → `#050806` | every screen |
| Phosphor | `#78F29C` | channel 1 « toi », values, gains, primary controls |
| Phosphor bright | `#EAFFF0` | 200 ms flash when a value changes |
| Text | `#CFF7DA` | primary text |
| Text 2 | `#86AE93` | labels, secondary text (≥ 4.5:1 on the background) |
| Amber | `#F2C46D` | channel 2 « S&P », warnings |
| Loss | `#F2876E` | losses, « Tout couper » |
| Graticule | phosphor 10 %; centre axes and minor ticks 22 %; frame 28 % | the scope |
| Rules | phosphor 14 % | row separators |
| Halo | SVG `feGaussianBlur` 1.8 merged with the trace; `text-shadow 0 0 10px rgba(120,242,156,.45)` on the main figure only | traces, main figure, the name |

Channels differ in lightness as well as hue: phosphor (light) solid 1.6 px with halo; amber solid 1.2 px with halo; ghost phosphor 50 % in 3/3 dashes.

## Type

- **Martian Mono** (variable, self-hosted subset, OFL): all UI and numbers, `tabular-nums`. Sizes 12 / 13 / 14 / 40 px only; nothing under 12 px. Row sub-lines use width 87.5 %.
- **Tilt Prism** (variable XROT/YROT, self-hosted subset of « PILEF », OFL): only the name PILE and the coin's P and F.

## Layout

32 px side gutters (plus safe areas), 8 px rhythm, 64 px rows, 48 px touch targets, max width 560 px. Screens: launch, dashboard, history, system, pairing. No cards, no modals.

## Components

- **Scope** (`app/src/scope/`): 10 × 6 graticule, nice €/div vertical scale always holding the 50 € level, monotone curve (never overshoots a real value), ▲ buy / ▽ sell, beam spot on the last value, touch cursor whose readout replaces the legend.
- **Range selector** 1J · 1S · 1M · Tout: text buttons, the active one underlined in phosphor.
- **Rows**: title 14 px / sub 12 px / value 14 px, rule on top.
- **Hold button** « Tout couper »: 1.5 s hold, ring fills (rAF-driven, so it still gives feedback with reduced motion). No dialog.
- **Footer**: « CLAUDE hh:mm » and the crowd index in 5 bars; opens Système.

## Motion

Name tilt 6 s; coin 3.6 s with two afterimages (0.08 s / 0.16 s, opacity 0.38 / 0.18); trace draws in 600 ms once; 200 ms flash on change; live dot pulse 1.8 s; screens fade in 320 ms. All off under `prefers-reduced-motion` (static coin, no afterimages).

## Copy

Plain French, short, factual. Empty states say what will appear and why it may stay empty (days without a trade are normal). Never a promise of gains.
