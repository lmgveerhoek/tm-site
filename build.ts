// Builds the public page for one course repo: compiles every document listed in
// that repo's site.yaml (or site.yml / site.json) and writes <out>/<slug>/{index.html,manifest.json,*.pdf}.
//
//   bun build.ts --repo ../TM12001-advanced-signal-acquisition --out dist [--fonts fonts]
//
// Runs on Bun (versions pinned in mise.toml); no dependencies.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface Doc {
  section: string;
  title: string;
  /** Typst entrypoint to compile, relative to the repo root. */
  typ?: string;
  /** Existing tracked PDF to copy, relative to the repo root. */
  pdf?: string;
  /** Values passed to Typst as --input key=value. */
  inputs?: Record<string, string>;
  /** Published file name. Required with `typ`, defaults to the basename with `pdf`. */
  out?: string;
  /** Paths whose last commit dates this document. Defaults to the source's folder (typ) or file (pdf). */
  watch?: string[];
  note?: string;
}

interface Site {
  slug: string;
  title: string;
  subtitle?: string;
  /** Course code shown above the title, for example "TM12001". */
  code?: string;
  /** Set to true to let search engines index the page. */
  index?: boolean;
  /** Public base URL of the recording bucket; overrides VIDEO_BASE below. */
  video_base?: string;
  /** Documents are optional only for a recordings-only page. */
  docs?: Doc[];
  videos?: Video[];
}

interface Video {
  section: string;
  title: string;
  /** Encoded MP4 served to the in-page player, under <base>/<slug>/. */
  file: string;
  /** Untouched original offered as download, under the same prefix. */
  original?: string;
  /** Small line under the title; suits the recording's duration. */
  note?: string;
  /** ISO date (YYYY-MM-DD); recordings are untracked, so it is given by hand. */
  date: string;
  bytes?: number;
  originalBytes?: number;
}

interface Built {
  section: string;
  title: string;
  note?: string;
  file: string;
  bytes: number;
  updated: string;
}

// Workers static assets reject files above 25 MiB.
const MAX_BYTES = 25 * 1024 * 1024;

// Recordings are far larger, so they are served from object storage instead.
// Set this once the bucket exists; a course overrides it with `video_base`.
const VIDEO_BASE = "";

const { values: args } = parseArgs({
  options: { repo: { type: "string" }, out: { type: "string", default: "dist" }, fonts: { type: "string" } },
});
if (!args.repo) fail("usage: bun build.ts --repo <course repo> [--out dist] [--fonts <dir>]");

const repo = resolve(args.repo);
const here = import.meta.dir;
// YAML is a superset of JSON, so Bun's built-in YAML parser reads all three.
const configName = ["site.yaml", "site.yml", "site.json"].find((name) => existsSync(join(repo, name)));
if (!configName) fail(`no site.yaml, site.yml or site.json in ${repo}`);
const site: Site = Bun.YAML.parse(readFileSync(join(repo, configName), "utf8")) as Site;
validate(site);

const outDir = join(resolve(args.out), site.slug);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let fontCache: Set<string> | undefined;
const built: Built[] = [];
for (const doc of site.docs ?? []) {
  const file = doc.out ?? basename(doc.pdf!);
  const target = join(outDir, file);
  if (doc.typ) compile(doc, target);
  else copyFileSync(join(repo, doc.pdf!), target);

  if (statSync(target).size > MAX_BYTES) shrink(target);
  const bytes = statSync(target).size;
  if (bytes > MAX_BYTES) fail(`${file}: ${mb(bytes)} MB exceeds the 25 MiB asset limit, even after downsampling`);

  const watch = doc.watch ?? [doc.typ ? dirname(doc.typ) : doc.pdf!];
  built.push({ section: doc.section, title: doc.title, note: doc.note, file, bytes, updated: lastCommit(watch) });
  console.log(`ok  ${file}  (${mb(bytes)} MB)`);
}

const commit = git(["rev-parse", "--short", "HEAD"]);
const videos = site.videos ?? [];
const manifest = {
  slug: site.slug,
  code: site.code,
  title: site.title,
  commit,
  updated: [...built.map((d) => d.updated), ...videos.map((v) => v.date), ...(videos.length ? [lastCommit([configName])] : [])].sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1),
  docs: built,
  videos: videos.map((v) => ({
    section: v.section,
    title: v.title,
    note: v.note,
    file: v.file,
    original: v.original,
    updated: v.date,
    bytes: v.bytes,
    originalBytes: v.originalBytes,
  })),
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "index.html"), render());
console.log(`built ${built.length} document(s)${videos.length ? ` and ${videos.length} recording(s)` : ""} into ${outDir}`);

function compile(doc: Doc, target: string): void {
  const cmd = ["compile", "--root", repo];
  if (args.fonts) cmd.push("--font-path", resolve(args.fonts));
  for (const [key, value] of Object.entries(doc.inputs ?? {})) cmd.push("--input", `${key}=${value}`);
  cmd.push(join(repo, doc.typ!), target);

  const run = spawnSync("typst", cmd, { encoding: "utf8" });
  if (run.error) fail(`typst could not be started: ${run.error.message}`);
  if (run.status !== 0) fail(`${doc.typ} failed to compile:\n${run.stderr}`);
  checkFonts(doc.typ!, run.stderr);
}

// Slide crops are embedded at 600-900 ppi, which makes some summaries too large
// to publish. Ghostscript resamples the images to 300 ppi; text stays vector.
function shrink(target: string): void {
  const before = statSync(target).size;
  const tmp = `${target}.tmp`;
  const run = spawnSync(
    "gs",
    ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-dPDFSETTINGS=/printer", `-sOutputFile=${tmp}`, target],
    { encoding: "utf8" },
  );
  if (run.error) fail(`${basename(target)} is ${mb(before)} MB and needs Ghostscript (gs) to be downsampled: ${run.error.message}`);
  if (run.status !== 0) fail(`gs failed on ${basename(target)}:\n${run.stderr}`);
  renameSync(tmp, target);
  console.log(`    downsampled ${basename(target)}: ${mb(before)} -> ${mb(statSync(target).size)} MB`);
}

// Typst only warns about a missing font and then falls back, which silently
// changes the layout. A missing entry in a fallback list is fine as long as
// another entry of that list is installed; a list with no installed entry is not.
function checkFonts(source: string, stderr: string): void {
  const blocks = stderr.split(/^(?=warning: )/m).filter((b) => b.startsWith("warning: unknown font family"));
  for (const block of blocks) {
    const line = block.split("\n").find((l) => /^\s*\d+ │/.test(l)) ?? "";
    const families = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
    if (!families.some((f) => installedFonts().has(f))) fail(`${source} has no installed font to fall back on:\n${block}`);
  }
}

function installedFonts(): Set<string> {
  const cmd = args.fonts ? ["fonts", "--font-path", resolve(args.fonts)] : ["fonts"];
  fontCache ??= new Set(execFileSync("typst", cmd, { encoding: "utf8" }).toLowerCase().split("\n"));
  return fontCache;
}

function lastCommit(paths: string[]): string {
  for (const path of paths) if (!existsSync(join(repo, path))) fail(`watch path does not exist: ${path}`);
  // Empty when the paths are not committed yet (local test builds).
  return git(["log", "-1", "--format=%cI", "--", ...paths]) || new Date().toISOString();
}

function git(cmd: string[]): string {
  return execFileSync("git", ["-C", repo, ...cmd], { encoding: "utf8" }).trim();
}

function render(): string {
  const base = (site.video_base ?? VIDEO_BASE).replace(/\/+$/, "");
  const sections: string[] = [];
  for (const name of new Set([...built.map((d) => d.section), ...videos.map((v) => v.section)])) {
    const rows = built
      .filter((d) => d.section === name)
      .map(
        (d) => `<li><a href="${esc(encodeURI(d.file))}">
          <span class="doc">${esc(d.title)}${d.note ? `<small>${esc(d.note)}</small>` : ""}</span>
          <span class="meta"><time datetime="${d.updated}">${day(d.updated)}</time> · PDF, ${mb(d.bytes)} MB</span>
        </a></li>`,
      )
      .join("\n");
    const cards = videos
      .filter((v) => v.section === name)
      .map((v) => {
        const src = `${base}/${site.slug}/${v.file}`;
        const original = v.original ? `${base}/${site.slug}/${v.original}` : "";
        return `<li class="video">
          <h3>${esc(v.title)}${v.note ? `<small>${esc(v.note)}</small>` : ""}</h3>
          <video controls playsinline preload="none" aria-label="${esc(v.title)}" src="${esc(encodeURI(src))}">Je browser ondersteunt deze videospeler niet. <a href="${esc(encodeURI(src))}">Open de opname</a>.</video>
          <p class="meta"><time datetime="${v.date}">${day(v.date)}</time>${v.bytes ? ` · ${mb(v.bytes)} MB` : ""}${original ? ` · <a href="${esc(encodeURI(original))}">Download origineel${v.originalBytes ? ` (${mb(v.originalBytes)} MB)` : ""}</a>` : ""}</p>
        </li>`;
      })
      .join("\n");
    const items = [rows, cards].filter(Boolean).join("\n");
    sections.push(`<section><h2>${esc(name)}</h2><ul>\n${items}\n</ul></section>`);
  }

  const fields: Record<string, string> = {
    title: esc(site.title),
    code: esc(site.code ?? ""),
    subtitle: esc(site.subtitle ?? ""),
    robots: site.index ? "" : '<meta name="robots" content="noindex">',
    updated: day(manifest.updated!),
    commit,
    sections: sections.join("\n"),
  };
  return readFileSync(join(here, "template.html"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key]);
}

function validate(s: Site): void {
  if (!s || typeof s !== "object") fail(`${configName}: config must be an object`);
  if (s.docs !== undefined && !Array.isArray(s.docs)) fail(`${configName}: docs must be an array`);
  if (s.videos !== undefined && !Array.isArray(s.videos)) fail(`${configName}: videos must be an array`);
  if (!/^[a-z0-9-]+$/.test(s.slug ?? "")) fail(`${configName}: slug must be lowercase letters, digits or dashes`);
  if (!s.title) fail(`${configName}: title is required`);
  const seen = new Set<string>();
  for (const d of s.docs ?? []) {
    const label = d.title ?? "(untitled)";
    if (!d.section || !d.title) fail(`${configName}: "${label}" needs a section and a title`);
    if (!d.typ === !d.pdf) fail(`${configName}: "${label}" needs exactly one of typ or pdf`);
    if (d.typ && !d.out) fail(`${configName}: "${label}" needs out`);
    const file = d.out ?? basename(d.pdf!);
    if (!/^[\w.-]+\.pdf$/.test(file)) fail(`${configName}: "${label}" has an invalid output name: ${file}`);
    if (seen.has(file)) fail(`${configName}: output name used twice: ${file}`);
    seen.add(file);
    if (!existsSync(join(repo, d.typ ?? d.pdf!))) fail(`${configName}: "${label}" points to a missing file: ${d.typ ?? d.pdf}`);
  }
  if (seen.size === 0 && !(s.videos?.length)) fail(`${configName}: docs is empty`);
  const videoBase = s.video_base ?? VIDEO_BASE;
  if (s.videos?.length && !videoBase) fail(`${configName}: videos need video_base set to the bucket's public URL (or VIDEO_BASE in build.ts)`);
  if (videoBase) {
    let url: URL;
    try { url = new URL(videoBase); } catch { fail(`${configName}: video_base must be a valid HTTPS URL`); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail(`${configName}: video_base must use HTTPS without credentials, query or fragment`);
  }
  const videoFiles = new Set<string>();
  for (const v of s.videos ?? []) {
    const label = v?.title ?? "(untitled)";
    if (!v || typeof v !== "object" || typeof v.section !== "string" || !v.section.trim() || typeof v.title !== "string" || !v.title.trim()) fail(`${configName}: video "${label}" needs a section and a title`);
    if (v.note !== undefined && typeof v.note !== "string") fail(`${configName}: video "${label}" note must be a string (quote durations in YAML)`);
    if (!/^[\w.-]+\.mp4$/.test(v.file ?? "")) fail(`${configName}: video "${label}" needs an .mp4 file name: ${v.file}`);
    if (v.original && !/^[\w.-]+\.(mp4|mov|m4v|mkv|webm)$/.test(v.original)) fail(`${configName}: video "${label}" has an invalid original name: ${v.original}`);
    if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !Number.isFinite(Date.parse(v.date)) || new Date(v.date).toISOString().slice(0, 10) !== v.date) fail(`${configName}: video "${label}" needs a valid date (YYYY-MM-DD; quote it in YAML)`);
    for (const bytes of [v.bytes, v.originalBytes]) if (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < 0)) fail(`${configName}: video "${label}" sizes must be non-negative byte counts`);
    if (videoFiles.has(v.file)) fail(`${configName}: video file name used twice: ${v.file}`);
    videoFiles.add(v.file);
  }
}

function day(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}
