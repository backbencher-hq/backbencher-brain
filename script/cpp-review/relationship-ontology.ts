/**
 * The relationship ONTOLOGY gate: every value the engine's `RelationshipType` can
 * carry must be accounted for in the C++ lane's documentation, and the
 * "emitted as a relationship" claim must match what the analyzer actually emits.
 *
 * This exists because the first version of that table was wrong in two ways and
 * nothing caught it: it marked `imports` and `exports` as emitted (they are
 * separate `ImportInfo[]` / `ExportInfo[]` payload for this lane, not edges) and
 * omitted `implements` altogether. A consumer reading the table could not tell
 * "C++ has no such construct" from "the analyzer forgot", which is the one thing
 * an ontology table exists to settle.
 *
 * Three checks:
 *   1. every distinct `RelationshipType` value appears in the doc's table
 *   2. the doc's emitted/not claim matches the analyzer's own push sites
 *   3. the emitted set matches what the corpus census measured (passed in)
 *
 *   bun run script/cpp-review/relationship-ontology.ts [measuredTypesJson]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const DOC = path.join(ROOT, "docs/analyzers/real-cpp-analyzer.md")
const ENGINE = path.join(ROOT, "src/ast/engine.ts")
const ANALYZER = path.join(ROOT, "src/ast/real-cpp-analyzer.ts")
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

const ENGINE_VALUES = [...new Set(
  (readFileSync(ENGINE, "utf8").match(/= "([a-z_]+)"/g) ?? [])
    .map((m) => m.slice(3, -1))
    .filter((v) => ["calls", "contains", "exports", "extends", "implements", "imports", "instantiates", "overrides", "references", "uses"].includes(v)),
)].sort()

// What the analyzer can actually push, read from its own source rather than from
// the doc — the doc is the thing under test.
const EMITTED = [...new Set(
  (readFileSync(ANALYZER, "utf8").match(/RelationshipType\.([A-Za-z]+)/g) ?? [])
    .map((m) => m.split(".")[1].toLowerCase()),
)].sort()

const doc = readFileSync(DOC, "utf8")
const failures: string[] = []
const rows: { type: string; inDoc: boolean; docClaimsEmitted: boolean | null; codeEmits: boolean }[] = []

for (const t of ENGINE_VALUES) {
  // the table row for this type: starts with `| name |` possibly bolded
  const re = new RegExp(`^\\|\\s*\\**${t}\\**\\s*\\|([^\\n]*)$`, "m")
  const m = doc.match(re)
  const inDoc = !!m
  let docClaimsEmitted: boolean | null = null
  if (m) {
    const cell = m[1]
    const claim = cell.split("|")[0]
    // The claim cell must be a CLAIM. Accepting any cell that merely lacks a
    // check mark would let a row reading "(removed)" or "TODO" pass as "not
    // emitted" — the first version of this gate did exactly that, and the
    // self-test that was supposed to catch a deleted row did not, because the
    // row was still there with its check mark gone.
    if (claim.includes("✅")) docClaimsEmitted = true
    else if (/❌|never|not emitted|not as a relationship/i.test(claim)) docClaimsEmitted = false
    else {
      failures.push(`${t}: the row's claim cell reads ${JSON.stringify(claim.trim())} — a claim must be ✅ or an explicit "never"`)
    }
  }
  const codeEmits = EMITTED.includes(t)
  rows.push({ type: t, inDoc, docClaimsEmitted, codeEmits })
  if (!inDoc) { failures.push(`${t}: the engine can carry this value and the C++ ontology table does not mention it`); continue }
  if (docClaimsEmitted !== null && docClaimsEmitted !== codeEmits) {
    failures.push(`${t}: the doc claims ${docClaimsEmitted ? "emitted" : "not emitted"} but the analyzer's push sites say ${codeEmits ? "emitted" : "not emitted"}`)
  }
}

// check 3 — if a census was produced, the emitted set must match it
const census = process.argv[2] ?? path.join(OUT, "line-contract.json")
if (existsSync(census)) {
  const measured: string[] = JSON.parse(readFileSync(census, "utf8")).byType.map((r: any) => r.type)
  const a = [...new Set([...EMITTED, ...measured])].sort()
  for (const t of a) {
    if (EMITTED.includes(t) !== measured.includes(t)) {
      failures.push(`${t}: the code emits it (${EMITTED.includes(t)}) but the corpus census measured the opposite (${measured.includes(t)})`)
    }
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  engineValues: ENGINE_VALUES,
  analyzerEmits: EMITTED,
  censusMeasured: existsSync(census) ? JSON.parse(readFileSync(census, "utf8")).byType.map((r: any) => r.type) : null,
  rows, failures,
  pass: failures.length === 0,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "relationship-ontology.json"), JSON.stringify(out, null, 2))
console.log(`engine values: ${ENGINE_VALUES.length} | analyzer emits: ${EMITTED.length} (${EMITTED.join(", ")})`)
for (const r of rows) console.log(`  ${r.type.padEnd(14)} doc:${r.inDoc ? "yes" : "NO "}  claims:${String(r.docClaimsEmitted)}  code:${r.codeEmits ? "emits" : "silent"}`)
if (failures.length) { console.log("\nFAIL:"); for (const f of failures) console.log("  " + f) }
console.log(`\n${out.pass ? "PASS" : "FAIL"} — relationship ontology: every engine value is documented and every emitted/not claim matches the code`)
process.exit(out.pass ? 0 : 1)
