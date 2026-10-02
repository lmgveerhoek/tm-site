// Gedeelde helpers voor de app-shell. Houd deze module vrij van DOM-logica,
// zodat de views later portabel blijven (bijv. naar Svelte).

import { validateDashboard } from "./dashboard-schema.js";
export { KINDS } from "./dashboard-schema.js";

export const TZ = "Europe/Amsterdam";

export const dayFmt   = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
export const dateFmt  = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: TZ });
export const timeFmt  = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const stampFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeStyle: "short", timeZone: TZ });
export const longFmt  = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeZone: TZ });

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const calendarFmt = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });

export function dayKey(value = new Date()) {
  const parts = Object.fromEntries(calendarFmt.formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dayDiff(due, now = new Date()) {
  // UTC dient hier alleen als rekenas voor kalenderdagen, niet voor lokale middernacht.
  return (Date.parse(`${dayKey(due)}T00:00:00Z`) - Date.parse(`${dayKey(now)}T00:00:00Z`)) / 86400000;
}

export function chipFor(diff) {
  if (diff < 0) return `<span class="chip chip-late">${-diff} dag${diff < -1 ? "en" : ""} geleden</span>`;
  if (diff === 0) return `<span class="chip chip-today">vandaag</span>`;
  if (diff === 1) return `<span class="chip chip-soon">morgen</span>`;
  if (diff === 2) return `<span class="chip chip-soon">overmorgen</span>`;
  return `<span class="chip">over ${diff} dagen</span>`;
}

let cache = null;
let cacheAt = 0;
let pending = null;

export async function loadDashboard(force = false) {
  if (pending) return pending;
  if (!force && cache && Date.now() - cacheAt < 30 * 60_000) return cache;
  pending = (async () => {
    const res = await fetch("data/dashboard.yaml", { cache: "no-cache" });
    if (!res.ok) throw new Error(`data.yaml: HTTP ${res.status}`);
    // JSON_SCHEMA laat ISO-timestamps strings, net als Bun.YAML in de sync/CI.
    const data = validateDashboard(jsyaml.load(await res.text(), { schema: jsyaml.JSON_SCHEMA }));
    cache = data;
    cacheAt = Date.now();
    return data;
  })();
  try { return await pending; } finally { pending = null; }
}
