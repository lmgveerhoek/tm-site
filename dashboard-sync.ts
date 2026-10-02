// Publiceer snapshots uitsluitend vanuit de aparte, detached sync-worktree.
// De Brightspace-ophaalstap blijft bij de agentsessie; git en validatie zijn deterministisch.
import { basename, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateDashboard } from "./hub/public/dashboard-schema.js";

const root = import.meta.dir;
const snapshot = "hub/public/data/dashboard.yaml";

function git(args: string[], allowFailure = false) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
  }
  return { code: result.exitCode, text: result.stdout.toString().trim() };
}

function checkCheckout() {
  if (basename(root) !== "tm-site-dashboard-sync" || git(["rev-parse", "--show-toplevel"]).text !== root) {
    throw new Error("Gebruik uitsluitend de aparte tm-site-dashboard-sync worktree.");
  }
  const head = git(["symbolic-ref", "-q", "HEAD"], true);
  if (head.code !== 1) throw new Error("De sync-worktree moet detached zijn; wissel geen ontwikkelbranch.");
  if (git(["status", "--porcelain"]).text) throw new Error("Sync-worktree bevat wijzigingen; stop zonder deze te overschrijven.");
}

function prepare() {
  checkCheckout();
  git(["fetch", "origin", "main"]);
  git(["merge", "--ff-only", "refs/remotes/origin/main"]);
  const base = git(["rev-parse", "HEAD"]).text;
  if (base !== git(["rev-parse", "refs/remotes/origin/main"]).text) {
    throw new Error("Lokale sync-commit is nog niet gepubliceerd; los dit eerst handmatig op.");
  }
  return base;
}

async function publish(candidate: string, base: string) {
  checkCheckout();
  if (!/^[a-f0-9]{40,64}$/.test(base) || git(["rev-parse", "HEAD"]).text !== base) {
    throw new Error("De candidate moet zijn opgebouwd vanaf de HEAD die prepare teruggaf.");
  }
  const path = resolve(candidate);
  if (path === resolve(root, snapshot)) throw new Error("Schrijf de candidate buiten het gepubliceerde snapshot.");
  const yaml = await Bun.file(path).text();
  const data = validateDashboard(Bun.YAML.parse(yaml));
  const previous = validateDashboard(Bun.YAML.parse(await Bun.file(`${root}/${snapshot}`).text()));
  for (const old of previous.items) {
    const next = data.items.find((item) => item.id === old.id);
    if (old.source === "manual" && !isDeepStrictEqual(next, old)) {
      throw new Error(`Handmatig item ${old.id} is gewijzigd of verwijderd.`);
    }
    if (next && (next.done !== old.done || next.note !== old.note)) {
      throw new Error(`Eigen voortgang of notitie van ${old.id} is niet behouden.`);
    }
  }
  if (await Bun.file(`${root}/${snapshot}`).text() === yaml) {
    console.log("Geen wijzigingen; niets te publiceren.");
    return;
  }
  // Niet verdergaan als main tijdens de Brightspace-ophaalstap is gewijzigd.
  git(["fetch", "origin", "main"]);
  if (git(["rev-parse", "refs/remotes/origin/main"]).text !== base) {
    throw new Error("origin/main is gewijzigd; haal eerst een nieuwe basis op en bouw de candidate opnieuw.");
  }
  await Bun.write(`${root}/${snapshot}`, yaml);
  git(["add", "--", snapshot]);
  if (git(["diff", "--cached", "--name-only"]).text !== snapshot) {
    throw new Error("Alleen het dashboard-snapshot mag in de sync-commit zitten.");
  }
  git(["commit", "-m", "Sync dashboard data"]);
  // Expliciete refspec: geen upstream nodig; nooit force-pushen.
  git(["push", "origin", "HEAD:refs/heads/main"]);
  console.log("Dashboard gepubliceerd op main.");
}

try {
  const [action, candidate, base] = process.argv.slice(2);
  if (action === "prepare") console.log(prepare());
  else if (action === "publish" && candidate && base) await publish(candidate, base);
  else throw new Error("Gebruik: bun dashboard-sync.ts prepare | publish <candidate.yaml> <base-sha>");
} catch (error) {
  console.error(`Sync gestopt: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
