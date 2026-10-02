import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { validateDashboard } from "../hub/public/dashboard-schema.js";
import { loadDashboard } from "../hub/public/lib.js";
import { fixture } from "./dashboard-fixture";

const root = resolve(import.meta.dir, "..");
const published = Bun.YAML.parse(await Bun.file(`${root}/hub/public/data/dashboard.yaml`).text());
const originalFetch = globalThis.fetch;
const originalYaml = globalThis.jsyaml;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.jsyaml = originalYaml; });

async function evaluate(script: string, env = {}) {
  const process = Bun.spawn([Bun.which("bun")!, "-e", script], {
    cwd: root, env: { ...globalThis.process.env, ...env }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  expect(code, stderr).toBe(0);
  return JSON.parse(stdout);
}

describe("snapshot validation", () => {
  test("accepts the real YAML snapshot", () => {
    expect(validateDashboard(structuredClone(published))).toEqual(published);
  });

  const invalidCases = [
    ["items is not an array", (data) => { data.items = "not-an-array"; }, "items"],
    ["missing courses", (data) => { delete data.courses; }, "courses"],
    ["invalid synced_at", (data) => { data.synced_at = "not-a-date"; }, "synced_at"],
    ["timezone-less due", (data) => { data.items[0].due = "2026-10-02T23:59:59"; }, "due"],
    ["impossible date", (data) => { data.items[0].due = "2026-02-30T23:59:59Z"; }, "due"],
    ["duplicate item IDs", (data) => { data.items[1].id = data.items[0].id; }, "id"],
    ["duplicate announcement IDs", (data) => { data.announcements[1].id = data.announcements[0].id; }, "id"],
    ["unknown course", (data) => { data.items[0].course = "unknown"; }, "course"],
    ["unknown kind", (data) => { data.items[0].kind = "toString"; }, "kind"],
    ["invalid boolean", (data) => { data.items[0].done = "false"; }, "done"],
    ["non-HTTP link", (data) => { data.items[0].url = "javascript:alert(1)"; }, "url"],
  ] as const;
  for (const [name, mutate, field] of invalidCases) {
    test(`rejects ${name}`, () => {
      const data = structuredClone(fixture);
      mutate(data);
      expect(() => validateDashboard(data)).toThrow(field);
    });
  }

  test("a malformed refresh does not replace the last valid cache", async () => {
    globalThis.jsyaml = { load: Bun.YAML.parse, JSON_SCHEMA: {} };
    globalThis.fetch = async () => new Response(JSON.stringify(fixture));
    const previous = await loadDashboard(true);
    globalThis.fetch = async () => new Response('items: not-an-array\nannouncements: []\nsynced_at: not-a-date');
    await expect(loadDashboard(true)).rejects.toThrow();
    expect(await loadDashboard()).toBe(previous);
  });

  test("overlapping refreshes share one fetch", async () => {
    globalThis.jsyaml = { load: Bun.YAML.parse, JSON_SCHEMA: {} };
    let complete;
    let calls = 0;
    globalThis.fetch = () => { calls++; return new Promise((resolve) => { complete = resolve; }); };
    const first = loadDashboard(true);
    const second = loadDashboard(true);
    complete(new Response(JSON.stringify(fixture)));
    expect(await first).toBe(await second);
    expect(calls).toBe(1);
  });
});

describe("Amsterdam calendar dates", () => {
  for (const TZ of ["UTC", "America/Los_Angeles", "Europe/Amsterdam"]) {
    test(`grouping and DST boundaries are independent of browser timezone ${TZ}`, async () => {
      const result = await evaluate(`
        const { dayKey, dayDiff, dayFmt } = await import("./hub/public/lib.js");
        const due = "2026-10-05T00:30:00+02:00";
        console.log(JSON.stringify({
          key: dayKey(due),
          heading: dayFmt.format(new Date(due)),
          sameDay: dayDiff(due, "2026-10-05T23:00:00+02:00"),
          yesterday: dayDiff(due, "2026-10-06T00:01:00+02:00"),
          autumn: dayDiff("2026-10-25T23:59:59+01:00", "2026-10-24T23:59:59+02:00"),
          spring: dayDiff("2026-03-29T23:59:59+02:00", "2026-03-28T23:59:59+01:00"),
        }));
      `, { TZ });
      expect(result).toEqual({ key: "2026-10-05", heading: "maandag 5 oktober", sameDay: 0, yesterday: -1, autumn: 1, spring: 1 });
    });
  }
});

describe("navigation races", () => {
  for (const outcome of ["success", "failure"]) {
    test(`late overview ${outcome} cannot overwrite Courses`, async () => {
      const result = await evaluate(`
        let resolveFetch, rejectFetch, listener, mounts = 0;
        globalThis.fetch = () => new Promise((resolve, reject) => { resolveFetch = resolve; rejectFetch = reject; });
        globalThis.jsyaml = { load: () => (${JSON.stringify(fixture)}), JSON_SCHEMA: {} };
        const main = { innerHTML: "", classList: { remove() {}, add() {} } };
        const tabs = ["overview", "courses"].map(name => ({ dataset: { view: name }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} }));
        globalThis.location = { hash: "#/" };
        globalThis.document = { title: "", visibilityState: "visible", getElementById: () => main,
          querySelectorAll: selector => { if (selector === ".tabs a") return tabs; mounts++; return []; }, addEventListener() {} };
        globalThis.window = { scrollTo() {}, addEventListener: (_, cb) => { listener = cb; } };
        globalThis.requestAnimationFrame = cb => cb();
        globalThis.setInterval = () => 0;
        await import("./hub/public/app.js");
        location.hash = "#/courses";
        await listener();
        ${outcome === "success" ? 'resolveFetch({ ok: true, text: async () => "" });' : 'rejectFetch(new Error("offline"));'}
        await new Promise(resolve => setTimeout(resolve, 10));
        console.log(JSON.stringify({ title: document.title, courses: main.innerHTML.includes("<h1>Vakken</h1>"), mounts }));
      `);
      expect(result).toEqual({ title: "Vakken — Technical Medicine", courses: true, mounts: 1 });
    });
  }

  test("an Amsterdam day change refreshes a continuously visible overview", async () => {
    const result = await evaluate(`
      const RealDate = Date;
      let now = new RealDate("2026-10-24T23:59:00+02:00").getTime();
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      };
      let timer, calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(""); };
      globalThis.jsyaml = { load: () => (${JSON.stringify(fixture)}), JSON_SCHEMA: {} };
      const main = { innerHTML: "", classList: { remove() {}, add() {} } };
      globalThis.location = { hash: "#/" };
      globalThis.document = { title: "", visibilityState: "visible", getElementById: () => main, querySelectorAll: () => [], addEventListener() {} };
      globalThis.window = { scrollTo() {}, addEventListener() {} };
      globalThis.requestAnimationFrame = cb => cb();
      globalThis.setInterval = cb => { timer = cb; return 0; };
      await import("./hub/public/app.js");
      await new Promise(resolve => setTimeout(resolve, 10));
      now = new RealDate("2026-10-25T00:01:00+02:00").getTime();
      timer();
      await new Promise(resolve => setTimeout(resolve, 10));
      console.log(JSON.stringify({ calls, overview: main.innerHTML.includes("<h1>Wat komt eraan</h1>") }));
    `, { TZ: "America/Los_Angeles" });
    expect(result).toEqual({ calls: 2, overview: true });
  });
});
