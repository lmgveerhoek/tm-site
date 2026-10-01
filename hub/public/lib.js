// Gedeelde helpers voor de app-shell. Houd deze module vrij van DOM-logica,
// zodat de views later portabel blijven (bijv. naar Svelte).

export const TZ = "Europe/Amsterdam";

export const KINDS = {
  deadline:     { label: "Inleveren",  cls: "k-deadline" },
  exam:         { label: "Tentamen",   cls: "k-exam" },
  presentation: { label: "Presentatie",cls: "k-pres" },
  assessment:   { label: "Beoordeling",cls: "k-exam" },
  session:      { label: "Sessie",     cls: "k-session" },
  lecture:      { label: "Materiaal",  cls: "k-lecture" },
  other:        { label: "Overig",     cls: "k-lecture" },
};

export const dayFmt   = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
export const dateFmt  = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: TZ });
export const timeFmt  = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const stampFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeStyle: "short", timeZone: TZ });
export const longFmt  = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeZone: TZ });

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function dayDiff(due) {
  const today = midnight(new Date());
  return Math.round((midnight(due) - today) / 86400000);
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

export async function loadDashboard(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30 * 60_000) return cache;
  const res = await fetch("data/dashboard.yaml");
  if (!res.ok) throw new Error(`data.yaml: HTTP ${res.status}`);
  cache = jsyaml.load(await res.text());
  cacheAt = Date.now();
  return cache;
}
