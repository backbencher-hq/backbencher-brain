/**
 * cpp-d3-arm-artifacts — produce the generator's D2/D3 arm artifacts from measured gate runs.
 *
 * `script/m14/cpp-spec-table.ts` reads two files that no committed script produced:
 * `cpp-d3-noindex-arm.json` and `cpp-d3-indexed-arm.json`. This is that producer. It does not run
 * the gate: it ASSEMBLES the artifacts from a saved gate text report (the no-index arm, which carries
 * TABLE 1) and a saved gate `--json` result (the index arm), so the numbers stay the gate's own.
 *
 * The reconstruction corpus is the recorded population (`validation/cpp-audit/corpus-manifest.json`);
 * the original ledger's population is NOT regenerable, so this producer states the population it
 * read from the arm rather than copying the old generator's hardcoded 7,435/31.
 *
 * Usage: bun run script/cpp-audit/cpp-d3-arm-artifacts.ts --noindex-report=<txt> --indexed-json=<json> [--out-dir=<dir>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`${f}=`))
  return hit ? hit.slice(f.length + 1) : null
}
const NOINDEX = argOf("--noindex-report")
const INDEXED = argOf("--indexed-json")
const OUT = path.resolve(argOf("--out-dir") ?? path.join(ROOT, "validation/m14/fixtures/cpp/measurements"))
if (!NOINDEX || !INDEXED) {
  console.error("usage: bun run script/cpp-audit/cpp-d3-arm-artifacts.ts --noindex-report=<gate text> --indexed-json=<gate json> [--out-dir=<dir>]")
  process.exit(2)
}

/** TABLE 1 as the gate prints it: the header line through the TOTAL row, verbatim. */
function table1(report: string): string[] {
  const lines = report.split("\n")
  const start = lines.findIndex((l) => l.startsWith("TABLE 1"))
  if (start < 0) throw new Error("no TABLE 1 in the report — refusing to write an artifact with no table")
  const out: string[] = []
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i])
    if (lines[i].startsWith("TOTAL")) break
  }
  if (!out.some((l) => l.startsWith("TOTAL"))) throw new Error("TABLE 1 has no TOTAL row — refusing to write")
  return out
}
function population(report: string): { parsed: number | null; repos: number | null } {
  const m = report.match(/population: (\d+) parsed of \d+ sampled \(corpus has \d+ .*? across (\d+) repos/)
  return { parsed: m ? Number(m[1]) : null, repos: m ? Number(m[2]) : null }
}

const report = readFileSync(NOINDEX, "utf8")
const indexed = JSON.parse(readFileSync(INDEXED, "utf8"))
const pop = population(report)
const noindexArm = {
  schemaVersion: 1,
  instrument: "script/cpp-audit/cpp-d3-arm-artifacts.ts",
  command: "BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus bun run script/m14/incoming-gate.ts cpp cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu 0 --dump",
  population: { parsed: pop.parsed, admitted: pop.parsed, repos: pop.repos, failed: 0, degraded: 0 },
  table1: table1(report),
  sourceReport: path.relative(ROOT, path.resolve(NOINDEX)),
}
const indexedArm = {
  schemaVersion: 1,
  instrument: "script/cpp-audit/cpp-d3-arm-artifacts.ts",
  command: "BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus bun run script/m14/incoming-gate.ts cpp cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu 0 --index --json",
  population: indexed.population ?? { parsed: pop.parsed, admitted: pop.parsed, repos: pop.repos },
  table1: null,
  totals: indexed.totals,
  perType: Object.fromEntries(Object.entries(indexed.perType ?? {}).map(([k, v]: any) => [k, { edges: v.edges }])),
  sourceJson: path.relative(ROOT, path.resolve(INDEXED)),
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "cpp-d3-noindex-arm.json"), JSON.stringify(noindexArm, null, 2) + "\n")
writeFileSync(path.join(OUT, "cpp-d3-indexed-arm.json"), JSON.stringify(indexedArm, null, 2) + "\n")
console.log(`cpp-d3-arm-artifacts: noindex rows=${noindexArm.table1.length} pop=${pop.parsed}/${pop.repos}; indexed totals resolved=${indexedArm.totals?.resolved}`)
