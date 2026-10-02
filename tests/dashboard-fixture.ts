// Vaste regressiedata: de tests blijven werken als de live snapshot leeg wordt.
export const fixture = {
  synced_at: "2026-10-01T17:05:00+02:00",
  quarter: "2026/27 · Q1",
  courses: [{ code: "TM12001", name: "Advanced Signal Acquisition", slug: "asa" }],
  items: [
    { id: "bs-1", source: "brightspace", course: "TM12001", kind: "deadline", title: "Opdracht 1", due: "2026-10-05T00:30:00+02:00", done: false },
    { id: "bs-2", source: "brightspace", course: "TM12001", kind: "deadline", title: "Opdracht 2", due: "2026-10-06T17:00:00+02:00", done: false },
  ],
  announcements: [
    { id: "news-1", course: "TM12001", title: "Nieuws", posted: "2026-10-01T12:00:00+02:00", summary: "Materiaal is beschikbaar.", pinned: false },
    { id: "news-2", course: "TM12001", title: "Voorbereiding", posted: "2026-09-30T12:00:00+02:00", summary: "Lees de voorbereiding.", pinned: true },
  ],
};
