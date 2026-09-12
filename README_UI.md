# RenewCast — UI Specification

**Companion to [`README_PROJECT.md`](README_PROJECT.md).** That document is the build
contract for the system. This one is the build contract for the interface: every token,
every component, every state, every word.

Nothing in the colour system below is eyeballed. Every value was measured against
**RenewCast's own surfaces**, and the measured ratio is printed beside it. Where a value
sits below a threshold, the required mitigation is stated as a rule, not a suggestion.
`frontend/scripts/check-palette.ts` re-measures every one of those figures against
`globals.css` on demand — run it with `npm run check:palette`.

---

## Table of contents

1. [What this interface is](#1-what-this-interface-is)
2. [The one decision that defines it](#2-the-one-decision-that-defines-it)
3. [Design plan, and the critique that revised it](#3-design-plan-and-the-critique-that-revised-it)
4. [Anti-tell audit](#4-anti-tell-audit)
5. [Colour system — measured](#5-colour-system--measured)
6. [Typography](#6-typography)
7. [Layout, spacing, radius, elevation](#7-layout-spacing-radius-elevation)
8. [Domain vocabulary](#8-domain-vocabulary)
9. [Global chrome](#9-global-chrome)
10. [Component inventory](#10-component-inventory)
11. [Chart-by-chart decisions](#11-chart-by-chart-decisions)
12. [Forms and inputs](#12-forms-and-inputs)
13. [States and copy deck](#13-states-and-copy-deck)
14. [Interaction](#14-interaction)
15. [Motion](#15-motion)
16. [Accessibility floor](#16-accessibility-floor)
17. [Page layouts](#17-page-layouts)
18. [Frontend file structure](#18-frontend-file-structure)
19. [Build order and definition of done](#19-build-order-and-definition-of-done)
20. [Decisions the team still owes](#20-decisions-the-team-still-owes)

---

## 1. What this interface is

**Subject.** Renewable generation forecasting and dispatch decision-making on the Indian
electricity grid.

**Audience.** Operators at Load Despatch Centres and Renewable Energy Management Centres,
utility schedulers, plant operators, energy traders. People who already know what a time
block is, who are reading this at 06:00, and who will be penalised if they get it wrong.

**Primary job.** Answer one question fast: *what will output be, where will it miss the
schedule, and what do I do about it while I still can?*

**What it is not.** It is not a monitoring dashboard. Monitoring tells you what happened.
This tells you what to do before it happens, and how much the doing is worth. Every design
decision below serves that distinction.

---

## 2. The one decision that defines it

The Indian grid does not schedule in hours. It schedules in **96 time blocks of 15 minutes
each, with the despatch day beginning at 00:00.** Declarations of capability, generation
schedules, drawal schedules and deviation settlement are all expressed per time block.

**So the 96-block day is the spine of the entire interface.**

Every time-series surface shares one identical x-axis: block 1 → block 96. Panels stack as
horizontal **bands** bound to that same scale, so block 49 sits at the same pixel column in
every band. The operator reads one vertical column of the day and gets, top to bottom:
expected output → deviation from schedule → risk → recommended action → battery state.

That vertical alignment *is* the product. It is not decoration and it must not be traded
for a grid of independent cards on independent axes.

### The two markers that make it an operations tool

**`now`** — the current block, labelled `Block 43 · 10:30–10:45 IST`.

**`revision horizon`** — at `now + 6 blocks`. Under Indian grid rules a **voluntary schedule
revision takes effect only from the 6th time block** after issue (an RLDC-initiated revision
from the 4th). The next block an operator can actually influence is therefore ~90 minutes
out — not now.

Everything left of the revision horizon renders at **55% opacity** with the note
*"Locked — revisions take effect from block 49."*

This is the single most important device in the design. It converts an abstract claim
("forecasting is useful") into a visible, regulated deadline: a forecast is worth something
only if it arrives before the gate closes. No generic dashboard would invent this, because
it only exists if you understand how the grid actually settles.

### Also on the spine

| Element | Encoding | Why it is there |
|---|---|---|
| Daylight region | flat 3% ink wash, sunrise→sunset, **solar sites only** | the diurnal arc is the physical driver; flat, never a gradient |
| Evacuation limit | horizontal reference line | output above it *must* be curtailed — a hard constraint, not advice |
| Declared capability / schedule | second series line | the thing deviation is measured against |
| P10–P90 band | 10% wash of slot-1 blue | uncertainty, widening with lead time |

---

## 3. Design plan, and the critique that revised it

The method requires two passes: plan, then critique the plan against the brief before
building. Both are recorded here, because the revisions are the reason the design is not
generic.

### Pass one — what I first reached for

| Axis | First instinct |
|---|---|
| Layout | Responsive card grid: stat tiles across the top, charts in a 2-column grid |
| Theme | Dark-primary — "it's a control room" |
| Hero | `Total generation · 1,842 MW` |
| Type | Inter |
| Motion | Fade-and-slide-up on each section as it scrolls in |
| Series colour | yellow = solar, aqua = wind, because it's intuitive |

### Pass two — the critique, and what changed

**Layout → banded spine.** The card grid is the SaaS-card kit (tell #4), and worse, it
actively destroys the one comparison that matters. Cards on independent axes make it
impossible to ask "what is happening at block 49?" — you have to re-find the moment in
every chart. **Changed to** horizontal bands on a shared x-scale with a fixed label gutter,
so a moment in time is a readable vertical column.

**Theme → light-primary.** "Control room means dark" led me straight to tell #2, which is
also what every AI-generated energy dashboard currently looks like. It also fails on
contact with reality: dark UIs wash out on venue projectors and in sunlight. **Changed to**
light-primary, with dark as a genuine operations theme rather than the default. Both modes
are fully specified and both were validated separately.

**Hero → the deviation at the revision horizon.** Big-number-plus-small-label-plus-
supporting-stats is the named default treatment. "Total generation" is also just
monitoring — it answers nothing. **Changed to** the signed deviation at the first block the
operator can still act on, e.g. `−214 MW`, labelled *"Deficit vs schedule at block 49,
12:00."* That number cannot exist without this product's thesis, which is exactly what a
hero figure should be.

**Type → IBM Plex Sans.** Inter is the default for every dashboard built this decade.
**Changed to** IBM Plex Sans for reasons that are functional, not stylistic: it was drawn
for engineering and product contexts, it has true tabular figures, and it disambiguates
`1 l I` and `0 O` — which matters when a misread digit is a dispatch error. **IBM Plex Sans
Condensed** handles axis ticks on the 96-block spine, where 96 positions genuinely demand
narrower glyphs. One family, two widths, one functional reason each.

**Motion → one orchestrated moment.** Per-section entrance animations are explicitly the
generic default. **Changed to** exactly one: on first load the P10–P90 band draws left to
right across the 96 blocks, ~600 ms, ease-out. It earns its place because the band
*visibly widens with lead time* — the motion encodes the core insight that hour 72 is less
certain than hour 6. Nothing else in the product animates unless a person acted.

**Series colour → technology by facet, not by hue.** "Yellow = solar" is intuitive but it
forces yellow (measured 2.11:1 on the light surface) into a primary role, and it spends two
categorical slots on information that position and a direct label already carry. It also
collides with the all-pairs cap (§5). **Changed to** slot-1 blue meaning simply *"the
forecast"*, with technology carried by facet and label.

### Principles

1. **One moment, one column.** Anything time-indexed aligns to the block spine. If it
   cannot align, it is not a band — it is a table or a tile.
2. **The gate is the point.** The revision horizon appears on every time-series surface.
   Value decays with lead time and the UI says so continuously.
3. **Every number is traceable.** No figure appears without a path back to what produced
   it — a table view, a source chip, or a model card.
4. **Constraints are drawn, not described.** Evacuation limits, minimum technical load and
   battery capacity are reference lines and bounded tracks, not footnotes.
5. **Boldness is spent once**, on the spine and its gate. Everything around it is quiet.

---

## 4. Anti-tell audit

The five clusters that currently mark a design as machine-generated, and what RenewCast
does instead. Each replacement is a measured or functional decision, not a preference.

| # | The tell | What RenewCast does instead |
|---|---|---|
| 1 | Warm cream (~`#F4F1EA`) + high-contrast serif display + terracotta (~`#D97757`) accent | Cool porcelain `#F1F3F4`. One sans family, no serif anywhere. Accent is validated slot-1 blue. |
| 2 | Near-black background + one bright acid-green/vermilion accent | Light-primary by default. Dark mode is cool graphite `#151D20`, not `#0B0B0B`/`#111`, and its accent is the same validated blue — no acid. |
| 3 | Broadsheet pastiche: decorative hairline rules, zero radius everywhere, newspaper columns | Hairlines appear **only where they carry data** — chart gridlines and table row separators. Zero decorative dividers. Radius varies by role (§7). |
| 4 | Identical rounded cards, one radius on everything, the same `rgba(0,0,0,.1)` shadow under each, gradient washes | **Zero box-shadow on static content.** Panels separate by a *measured* 1.08:1 surface lift plus a 10% hairline ring. Shadow exists only on transient overlays. No gradients anywhere. |
| 5 | Template chrome: ALL-CAPS eyebrows, middot meta strings, `WORD — fragment` labels, tinted near-black, monospace for small data labels, `→` on buttons | Sentence case throughout. No eyebrows, no interpunct strings, no spaced-em-dash labels. Buttons name the action with no arrow. |

### The one careful exception, stated precisely

Tell #5 includes *"a monospace face for small data labels."* RenewCast **does** use
tabular figures in numeric columns — that is a data-alignment requirement, not a style
choice. The distinction is exact and must be respected in code:

- ✅ `font-variant-numeric: tabular-nums` applied to **IBM Plex Sans** in table cells,
  axis ticks, and the readout column.
- ❌ Switching to **IBM Plex Mono** (or any monospace face) for small data labels.

Tabular *figures* in the sans is correct. A monospace *typeface* is the tell.

Equally: large standalone numbers — the hero figure, stat-tile values — use the font's
**default proportional figures**. `tabular-nums` gives every digit the width of a `0`,
which makes a number like `121` look loose at display size.

---

## 5. Colour system — measured

Four colour jobs, kept strictly separate: **categorical** (unordered series),
**sequential/ordinal** (magnitude), **diverging** (signed deviation), **status** (reserved).
A colour never does two jobs.

### 5.1 Surfaces and ink

Measured against the surface each token actually renders on.

**Light** — page plane `#F1F3F4`, chart surface `#FBFCFC`

| Role | Hex | Contrast vs surface |
|---|---|---|
| Primary ink | `#10181A` | **17.50:1** |
| Secondary ink | `#4C5A5E` | **6.97:1** |
| Muted / axis labels | `#6E7C80` | **4.21:1** |
| Gridline (hairline) | `#E3E8E9` | 1.20:1 *(recessive by design)* |
| Baseline / axis | `#C6CED0` | 1.55:1 |
| Hairline ring | `rgba(16,24,26,0.10)` | — |

**Dark** — page plane `#0B1113`, chart surface `#151D20`

| Role | Hex | Contrast vs surface |
|---|---|---|
| Primary ink | `#F3F7F8` | **15.85:1** |
| Secondary ink | `#A9B9BD` | **8.43:1** |
| Muted / axis labels | `#839297` | **5.31:1** |
| Gridline (hairline) | `#263135` | 1.28:1 |
| Baseline / axis | `#354247` | 1.65:1 |
| Hairline ring | `rgba(243,247,248,0.10)` | — |

Two consequences worth stating:

- **Muted axis text measures 4.21:1 light / 5.31:1 dark.** Dark clears the 4.5:1 small-text
  bar; light sits just under it — better than the reference palette's 3.50:1, but not a pass.
  The mitigation is scope: `--ink-muted` is confined to axis ticks, block indices, panel
  metadata and footnotes — never to a sentence a decision rests on. Anything an operator
  acts on is `--ink-secondary` at 6.97:1 or `--ink-primary` at 17.50:1. This is a measured
  exception, not an oversight, and `npm run check:palette` asserts the boundary.
- **Surface-to-page lift measures 1.08:1 light / 1.11:1 dark.** That is the *entire*
  mechanism for separating a panel from the page. It is why the design can ban box-shadows
  on static content without panels dissolving — the separation is measured, not absent.

### 5.2 Categorical series — fixed order, never reordered

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |

Validator result on RenewCast surfaces, adjacent pairs (lines, bars, stacks):

```
LIGHT  #FBFCFC   lightness band PASS · chroma floor PASS
                 CVD separation PASS  worst adjacent yellow↔aqua ΔE 9.1 (protan)
                 normal-vision  PASS  worst adjacent ΔE 22.9
                 contrast       WARN  aqua 2.74 · yellow 2.11  → relief required

DARK   #151D20   lightness band PASS · chroma floor PASS
                 CVD separation PASS  worst adjacent yellow↔aqua ΔE 8.4 (protan)
                 normal-vision  PASS  worst adjacent ΔE 19.8
                 contrast       PASS  all four ≥ 3:1
```

> **Relief rule — binding.** Light-mode aqua (2.74:1) and yellow (2.11:1) sit below 3:1.
> Wherever they appear, visible **direct labels or the table view must ship**. This is not
> a nice-to-have; it is the condition under which those hues are permitted at all.

> **All-pairs cap — binding.** Any form that puts every series in mutual comparison
> (scatter, bubble, map, small multiples) is limited to the **first three slots**.
> Measured all-pairs: CVD ΔE 9.2 light / 9.4 dark, normal-vision 24.0 / 20.9 — clear.
> Adding slot 4 puts yellow beside orange and fails.
>
> **Direct consequence:** the Fleet view has five sites but may not colour by site. It
> colours by **technology** (solar, wind) and distinguishes sites by position and direct
> label. The constraint produced the better design.

The slot **ordering** is the colour-blind-safety mechanism, not cosmetics. Do not reorder.

### 5.3 Sequential and ordinal — one blue ramp

| step | hex | step | hex | step | hex | step | hex |
|---|---|---|---|---|---|---|---|
| 100 | `#cde2fb` | 250 | `#86b6ef` | 400 | `#3987e5` | 550 | `#1c5cab` |
| 150 | `#b7d3f6` | 300 | `#6da7ec` | 450 | `#2a78d6` | 600 | `#184f95` |
| 200 | `#9ec5f4` | 350 | `#5598e7` | 500 | `#256abf` | 650 | `#104281` |
| | | | | | | 700 | `#0d366b` |

Full range for **sequential** encoding (continuous magnitude — the day × block capacity-factor
heatmap), where the lightest step means "near zero" and may recede toward the surface.

For **ordinal** encoding (discrete ordered tiers), the step nearest the surface must still
clear 2:1. Measured on RenewCast surfaces:

- Light: start no lighter than **`#86b6ef` (2.05:1)**
- Dark: go no darker than **`#184f95` (2.11:1)**

Both validated: lightness monotone PASS, adjacent ΔL ≥ 0.06 PASS, single hue (3° spread) PASS.

### 5.4 Diverging — deviation from schedule

Both directions cost money. Over-generation forces curtailment and lost revenue;
under-generation forces expensive backup. So the scale is **signed around zero, neutral at
the centre**, with no implied "good" side.

| Arm | Meaning | Hue |
|---|---|---|
| Cool | Surplus — output above schedule | blue ramp |
| Neutral | At schedule | `#E9EDEE` light (1.15:1) · `#2E393C` dark (1.44:1) |
| Warm | Deficit — output below schedule | red ramp |

Equal step count per arm. The midpoints are cool neutrals matched to RenewCast's surfaces
and measured into the same near-surface band as the reference (1.12 / 1.48).

Because the deficit arm is red-family and sits near status-critical, deviation marks
**always carry an icon and a text label**. Hue never carries the sign alone.

### 5.5 Status — fixed, never themed, never a data series

| Role | Hex | Light | Dark | Risk label |
|---|---|---|---|---|
| good | `#0ca30c` | 3.26:1 | 5.10:1 | Within band |
| warning | `#fab219` | **1.78:1** | 9.32:1 | Watch (severity 25–49) |
| serious | `#ec835a` | **2.57:1** | 6.48:1 | Action needed (50–74) |
| critical | `#d03b3b` | 4.67:1 | 3.56:1 | Critical (75–100) |

Light-mode `warning` and `serious` are below 3:1 **by design**. The mitigation is mandatory
and absolute:

> **Every status is icon + text label + colour. Colour never carries the meaning alone.**

These four steps are deliberately distinct from the categorical slots so a status colour
never impersonates a series — distinct enough that nothing collides at a glance, though not
enough for hue to carry the distinction unaided. Hence the icon-plus-label rule.

### 5.6 De-emphasis and delta text

| Role | Light | Dark | Notes |
|---|---|---|---|
| De-emphasis (baselines, "Other") | `#A9B3B6` (2.08:1) | `#667579` (3.57:1) | For the emphasis form — model in blue, baselines grey |
| Positive delta text | `#006300` (7.34:1) | `#0ca30c` (5.10:1) | Direction × whether up is good |
| Negative delta text | `#C0392B` (5.29:1) | `#e66767` (5.29:1) | Never the same hex as a series |

### 5.7 Text never wears the data colour

Marks — bars, lines, dots, area fills — carry the series colour. **All labels, values,
legend text and axis text use the ink tokens.** A light categorical hue is illegible as
text on the surface (yellow at 2.11:1 proves it). Series identity comes from a coloured dot
or short line-key placed *beside* the text.

The single exception: a label set *inside* a filled shape (a stacked segment, a heat cell)
picks white or ink by the fill's luminance so it always clears contrast.

### 5.8 Tokens as CSS

Declare dark values under **both** scopes — the media query covers the OS setting, the
`data-theme` scope covers the in-app toggle, and the toggle must win both ways.

```css
.rc-root {
  color-scheme: light;

  --page:            #F1F3F4;
  --surface:         #FBFCFC;
  --ink-primary:     #10181A;
  --ink-secondary:   #4C5A5E;
  --ink-muted:       #6E7C80;
  --gridline:        #E3E8E9;
  --baseline:        #C6CED0;
  --ring:            rgba(16,24,26,0.10);

  --series-1:        #2a78d6;
  --series-2:        #eb6834;
  --series-3:        #1baf7a;
  --series-4:        #eda100;
  --de-emphasis:     #A9B3B6;

  --seq-100:         #cde2fb;
  --seq-250:         #86b6ef;   /* ordinal light-end floor — 2.05:1 */
  --seq-450:         #2a78d6;
  --seq-700:         #0d366b;
  --diverge-mid:     #E9EDEE;

  --delta-pos:       #006300;
  --delta-neg:       #C0392B;

  /* status — fixed, identical in both modes, never themed */
  --status-good:     #0ca30c;
  --status-warning:  #fab219;
  --status-serious:  #ec835a;
  --status-critical: #d03b3b;

  --overlay-shadow:  0 4px 16px rgba(16,24,26,0.14);  /* transient overlays ONLY */
}

@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .rc-root { /* …dark values… */ }
}
:root[data-theme="dark"] .rc-root {
  color-scheme: dark;
  --page:          #0B1113;
  --surface:       #151D20;
  --ink-primary:   #F3F7F8;
  --ink-secondary: #A9B9BD;
  --ink-muted:     #839297;
  --gridline:      #263135;
  --baseline:      #354247;
  --ring:          rgba(243,247,248,0.10);
  --series-1:      #3987e5;
  --series-2:      #d95926;
  --series-3:      #199e70;
  --series-4:      #c98500;
  --de-emphasis:   #667579;
  --seq-250:       #184f95;   /* ordinal dark-end floor — 2.11:1 */
  --diverge-mid:   #2E393C;
  --delta-pos:     #0ca30c;
  --delta-neg:     #e66767;
  --overlay-shadow: 0 4px 16px rgba(0,0,0,0.45);
}
```

Write chart code against **roles**, never raw hex, so a mode swap happens in one place.

---

## 6. Typography

**One family: IBM Plex Sans.** Plus **IBM Plex Sans Condensed** for axis ticks only.
No serif face, no display face, no monospace face — including the hero number, where a
display face reads as off-brand decoration.

Load via `next/font/google` with `display: 'swap'`, subset `latin`, weights 400/500/600.

### Scale — 1.2 ratio, 14px base

A dense operations tool earns a small base. Anything larger wastes the column.

| Token | px / line-height | Role |
|---|---|---|
| `--t-11` | 11 / 16 | Axis ticks, band gutter sub-labels, table units |
| `--t-12` | 12 / 16 | Legend, tooltip series names, help text, chip text |
| `--t-14` | 14 / 20 | **Base.** Body, table cells, form inputs, button labels |
| `--t-17` | 17 / 24 | Band gutter labels, stat-tile values, card titles |
| `--t-20` | 20 / 28 | Page title |
| `--t-24` | 24 / 32 | Section heading (rare) |
| `--t-34` | 34 / 40 | Secondary large figure |
| `--t-48` | 48 / 52 | **Hero figure — exactly one per view** |

Weights: **400** body, **500** emphasis and labels, **600** headings and numeric values.
Never 700+ — at these sizes it reads as shouting, and Plex's 600 already carries.

### Figures — the rule that catches people out

```css
/* Columns that must align vertically */
.rc-table td, .rc-axis-tick, .rc-readout { font-variant-numeric: tabular-nums; }

/* Large standalone values — proportional, the default */
.rc-hero, .rc-stat-value { font-variant-numeric: normal; }
```

### Prose

Left-aligned, **72 characters maximum**. Sentence case everywhere — headings, labels,
buttons, table headers. No ALL-CAPS. No centred body text.

---

## 7. Layout, spacing, radius, elevation

### 7.1 The banded spine

```
┌ label gutter 168px ┬──────────── 96-block spine (fluid) ────────────┬ readout 104px ┐
│ Available ex-bus   │  P50 line · P10–P90 band · schedule line       │       1,842   │
│ MW                 │                                               │          MW   │
├────────────────────┼───────────────────────────────────────────────┼───────────────┤
│ Deviation          │  diverging bars around a zero baseline        │        −214   │
│ vs schedule        │                                               │          MW   │
├────────────────────┼───────────────────────────────────────────────┼───────────────┤
│ Risk               │  ▚▚▚▚ event spans, status-coloured + labelled  │    2 events   │
├────────────────────┼───────────────────────────────────────────────┼───────────────┤
│ Despatch plan      │  ▬▬▬ battery · ▬▬ curtail · ▬ backup lanes     │   ₹1.82 L     │
├────────────────────┼───────────────────────────────────────────────┼───────────────┤
│ Battery SoC        │  bounded track, 0–100%                        │         62%   │
└────────────────────┴───────────────────────────────────────────────┴───────────────┘
   00:00      04:00      08:00      12:00      16:00      20:00      24:00
                              ▲ now              ▲ revision horizon
                         ◄──── locked ────►
```

- **Label gutter 168px, fixed.** Left-aligned. Name on line one, unit on line two in
  `--t-11` muted.
- **Spine, fluid.** The only full-bleed element. Identical x-scale in every band.
- **Readout 104px, fixed.** Right-aligned, `tabular-nums`. Value at the crosshair block, or
  at `now` when the pointer is away.
- Bands are separated by a hairline ring, never a gap — the lattice must read continuous.

**Axis labelling.** 96 ticks cannot be labelled. Label **every 8th block** (every 2 hours),
`00:00 … 22:00`, in Plex Sans Condensed at `--t-11`. Gridlines at the same 12 positions —
**one weight only**, hairline, solid, never dashed. Hour markers at 06:00 / 12:00 / 18:00
get label *weight* emphasis (500), not a second gridline weight.

### 7.2 Shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ RenewCast   [Western Region ▾] [Bhadla Solar ▾] [12 Sep 2026 ▾]              │
│             Block 43 · 10:30–10:45 IST      ECMWF 06Z · ingested 07:42  ◐ ⌘K │
├────┬─────────────────────────────────────────────────────────┬───────────────┤
│ ▣  │  [ filter row — one, left-aligned, scopes everything ]   │               │
│ ⌁  │                                                          │   Copilot     │
│ ⚠  │  page content                                            │   drawer      │
│ ⚙  │                                                          │   (toggle)    │
│ ⊞  │                                                          │               │
│ ◷  │                                                          │               │
└────┴─────────────────────────────────────────────────────────┴───────────────┘
```

Left rail is **narrow, icon + label**, not a wide sidebar — horizontal space belongs to the
spine. Top bar carries control area, site, despatch date, the live block clock, and the
data-freshness badge naming the ingested model run.

### 7.3 Spacing

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Band inner padding 16. Panel padding 16.
Page gutter 24 (16 below 768px).

### 7.4 Radius varies by role

This is a rule with a reason, which is what distinguishes it from the uniform-radius tell:
**radius decreases as an element becomes more data-like.** The lattice is square;
interactive affordances are softly rounded.

| Element | Radius |
|---|---|
| Status pill | `999px` |
| Modal, drawer | `8px` |
| Chart panel, band group | `6px` |
| Button, input, tooltip, chip | `4px` |
| Bar data-end | `4px` — **square at the baseline** |
| Data table, heatmap cell, spine | `0` |

### 7.5 Elevation

> **Zero `box-shadow` on static content.** Separation comes from the measured 1.08:1
> surface lift plus the 10% hairline ring.

Shadow exists only on **transient overlays that must read as floating** — tooltip, popover,
modal, command palette — as the single `--overlay-shadow` token. No gradient washes
anywhere, on anything, ever.

---

## 8. Domain vocabulary

Use the real terms. They cost nothing and they are the difference between a product and a
demo. Note the Indian convention: **"despatch"**, not "dispatch".

**Institutions.** Load Despatch Centre · National Load Despatch Centre (NLDC) · Regional
Load Despatch Centre (RLDC) · State Load Despatch Centre (SLDC) · Renewable Energy
Management Centre (REMC) · control area · CERC · SERC · DISCOM · Grid India.

The five RLDCs — NRLDC (New Delhi), WRLDC (Mumbai), ERLDC (Kolkata), SRLDC (Bengaluru),
NERLDC (Shillong & Guwahati) — populate the control-area selector. Four REMCs are
co-located with the regional centres and their stated mandate is *"generation-scheduling and
generation-forecasting"* — which is, precisely, this product.

**Time and scheduling.** time block (96 per day, 15 minutes, day begins 00:00) · declaration
of capability · requisition · generation schedule · drawal schedule · ex-bus · rated
capacity (MCR) · sent-out capability · schedule revision.

**Settlement.** Availability Based Tariff · Deviation Settlement Mechanism · grid
discipline · 50 Hz.

**Despatch.** merit order · economic despatch · **must-run status** (which solar and wind
hold) · **minimum technical load** — the floor below which a thermal unit cannot be backed
down · spinning reserve · ancillary services.

**Network.** evacuation · transmission congestion · curtailment · open access · ISTS ·
intra-STS · Green Energy Corridor.

**Market.** Day-Ahead Market · Real-Time Market · Term-Ahead Market · Market Clearing
Price · Renewable Energy Certificate.

Currency is formatted Indian-style: `₹1,82,400`, with lakh and crore where natural
(`₹1.82 L`, `₹4.1 Cr`). Times are IST, 24-hour.

> **Verified context worth knowing.** Gujarat, Rajasthan and Tamil Nadu have all seen more
> renewable output than local demand — which is exactly where four of the five registry
> sites sit, and is why curtailment is a first-class action rather than an edge case.
> Thermal minimum technical load is designed at 70–80% of rated capacity, with many Indian
> units now near 55% and the best around 40% — a real feasibility floor for the
> "back down thermal" action.

> **Do not state as fact.** Specific Deviation Settlement penalty slabs for renewables, and
> the duties of a Qualified Coordinating Agency. These were not verified. Refer to deviation
> charges generically and keep every rate configurable and labelled as indicative.

---

## 9. Global chrome

| Component | Spec |
|---|---|
| **App shell** | Left rail (icon + label, 72px) · top bar (56px) · content · optional right drawer (360px) |
| **Block clock** | `Block 43 · 10:30–10:45 IST`. Ticks every 15 min. The product's heartbeat — always visible. |
| **Control-area selector** | Combobox, 5 RLDCs + "All India" |
| **Site selector** | Combobox with technology icon, name, state, capacity |
| **Despatch-date picker** | Preset **rows** (Today, Tomorrow, D+2), selection marked by a 16px bold check, hover a ghost wash, custom range behind a hairline in the footer. Never a bare calendar grid. |
| **Freshness badge** | `ECMWF 06Z · ingested 07:42`. Turns `warning` past 6h, `serious` past 12h — with the icon and label, never colour alone. |
| **Theme toggle** | Light (default) / Dark / System |
| **Command palette** | `⌘K` / `Ctrl+K` — jump to site, jump to block, run an action, open a page |
| **Copilot toggle** | Opens the right drawer; persists across pages |
| **Toast** | Bottom-left, 4s, one line, reuses the action's verb |
| **Skip link** | First tab stop, "Skip to main content" |

---

## 10. Component inventory

### Tier 0 — foundations
Colour role tokens · texture fill (45°/135°, opt-in only) · **chart container** (a `<figure>`
owning responsive sizing, title, caption and the **table-view toggle**) · legend · tooltip ·
axis · data label.

> Any fixed chart height **includes the x-axis band**, so a panel never grows a nested
> vertical scrollbar. Prefer letting the container grow with its content.

### Tier 1 — the core
`BlockSpine` (the shared-axis container every band mounts into) · `ForecastBand` ·
`DeviationBand` · `RiskBand` · `PlanBand` · `SoCBand` · `StatTile` · `Meter` ·
`ActionTable` · `DataTable`.

### Tier 2 — supporting
`Sparkline` · `Heatmap` · `LeadTimeErrorChart` · `ReliabilityChart` · `FleetSmallMultiples` ·
`WeatherDriverStrip` · `ScaleLegend` · `EmptyState` · `StatusPill` · `SourceChip` ·
`CopilotDrawer` · `CommandPalette`.

### Mark specs — fixed across every chart

| Mark | Spec |
|---|---|
| Bar / column | **≤ 24px thick** — cap it, let the band's leftover be air. 4px rounded data-end, square at baseline. Grows from a single baseline. |
| Line | **2px**, round join and cap |
| Marker / end-dot | **≥ 8px** (r ≥ 4), filled with the series colour |
| Area fill | series hue at **~10% opacity** — a wash, never a saturated block |
| Gridline / axis | one step off surface, **hairline 1px, solid**, never dashed, recessive |

### The two spacers

- **Surface gap.** A **2px gap in the surface colour** separates touching marks — every
  stacked segment, every adjacent bar, one consistent width.
- **Surface ring.** Dots and end-markers carry a **2px ring in the surface colour** so they
  stay legible where they cross a line. The ring is part of the hit target.

> **Never draw a border around a mark to separate it.** The gap and the ring are the
> mechanism; a stroke adds data-weight ink that is not data.

### Legend and label rules

- **Two or more series → a legend is always present.** Never make the reader colour-match.
- **One series → no legend box.** The title already says what is plotted.
- Legends mirror the mark: **rect** for bars and areas, **line key** for lines. Tooltips
  always use **line keys** — at tooltip density a filled box is data-weight ink doing a
  label's job.
- **Label selectively.** The endpoint, the extreme, or the one series the story is about.
  Never a number on every point.
- **Direct labels before gridlines; gridlines before a second axis.**
- **Measure before placing a label inside a bar.** If it does not fit with comfortable
  padding on both sides: move it outside the bar end, or drop it to the tooltip. For an
  interior stacked segment, skip it and let legend + tooltip carry it. **Never**
  `overflow: hidden` — clipping the first characters is worse than no label.
- **When end-labels collide, do not stack them.** Use leader lines, or facet into small
  multiples. Past ~4 converging series, small multiples is usually right.

### Stat tile contract

`label` (sentence case, no trailing colon) · `value` (600 weight, auto-compact: `1,284` /
`12.9K` / `₹4.2 Cr`) · `delta` (optional; signed, against a *named* period, coloured by
direction × whether up is good) · `trend` (optional; 12-point sparkline in the de-emphasis
hue with the current period in the accent).

---

## 11. Chart-by-chart decisions

Form follows the question, never variety.

| Surface | Question it answers | Form | Colour job |
|---|---|---|---|
| **Forecast band** | How much, and how sure? | Line + 10% uncertainty band + schedule line | Categorical, 2 slots → **legend required**, line keys |
| **Deviation band** | Where do we miss, and by how much? | Diverging bars from zero baseline | Diverging + icon/label |
| **Risk band** | When are the problem windows? | Horizontal event spans | Status + icon + text |
| **Despatch plan band** | What do we do, when? | Horizontal spans, one lane per action type | Categorical ≤ 4, lanes labelled |
| **Battery SoC band** | Is the plan feasible? | Single-series bounded track, 0–100% | One hue, no legend |
| **Merit-order actions** | What first, and what's it worth? | **Ranked table, not a chart** | Status pill per row |
| **Lead-time error** | Does accuracy decay honestly? | Grouped bars, buckets 6/12/24/36/48/72h | Categorical 2–3 |
| **Model vs baselines** | Are we actually better? | **Emphasis form** — model in slot-1 blue, every baseline in de-emphasis grey | Not categorical |
| **PI coverage** | Is P10–P90 honest? | Line vs an 80% nominal reference line | One hue + reference |
| **Day × block CF** | What's the seasonal shape? | Heatmap | Sequential ramp + scale legend |
| **Fleet** | Which sites need attention? | **Small multiples**, faceted | ≤ 3 slots — by **technology**, never by site |
| **Weather drivers** | Why is the forecast this? | Stacked micro-strips (GHI, temp, wind, cloud) sharing the block axis | Sequential per strip |

> **Every chart ships a table-view toggle** containing the same numbers. This is not
> optional, and it is the specific reason the sub-3:1 light-mode hues are permitted at all.

**The emphasis form matters.** Model-vs-baselines is not a categorical chart — one series is
the point and the rest are context. Colouring four baselines in four hues implies they are
peers. They are not; they are the bar being cleared.

---

## 12. Forms and inputs

### Field rules — applied everywhere

- **Label above the field.** Sentence case. Never a placeholder standing in for a label.
- **Unit as a suffix inside the field** (`MW`, `°`, `m/s`, `₹/MWh`, `tCO₂/MWh`), in muted ink.
- **Help text states provenance**, not just meaning: *"Default from CEA national grid
  average. Override with your own factor."*
- **Validate on blur, not on keystroke.** Nobody wants to be corrected mid-number.
- **Errors say what happened and how to fix it.** *"Hub height must be between 30 and 200 m."*
  Never *"Invalid input."*
- **The primary button names the action** — `Save site configuration`, not `Submit`.
  No arrow character.
- **The confirmation reuses the verb** — `Save site configuration` → toast `Saved`.
- **Unsaved-changes guard** on navigation away.
- Numeric inputs use `inputmode="decimal"` and `tabular-nums`.

### The forms

**1 · Site configuration** (`PATCH /api/sites/{id}/config`)

Grouped into fieldsets, because a flat list of 18 fields is unusable:

| Fieldset | Fields |
|---|---|
| Plant | Name, technology, latitude, longitude, rated capacity (MCR) `MW` |
| Solar array *(solar only)* | Tilt `°`, azimuth `°`, module derate `%`, inverter clipping ratio |
| Turbine *(wind only)* | Hub height `m`, cut-in `m/s`, rated `m/s`, cut-out `m/s`, rotor diameter `m` |
| Network | Evacuation limit `MW`, must-run status *(toggle, on)* |
| Storage | Energy `MWh`, power `MW`, round-trip efficiency `%`, initial SoC `%` |
| Commercial | PPA tariff `₹/MWh`, grid emission factor `tCO₂/MWh`, diesel `₹/MWh` + `tCO₂/MWh`, gas peaker `₹/MWh` + `tCO₂/MWh`, storage LCOS `₹/MWh` |

> Every commercial coefficient carries the badge **"Indicative — configurable"** with its
> source in help text. Never present a tariff or emission factor as settled fact. This is
> an honesty requirement, and judges will ask.

**2 · Simulator controls** (`POST /api/simulate`)

Live-updating, no submit button — the chart re-renders as controls move, holding the
previous frame at reduced opacity while the request is in flight.

Battery energy `MWh` (slider + numeric) · battery power `MW` · curtailment threshold
(% of capacity) · notice hours (**snapped to time blocks**, minimum 6 — the revision
horizon is a hard floor, and the control says so) · backup availability (toggle group:
diesel / gas peaker / none) · `Reset to defaults`.

**3 · CSV ingest** (`POST /api/ingest/csv`)

Dropzone → column mapping → validation preview → result.

- Dropzone states: idle, drag-over, uploading, done.
- **Column mapping** is a table of detected headers → expected fields, each a select, with
  a confidence hint for auto-matched columns.
- **Validation preview**: first 20 rows rendered as the real table, invalid cells marked
  with `critical` plus an icon and a row-level reason.
- **Partial success is a first-class outcome**: *"Imported 8,712 rows. 14 rows skipped —
  timestamp out of range. Download skipped rows."*

**4 · Smaller controls**

Horizon selector (24 / 48 / 72 h segmented control) · site combobox · control-area combobox ·
despatch-date picker (preset rows, §9) · table-view toggle per chart · theme toggle ·
CSV export.

**5 · Copilot input**

Not a blank chat box — a blank box invites questions the system cannot answer. Lead with
**intent chips** matching the deterministic router, so the key-optional fallback is
invisible:

`Why is this happening?` · `What should I do?` · `How confident are you?` ·
`Compare with yesterday` · `Summarise the day`

Free text is available below them, with the placeholder *"Ask about this site's forecast."*

---

## 13. States and copy deck

Written in the interface's voice: direct, never apologising, never vague. An empty screen
is an invitation to act; an error names the cause and the fix.

| State | Treatment | Copy |
|---|---|---|
| Loading (first) | Panel outline + axis only, no spinner | — |
| **Refetching** | **Hold the previous render at 55% opacity.** No skeleton, no layout jump, no flash. | — |
| Empty — no site | Illustration-free, one action | *"Choose a site to see its forecast."* → `Choose a site` |
| Empty — no events | Calm, not alarming | *"No over- or under-generation flagged in the next 72 hours. Output stays inside the schedule band."* |
| Empty — no history | Offers the fix | *"No measured generation uploaded for this site yet. Upload a CSV to compare forecasts against actuals."* → `Upload actuals` |
| Error — weather source | Names the cause | *"Open-Meteo did not respond. Showing the last forecast, ingested 07:42."* → `Retry` |
| Error — model missing | Names the fix | *"No trained model found for wind. Run `scripts/train.py` to build one."* |
| Stale data | Badge + inline note | *"Last good fetch was 3 hours ago. Values may have moved."* |
| Partial data | Inline, above the band | *"Forecast covers 48 of 72 hours. The source returned a short run."* |
| Locked blocks | On-spine note | *"Locked — revisions take effect from block 49."* |
| Offline | Full page | *"You're offline. RenewCast needs a connection to fetch forecasts."* |
| 404 | Full page | *"That page doesn't exist."* → `Go to Command Centre` |

**Verb consistency.** `Save` → `Saved`. `Upload actuals` → `Uploaded`. `Run simulation` →
`Simulation complete`. `Apply plan` → `Plan applied`. An action keeps its name through the
whole flow.

---

## 14. Interaction

### Crosshair and tooltip

- **The crosshair finds the X.** A vertical hairline tracks the pointer and **snaps to the
  nearest block**. Readers aim at a time, never at a 2px line.
- **It spans every band.** Because all bands share the x-scale, one crosshair crosses the
  whole stack, and every band's readout column updates together. This is the payoff of the
  spine.
- **On bars and heat cells there is no crosshair** — the mark is the hit target and lifts
  slightly on hover so the reader sees it respond.
- **One tooltip lists every series at that block**, so the pointer never has to land on a
  line to get a value.
- **Values lead, labels follow.** The value is the strong, high-contrast element; the series
  name is secondary — the legend's hierarchy inverted, because the reader already has the
  series and wants the number.
- Tooltip rows key their series with a **short stroke of colour**, not a filled box.
- **Same content on keyboard focus as on hover.**
- Tooltips **enhance, never gate**: every value is also reachable via direct labels or the
  table view.

### Hit targets and safety

- Every hit target is **≥ 24px**, including the mark's 2px surface gap. An 8px dot is a
  pinpoint nobody hits.
- A value pushed off its mark lives in the tooltip, and in the table view regardless.
- **Series and category names are untrusted data** — they arrive from CSV headers and API
  responses. Insert them with `textContent` / `createTextNode`, **never** `innerHTML`
  string concatenation.

### Filters

**One row, left-aligned, above all content.** Never inside a chart card, never per-chart.
Despatch date first — it is the filter everyone reaches for. Filters scope everything below
them, so every number on the page agrees.

### Copilot traceability

Every numeric value in a Copilot answer renders as an inline **`SourceChip`**. Hovering or
focusing it highlights the exact block, row or event it came from on the spine.

This makes the architecture visible: the model narrates computed JSON and never generates a
number, and a reader can trace any sentence back to the data that produced it. It is the
cheapest possible answer to *"how do we know it isn't hallucinating?"*

---

## 15. Motion

**One orchestrated moment.** On first load, the P10–P90 band draws left to right across the
96 blocks — ~600ms, ease-out, once.

It earns its place because the band **visibly widens with lead time**: the motion encodes
the core insight that hour 72 is less certain than hour 6. That is motion drawing attention
to information, which is the only justification for motion that a person did not trigger.

Everything else animates **only in answer to an action** — opening, expanding, confirming —
and only to show what changed. Durations 120–200ms.

Explicitly banned: fade-and-slide-up section entrances, hover transitions on every panel,
looping ambient animation, animated gradients, number count-ups on load.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Under reduced motion the band renders instantly at full extent. No information is lost,
because the motion was emphasis, never the encoding itself.

---

## 16. Accessibility floor

Met without announcing it.

- **No information by colour alone, anywhere.** Status = icon + label + colour. Deviation
  sign = icon + label + colour. Series = legend + direct label + colour.
- **Every chart has a table-view twin** with the same numbers.
- **Visible keyboard focus** on every interactive element: 2px ring in `--series-1` with a
  2px surface offset. Never `outline: none` without a replacement.
- Full keyboard path through the spine: `Tab` to a band, `←/→` to step blocks, `Home/End`
  to jump to block 1 / 96, `Enter` to open that block's detail.
- Charts expose `role="img"` with an `aria-label` summarising the series and range; the
  table view is the accessible equivalent, not an afterthought.
- `prefers-reduced-motion` respected (§15). `forced-colors` triggers the texture channel.
- **Responsive to mobile.** Below 768px the spine becomes horizontally scrollable *as one
  unit* — all bands scroll together so block alignment is never broken. The label gutter
  sticks left; the readout column collapses into the tooltip.
- Touch targets ≥ 44px on coarse pointers.

---

## 17. Page layouts

> **Routes as built.** This section is the full design target. The shipped app
> consolidates it into four routes, and the layouts below describe what each one
> contains rather than a route that exists for every heading.
>
> | Route | Status | Covers |
> |-------|--------|--------|
> | `/` | built | §17.1 Command Centre — fleet list, per-site status |
> | `/sites/[siteId]` | built | §17.2 Forecast — the P10/P50/P90 band, the 24/48/72 h window selector, plant configuration |
> | `/sites/[siteId]/decisions` | built | §17.1 hero + §17.3 Risk & Actions — decision summary, deviation strip, merit-ordered actions, the 96-block table, copilot |
> | `/accuracy` | built | §17.6 Accuracy & Model Card |
> | `/forecast`, `/risk` | **not built as routes** | folded into the two site routes above — a forecast and a plan are always *for a site*, so the site id belongs in the path rather than in a filter dropdown |
> | `/simulator`, `/fleet` | **not built** | §17.4 and §17.5 are unimplemented; no backend endpoint backs them yet |
>
> The consolidation is deliberate, not an omission: every behaviour §17.2 and
> §17.3 specify is reachable, one level down from the site it belongs to.

### 17.1 Command Centre — `/`

```
┌ filter row: [Today ▾] [72 h] [All sites ▾]                                   ┐
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   −214 MW                        ← hero, 48px, proportional figures          │
│   Deficit vs schedule at block 49, 12:00                                     │
│   ⚠ Action needed · 2 h 15 m of headroom before the revision gate            │
│                                                                              │
├──────────────┬──────────────┬──────────────┬────────────────────────────────┤
│ Available    │ Peak surplus │ At risk      │ Plan value                     │
│ 1,842 MW     │ +310 MW      │ 2 events     │ ₹1.82 L · 34 tCO₂             │
│ ▁▂▄▆█▆▄▂     │ block 61     │ 1 critical   │ if actioned by block 49        │
├──────────────┴──────────────┴──────────────┴────────────────────────────────┤
│                     THE BANDED SPINE  (§7.1, all five bands)                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Recommended actions — merit order          [ table view ]                    │
│ ─────────────────────────────────────────────────────────────────────────── │
│ 1  Discharge battery      blocks 49–58   184 MWh   ₹0.83 L   −12 tCO₂  ⚠     │
│ 2  Revise schedule down   blocks 49–66   −214 MW   ₹0.64 L     —       ⚠     │
│ 3  Start gas peaker       blocks 52–60    96 MWh   ₹0.35 L   +43 tCO₂  ◆     │
│ ─────────────────────────────────────────────────────────────────────────── │
│ Residual unserved: 0 MWh                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

**The hero is the whole thesis in one number.** When nothing is flagged it becomes a cleared
state — *"Within schedule band · No action needed through block 96"* — not a zero.

### 17.2 Forecast — `/forecast`

*Built as `/sites/[siteId]`.* The horizon control is the 24/48/72 h selector on the
forecast panel; the site dropdown is the route itself.

Filter row → the forecast band at full height → weather driver strips sharing the axis →
lead-time accuracy note → table view.

```
┌ [Today ▾] [72 h] [Bhadla Solar ▾]                                            ┐
├──────────────────────────────────────────────────────────────────────────────┤
│ Expected generation, ex-bus                    ● P50  ─ Declared capability  │
│  MW                                        ░░░ daylight        [table view]  │
│ 2200 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ evacuation limit ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│ 1650                        ╭──────────╮                                     │
│ 1100          ▓▓▓▓▓▓▓▓▓▓╱─╯          ╰─╲▓▓▓▓▓▓▓▓                            │
│  550      ▓▓▓╱                              ╲▓▓▓                            │
│    0 ────────────────────────────────────────────────                        │
│      00:00   04:00   08:00   12:00   16:00   20:00                           │
│                    ▲now  ▲revision horizon                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ GHI      ░░▒▒▓▓██▓▓▒▒░░      Cloud cover  ██▓▓░░░░▒▒▓▓██                     │
│ Temp     ▒▒▓▓██████▓▓▒▒      Wind speed   ░░░░▒▒▒▒▓▓▒▒░░                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Band widening with lead time must be visually obvious — it is the honesty of the model made
legible. Do not clamp it to look tidy.

### 17.3 Risk & Actions — `/risk`

*Built as `/sites/[siteId]/decisions`.* Risk is carried per block in the deviation
strip and the attention table rather than as a separate linked event list.

Event list (left, 40%) ↔ spine detail (right, 60%), linked selection. Selecting an event
scrolls and highlights its span. Each event card: severity pill with icon and label,
block range with clock times, magnitude, duration, driver attribution
(*"Cloud cover rising to 82% from block 52"*), and its ranked actions.

Below: the **battery SoC dispatch simulation** with the energy-balance statement rendered
in plain words — *"Served 184 MWh · curtailed 0 MWh · unserved 0 MWh of 184 MWh available."*

### 17.4 Simulator — `/simulator`

*Not built.* Design target only.

Controls left (320px, live), outcome right. Two spines stacked: **baseline** above,
**scenario** below, on the same axis so the difference is a vertical read. A delta strip
between them shows the change per block on the diverging scale.

Outcome tiles: energy served, curtailed, unserved, cost, carbon — each with a signed delta
against baseline.

### 17.5 Fleet — `/fleet`

*Not built as a route.* The fleet overview is the Command Centre at `/`.

Five small multiples, faceted, **coloured by technology only** (the all-pairs cap, §5.2).
Each facet: site name, capacity, a compact spine, a status pill, and the next event.
Sortable by severity, capacity, or deviation. A table view carries the same data.

### 17.6 Accuracy & Model Card — `/accuracy`

*Built.*

The credibility page. Judges will spend real time here.

- **Skill score against baselines** — the emphasis form: RenewCast in blue, climatology,
  persistence and pure-physics in de-emphasis grey.
- **Error by lead-time bucket** — 6 / 12 / 24 / 36 / 48 / 72 h. Error must grow. If it does
  not, something leaked.
- **PI coverage** against the 80% nominal reference line.
- **MAE / RMSE / nMAE** as stat tiles, with the evaluation window named.
- **Model card**: features used, features *deliberately excluded* (no target lags — with the
  reason), training window, data sources with licences, and **a plainly worded limitations
  section**.

> The limitations section is a feature, not a disclaimer. Stating that no clean free
> site-level Indian generation series exists, and that the model therefore trains in
> capacity-factor space with physics carrying geography, reads as rigour. Hiding it reads as
> a student project.

### 17.7 Copilot drawer — global

360px right drawer. Intent chips at top, conversation below, input at bottom. Every number
is a `SourceChip`. A footer line names the mode honestly: *"Explanations generated from
computed results."*

### 17.8 Peripheral surfaces

`/ingest` (CSV upload) · site configuration (drawer from any page) · 404 · offline ·
keyboard-shortcut sheet (`?`) · print view (light tokens forced, table views expanded,
overlays suppressed) · CSV export · shareable permalink encoding site + date + horizon.

---

## 18. Frontend file structure

Matches `README_PROJECT.md` §12.

```
frontend/
├── src/app/
│   ├── layout.tsx                 # shell, fonts, theme provider, query client
│   ├── page.tsx                   # Command Centre
│   ├── forecast/page.tsx
│   ├── risk/page.tsx
│   ├── simulator/page.tsx
│   ├── fleet/page.tsx
│   ├── accuracy/page.tsx
│   ├── ingest/page.tsx
│   └── globals.css                # §5.8 tokens, type scale, reduced-motion block
│
├── src/components/
│   ├── shell/                     # AppShell · TopBar · LeftRail · BlockClock
│   │                              # FreshnessBadge · CommandPalette · ThemeToggle
│   ├── spine/                     # BlockSpine (shared x-scale provider + crosshair)
│   │                              # ForecastBand · DeviationBand · RiskBand
│   │                              # PlanBand · SoCBand · NowMarker · RevisionHorizon
│   │                              # DaylightRegion · EvacuationLine
│   ├── charts/                    # LeadTimeErrorChart · ReliabilityChart · Heatmap
│   │                              # FleetSmallMultiples · WeatherDriverStrip · Sparkline
│   │                              # ChartFrame (figure + title + table-view toggle)
│   │                              # Legend · Tooltip · ScaleLegend
│   ├── panels/                    # StatTile · HeroFigure · ActionTable · EventCard
│   │                              # DataTable · Meter · StatusPill · SourceChip
│   ├── forms/                     # SiteConfigForm · SimulatorControls · CsvIngestForm
│   │                              # HorizonSelector · DespatchDatePicker · SiteCombobox
│   └── copilot/                   # CopilotDrawer · IntentChips · MessageList
│
├── src/lib/
│   ├── api.ts                     # typed client, one fn per endpoint
│   ├── blocks.ts                  # hour ↔ block 1–96, revision horizon, block labels
│   ├── format.ts                  # MW · MWh · ₹ lakh/crore · tCO₂ · IST times
│   ├── tokens.ts                  # colour roles as TS constants, mirrors globals.css
│   └── theme.ts
└── .env.local                     # NEXT_PUBLIC_API_BASE_URL
```

**`blocks.ts` is the keystone.** Every band, tooltip and label derives its x-position from
it. One implementation of `hourToBlock`, `blockToTime`, `revisionHorizonBlock(now)` — never
a second, or the bands will drift out of alignment and the whole design collapses.

### Endpoint → surface binding

| Endpoint | Feeds | Status |
|---|---|---|
| `GET /api/sites` | Site list, Command Centre | **built** |
| `GET /api/forecast/{id}?horizon_hours=` | Forecast band, stat tiles, horizon selector | **built** |
| `GET /api/decisions/{id}` | Decision summary, deviation strip, action table, 96-block table | **built** — covers `/api/risk` and `/api/actions` below |
| `GET /api/accuracy` | Accuracy charts, model card | **built** — covers `/api/backtest` and `/api/model/card` below |
| `POST /api/copilot` | Copilot | **built** |
| `GET /api/weather/{id}` | Weather driver strips | planned — drivers ride inside the forecast response |
| `GET /api/risk/{id}` | Risk band, event list | planned |
| `GET /api/actions/{id}` | Action table, plan band | planned |
| `POST /api/simulate` | Simulator | planned |
| `GET /api/backtest/{tech}` | Accuracy charts | planned |
| `GET /api/model/card` | Model card | planned |
| `GET /api/fleet` | Fleet small multiples | planned |
| `GET /api/history/{id}` | Forecast-vs-actual comparison | planned |
| `POST /api/ingest/csv` | CSV ingest form | planned |

The forecast query parameter is `horizon_hours`.

TanStack Query throughout, `keepPreviousData: true` — that flag is what implements
"refetch holds the frame" (§13).

---

## 19. Build order and definition of done

Aligned to `README_PROJECT.md` §15. UI work begins at **P4** and must not start earlier —
the spine is meaningless without real numbers behind it.

| Step | Deliverable | Exit gate |
|---|---|---|
| U1 | Tokens + shell + fonts | Both themes render; toggle works; focus ring visible |
| U2 | `blocks.ts` + `BlockSpine` with axis, now marker, revision horizon | Block 49 lands on the same pixel column in two stacked bands |
| U3 | `ForecastBand` with band, schedule line, daylight, evacuation line | Renders live `/api/forecast` data; band visibly widens |
| U4 | Crosshair + tooltip + readout column, spanning all bands | One crosshair updates every band's readout together |
| U5 | Deviation, Risk, Plan, SoC bands | Full five-band stack aligned |
| U6 | Hero + stat tiles + action table | **★ Demoable Command Centre** |
| U7 | Table-view toggle on every chart | No chart lacks its twin |
| U8 | Forecast, Risk, Fleet pages | Navigation complete |
| U9 | Simulator + forms | Live re-render, validation, verb-consistent toasts |
| U10 | Accuracy + Model Card | Error grows with lead time; limitations stated |
| U11 | Copilot drawer + source chips | Every number traceable to a block |
| U12 | States, empty, error, offline, 404, print, mobile | Nothing renders blank |

### Definition of done — check before the demo

- [ ] Every chart has a table view.
- [ ] No information conveyed by colour alone.
- [ ] Every status shows icon + label + colour.
- [ ] Light-mode aqua/yellow appear only with direct labels or a table view.
- [ ] Fleet colours by technology, never by site.
- [ ] Exactly one hero figure per view.
- [ ] Zero `box-shadow` on static content; overlays only.
- [ ] No gradient anywhere.
- [ ] No ALL-CAPS label, no interpunct meta string, no `→` in a button.
- [ ] No monospace typeface; `tabular-nums` only in columns.
- [ ] Crosshair snaps to blocks and spans all bands.
- [ ] Revision horizon visible on every time-series surface; past blocks dimmed.
- [ ] Refetch holds the previous frame — no skeleton, no jump.
- [ ] `prefers-reduced-motion` renders the band instantly.
- [ ] Keyboard: tab to a band, arrow through blocks, focus ring always visible.
- [ ] Mobile: bands scroll together; alignment never breaks.
- [ ] Every coefficient labelled "Indicative — configurable".
- [ ] Model card names its limitations in plain words.

---

## 20. Decisions the team still owes

Carried from `README_PROJECT.md` §14, narrowed to the ones that change the UI:

- [ ] **D1 — Emission factors and tariffs.** Defaults are indicative (grid 0.71 tCO₂/MWh,
      diesel ₹22,000/MWh, gas peaker ₹8,000/MWh, solar PPA ₹2,500/MWh, wind PPA ₹3,000/MWh,
      storage LCOS ₹4,500/MWh). If better India-specific figures are available, supply them
      — the numbers appear on screen and judges may ask for provenance.
- [ ] **D2 — Demand / commitment profile per site.** The deviation band needs something to
      deviate *from*. Options: a synthetic declared-capability curve derived from the
      physics forecast, or a flat committed MW per block. Pick one; the band is empty
      without it.
- [ ] **D3 — Branding.** The palette above is validated and ready to build against. Confirm
      it, or supply brand hues — in which case they must be re-measured with
      `npm run check:palette` against these surfaces before use. Unvalidated hues forfeit the
      accessibility guarantees in §5.

---

*Every contrast ratio in this document was measured against RenewCast's own surfaces — not
against defaults, and not by eye — and `npm run check:palette` re-measures them from
`globals.css` on demand. The ΔE and colour-blind separation figures were measured the same
way at authoring time; the automated check covers the contrast ratios, the token inventory
and light/dark parity, not the CVD simulation.*
