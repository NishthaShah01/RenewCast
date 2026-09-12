/**
 * Formatters.
 *
 * Units are written the way the audience writes them. An Indian grid operator
 * reads ₹4.2 crore, not ₹42,000,000, and reads 1,20,000 rather than 120,000 —
 * the `en-IN` locale handles the digit grouping, but the crore/lakh scale
 * break has to be done by hand because `Intl` has no notation for it.
 *
 * Every function here returns a string with its unit attached. A bare number
 * on a dashboard is an invitation to misread MW as MWh, and those differ by a
 * factor of four in this product.
 */

/** Power, always MW. Sub-megawatt values keep one decimal; above 10 MW the
 *  decimal is noise against forecast uncertainty of tens of megawatts. */
export function mw(value: number): string {
  const digits = Math.abs(value) < 10 ? 1 : 0;
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: digits })} MW`;
}

/** Energy. Above 10,000 MWh reads as GWh — a full day at Bhadla is ~14 GWh,
 *  and five digits of MWh is harder to compare at a glance than one of GWh. */
export function mwh(value: number): string {
  if (Math.abs(value) >= 10_000) {
    return `${(value / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} GWh`;
  }
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} MWh`;
}

/**
 * Rupees on the Indian scale.
 *
 * ₹1 crore = 10 million, ₹1 lakh = 100 thousand. The threshold for switching
 * is one full unit, so ₹95 lakh stays in lakh rather than becoming ₹0.95 crore.
 */
export function inr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";

  if (abs >= 10_000_000) {
    return `${sign}₹${(abs / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} cr`;
  }
  if (abs >= 100_000) {
    return `${sign}₹${(abs / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

/**
 * A cost with its direction named in words.
 *
 * The decisions engine signs cost so that positive is money spent and negative
 * is money saved. A minus sign alone carries that distinction far too quietly
 * for a number an operator acts on, so the sense is spelled out.
 */
export function cost(value: number): { text: string; saving: boolean } {
  return { text: inr(Math.abs(value)), saving: value < 0 };
}

export function tonnes(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return `${(value / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kt CO₂`;
  }
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: abs < 10 ? 1 : 0 })} t CO₂`;
}

/** Capacity factor and other 0..1 ratios. */
export function percent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A signed delta, for deviation columns. */
export function signedMw(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${mw(Math.abs(value))}`;
}

/** `'12 Sep 2026'` — an unambiguous date, never 09/12 or 12/09. */
export function despatchDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

/** `'issued 05:42 IST'` from a server timestamp. */
export function issuedAtLabel(iso: string): string {
  const t = new Date(iso);
  const ist = new Date(t.getTime() + 330 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
}

/* ── Vocabulary ──────────────────────────────────────────────────────────
   Action names appear on screen, in the copilot's narration and in the alt
   text. Defining them once means the button that says "Charge battery" can
   never produce a log line that says "battery_charge". */

export const ACTION_LABELS: Record<string, string> = {
  battery_charge: "Charge battery",
  battery_discharge: "Discharge battery",
  curtail: "Curtail output",
  gas_peaker: "Start gas peaker",
  diesel: "Start diesel backup",
  hold: "Hold",
};

export const RISK_LABELS: Record<string, string> = {
  good: "On plan",
  watch: "Watch",
  serious: "Serious",
  critical: "Critical",
};

export function technologyLabel(technology: string): string {
  return technology === "solar" ? "Solar PV" : "Wind";
}
