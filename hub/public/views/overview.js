import { KINDS, dayFmt, dateFmt, timeFmt, stampFmt, esc, dayKey, dayDiff, chipFor, loadDashboard } from "../lib.js";

function renderItem(it, courses) {
  const course = courses.find((c) => c.code === it.course);
  const href = it.url ? `href="${esc(it.url)}"` : "";
  const time = it.allday ? "" : ` · ${timeFmt.format(new Date(it.due))}`;
  const k = KINDS[it.kind] ?? KINDS.other;
  const note = it.note ? `<span class="note">${esc(it.note)}</span>` : "";
  return `<li class="${it.done ? "done" : ""}">
    <a ${href} class="item">
      <span class="badge ${k.cls}">${k.label}</span>
      <span class="it-body">
        <span class="it-title">${esc(it.title)}${note}</span>
        <span class="it-meta"><span class="code">${esc(it.course)}</span>${esc(course?.name ?? "")}${time}</span>
      </span>
      ${it.url ? "<span class='arrow'>↗</span>" : ""}
    </a>
  </li>`;
}

function renderGroups(items, courses) {
  if (!items.length) return `<p class="empty">Nog niets bekend via Brightspace.</p>`;
  const groups = new Map();
  for (const it of items) {
    const key = dayKey(it.due);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.values()].map((list) => {
    const due = new Date(list[0].due);
    return `<div class="day">
      <div class="day-head"><h3>${dayFmt.format(due)}</h3>${chipFor(dayDiff(due))}</div>
      <ul>${list.map((it) => renderItem(it, courses)).join("")}</ul>
    </div>`;
  }).join("");
}

export async function render({ force = false } = {}) {
  const data = await loadDashboard(force);
  const courses = data.courses ?? [];

  const now = new Date();
  const upcoming = (data.items ?? [])
    .filter((it) => dayDiff(it.due, now) >= 0)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  const assess = upcoming.filter((it) => ["exam", "presentation", "assessment"].includes(it.kind));

  const byCourse = new Map();
  for (const a of [...data.announcements].sort((x, y) => new Date(y.posted) - new Date(x.posted))) {
    if (!byCourse.has(a.course)) byCourse.set(a.course, []);
    byCourse.get(a.course).push(a);
  }
  const weekAgo = Date.now() - 7 * 86400000;
  const annHtml = [...byCourse.entries()].map(([code, list]) => {
    const course = courses.find((c) => c.code === code);
    const fresh = list.some((a) => new Date(a.posted).getTime() > weekAgo);
    const rows = list.map((a) => `
      <li>
        <div class="ann">
          <span class="ann-date">${dateFmt.format(new Date(a.posted))}</span>
          <div class="ann-body">
            <span class="ann-title">${esc(a.title)}${a.pinned ? " <span class='pin'>📌 vastgemaakt</span>" : ""}</span>
            <span class="ann-sum">${esc(a.summary)}</span>
          </div>
        </div>
      </li>`).join("");
    return `<details class="ann-course"${fresh ? " open" : ""}>
      <summary><span class="code">${esc(code)}</span> ${esc(course?.name ?? "")}<span class="ann-count">${list.length}</span></summary>
      <ul>${rows}</ul>
    </details>`;
  }).join("") || `<p class="empty">Geen aankondigingen.</p>`;

  return `
  <header class="hero">
    <div class="wrap">
      <p class="eyebrow">Dashboard · ${esc(data.quarter ?? "")}</p>
      <h1>Wat komt eraan</h1>
      <p class="lead">Deadlines, toetsen, presentaties en aankondigingen van alle vakken dit kwartaal, rechtstreeks uit Brightspace.</p>
      <p class="stamp">Laatst bijgewerkt ${stampFmt.format(new Date(data.synced_at))} · volgt Brightspace</p>
    </div>
  </header>
  <div class="wrap">
    <section>
      <h2>Komende weken</h2>
      <div class="timeline">${renderGroups(upcoming, courses)}</div>
    </section>
    <section>
      <h2>Toetsen &amp; presentaties</h2>
      <div class="timeline">${renderGroups(assess, courses)}</div>
    </section>
    <section>
      <h2>Aankondigingen</h2>
      ${annHtml}
    </section>
  </div>`;
}
