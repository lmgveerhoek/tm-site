// Publisher regression tests run alongside the site generator tests.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "tm-video-test-"));
const recording = join(root, "source.mov");
const tool = join(import.meta.dir, "video.ts");
const bin = join(root, "bin");
const log = join(root, "uploads.jsonl");
const common = ["--repo", root, "--file", recording, "--name", "lecture-1", "--title", "Lecture 1", "--bucket", "test-bucket", "--date", "2026-09-08", "--preset", "ultrafast"];

function run(extra: string[] = [], mocked = false) {
  return Bun.spawnSync([process.execPath, ...(mocked ? ["--preload", join(root, "fetch.ts")] : []), tool, ...common, ...extra], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, UPLOAD_LOG: log },
    stdout: "pipe", stderr: "pipe",
  });
}

beforeAll(() => {
  mkdirSync(bin);
  writeFileSync(join(root, "site.json"), JSON.stringify({ slug: "test", video_base: "https://bucket.example/" }));
  const input = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=10", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", recording]);
  expect(input.exitCode).toBe(0);
  // No network or credentials: the rclone fixture records arguments, and the
  // HTTP fixture returns metadata from those uploaded objects.
  writeFileSync(join(bin, "rclone"), `#!/usr/bin/env bun\nimport { appendFileSync } from "node:fs"; appendFileSync(process.env.UPLOAD_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");`);
  chmodSync(join(bin, "rclone"), 0o755);
  writeFileSync(join(root, "fetch.ts"), `
    import { readFileSync, statSync } from "node:fs";
    globalThis.fetch = async (url, options) => {
      const rows = readFileSync(process.env.UPLOAD_LOG, "utf8").trim().split("\\n").map(JSON.parse);
      const row = rows.findLast(r => new URL(url).pathname.endsWith(r[2].split(":")[1].replace("test-bucket", "")));
      if (!row) return new Response(null, {status: 404});
      const metadata = row.flatMap((v, i) => v === "--metadata-set" ? [row[i + 1]] : []);
      const headers = Object.fromEntries(metadata.map(m => { const i = m.indexOf("="); return [m.slice(0, i), m.slice(i + 1)]; }));
      const bytes = statSync(row[1]).size;
      headers["content-length"] = String(bytes);
      if (options?.headers?.Range) { headers["content-range"] = "bytes 0-0/" + bytes; return new Response("x", {status: 206, headers}); }
      return new Response(null, {status: 200, headers});
    };
  `);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("encode cache, content-addressed names and verified S3 metadata", () => {
  const original = Bun.CryptoHasher.hash("sha256", readFileSync(recording), "hex");
  const first = run(["--dry-run"]);
  expect(first.exitCode).toBe(0);
  expect(first.stdout.toString()).toMatch(/lecture-1-[a-f0-9]{16}\.mp4/);
  const encoded = join(root, "derived/web/test/lecture-1.mp4");
  const data = readFileSync(encoded);
  expect(data.indexOf("moov")).toBeLessThan(data.indexOf("mdat"));
  const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-show_streams", "-of", "json", encoded]);
  const streams = JSON.parse(probe.stdout.toString()).streams;
  const picture = streams.find((s: { codec_type: string }) => s.codec_type === "video");
  expect(picture.codec_name).toBe("h264");
  expect(picture.pix_fmt).toBe("yuv420p");
  expect([picture.width, picture.height]).toEqual([640, 360]);
  expect(streams.find((s: { codec_type: string }) => s.codec_type === "audio").codec_name).toBe("aac");
  const second = run(["--dry-run"]);
  expect(second.stdout.toString()).toContain("reusing");
  writeFileSync(encoded, "interrupted encode");
  const repaired = run(["--dry-run"]);
  expect(repaired.exitCode).toBe(0);
  expect(repaired.stdout.toString()).not.toContain("reusing");
  const upload = run([], true);
  expect(upload.exitCode).toBe(0);
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain("--metadata");
  expect(calls[0]).not.toContain("--header-upload");
  expect(calls[0]).toContain("content-type=video/mp4");
  expect(calls[1]).toContain('content-disposition=attachment; filename="lecture-1-original.mov"');
  expect(calls[1]).toContain("content-type=video/quicktime");
  expect(Bun.CryptoHasher.hash("sha256", readFileSync(recording), "hex")).toBe(original);
  const completed = readFileSync(encoded);
  writeFileSync(join(bin, "ffmpeg"), '#!/usr/bin/env bun\nimport { writeFileSync } from "node:fs"; writeFileSync(process.argv.at(-1), "partial file"); process.exit(1);');
  chmodSync(join(bin, "ffmpeg"), 0o755);
  try {
    const failed = run(["--dry-run", "--reencode"]);
    expect(failed.exitCode).not.toBe(0);
    expect(readFileSync(encoded).equals(completed)).toBe(true);
  } finally { rmSync(join(bin, "ffmpeg")); }
}, 30_000);

test("bad calendar dates and CRF values fail before encoding or uploading", () => {
  for (const args of [["--date", "2026-02-30"], ["--crf", "99"], ["--preset", "unknown"]]) {
    const result = run([...args, "--dry-run"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).not.toContain("encoding");
  }
});

test("relocated command works from a course checkout with relative paths", () => {
  const result = Bun.spawnSync([join(import.meta.dir, "bin/tm-video"),
    "--repo", ".", "--file", "source.mov", "--name", "wrapper-test",
    "--title", "Wrapper test", "--bucket", "test-bucket", "--preset", "ultrafast", "--dry-run"], {
    cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toMatch(/wrapper-test-[a-f0-9]{16}\.mp4/);
  expect(result.stdout.toString()).toContain("done (dry run)");
});
