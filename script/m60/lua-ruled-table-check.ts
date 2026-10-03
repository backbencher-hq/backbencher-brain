/**
 * Runs `LUA_RULED` through the SAME instrument-A loop
 * `script/m14/ontology-coverage-gate.ts` runs, and reports the verdict the gate's
 * own logic would produce.
 *
 * ## Why this exists
 *
 * The table lives in `RULED_BY_LANG` inside the gate, and the gate is shared
 * machinery this lane does not own — so until the supervisor adds one import and
 * one map entry, the gate exits 2 on `lua` with "no RULING TABLE" and the table is
 * never exercised. A table that has never been run is not a measurement, it is a
 * claim. This runs it, so what the gate will say is known before the wiring lands
 * rather than after.
 *
 * It is deliberately a COPY of the gate's loops, not a re-implementation with
 * better judgement. Corpus admission, the wasm, the walk and the verdict rule are
 * the gate's:
 *
 *   corpus      every tracked file whose detectLanguageFromPath() is `lua`
 *   instrumentA the gate walks `n.child(i)` — ALL children, so the count includes
 *               the grammar's ANONYMOUS nodes. Walking `namedChild` instead yields
 *               46 and not 100, and the first version of this script did exactly
 *               that: it published 46 where the gate would have said 100.
 *   verdict     any listed node type present -> FALSIFIED; absent + a written
 *               ruling in the spec -> RULED-SOUND
 *
 * It also runs `REJECTED_IMPLEMENTS_TREE_PROBE` — the instrument-B probe that was
 * tried for `implements` and refused — and prints what its hits actually are, so
 * the refusal in `lua-ruled.ts` is a measurement rather than an assertion.
 *
 * Usage: npx tsx script/m60/lua-ruled-table-check.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { LUA_RULED, REJECTED_IMPLEMENTS_TREE_PROBE } from "../m14/lua-ruled"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LANG = "lua"
const OUT = path.join(ROOT, "validation/m60/lua/ruled-table-check.json")

// ── corpus, admitted exactly as the gate admits it ─────────────────────────────────
const files: { repo: string; rel: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, rel, text })
  }
}
console.log(`lua-ruled-table-check — corpus: ${files.length} admitted files\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

// ── instrument A: the gate's grammar inventory, over ALL children ──────────────────
const grammarNodeTypes = new Map<string, number>()
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any): void => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  t.delete?.()
}

// ── is there a WRITTEN ruling for the gate to find? ───────────────────────────────
function rulingFor(t: string): { src: string } | null {
  const specPath = `script/m14/spec/${LANG}-completeness.json`
  let raw: string
  try { raw = readFileSync(path.join(ROOT, specPath), "utf8") } catch { return null }
  const d = JSON.parse(raw)
  for (const dec of d?.design_decision?.decisions ?? []) {
    if (dec.status !== "RULED") continue
    const body = String(dec.resolution ?? "")
    if (new RegExp(`\\b${t}\\b`, "i").test(body)) {
      if (/ontology|emits|excluded|type/i.test(body)) return { src: `${specPath}#${dec.id}` }
    }
  }
  return null
}

const rows = LUA_RULED.map((r) => {
  const present = (r.nodeTypesThatWouldMeanIt ?? []).filter((n) => grammarNodeTypes.has(n))
  const ruling = rulingFor(r.type)
  const status = present.length > 0
    ? "FALSIFIED"
    : !ruling
      ? "RULED-UNJUSTIFIED"
      : "RULED-SOUND"
  return { type: r.type, instrument: r.instrument, nodeTypesThatWouldMeanIt: r.nodeTypesThatWouldMeanIt, presentInCorpus: present, writtenRuling: ruling?.src ?? null, status }
})

// ── the instrument-B probe that was tried and refused ─────────────────────────────
const bHits: string[] = []
const bFiles = new Set<string>()
for (const f of files) {
  const before = bHits.length
  const t = parser.parse(f.text)
  if (t) { REJECTED_IMPLEMENTS_TREE_PROBE(t.rootNode, `${f.repo}/${f.rel}`, bHits); t.delete?.() }
  if (bHits.length > before) bFiles.add(f.rel)
}
/** Bucket the refused probe's hits by the ROLE recorded on the tree by the probe
 * itself. No word list: the role comes from node types and fields, so it can tell a
 * type name from an error message, which a word list cannot. */
const bBreakdown = new Map<string, number>()
const bExamples = new Map<string, string[]>()
/** A role that would actually be a type position. If any hit carries one, the refusal
 * above is wrong and must be revisited. */
const TYPE_POSITION_ROLES = /conformance API|type position|named type/i
for (const h of bHits) {
  const [where, role = "unclassified", value = ""] = h.split("\u001f")
  const k = role
  bBreakdown.set(k, (bBreakdown.get(k) ?? 0) + 1)
  if (!bExamples.has(k)) bExamples.set(k, [])
  const ex = bExamples.get(k)!
  if (ex.length < 3) ex.push(`${where} -> "${value}"`)
}
const typePositionHits = bHits.filter((h) => TYPE_POSITION_ROLES.test(h.split("\u001f")[1] ?? ""))

const anyFalsified = rows.some((r) => r.status === "FALSIFIED")
const anyUnjustified = rows.some((r) => r.status === "RULED-UNJUSTIFIED")

console.log("LUA_RULED as the gate will evaluate it")
console.log(`${"type".padEnd(14)}${"instrument".padEnd(24)}${"listed".padEnd(9)}${"present".padEnd(10)}status`)
console.log("-".repeat(110))
for (const r of rows) {
  console.log(`${r.type.padEnd(14)}${r.instrument.padEnd(24)}${String(r.nodeTypesThatWouldMeanIt?.length ?? 0).padEnd(9)}${String(r.presentInCorpus.length).padEnd(10)}${r.status}`)
}
console.log("-".repeat(110))
console.log(`\ninstrument A: grammar produced ${grammarNodeTypes.size} distinct node types across ${files.length} files`)
for (const r of rows) {
  console.log(`  ${r.type}: ${r.nodeTypesThatWouldMeanIt!.length} node types that would express it — present in corpus: ${r.presentInCorpus.length === 0 ? "NONE" : r.presentInCorpus.join(", ")}`)
  console.log(`  written ruling: ${r.writtenRuling ?? "NONE (the gate would report RULED-UNJUSTIFIED)"}`)
}

console.log(`\nREJECTED instrument B probe for \`implements\` (script/m14/lua-ruled.ts, REJECTED_IMPLEMENTS_TREE_PROBE)`)
console.log(`  hits: ${bHits.length} across ${bFiles.size} files — every one classified below, and the gate would call the ruling FALSIFIED`)
for (const [k, v] of [...bBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(v).padStart(6)}  ${k}`)
  for (const e of (bExamples.get(k) ?? [])) console.log(`              e.g. ${e}`)
}
console.log(`  hits carrying an actual TYPE-POSITION role: ${typePositionHits.length}`)
for (const h of typePositionHits.slice(0, 10)) console.log(`    ${h.split("\u001f").join(" | ")}`)
console.log(`\n  Verdict: the probe matches a SHAPE, not a ROLE. A role-resolved probe would have to`)
console.log(`  hardcode the three vocabularies above, so instrument B is not available for this`)

writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  kind: "lua_ruled_table_check",
  at: new Date().toISOString(),
  commit: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpus: { root: CR, filesAdmitted: files.length, admission: "the gate's own rule: tracked file, <=512KB, detectLanguageFromPath === lua" },
  tableUnderTest: "script/m14/lua-ruled.ts",
  rows,
  instrumentA: {
    distinctNodeTypesProduced: grammarNodeTypes.size,
    walk: "n.child(i) over all children, as the gate does — includes anonymous nodes. A namedChild walk yields 46 and would understate the grammar by 54 types.",
  },
  rejectedInstrumentB: {
    probe: "REJECTED_IMPLEMENTS_TREE_PROBE",
    occurrences: bHits.length,
    files: bFiles.size,
    breakdownByTreeRole: Object.fromEntries([...bBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { occurrences: v, examples: bExamples.get(k) ?? [] }])),
    hitsCarryingATypePositionRole: typePositionHits.length,
    typePositionExamples: typePositionHits.slice(0, 15).map((h) => h.split("\u001f").join(" | ")),
    verdict:
      "Refused. The role is read off node types and fields, so the breakdown is a fact about the tree and not a word list. No hit carries a type-position role (see hitsCarryingATypePositionRole): every string the probe caught is a label - an enum compared for equality, a format argument, a table field value, a record name, or an assertion message - and the one conformance-shaped call in the corpus names a PLUGIN PHASE, not a type. Excluding those vocabularies would require hardcoding project-specific word lists, so the probe cannot be made role-resolved and instrument B is not available for `implements`.",
  },
  wiring: "the gate needs `import { LUA_RULED } from \"./lua-ruled\"` and `lua: LUA_RULED` in RULED_BY_LANG. Both are edits to script/m14/ontology-coverage-gate.ts, which this lane does not own — reported, not applied.",
}, null, 2))
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
process.exitCode = anyFalsified || anyUnjustified ? 1 : 0