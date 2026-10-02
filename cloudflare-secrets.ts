// Read 1Password references and update GitHub Actions secrets, including rotation.
// Secret values travel only through captured stdout/stdin, never argv or files.
type Configuration = { repositories: string[]; secrets: Record<string, string> };
type CommandResult = { code: number; stdout: string };
type Runner = (command: string[], input?: string) => CommandResult;
type Failure = { repository: string; secret: string };

const names = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

export function readConfiguration(yaml: string): Configuration {
  let data;
  try { data = Bun.YAML.parse(yaml); } catch { throw new Error("Ongeldige cloudflare-secrets.yaml."); }
  if (!data || !Array.isArray(data.repositories) || !data.repositories.length
    || data.repositories.some((repo) => typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo))
    || new Set(data.repositories).size !== data.repositories.length) {
    throw new Error("Configureer een niet-lege lijst unieke owner/repository-namen.");
  }
  if (!data.secrets || typeof data.secrets !== "object" || Array.isArray(data.secrets)
    || Object.keys(data.secrets).length !== names.length
    || names.some((name) => typeof data.secrets[name] !== "string" || !/^op:\/\/[^/]+\/[^/]+\/[^/]+$/.test(data.secrets[name]))) {
    throw new Error("Configureer alleen CLOUDFLARE_API_TOKEN en CLOUDFLARE_ACCOUNT_ID, beide als op://-referentie.");
  }
  return data;
}

function run(command: string[], input?: string): CommandResult {
  const result = Bun.spawnSync(command, {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, stdout: result.stdout.toString() };
}

export function synchronize(configuration: Configuration, options: {
  dryRun?: boolean;
  run?: Runner;
  log?: (message: string) => void;
} = {}) {
  const execute = options.run ?? run;
  const log = options.log ?? console.log;
  function checked(command: string[], label: string, input?: string) {
    let result;
    try { result = execute(command, input); } catch { throw new Error(`${label} mislukt; controleer CLI-installatie en authenticatie.`); }
    // Never relay subprocess output on errors: tools can echo a submitted value.
    if (result.code !== 0) throw new Error(`${label} mislukt (exitcode ${result.code}).`);
    return result.stdout;
  }

  // Verify all targets before reading credentials or changing any repository.
  checked(["gh", "auth", "status"], "GitHub-authenticatie");
  for (const repository of configuration.repositories) {
    const admin = checked(["gh", "api", `repos/${repository}`, "--jq", ".permissions.admin"], `Toegangscontrole ${repository}`);
    if (admin.trim() !== "true") throw new Error(`Geen admin-toegang tot ${repository}; niets bijgewerkt.`);
  }

  // Fetch both fields successfully before the first upload. No temporary files.
  const values = new Map<string, string>();
  for (const name of names) {
    const value = checked(["op", "read", configuration.secrets[name], "--no-newline"], `1Password ophalen ${name}`).trim();
    if (!value) throw new Error(`1Password-veld voor ${name} is leeg; niets bijgewerkt.`);
    values.set(name, value);
  }

  let updated = 0;
  const failures: Failure[] = [];
  try {
    if (options.dryRun) {
      log(`Controle geslaagd: ${configuration.repositories.length} repositories en twee 1Password-velden. Niets bijgewerkt.`);
      return { updated, failures };
    }
    for (const repository of configuration.repositories) {
      for (const name of names) {
        try {
          checked(["gh", "secret", "set", name, "--repo", repository, "--app", "actions"], `Bijwerken ${repository}/${name}`, values.get(name));
          updated++;
          log(`Bijgewerkt: ${repository} → ${name}`);
        } catch {
          failures.push({ repository, secret: name });
          log(`Mislukt: ${repository} → ${name}`);
        }
      }
    }
    log(`${updated} secrets bijgewerkt; ${failures.length} mislukt.${failures.length ? " Voer dezelfde taak opnieuw uit om te herstellen." : ""}`);
    return { updated, failures };
  } finally {
    values.clear();
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--dry-run") || args.length > 1) {
      throw new Error("Gebruik: mise run cloudflare-secrets [-- --dry-run]");
    }
    const configuration = readConfiguration(await Bun.file(`${import.meta.dir}/cloudflare-secrets.yaml`).text());
    const result = synchronize(configuration, { dryRun: args.includes("--dry-run") });
    if (result.failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Cloudflare-secrets bijwerken mislukt.");
    process.exitCode = 1;
  }
}
