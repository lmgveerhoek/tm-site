import { describe, expect, test } from "bun:test";
import { readConfiguration, synchronize } from "../cloudflare-secrets";

const configuration = readConfiguration(await Bun.file(`${import.meta.dir}/../cloudflare-secrets.yaml`).text());
const dummyToken = "dummy-token-for-tests-only";
const dummyAccount = "dummy-account-for-tests-only";

function harness() {
  const calls: { command: string[]; input?: string }[] = [];
  const logs: string[] = [];
  const run = (command: string[], input?: string) => {
    calls.push({ command, input });
    if (command[0] === "op") {
      return { code: 0, stdout: command[2].endsWith("cloudflare_api_token") ? dummyToken : dummyAccount };
    }
    return { code: 0, stdout: command[1] === "api" ? "true\n" : "" };
  };
  return { calls, logs, run, log: (message: string) => logs.push(message) };
}

describe("Cloudflare secret distribution", () => {
  test("uses only two 1Password fields and the expected six repositories", () => {
    expect(configuration.repositories).toEqual([
      "lmgveerhoek/tm-site", "lmgveerhoek/advanced-signal-acquisition", "lmgveerhoek/drug-sensing-and-delivery",
      "lmgveerhoek/patient-cases", "lmgveerhoek/medical-skills", "lmgveerhoek/quality-safety-ux-in-healthcare",
    ]);
    expect(Object.keys(configuration.secrets).sort()).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  });

  test("rejects inline credentials and duplicate repositories", () => {
    expect(() => readConfiguration(JSON.stringify({ ...configuration, secrets: { ...configuration.secrets, CLOUDFLARE_API_TOKEN: dummyToken } }))).toThrow("op://");
    expect(() => readConfiguration(JSON.stringify({ ...configuration, repositories: ["a/b", "a/b"] }))).toThrow("unieke");
  });

  test("dry run checks all repositories and reads both fields without uploading", () => {
    const h = harness();
    expect(synchronize(configuration, { ...h, dryRun: true })).toEqual({ updated: 0, failures: [] });
    expect(h.calls.filter(({ command }) => command[1] === "api")).toHaveLength(6);
    expect(h.calls.filter(({ command }) => command[0] === "op")).toHaveLength(2);
    expect(h.calls.some(({ command }) => command[1] === "secret")).toBe(false);
    expect(h.logs.join("\n")).not.toContain(dummyToken);
    expect(h.logs.join("\n")).not.toContain(dummyAccount);
  });

  test("uploads 12 secrets through stdin, never arguments or logs", () => {
    const h = harness();
    expect(synchronize(configuration, h)).toEqual({ updated: 12, failures: [] });
    const writes = h.calls.filter(({ command }) => command[1] === "secret");
    expect(writes).toHaveLength(12);
    for (const { command, input } of writes) {
      expect(input).toBe(command[3] === "CLOUDFLARE_API_TOKEN" ? dummyToken : dummyAccount);
      expect(command.join(" ")).not.toContain(dummyToken);
      expect(command.join(" ")).not.toContain(dummyAccount);
    }
    expect(h.logs.join("\n")).not.toContain(dummyToken);
    expect(h.logs.join("\n")).not.toContain(dummyAccount);
  });

  test("failed repository preflight stops before any credential reads or writes", () => {
    const h = harness();
    const run = (command: string[], input?: string) => command[1] === "api"
      ? { code: 0, stdout: "false" } : h.run(command, input);
    expect(() => synchronize(configuration, { ...h, run })).toThrow("admin-toegang");
    expect(h.calls.some(({ command }) => command[0] === "op" || command[1] === "secret")).toBe(false);
  });

  test("missing account ID stops before any upload and never relays tool output", () => {
    const h = harness();
    const run = (command: string[], input?: string) => command[0] === "op" && command[2].endsWith("cloudflare_account_id")
      ? { code: 1, stdout: dummyToken } : h.run(command, input);
    let message = "";
    try { synchronize(configuration, { ...h, run }); } catch (error) { message = String(error); }
    expect(message).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(message).not.toContain(dummyToken);
    expect(h.calls.some(({ command }) => command[1] === "secret")).toBe(false);
  });

  test("partial failures attempt remaining uploads and report failures without values", () => {
    const h = harness();
    const run = (command: string[], input?: string) => {
      if (command[1] === "secret" && command[5] === "lmgveerhoek/tm-site") {
        h.calls.push({ command, input });
        return { code: 1, stdout: `${dummyToken} ${dummyAccount}` };
      }
      return h.run(command, input);
    };
    const result = synchronize(configuration, { ...h, run });
    expect(result.updated).toBe(10);
    expect(result.failures).toHaveLength(2);
    expect(h.calls.filter(({ command }) => command[1] === "secret")).toHaveLength(12);
    expect(h.logs.join("\n")).not.toContain(dummyToken);
    expect(h.logs.join("\n")).not.toContain(dummyAccount);
  });
});
