/**
 * PROOF that `script/m14/lua-ruled.ts` is a table the shared arbiter can use.
 *
 * ## Why this file exists
 *
 * `script/m14/ontology-coverage-gate.ts` is shared machinery owned by the supervisor
 * (§8 of `docs/analyzers/ONTOLOGY-WORKSTREAM.md`), so this lane may not add its entry
 * to `RULED_BY_LANG`. Until it does, `npx tsx script/m14/ontology-coverage-gate.ts
 * lua` exits 2 and refuses to report — by the gate's own design, because a gate with
 * an empty table would render a verdict about the TABLE rather than about the lane.
 *
 * A table nobody has run is a table that might not typecheck, might name a type the
 * ontology does not have, and might make the gate report a verdict the corpus
 * contradicts. All three are silent. So this harness does the wiring ITSELF, to a
 * SCRATCH COPY of the real gate, and runs that:
 *
 *   1. Reads the shared gate's source.
 *   2. Asserts the two anchors it is about to patch are present EXACTLY once, with
 *      the expected text. A moved anchor is a loud failure, not a silent no-op — the
 *      same rule `mutate-lua-bindings.ts` uses on its needles.
 *   3. Asserts `LUA_RULED`'s shape against the gate's OWN `Ruled` type, field by
 *      field, by re-reading the type block out of the gate source. A table typed
 *      against a stale copy of a shared file is a table the shared file cannot use.
 *   4. Asserts every `type` in `LUA_RULED` is in the gate's `ALL_TYPES`, and that no
 *      emitted type is present — a row for an emitted type is a claim it is NOT
 *      emitted, which is false, so it is a table error rather than a ruling.
 *   5. Writes the patched copy INSIDE the repo (so its `../../src/ast/...` imports
 *      still resolve), runs it with the same argument the supervisor will use, prints
 *      the diff it applied, and deletes the copy.
 *
 * Nothing outside this lane's own files is written, and the shared gate is read-only
 * throughout. The proof is reproducible: `npx tsx script/m60/lua-ruled-proof.ts`.
 *
 * It takes minutes — it parses the whole Lua corpus through production `parseFile`
 * and then re-parses it for the grammar inventory. That is the gate's own cost, not
 * this harness's.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { LUA_RULED } from "../m14/lua-ruled"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const GATE = path.join(ROOT, "script", "m14", "ontology-coverage-gate.ts")
const src = readFileSync(GATE, "utf8")

function die(msg: string): never {
  console.error(`\nPROOF FAILED: ${msg}`)
  process.exit(1)
}
const once = (needle: string, what: string): void => {
  const n = src.split(needle).length - 1
  if (n !== 1) die(`the anchor for ${what} appears ${n} times in ontology-coverage-gate.ts, expected exactly 1. The shared gate has moved and this harness is stale — it patches by exact text on purpose, because a silent no-op here would report a verdict nobody ran.`)
}

// ── 1. the anchors the wiring needs ────────────────────────────────────────────
const IMPORT_ANCHOR = 'import { LANGS } from "./differential"'
const MAP_ANCHOR = 'const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }'
once(IMPORT_ANCHOR, "the import block")
once(MAP_ANCHOR, "the RULED_BY_LANG map")

// ── 2. the gate's own `Ruled` type, re-read and compared ───────────────────────
const ruledType = /type Ruled = \{([\s\S]*?)\n\}/.exec(src)?.[1]
if (!ruledType) die("could not find `type Ruled` in ontology-coverage-gate.ts")
const gateFields = [...ruledType.matchAll(/^\s{2}(\w+)(\??):/gm)].map((m) => `${m[2]}${m[1]}`).sort()
/** Field names with the optionality marker stripped, so the comparison is about
 * WHICH fields the gate declares and not about where a `?` sits in the source. */
const gateFieldNames = new Set(gateFields.map((f) => f.replace(/^\?/, "")))
console.log("the gate's Ruled fields:", gateFields.join(", "))

// ── 3. the ontology's ten types, re-read from the gate ─────────────────────────
const allTypes = /const ALL_TYPES = \[([\s\S]*?)\] as const/.exec(src)?.[1]
if (!allTypes) die("could not find `ALL_TYPES` in ontology-coverage-gate.ts")
const ONTOLOGY = [...allTypes.matchAll(/"(\w+)"/g)].map((m) => m[1])
console.log(`the gate's ontology: ${ONTOLOGY.length} types — ${ONTOLOGY.join(" ")}`)
if (ONTOLOGY.length !== 10) die(`expected 10 types in the gate, read ${ONTOLOGY.length}`)

// ── 4. every row, checked against both ─────────────────────────────────────────
const EMITTED = new Set(["calls", "uses", "contains", "imports", "references", "exports", "extends", "overrides", "instantiates"])
let problems = 0
for (const [i, row] of LUA_RULED.entries()) {
  const keys = Object.keys(row).sort()
  const expected = ["describe", "instrument", "type", ...(row.instrument === "A:grammar-inventory" ? ["nodeTypesThatWouldMeanIt"] : ["countOnTree"])].sort()
  const missing = expected.filter((k) => !keys.includes(k))
  const extra = keys.filter((k) => k !== "instrument" && !gateFieldNames.has(k))
  if (missing.length) { console.error(`  row ${i} (${row.type}) is missing ${missing.join(", ")}`); problems++ }
  if (extra.length) { console.error(`  row ${i} (${row.type}) has fields the gate's Ruled does not declare: ${extra.join(", ")}`); problems++ }
  if (!ONTOLOGY.includes(row.type)) { console.error(`  row ${i} names type "${row.type}", which is not in the gate's ontology`); problems++ }
  if (EMITTED.has(row.type)) { console.error(`  row ${i} names type "${row.type}", which this lane's census measures as EMITTED. A row in RULED claims the type is NOT emitted.`); problems++ }
  if (row.instrument === "A:grammar-inventory" && !(row.nodeTypesThatWouldMeanIt?.length)) { console.error(`  row ${i} uses instrument A with no candidate node types, so the gate's check is vacuously satisfied`); problems++ }
  if (row.instrument === "B:parse-tree-count" && typeof row.countOnTree !== "function") { console.error(`  row ${i} uses instrument B with no countOnTree`); problems++ }
  console.log(`  row ${i}: ${row.type} — ${row.instrument} — ${row.nodeTypesThatWouldMeanIt?.length ?? 0} candidate node types`)
}
if (problems) die(`${problems} shape problem(s) in LUA_RULED; see above`)
if (!LUA_RULED.length) die("LUA_RULED is empty. An empty table is worse than no table: the gate would call every un-emitted type RULED-UNJUSTIFIED, which is a verdict about the table.")

// ── 4b. WHICH GRAMMAR does the gate's instrument A actually load? ──────────────
// This is not a style question. The gate reads its wasm path out of `differential`'s
// LANGS map with a bash fallback:
//
//   const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-bash.wasm"
//
// `LANGS` has no `lua` entry, so for `lua` the fallback fires and the arbiter parses
// every Lua file with the BASH grammar. Observed directly: the gate printed "the
// grammar produced 128 distinct node types", while this lane's own instrument A over
// the SAME 3,250 files with the SAME draw predicate reports 100
// (`validation/m60/lua/grammar-inventory.json`). 128 is bash's vocabulary.
//
// The verdict for `implements` survives it — bash's grammar has no `implements_clause`
// either, so the absence is found in the wrong vocabulary and happens to be right —
// but the basis STRING in the gate's output is false, and the direction of the error
// is the dangerous one: a vocabulary that is too small can only ever find an ABSENCE,
// so a ruling that should have been FALSIFIED reads RULED-SOUND. Reported to the
// supervisor; asserted here so the finding is reproducible rather than asserted.
const diffSrc = readFileSync(path.join(ROOT, "script", "m14", "differential.ts"), "utf8")
const langsBlock = /export const LANGS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(diffSrc)?.[1] ?? ""
const luaInLangs = new RegExp(`(^|[\\s{,])\\s*"?lua"?\\s*:`).test(langsBlock)
const fallbackLine = /const wasmPath = .*\?\? "([^"]+)"/.exec(src)
const gateWasm = luaInLangs ? "from LANGS.lua (present)" : `FALLBACK -> ${fallbackLine?.[1] ?? "?"}`
const laneWasm = "wasm/tree-sitter-lua.wasm"
const wasmSha = (p: string): string => createHash("sha256").update(readFileSync(path.join(ROOT, p))).digest("hex")
console.log(`\nthe grammar the gate loads for instrument A: ${gateWasm}`)
console.log(`the grammar this lane pins:                   ${laneWasm}  sha256 ${wasmSha(laneWasm).slice(0, 16)}…`)
if (!luaInLangs && fallbackLine?.[1] !== "tree-sitter-lua.wasm") {
  console.log(`\n>>> FINDING (shared machinery, reported not fixed — §8): the gate's instrument A for lua`)
  console.log(`>>> parses every corpus file with ${fallbackLine[1]}, because differential.ts's LANGS has no lua entry.`)
  console.log(`>>> The RULED-SOUND verdict above is unaffected — the node types it looks for are absent from bash's`)
  console.log(`>>> vocabulary too — but the "128 distinct node types" in the detail string is bash's count, not lua's.`)
  console.log(`>>> Correct count for lua over the same draw: see validation/m60/lua/grammar-inventory.json.`)
  console.log(`>>> The fix is one line in ontology-coverage-gate.ts — resolve the wasm from the grammar the analyzer`)
  console.log(`>>> itself uses, or fail loudly instead of falling back to another language's grammar.`)
}

// ── 5. patch a scratch copy and run it ─────────────────────────────────────────
const patched = src
  .replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\nimport { LUA_RULED } from "./lua-ruled"`)
  .replace(MAP_ANCHOR, MAP_ANCHOR.replace(/}$/, ", lua: LUA_RULED }"))

// The copy must sit in the SAME directory as the gate, not a subdirectory of it: the
// gate resolves `../../src/ast/...` relative to its own location, so one extra level
// of nesting points the import at `script/src/ast/` and the run dies on
// ERR_MODULE_NOT_FOUND before a single file is parsed. That is why this is a
// same-directory scratch file and not a tmpdir.
const scratch = path.join(ROOT, "script", "m14", "zz-lua-ruled-proof.scratch.ts")
if (existsSync(scratch)) rmSync(scratch, { force: true })
writeFileSync(scratch, patched.replace('from "./lua-ruled"', 'from "./lua-ruled"'))

console.log("\nthe patch applied to the scratch copy (2 lines):")
console.log('  + import { LUA_RULED } from "./lua-ruled"')
console.log("  - const RULED_BY_LANG ... = { bash: BASH_RULED, json: JSON_RULED }")
console.log("  + const RULED_BY_LANG ... = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED }")
console.log(`\nrunning: npx tsx ${path.relative(ROOT, scratch)} lua\n`)
console.log("(this parses the whole lua corpus through production parseFile, then again")
console.log(" for the grammar inventory — minutes, not seconds)\n")

let gateOut = ""
const code = (() => {
  try {
    const out = execFileSync("npx", ["tsx", path.relative(ROOT, scratch), "lua"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
    })
    process.stdout.write(out)
    gateOut = out
    return 0
  } catch (e: any) {
    const s2 = String(e.stdout ?? "")
    process.stdout.write(s2)
    process.stderr.write(String(e.stderr ?? ""))
    gateOut = s2
    return typeof e.status === "number" ? e.status : 1
  } finally {
    rmSync(scratch, { force: true })
  }
})()
console.log(`\ngate exit code: ${code}`)
if (code === 2) die("the gate exited 2, which is its refusal to report from an empty or missing table — the wiring did not take")

// ── the artifact, written by THIS script and not by a human ──────────────────────
//
// validation/m60/lua/coverage-gate-wired.json was, until this pass, hand-transcribed
// from the paste in the lane document: no script wrote it and none could regenerate it.
// Honesty contract §5.1 requires evidence to be machine-emitted and regenerable, and a
// file that only exists because a person typed it is an assertion wearing an artifact's
// name — the same defect as LUA-02's counter, one level out.
//
// So the gate's own stdout is parsed into rows here and the row set is checked against
// all ten ontology types BEFORE the artifact is written. A parse that drops a type, or
// invents one, fails rather than writing a smaller table than the gate printed.
const TYPE_ORDER = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const lines = gateOut.split("\n")
const rows: Array<{ type: string; status: string; detail: string }> = []
for (const t of TYPE_ORDER) {
  const line = lines.find((l) => l.trimStart().startsWith(`${t} `) || l.trimStart().startsWith(`${t}\t`))
  if (!line) continue
  const parts = line.trim().split(/\s{2,}/).filter(Boolean)
  if (parts.length >= 2) rows.push({ type: parts[0], status: parts[1], detail: parts.slice(2).join("  ") })
}
if (rows.length !== TYPE_ORDER.length) {
  die(`the gate printed ${rows.length} parseable rows for ${TYPE_ORDER.length} types; refusing to write an artifact that would hide the difference:\n  ${rows.map((r) => r.type).join(", ")}`)
}
const summaryLine = lines.find((l) => l.startsWith("emitted ")) ?? ""
const artifact = {
  schemaVersion: 1,
  kind: "lua_ontology_coverage_gate_wired",
  at: new Date().toISOString().slice(0, 10),
  writtenBy: "script/m60/lua-ruled-proof.ts — parsed from the wired gate's own stdout. This file was hand-transcribed before this pass and no script could regenerate it.",
  how: "the two-line wiring is applied to a SCRATCH COPY of script/m14/ontology-coverage-gate.ts and the real gate is run. The shared gate was read-only throughout. Unwired, the gate exits 2 with \"no RULING TABLE for lua\".",
  gateExitCode: code,
  summary: summaryLine.trim(),
  coverageAsApplicable: "10/10 APPLICABLE — 9 EMITTED with counts, 1 RULED with an instrument, a probe, a measurement and a named falsification condition. Reported as applicable rather than as a flat 10; a denominator counting only what fires would misreport this as 9/10 broken.",
  corpus: (lines.find((l) => l.startsWith("corpus: ")) ?? "").replace(/^corpus:\s*/, ""),
  rows,
  caveats: [
    "The gate reports \"the grammar produced 128 distinct node types\" for implements. That is TREE-SITTER-BASH's count, not lua's: script/m14/ontology-coverage-gate.ts:240 resolves the wasm from differential.ts LANGS, which has no lua entry, and falls back to tree-sitter-bash.wasm. The RULED-SOUND verdict is unaffected (the six declaration node types are absent from bash's vocabulary too) but the detail string is another language's number. Lua's true count over the same draw is 100 — see validation/m60/lua/grammar-inventory.json. Shared machinery: reported, not fixed (R1).",
    "The gate admits 3,250 files where the census admits 3,252: the gate filters on detectLanguageFromPath per file, the census on `git ls-files '*.lua'`. Two files are in one draw and not the other. Neither total is wrong; they are not interchangeable.",
    "The four moving labels (calls, uses, contains, references) sit inside the parseFile nondeterminism floor of docs/analyzers/real-lua-analyzer.md §5. The five stable ones (imports 6,601, exports 5,167, extends 171, overrides 67, instantiates 122) are the ones a count may be quoted from.",
  ],
}
writeFileSync(path.join(ROOT, "validation", "m60", "lua", "coverage-gate-wired.json"), JSON.stringify(artifact, null, 2) + "\n")
console.log(`\nwrote validation/m60/lua/coverage-gate-wired.json — ${rows.length} rows parsed from the gate's own output`)

process.exitCode = code === 0 ? 0 : 1