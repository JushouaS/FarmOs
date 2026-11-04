/**
 * validation-report.ts: how far are the weights, counts and behavior alerts from what a person found?
 *
 *   npx tsx scripts/validation-report.ts weight   ..\..\..\docs\templates\weight.csv
 *   npx tsx scripts/validation-report.ts count    my-counts.csv
 *   npx tsx scripts/validation-report.ts behavior my-behavior.csv
 *
 * Add --json for the numbers as JSON. The files and how to fill them in are described in docs/validation.md.
 */
import { readFileSync } from "node:fs";
import { behaviorReport, countReport, formatReport, parseCsv, weightReport } from "../src/validation.js";

const [kind, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if ((kind !== "weight" && kind !== "count" && kind !== "behavior") || !file) {
  console.error("Usage: npx tsx scripts/validation-report.ts <weight|count|behavior> <file.csv> [--json]");
  process.exit(1);
}
try {
  const rows = parseCsv(readFileSync(file, "utf8"));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(kind === "weight" ? weightReport(rows) : kind === "count" ? countReport(rows) : behaviorReport(rows), null, 2));
  } else {
    console.log(formatReport(kind, rows));
  }
} catch (err) {
  console.error(`Could not read ${file}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
