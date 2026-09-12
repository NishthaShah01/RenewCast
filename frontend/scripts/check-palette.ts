/**
 * Palette validation.
 *
 * README_UI.md §5 makes three claims about the colour system, and this checks
 * all three against `src/app/globals.css` — the file the product actually
 * renders from, not a spec copy that can drift away from it.
 *
 *   1. Every role token the components bind to exists, in both modes.
 *   2. The contrast ratio written beside each token is the real measured
 *      ratio against that mode's own surface — recomputed here by WCAG 2.1,
 *      not trusted.
 *   3. The two dark definitions agree. Dark is declared twice, once under
 *      `prefers-color-scheme` and once under `[data-theme="dark"]`, and a hex
 *      changed in one but not the other means the in-app toggle and the OS
 *      preference render different products.
 *
 * Run:  npm run check:palette
 *
 * ## This validates; it does not decide
 *
 * The palette is approved and fixed. A failure here means the CSS and the
 * documented figure disagree — the fix is to correct whichever one is wrong,
 * after measuring, never to adjust a hex until the number goes green.
 *
 * No dependencies and no test framework, matching `check-blocks.ts`: Node
 * strips the types and ships the runner, so this cannot rot when a library
 * changes its API.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../src/app/globals.css");
const css = readFileSync(CSS_PATH, "utf8");

/* ── Colour maths ────────────────────────────────────────────────────────
   WCAG 2.1 relative luminance and contrast. The sRGB transfer curve is the
   piecewise one from the spec, not the 2.2 gamma approximation — they differ
   enough near the dark end to move a borderline ratio across a threshold. */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const r = srgbToLinear(parseInt(full.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(full.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── CSS parsing ─────────────────────────────────────────────────────────
   Deliberately small. Extracting `--token: #hex; /* n:1 *\/` from a known file
   does not need a CSS parser, and a real one would be a dependency this check
   exists partly to avoid. */

interface Token {
  name: string;
  hex: string;
  /** The ratio asserted in the trailing comment, if the token carries one. */
  claimed?: number;
}

/** Pull one `:root`-ish block out by its selector, to its closing brace. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `globals.css has no ${selector} block`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

function tokensIn(source: string): Map<string, Token> {
  const found = new Map<string, Token>();
  // `--name: #hex;` with an optional `/* 4.21:1 */` comment after it.
  const pattern =
    /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;(?:[^\S\n]*\/\*([^*]*)\*\/)?/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, hex, comment] = match;
    const ratio = comment?.match(/([\d.]+)\s*:\s*1/);
    found.set(name, {
      name,
      hex: hex.toLowerCase(),
      claimed: ratio ? Number(ratio[1]) : undefined,
    });
  }
  return found;
}

const light = tokensIn(block(":root {"));
const darkMedia = tokensIn(block(':root:not([data-theme="light"])'));
const darkToggle = tokensIn(block(':root[data-theme="dark"]'));

/* ── 1. Role tokens exist ────────────────────────────────────────────────
   The list the components and charts actually bind to. Status tokens are
   light-only by design — they are identical in both modes and never themed —
   so they are checked in the light block alone. */

const ROLE_TOKENS = [
  "page",
  "surface",
  "ink-primary",
  "ink-secondary",
  "ink-muted",
  "gridline",
  "baseline",
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "de-emphasis",
  "diverge-mid",
  "delta-pos",
  "delta-neg",
  "status-good",
  "status-warning",
  "status-serious",
  "status-critical",
];

/** Themed per mode. Status is excluded: fixed across modes on purpose. */
const THEMED_TOKENS = ROLE_TOKENS.filter((t) => !t.startsWith("status-"));

test("every role token is defined in light mode", () => {
  for (const name of ROLE_TOKENS) {
    assert.ok(light.has(name), `--${name} missing from :root`);
  }
});

test("every themed token is redefined in both dark blocks", () => {
  for (const name of THEMED_TOKENS) {
    assert.ok(darkMedia.has(name), `--${name} missing from the dark media query`);
    assert.ok(darkToggle.has(name), `--${name} missing from [data-theme="dark"]`);
  }
});

test("the sequential ramp is complete", () => {
  // 13 steps, 100 through 700 in 50s. A gap would make an ordinal scale jump.
  for (let step = 100; step <= 700; step += 50) {
    assert.ok(light.has(`seq-${step}`), `--seq-${step} missing from :root`);
  }
});

/* ── 2. Documented ratios are real ───────────────────────────────────────
   Each mode measures against its own `--surface`, which is what "against
   RenewCast's own surfaces" means: a ratio quoted against white would be a
   different — and flattering — number. */

/** Tolerance in ratio points. Comments are written to 2 dp. */
const TOLERANCE = 0.02;

function assertClaimedRatios(tokens: Map<string, Token>, mode: string) {
  const surface = tokens.get("surface");
  assert.ok(surface, `${mode}: no --surface to measure against`);

  for (const token of tokens.values()) {
    if (token.claimed === undefined) continue;

    // --surface documents its lift over --page, not a ratio against itself.
    const against =
      token.name === "surface" ? tokens.get("page")!.hex : surface.hex;
    const measured = contrast(token.hex, against);

    assert.ok(
      Math.abs(measured - token.claimed) <= TOLERANCE,
      `${mode}: --${token.name} ${token.hex} claims ${token.claimed.toFixed(2)}:1 ` +
        `but measures ${measured.toFixed(2)}:1 against ${against}`,
    );
  }
}

test("light-mode ratios match the CSS comments", () => {
  assertClaimedRatios(light, "light");
});

test("dark-mode ratios match the CSS comments", () => {
  assertClaimedRatios(darkMedia, "dark");
});

/* ── 3. The two dark declarations agree ───────────────────────────────── */

test("the dark media query and the dark toggle define identical hexes", () => {
  for (const [name, token] of darkMedia) {
    const toggled = darkToggle.get(name);
    assert.ok(toggled, `--${name} is in the dark media query but not the toggle`);
    assert.equal(
      toggled.hex,
      token.hex,
      `--${name}: media query says ${token.hex}, toggle says ${toggled.hex} — ` +
        "the OS preference and the in-app toggle would render differently",
    );
  }
});

/* ── 4. The body-text floor holds ────────────────────────────────────────
   §5 allows warning and serious to sit below 3:1 because status always
   renders as icon + label + colour. Text has no such mitigation, so the
   colours a decision is read from are held to the 4.5:1 body-text bar.

   `--ink-muted` is a measured exception at 4.21:1 in light mode, and it is
   documented as one in §5.1. Its mitigation is scope: axis ticks, block
   indices, panel metadata and footnotes only. So it is checked against the
   3:1 bar it does clear, and asserted to stay below secondary ink — the
   boundary is what matters, because the day somebody "fixes" muted by
   darkening it toward secondary is the day the hierarchy quietly goes flat. */

test("ink and delta colours clear 4.5:1 against their surface", () => {
  for (const [tokens, mode] of [
    [light, "light"],
    [darkMedia, "dark"],
  ] as const) {
    const surface = tokens.get("surface")!.hex;
    for (const name of ["ink-primary", "ink-secondary", "delta-pos", "delta-neg"]) {
      const measured = contrast(tokens.get(name)!.hex, surface);
      assert.ok(
        measured >= 4.5,
        `${mode}: --${name} measures ${measured.toFixed(2)}:1, below the 4.5:1 floor`,
      );
    }
  }
});

test("muted ink stays inside its documented exception", () => {
  for (const [tokens, mode] of [
    [light, "light"],
    [darkMedia, "dark"],
  ] as const) {
    const surface = tokens.get("surface")!.hex;
    const muted = contrast(tokens.get("ink-muted")!.hex, surface);
    const secondary = contrast(tokens.get("ink-secondary")!.hex, surface);

    assert.ok(
      muted >= 3,
      `${mode}: --ink-muted measures ${muted.toFixed(2)}:1, below the 3:1 bar it must clear`,
    );
    assert.ok(
      muted < secondary,
      `${mode}: --ink-muted (${muted.toFixed(2)}:1) is no longer recessive against ` +
        `--ink-secondary (${secondary.toFixed(2)}:1) — the ink hierarchy has collapsed`,
    );
  }
});
