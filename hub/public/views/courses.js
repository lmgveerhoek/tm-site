import { esc, longFmt } from "../lib.js";

const COURSES = [
  { slug: "asa",  code: "TM12001", name: "Advanced Signal Acquisition" },
  { slug: "dsd",  code: "TM12004", name: "Drug Sensing and Delivery" },
  { slug: "pc",   code: "TM10006", name: "Patient Cases" },
  { slug: "ms",   code: "TM10004", name: "Medical Skills" },
  { slug: "qsux", code: "TM10012", name: "Quality, Safety & UX in Healthcare" },
];

export function render() {
  return `<div class="wrap page">
    <p class="eyebrow">Master 2026–2027</p>
    <h2 class="page-title">Vakken</h2>
    <p class="page-lead">Samenvattingen, toetsanalyses en uitwerkingen per vak. Elke pagina toont de laatste versie.</p>
    <ul class="cards">${COURSES.map((c) => `
      <li><a href="${c.slug}/"><span class="code">${c.code}</span><span class="name">${esc(c.name)}</span><span class="meta" data-slug="${c.slug}"></span></a></li>`).join("")}
    </ul>
  </div>`;
}

// Elke vakpagina publiceert een eigen manifest; toon wanneer die voor het laatst wijzigde.
export function mounted() {
  for (const el of document.querySelectorAll("[data-slug]")) {
    fetch(`${el.dataset.slug}/manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => { el.textContent = `${m.docs.length} ${m.docs.length === 1 ? "document" : "documenten"} · bijgewerkt op ${longFmt.format(new Date(m.updated))}`; })
      .catch(() => { el.textContent = "Nog niet gepubliceerd"; });
  }
}
