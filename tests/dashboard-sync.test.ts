import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixture } from "./dashboard-fixture";

const root = resolve(import.meta.dir, "..");

test("isolated publication validates candidates, preserves personal items, and never overwrites newer main", async () => {
  const temp = await mkdtemp(join(tmpdir(), "dashboard-sync-"));
  const seed = join(temp, "seed");
  const remote = join(temp, "remote.git");
  const worktree = join(temp, "tm-site-dashboard-sync");
  const path = "hub/public/data/dashboard.yaml";
  const env = { ...process.env, GIT_AUTHOR_NAME: "Dashboard test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Dashboard test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  const run = (cwd: string, args: string[], successful = true) => {
    const result = Bun.spawnSync(args, { cwd, env });
    const out = result.stdout.toString().trim();
    const err = result.stderr.toString().trim();
    expect(result.exitCode, `${args.join(" ")}\n${err}`).toBe(successful ? 0 : 1);
    return successful ? out : err;
  };
  const git = (cwd: string, ...args: string[]) => run(cwd, ["git", ...args]);
  const sync = (...args: string[]) => run(worktree, [process.execPath, "dashboard-sync.ts", ...args]);
  const rejected = (...args: string[]) => run(worktree, [process.execPath, "dashboard-sync.ts", ...args], false);

  try {
    await mkdir(join(seed, "hub/public/data"), { recursive: true });
    for (const file of ["dashboard-sync.ts", "hub/public/dashboard-schema.js"]) {
      await copyFile(join(root, file), join(seed, file));
    }
    const initial = structuredClone(fixture);
    initial.items.push({ id: "manual-1", source: "manual", course: initial.courses[0].code, kind: "deadline", title: "Eigen mijlpaal", due: "2026-11-01T12:00:00Z", done: false, note: "Mijn notitie" });
    await Bun.write(join(seed, path), JSON.stringify(initial));
    git(temp, "init", "--bare", remote);
    git(seed, "init", "-b", "main");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "Test fixture");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "-u", "origin", "main");
    git(seed, "worktree", "add", "--detach", worktree, "origin/main");

    const base = sync("prepare");
    const candidate = join(temp, "candidate.yaml");
    const next = structuredClone(initial);
    next.synced_at = "2026-10-02T07:30:00+02:00";
    next.items[0].title += " bijgewerkt";

    await Bun.write(candidate, JSON.stringify({ ...next, items: "invalid" }));
    expect(rejected("publish", candidate, base)).toContain("items");
    expect(git(worktree, "status", "--porcelain")).toBe("");

    await Bun.write(candidate, JSON.stringify({ ...next, items: next.items.filter((item) => item.source !== "manual") }));
    expect(rejected("publish", candidate, base)).toContain("Handmatig item");
    const changedNote = structuredClone(next);
    changedNote.items[0].note = "Overwrite";
    await Bun.write(candidate, JSON.stringify(changedNote));
    expect(rejected("publish", candidate, base)).toContain("niet behouden");

    await Bun.write(candidate, JSON.stringify(next));
    await Bun.write(join(seed, "upstream.txt"), "Een andere wijziging op main");
    git(seed, "add", "upstream.txt");
    git(seed, "commit", "-m", "Concurrent main update");
    git(seed, "push", "origin", "main");
    const mainBeforePublish = git(seed, "rev-parse", "HEAD");
    expect(rejected("publish", candidate, base)).toContain("origin/main is gewijzigd");
    expect(git(worktree, "status", "--porcelain")).toBe("");

    const updatedBase = sync("prepare");
    expect(updatedBase).toBe(mainBeforePublish);
    expect(sync("publish", candidate, updatedBase)).toContain("gepubliceerd op main");
    const published = git(worktree, "rev-parse", "HEAD");
    expect(git(temp, "--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(published);
    expect(git(worktree, "diff", "--name-only", updatedBase, "HEAD")).toBe(path);
    expect(git(seed, "rev-parse", "HEAD")).toBe(mainBeforePublish);
    expect(git(seed, "branch", "--show-current")).toBe("main");

    expect(sync("publish", candidate, published)).toContain("Geen wijzigingen");
    await Bun.write(join(worktree, "user-work.txt"), "Niet aanraken");
    expect(rejected("prepare")).toContain("bevat wijzigingen");
    expect(await Bun.file(join(worktree, "user-work.txt")).text()).toBe("Niet aanraken");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 20_000);
