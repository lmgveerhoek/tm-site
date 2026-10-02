// Eén schema voor de browser, lokale sync en CI. Geen runtime-afhankelijkheden.
export const KINDS = {
  deadline:     { label: "Inleveren",  cls: "k-deadline" },
  exam:         { label: "Tentamen",   cls: "k-exam" },
  presentation: { label: "Presentatie", cls: "k-pres" },
  assessment:   { label: "Beoordeling", cls: "k-exam" },
  session:      { label: "Sessie",     cls: "k-session" },
  lecture:      { label: "Materiaal",  cls: "k-lecture" },
  other:        { label: "Overig",     cls: "k-lecture" },
};

const require = (condition, path, message) => {
  if (!condition) throw new Error(`${path}: ${message}`);
};
const record = (value, path) => require(value !== null && typeof value === "object" && !Array.isArray(value), path, "verwacht een object");
const text = (value, path) => require(typeof value === "string" && value.trim().length > 0, path, "verwacht een niet-lege string");
const optional = (value, key, type, path) => {
  if (value[key] !== undefined) require(typeof value[key] === type, `${path}.${key}`, `verwacht ${type}`);
};

function timestamp(value, path) {
  text(value, path);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  require(match !== null && Number.isFinite(Date.parse(value)), path, "verwacht een ISO-timestamp met tijdzone");
  const [, year, month, day, hour, minute, second, zone] = match;
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(Number(year), Number(month), 0);
  require(Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= lastDay.getUTCDate()
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && (zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59)), path, "ongeldige kalenderdatum of tijd");
}

function unique(value, seen, path) {
  text(value, path);
  require(!seen.has(value), path, `dubbele waarde: ${value}`);
  seen.add(value);
}

export function validateDashboard(data) {
  record(data, "dashboard");
  timestamp(data.synced_at, "synced_at");
  text(data.quarter, "quarter");
  for (const key of ["courses", "items", "announcements"]) {
    require(Array.isArray(data[key]), key, "verwacht een array");
  }
  const codes = new Set();
  const slugs = new Set();
  data.courses.forEach((course, i) => {
    const path = `courses[${i}]`;
    record(course, path);
    unique(course.code, codes, `${path}.code`);
    unique(course.slug, slugs, `${path}.slug`);
    require(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(course.slug), `${path}.slug`, "verwacht een padsegment");
    text(course.name, `${path}.name`);
  });
  for (const key of ["items", "announcements"]) {
    const ids = new Set();
    data[key].forEach((entry, i) => {
      const path = `${key}[${i}]`;
      record(entry, path);
      unique(entry.id, ids, `${path}.id`);
      require(codes.has(entry.course), `${path}.course`, "onbekend vak");
      text(entry.title, `${path}.title`);
      timestamp(entry[key === "items" ? "due" : "posted"], `${path}.${key === "items" ? "due" : "posted"}`);
      if (key === "items") {
        require(["brightspace", "manual"].includes(entry.source), `${path}.source`, "verwacht brightspace of manual");
        require(Object.hasOwn(KINDS, entry.kind), `${path}.kind`, "onbekend soort item");
        optional(entry, "done", "boolean", path);
        optional(entry, "allday", "boolean", path);
        optional(entry, "note", "string", path);
      } else {
        text(entry.summary, `${path}.summary`);
        optional(entry, "pinned", "boolean", path);
      }
      if (entry.url !== undefined) {
        text(entry.url, `${path}.url`);
        let url;
        try { url = new URL(entry.url); } catch { /* Meld hieronder met het veldpad. */ }
        require(url && ["https:", "http:"].includes(url.protocol), `${path}.url`, "verwacht een absolute HTTP(S)-link");
      }
    });
  }
  return data;
}
