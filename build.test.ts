import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "tm-site-test-"));
const bin = join(root, "bin");
mkdirSync(bin);
// Reproducible Git metadata; these fixtures never create commits.
writeFileSync(join(bin, "git"), '#!/bin/sh\ncase "$*" in *rev-parse*) echo abc123 ;; *) echo 2026-10-01T10:00:00Z ;; esac\n');
chmodSync(join(bin, "git"), 0o755);
writeFileSync(join(root, "summary.pdf"), "%PDF-1.4 fixture");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const video = { section: "Opnames", title: 'Lecture <1> & "test"', file: "lecture-1-0123456789abcdef.mp4", original: "lecture-1-original-fedcba9876543210.mov", date: "2026-09-08", bytes: 1234, originalBytes: 5678 };
const config = { slug: "test", title: "Test course", video_base: "https://bucket.example/prefix/", docs: [{ section: "Documents", title: "Summary", pdf: "summary.pdf" }], videos: [video] };
function build(site: object) {
  writeFileSync(join(root, "site.json"), JSON.stringify(site));
  return Bun.spawnSync([process.execPath, join(import.meta.dir, "build.ts"), "--repo", root, "--out", join(root, "dist")], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
  });
}

test("players use normalized HTTPS URLs, escaped labels and updated publication dates", () => {
  const result = build(config);
  expect(result.exitCode).toBe(0);
  const html = readFileSync(join(root, "dist/test/index.html"), "utf8");
  expect(html).toContain('controls playsinline preload="none"');
  expect(html).toContain('aria-label="Lecture &lt;1&gt; &amp; &quot;test&quot;"');
  expect(html).toContain(`https://bucket.example/prefix/test/${video.file}`);
  expect(html).not.toContain("prefix//test");
  expect(html).toContain(`https://bucket.example/prefix/test/${video.original}`);
  const manifest = JSON.parse(readFileSync(join(root, "dist/test/manifest.json"), "utf8"));
  expect(manifest.updated).toBe("2026-10-01T10:00:00Z");
  expect(manifest.videos).toHaveLength(1);
});

test("docs-only and recordings-only configurations remain supported", () => {
  expect(build({ ...config, videos: undefined, video_base: undefined }).exitCode).toBe(0);
  expect(build({ ...config, docs: undefined }).exitCode).toBe(0);
});

test("reject malformed media configuration before output generation", () => {
  const cases = [
    { ...config, video_base: "javascript:alert(1)" },
    { ...config, video_base: "https://bucket.example/?token=x" },
    { ...config, video_base: undefined },
    { ...config, videos: [null] },
    { ...config, videos: "wrong type" },
    { ...config, videos: [{ ...video, date: "2026-02-30" }] },
    { ...config, videos: [{ ...video, bytes: -1 }] },
    { ...config, videos: [{ ...video, note: 123 }] },
    { ...config, videos: [video, video] },
  ];
  for (const site of cases) {
    const result = build(site);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("error: site.json:");
  }
});
