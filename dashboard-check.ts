// Dezelfde schemavalidatie als de browser, uitgevoerd vóór publicatie.
import { validateDashboard } from "./hub/public/dashboard-schema.js";

const path = process.argv[2] ?? `${import.meta.dir}/hub/public/data/dashboard.yaml`;
try {
  const data = validateDashboard(Bun.YAML.parse(await Bun.file(path).text()));
  console.log(`Dashboard geldig: ${data.items.length} items, ${data.announcements.length} aankondigingen.`);
} catch (error) {
  console.error(`Dashboard ongeldig: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
