// Publish one lecture recording for a course site: encode a web MP4 for the
// page player, upload it and the untouched original to the media bucket, and
// print the ready-to-paste site.json entry.
// Lives with the site generator so the publisher and its schema evolve together.
//
//   bin/tm-video --repo <course-repo> --file <recording.mp4|.mov> --name <name> --title "…"
//
// The encode lands next to the recording in derived/web/<slug>/ (gitignored by the
// course convention), so a failed upload retries without re-encoding. Uploads
// go through rclone; the bucket and its public URL are configured once
// (see README "Publishing a recording").

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    file: { type: "string" },
    name: { type: "string" },
    title: { type: "string" },
    section: { type: "string", default: "Opnames" },
    date: { type: "string" },
    remote: { type: "string", default: "tm-media" },
    bucket: { type: "string", default: process.env.TM_VIDEO_BUCKET },
    base: { type: "string" },
    crf: { type: "string", default: "24" },
    preset: { type: "string", default: "slow" },
    reencode: { type: "boolean" },
    "dry-run": { type: "boolean" },
  },
});

if (!args.repo || !args.file || !args.name || !args.title) {
  fail("usage: bun video.ts --repo <course-repo> --file <recording> --name <name> --title <title> [--section …] [--date …] [--remote tm-media] [--bucket …] [--base …] [--crf 24] [--preset slow] [--reencode] [--dry-run]");
}
if (!args.bucket) fail("--bucket (or TM_VIDEO_BUCKET) is required: the media bucket's name");
if (!/^[\w-]+$/.test(args.name)) fail(`name must be letters, digits, underscores or dashes: ${args.name}`);
if (!/^\d+$/.test(args.crf) || Number(args.crf) > 51) fail(`crf must be an integer from 0 to 51: ${args.crf}`);
if (!["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].includes(args.preset)) fail(`invalid x264 preset: ${args.preset}`);
if (!args.title.trim() || !args.section.trim()) fail("title and section cannot be blank");
if (!/^[a-z0-9][a-z0-9.-]*$/.test(args.bucket) || args.bucket.includes("..")) fail("invalid bucket name");
if (!args["dry-run"] && !Bun.which("rclone")) fail("rclone is required for uploads (brew install rclone)");

const repo = resolve(args.repo);
const input = resolve(args.file);
if (!existsSync(input) || !statSync(input).isFile()) fail(`recording does not exist or is not a file: ${input}`);

const configName = ["site.yaml", "site.yml", "site.json"].find((name) => existsSync(join(repo, name)));
if (!configName) fail(`no site.yaml, site.yml or site.json in ${repo}`);
const site = Bun.YAML.parse(readFileSync(join(repo, configName), "utf8")) as { slug?: string; video_base?: string };
if (!site || typeof site.slug !== "string" || !/^[a-z0-9-]+$/.test(site.slug)) fail(`${configName}: slug must be lowercase letters, digits or dashes`);
const slug = site.slug!;
const date = args.date ?? statSync(input).mtime.toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail(`date must be a real YYYY-MM-DD date: ${date}`);
const baseValue = args.base ?? site.video_base;
let base: string | undefined;
if (baseValue) {
  let url: URL;
  try { url = new URL(baseValue); } catch { fail("base must be a valid HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail("base must be an HTTPS URL without credentials, query or fragment");
  base = url.href.replace(/\/+$/, "");
}
if (!args["dry-run"] && !base) fail("set --base or video_base in the course config to the public bucket URL");

const ext = extname(input).toLowerCase();
if (![".mp4", ".mov", ".m4v", ".mkv", ".webm"].includes(ext)) fail(`unsupported recording type: ${ext}`);

const probe = ffprobe(input);
if (!probe.hasVideo) fail(`${basename(input)} has no video stream; for audio-only use tm-transcribe`);
if (!(probe.duration > 0)) fail(`${basename(input)} has no duration; is it a valid recording?`);

const webDir = join(dirname(input), "derived", "web", slug);
const encoded = join(webDir, `${args.name}.mp4`);
mkdirSync(webDir, { recursive: true });
const sourceHash = await sha256(input);
const signature = JSON.stringify({ sourceHash, crf: args.crf, preset: args.preset, format: "h264-aac-1080p-v2" });
const cachePath = `${encoded}.json`;
let cached: { signature?: string; sha256?: string } = {};
try {
  const value = JSON.parse(readFileSync(cachePath, "utf8"));
  if (value && typeof value === "object") cached = value;
} catch { /* Missing or incomplete cache is rebuilt. */ }
const reuse = !args.reencode && existsSync(encoded) && cached.signature === signature && cached.sha256 === await sha256(encoded);

if (reuse) {
  console.log(`reusing ${join("derived", "web", slug, basename(encoded))} (pass --reencode to encode again)`);
} else {
  console.log(`encoding ${basename(input)} -> ${basename(encoded)} (crf ${args.crf}, preset ${args.preset}; this can take a while)`);
  const temporary = `${encoded}.${process.pid}.tmp.mp4`;
  const run = spawnSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-i", input, "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-crf", args.crf, "-preset", args.preset,
      "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      temporary],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (run.error || run.status !== 0) {
    rmSync(temporary, { force: true });
    fail(run.error ? `ffmpeg could not be started: ${run.error.message}` : "ffmpeg failed; previous completed encode was preserved");
  }
  const result = ffprobe(temporary);
  if (!result.hasVideo || !(result.duration > 0) || Math.abs(result.duration - probe.duration) > 1) {
    rmSync(temporary, { force: true });
    fail("encoded video is incomplete; previous completed encode was preserved");
  }
  renameSync(temporary, encoded);
  writeFileSync(cachePath, JSON.stringify({ signature, sha256: await sha256(encoded) }, null, 2));
}

const bytes = statSync(encoded).size;
const originalBytes = statSync(input).size;
const playerKey = `${args.name}-${(await sha256(encoded)).slice(0, 16)}.mp4`;
const originalKey = `${args.name}-original-${sourceHash.slice(0, 16)}${ext}`;
const contentTypes: Record<string, string> = { ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska" };

if (args["dry-run"]) {
  console.log(`dry run: skipping upload to ${args.remote}:${args.bucket}`);
} else {
  upload(encoded, `${slug}/${playerKey}`, "video/mp4");
  upload(input, `${slug}/${originalKey}`, contentTypes[ext], `attachment; filename="${args.name}-original${ext}"`);
  await verify(`${base}/${slug}/${playerKey}`, bytes, "video/mp4", false);
  await verify(`${base}/${slug}/${originalKey}`, originalBytes, contentTypes[ext], true);
}

const entry = {
  section: args.section,
  title: args.title,
  file: playerKey,
  original: originalKey,
  note: stamp(probe.duration),
  date,
  bytes,
  originalBytes,
};

console.log(`\nAdd to ${configName}:\n`);
console.log(JSON.stringify(entry, null, 2).replace(/\n/g, "\n  ").replace(/^/, "  "));
if (base) {
  console.log(`\nplayer    ${base}/${slug}/${playerKey}  (${mb(bytes)} MB)`);
  console.log(`original  ${base}/${slug}/${originalKey}  (${mb(originalBytes)} MB)`);
}
console.log(`\ndone${args["dry-run"] ? " (dry run)" : ""}`);

function upload(source: string, key: string, contentType: string, disposition?: string): void {
  console.log(`uploading ${key} ...`);
  const metadata = [
    "cache-control=public, max-age=31536000, immutable",
    `content-type=${contentType}`,
    `content-disposition=${disposition ?? "inline"}`,
  ];
  const run = spawnSync(
    "rclone",
    ["copyto", source, `${args.remote}:${args.bucket}/${key}`, "--s3-acl", "public-read",
       "--metadata", "--ignore-times", ...metadata.flatMap((m) => ["--metadata-set", m]), "--progress"],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (run.error) fail(`rclone could not be started: ${run.error.message} (brew install rclone)`);
  if (run.status !== 0) fail(`rclone failed on ${key}`);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function verify(url: string, bytes: number, type: string, attachment: boolean): Promise<void> {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || Number(response.headers.get("content-length")) !== bytes || response.headers.get("content-type")?.split(";")[0] !== type || (attachment && !/^attachment\b/i.test(response.headers.get("content-disposition") ?? ""))) fail(`public object verification failed: ${url} (HTTP ${response.status}); check permissions and metadata`);
  if (!attachment) {
    const range = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(30_000) });
    await range.body?.cancel();
    if (range.status !== 206 || range.headers.get("content-range") !== `bytes 0-0/${bytes}`) fail(`byte-range seeking is not supported at ${url}`);
  }
}

function ffprobe(path: string): { duration: number; hasVideo: boolean } {
  const run = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (run.error) fail(`ffprobe could not be started: ${run.error.message} (brew install ffmpeg)`);
  if (run.status !== 0) fail(`ffprobe failed on ${basename(path)}:\n${run.stderr}`);
  const json = JSON.parse(run.stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  return {
    duration: parseFloat(json.format?.duration ?? ""),
    hasVideo: (json.streams ?? []).some((s) => s.codec_type === "video"),
  };
}

function stamp(seconds: number): string {
  const t = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}
