// script/m63/verify-cl1-wiring.ts — the CL1 gate's own wiring, checked without a corpus.
//
// WHY THIS EXISTS. Two of the failures this round were ANCHOR MISSES, and both
// were the dangerous kind:
//
//   M13 survived because its probe seeded a row for the wrong arm of the query.
//   The mutant was neither caught nor surviving — it was unexercised, and it
//   reported itself as a robust tool.
//   Earlier, in M26 W3, a mutant whose anchor no longer matched was skipped while
//   the suite still passed on its floor, because the floor was below the count.
//
// Both are invisible to a reviewer reading the code and invisible to the gate
// itself when it is not run. The full CL1 gate needs a corpus index and takes
// minutes to build one, so it cannot sit in `verify:fast`; CI runs only
// `build`, `verify` and `verify:fast`, and no other milestone gate is in CI
// either. This file is the part that CAN run there: it asserts that every mutant
// the gate declares still has a live anchor in the file it mutates, and that the
// declared count and the floor agree.
//
// WHAT IT CLAIMS, PRECISELY. That the gate would exercise what it says it
// exercises. It does not claim anything about the tool — a green run here says
// only that the gate is wired, and a red one means the gate has stopped testing
// something while still reporting success.
//
// THE DECODER IS THE RISK. Anchor strings are TypeScript double-quoted literals
// with escaped newlines and quotes, and extracting them means reading source with
// a pattern. A pattern that extracts the WRONG NUMBER of anchors would pass
// vacuously — the same failure as a gate that skips. So the count is checked
// against `MUTANT_FLOOR`, read from the gate itself, and a mismatch is a hard
// failure. If this file's extractor ever stops understanding the gate, it says so
// rather than agreeing with it.
//
// Run: npx tsx script/m63/verify-cl1-wiring.ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const GATE = join(ROOT, "script", "m63", "verify-cl1-cross-language.ts")

let checks = 0
let passed = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail = "") => {
  checks++
  if (ok) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  [${detail}]` : ""}`)
}

const gate = readFileSync(GATE, "utf8")

// ── the floor, read from the gate so the two cannot drift ────────────────────
const floorMatch = gate.match(/const MUTANT_FLOOR = (\d+)/)
check("the gate declares MUTANT_FLOOR", Boolean(floorMatch), floorMatch ? `= ${floorMatch[1]}` : "not found")
const FLOOR = floorMatch ? Number(floorMatch[1]) : 0

/** Decode a TypeScript double-quoted literal into the bytes it stands for.
 *  Only the escapes the gate actually uses are handled; an unknown escape throws
 *  rather than passing through, because a mis-decoded anchor would be reported as
 *  a missing one and blamed on the wrong file. */
function decodeLiteral(literal: string): string {
  let out = ""
  for (let i = 0; i < literal.length; i++) {
    const c = literal[i]
    if (c !== "\\") { out += c; continue }
    const n = literal[++i]
    if (n === "n") out += "\n"
    else if (n === "t") out += "\t"
    else if (n === '"') out += '"'
    else if (n === "'") out += "'"
    else if (n === "\\") out += "\\"
    else if (n === "`") out += "`"
    else throw new Error(`decodeLiteral: unsupported escape \\${n} — refusing to guess`)
  }
  return out
}

// ── the mutants, as the gate declares them ──────────────────────────────────
// Records are matched in source order. `from`/`to` are single-line double-quoted
// literals, which is what they are in the gate; a mutant that needed a real
// newline in its anchor would be written with an escape, which decodeLiteral
// handles.
const RECORD = /id:\s*"(M\d+)",\s*name:\s*(?:"(?:[^"\\]|\\.)*")\s*,\s*file:\s*"(handler|component)",\s*\n\s*from:\s*"((?:[^"\\]|\\.)*)",\s*\n\s*to:\s*"((?:[^"\\]|\\.)*)",/g

const mutants: Array<{ id: string; file: string; from: string; to: string }> = []
for (const m of gate.matchAll(RECORD)) {
  mutants.push({ id: m[1], file: m[2], from: decodeLiteral(m[3]), to: decodeLiteral(m[4]) })
}

// THE VACUITY GUARD. If the extractor finds a number of records that is not the
// floor, it has stopped understanding the gate — and a checker that quietly
// extracted nothing would agree with a gate that quietly tests nothing.
check(
  "the extractor found exactly MUTANT_FLOOR mutant records (a mismatch means this checker has stopped understanding the gate, not that the gate is small)",
  mutants.length === FLOOR,
  `extracted=${mutants.length} floor=${FLOOR}`,
)

// ── every anchor must still be present in the file it mutates ───────────────
const sources: Record<string, string> = {}
const src = (file: string) => (sources[file] ??= readFileSync(join(ROOT, "src", file === "handler" ? "mcp" : "lsp", file === "handler" ? "tool-handlers.ts" : "cross_language_hover.ts"), "utf8"))

let liveAnchors = 0
const dead: string[] = []
for (const m of mutants) {
  const body = src(m.file)
  if (!body.includes(m.from)) {
    dead.push(m.id)
    check(`${m.id}: its anchor is still present in ${m.file === "handler" ? "tool-handlers.ts" : "cross_language_hover.ts"}`, false, "ANCHOR NOT FOUND — this mutant would be skipped, and the gate would still report success")
    continue
  }
  liveAnchors++
  // The property that matters is not "is the replacement text absent" — for a
  // DELETION mutant the replacement is a substring of what it removes, so it is
  // necessarily already in the file, and the first draft of this check failed M12
  // for exactly that reason. The property is that the file CHANGES: perform the
  // replacement and require a different result. That subsumes the no-op case
  // (`from === to`), which is the one that would let a mutant bank as caught
  // without ever changing anything.
  const mutated = body.replace(m.from, m.to)
  check(`${m.id}: applying it changes the ${m.file === "handler" ? "handler" : "component"} (a mutant that changes nothing is not a mutant)`, mutated !== body,
    mutated === body ? "the replacement reproduces the original text" : "")
}
check("every mutant anchor resolves in the file it mutates", dead.length === 0, dead.length ? `dead: ${dead.join(", ")}` : `${liveAnchors}/${mutants.length} live`)
if (dead.length === 0) console.log(`  ok  all ${liveAnchors} mutant anchors are live`)

// ── the seeded states the guards depend on ──────────────────────────────────
// Two counters no corpus can reach are verified by building the store state that
// triggers them. If that section is removed, M11 and M12 stop being probeable and
// the gate throws UNVERIFIABLE — but only at run time, six minutes in. Here it is
// visible without running anything.
for (const [label, needle] of [
  ["the seeded unpairable state (null-language endpoint)", 'file("s-unlabelled", "mystery.unknownlang", null)'],
  ["the seeded collapsed state (two same-named symbols, two languages)", 'sym("s-twin-a", "seedTwin", "s-twin-ts", 1)'],
  ["the withSeeded() data-dir scope", "const withSeeded = async"],
  ["the UNVERIFIABLE guard, so an unprobeable mutant cannot bank as caught", "UNVERIFIABLE"],
] as const) {
  check(`the gate still contains ${label}`, gate.includes(needle))
}

// ── the hover door's project scope, in BOTH directions ──────────────────────
// CL3 constrained the row's project in two queries, and M13/M14 each break one. A
// filter that exists in one direction and not its twin is the exact shape of the
// bug that was fixed, so the count of project-scoped queries is itself a claim.
const component = src("component")
const scopedPredicates = (component.match(/AND r\.project_id = \(SELECT s2\.project_id FROM brain_symbol s2 WHERE s2\.id = \?\)/g) ?? []).length
check("the hover door scopes the row's project in BOTH directions", scopedPredicates === 2, `found ${scopedPredicates}, expected 2`)
check("neither hover query takes a projectId parameter", !/storedCrossLanguageRows\(db: CrossLanguageDb, symbolId: string, projectId/.test(component),
  "a projectId parameter is the alternative design; the doc says why there is none")

// ── report ──────────────────────────────────────────────────────────────────
const status = failures.length === 0 ? "verified" : "known-gap"
const result = {
  gate: "m63/verify-cl1-cross-language.ts",
  status,
  checks,
  passed,
  mutantsDeclared: mutants.length,
  mutantFloor: FLOOR,
  liveAnchors,
  deadAnchors: dead,
  hoverProjectScopedQueries: scopedPredicates,
  generatedAt: new Date().toISOString(),
  claimLevel: "structural — that the gate would exercise what it declares. Says nothing about the tool; a green run here means the gate is wired, and a red one means it has stopped testing something while still reporting success.",
  limitations: [
    "Not run in CI alongside the full gate: the full gate needs a corpus index and takes minutes to build one, and no other milestone gate is in CI either.",
    "Anchors are extracted from the gate's source with a pattern. The extractor is checked against MUTANT_FLOOR so that one which stops understanding the gate fails loudly rather than agreeing with it; it is not a parser.",
    "A live anchor means the mutant would be PLANTED. Whether its probe would notice the defect it plants is the full gate's job, and only the full gate's.",
  ],
}
writeSealed(join(ROOT, "validation", "m63", "results", "CL1-wiring.json"), result)
console.log(`\nCL1 wiring: ${status.toUpperCase()} (${passed}/${checks} passed, ${liveAnchors}/${mutants.length} anchors live)`)
if (failures.length) for (const f of failures) console.log(`  FAIL: ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
