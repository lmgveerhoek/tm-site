import { loadDashboard } from "./lib.js";
import { render as renderOverview } from "./views/overview.js";
import { render as renderCourses, mounted as mountedCourses } from "./views/courses.js";

const VIEWS = {
  overview: { title: "Dashboard — Technical Medicine", render: renderOverview, mounted: null },
  courses:  { title: "Vakken — Technical Medicine", render: renderCourses, mounted: mountedCourses },
};

const parseHash = () => {
  const name = location.hash.replace(/^#\/?/, "").split("/")[0];
  return VIEWS[name] ? name : "overview";
};

let current = null;
let renderedDay = new Date().toDateString();

async function route() {
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
  renderedDay = new Date().toDateString();

  const main = document.getElementById("view");
  main.innerHTML = `<div class="wrap"><p class="empty">Laden…</p></div>`;
  try {
    main.innerHTML = await view.render();
    view.mounted?.();
    main.classList.remove("view-in");
    requestAnimationFrame(() => main.classList.add("view-in"));
  } catch {
    main.innerHTML = `<div class="wrap"><p class="empty">Kon de weergave niet laden — vernieuw de pagina of probeer het later opnieuw.</p></div>`;
  }
}

// Een tab die open blijft liggen moet na middernacht niet meer "morgen" tonen.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (new Date().toDateString() !== renderedDay) {
    loadDashboard(true).catch(() => {});
    route();
  }
});

window.addEventListener("hashchange", route);
route();
