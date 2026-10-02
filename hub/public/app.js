import { dayKey } from "./lib.js";
import { render as renderOverview } from "./views/overview.js";
import { render as renderCourses, mounted as mountedCourses } from "./views/courses.js";

const VIEWS = {
  overview: { title: "Dashboard — Technical Medicine", render: renderOverview, mounted: null },
  courses:  { title: "Vakken — Technical Medicine", render: renderCourses, mounted: mountedCourses },
};

const parseHash = () => {
  const name = location.hash.replace(/^#\/?/, "").split("/")[0];
  return Object.hasOwn(VIEWS, name) ? name : "overview";
};

let current = null;
let renderedDay = dayKey();
let navigation = 0;

async function route(force = false) {
  const token = ++navigation;
  const name = parseHash();
  const view = VIEWS[name];
  document.title = view.title;
  for (const a of document.querySelectorAll(".tabs a")) {
    const on = a.dataset.view === name;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (name !== current) window.scrollTo(0, 0);
  current = name;

  const main = document.getElementById("view");
  main.innerHTML = `<div class="wrap"><p class="empty">Laden…</p></div>`;
  try {
    const html = await view.render({ force });
    if (token !== navigation) return;
    main.innerHTML = html;
    renderedDay = dayKey();
    view.mounted?.();
    main.classList.remove("view-in");
    requestAnimationFrame(() => {
      if (token === navigation) main.classList.add("view-in");
    });
  } catch {
    if (token !== navigation) return;
    renderedDay = dayKey();
    main.innerHTML = `<div class="wrap"><p class="empty">Kon de weergave niet laden — vernieuw de pagina of probeer het later opnieuw.</p></div>`;
  }
}

// Ook een continu zichtbare tab moet bij Amsterdam-middernacht verversen.
function refreshForDayChange() {
  if (document.visibilityState === "visible" && current === "overview" && dayKey() !== renderedDay) {
    route(true);
  }
}

document.addEventListener("visibilitychange", () => {
  refreshForDayChange();
});
setInterval(refreshForDayChange, 60_000);

window.addEventListener("hashchange", () => route());
route();
