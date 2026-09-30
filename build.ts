// Builds the public page for one course repo: compiles every document listed in
// that repo's site.json and writes <out>/<slug>/{index.html,manifest.json,*.pdf}.
//
//   node build.ts --repo ../TM12001-advanced-signal-acquisition --out dist [--fonts fonts]
//
// No dependencies; Node >= 24 runs this file directly.

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
  /** Set to true to let search engines index the page. */
  index?: boolean;
  docs: Doc[];
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

const { values: args } = parseArgs({
  options: { repo: { type: "string" }, out: { type: "string", default: "dist" }, fonts: { type: "string" } },
});
if (!args.repo) fail("usage: node build.ts --repo <course repo> [--out dist] [--fonts <dir>]");

const repo = resolve(args.repo);
const here = import.meta.dirname;
const site: Site = JSON.parse(readFileSync(join(repo, "site.json"), "utf8"));
validate(site);

const outDir = join(resolve(args.out), site.slug);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let fontCache: Set<string> | undefined;
const built: Built[] = [];
for (const doc of site.docs) {
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
const manifest = {
  slug: site.slug,
  title: site.title,
  commit,
  updated: built.map((d) => d.updated).sort().at(-1),
  docs: built,
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "index.html"), render());
console.log(`built ${built.length} documents into ${outDir}`);

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
  const sections: string[] = [];
  for (const name of new Set(built.map((d) => d.section))) {
    const rows = built
      .filter((d) => d.section === name)
      .map(
        (d) => `<li><a href="${esc(encodeURI(d.file))}">
          <span class="doc">${esc(d.title)}${d.note ? `<small>${esc(d.note)}</small>` : ""}</span>
          <span class="meta"><time datetime="${d.updated}">${day(d.updated)}</time> · ${mb(d.bytes)} MB</span>
        </a></li>`,
      )
      .join("\n");
    sections.push(`<section><h2>${esc(name)}</h2><ul>\n${rows}\n</ul></section>`);
  }

  const fields: Record<string, string> = {
    title: esc(site.title),
    subtitle: esc(site.subtitle ?? ""),
    robots: site.index ? "" : '<meta name="robots" content="noindex">',
    updated: day(manifest.updated!),
    commit,
    sections: sections.join("\n"),
  };
  return readFileSync(join(here, "template.html"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key]);
}

function validate(s: Site): void {
  if (!/^[a-z0-9-]+$/.test(s.slug ?? "")) fail("site.json: slug must be lowercase letters, digits or dashes");
  if (!s.title) fail("site.json: title is required");
  const seen = new Set<string>();
  for (const d of s.docs ?? []) {
    const label = d.title ?? "(untitled)";
    if (!d.section || !d.title) fail(`site.json: "${label}" needs a section and a title`);
    if (!d.typ === !d.pdf) fail(`site.json: "${label}" needs exactly one of typ or pdf`);
    if (d.typ && !d.out) fail(`site.json: "${label}" needs out`);
    const file = d.out ?? basename(d.pdf!);
    if (!/^[\w.-]+\.pdf$/.test(file)) fail(`site.json: "${label}" has an invalid output name: ${file}`);
    if (seen.has(file)) fail(`site.json: output name used twice: ${file}`);
    seen.add(file);
    if (!existsSync(join(repo, d.typ ?? d.pdf!))) fail(`site.json: "${label}" points to a missing file: ${d.typ ?? d.pdf}`);
  }
  if (seen.size === 0) fail("site.json: docs is empty");
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
