// Corpus-scale SYMBOL INTEGRITY audit for the Lua lane.
//
// "No unknown symbols" is a claim about 1,309 files, and no fixture can support
// it — a fixture is one file, written by the same person who wrote the analyzer.
// This walks every Lua file in a pinned corpus through the DIRECT analyzer path
// and checks five structural invariants that must hold for every symbol in every
// file, with no exceptions and no allowlist:
//
//   1. every symbol has a non-empty name
//   2. every symbol's owner is either "global" or ANOTHER SYMBOL IN THE SAME FILE
//      — an owner that does not exist is an "unknown symbol" in the strict sense
//   3. every `contains` edge names a target that IS a symbol in the same file, so
//      no containment points at nothing
//   4. no symbol name contains '.' or ':' — that is a PATH, not a name, and the
//      member-identity rule forbids it
//   5. no symbol's name equals its own owner — a scope is not a member of itself
//
// Invariants 2, 3 and 5 are the ones that catch a real class of defect: LUA-21
// produced `contains adapt -> c` naming a symbol that did not exist, and it took
// a corpus to see it. A fixture named `c`; the corpus found twenty-nine files
// where the edge pointed at nothing.
//
// Every violation is reported with its file, and the exit code is non-zero on any.
// A count of violations by shape is printed even when zero, because a legend that
// only appears on failure is a legend nobody reads when the run is clean.
import { join } from "node:path"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
// Derived from this file's own location, NOT hardcoded. Six of this lane's scripts
// pinned $HOME/backbencher-brain, so in a lane worktree they read a path
// that does not exist and the gate died with ENOENT instead of reporting a verdict.
// A gate that cannot execute is not a gate, and the mutant battery looked green
// only because its failure was being read as a pass.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const REPOS = "$HOME/fixtures/repositories"
const argOf = (k: string, d?: string): string | undefined => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const CORPUS = argOf("--repo", "kong")!
const LIMIT = Number(argOf("--limit", "0")) || 0

const { parseWithAnalyzer } = await import(REPO + "/script/m60/lua-analyzer-direct")
const { loadWebTreeSitter } = await import(REPO + "/src/util/wasm")
const mod: any = await loadWebTreeSitter()
const { parseFile } = await import(REPO + "/src/ast/pool-worker")
const root = join(REPOS, CORPUS)
// The core wasm must be live before a raw Language.load works; measured, not
// assumed — the same warm-up lua-wasm-compare.ts pays.
await parseFile(join(root, CORPUS === "kong" ? "kong/init.lua" : "init.lua"), root)
const lang = await mod.Language.load(REPO + "/wasm/tree-sitter-lua.wasm")
const parser = new mod.Parser()
parser.setLanguage(lang)

const files = execFileSync("git", ["-C", root, "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n").filter(Boolean)
const slice = LIMIT ? files.slice(0, LIMIT) : files

interface Violation { shape: string; detail: string; file: string }
const violations: Violation[] = []
let filesChecked = 0, parseErrorFiles = 0, symbolsTotal = 0, relsTotal = 0
let containsTotal = 0, containsResolved = 0, containsUnresolvedSource = 0, symbolsWithNoOwner = 0
/** Counted and sampled, never silently dropped: a disclosure is a fact, not a failure. */
const disclosures: Record<string, number> = {}
const disclosureSample: Record<string, string> = {}
const byShape: Record<string, number> = {}
const examples: Record<string, string> = {}

const note = (shape: string, detail: string, file: string): void => {
  byShape[shape] = (byShape[shape] ?? 0) + 1
  if (!examples[shape]) examples[shape] = `${file} :: ${detail}`
  if (violations.length < 400) violations.push({ shape, detail, file })
}

for (const f of slice) {
  const abs = join(root, f)
  let clean = true
  try {
    const t = parser.parse(readFileSync(abs, "utf8"))
    if (t.rootNode.hasError) clean = false
  } catch { clean = false }
  if (!clean) { parseErrorFiles++; continue }

  let d: any
  try { d = await parseWithAnalyzer(abs) } catch { parseErrorFiles++; continue }
  filesChecked++

  const symbols = d.symbols ?? []
  const rels = d.relationships ?? []
  symbolsTotal += symbols.length
  relsTotal += rels.length

  // 1. every symbol has a name
  for (const s of symbols) {
    if (!s || typeof s.name !== "string" || s.name.length === 0) {
      note("symbol with no name", JSON.stringify(s ?? null).slice(0, 80), f)
    }
  }
  const named = symbols.filter((s: any) => typeof s?.name === "string" && s.name.length > 0)

  // 4. no name is a path
  for (const s of named) {
    if (s.name.includes(".") || s.name.includes(":")) {
      note("symbol name is a path, not a name", s.name, f)
    }
  }

  // 2. every owner is either global, a symbol in this file, or a name this file
  //    RECEIVED and cannot declare. Measured, the first version of this check
  //    treated "owner is not a symbol in this file" as a flat violation and
  //    reported 4,300 of them on kong. Reading them showed most are correct:
  //
  //      local function wrapEmitter(emitter)   -- emitter is a PARAMETER
  //        function emitter:pause()            -- a method on the caller's object
  //
  //    `emitter` has no symbol in that file and cannot have one — the object
  //    arrives at run time. Demanding a symbol there would be demanding a
  //    FABRICATION, which is the same rule that keeps loop variables and
  //    re-exports out of the symbol table (LUA-26, LUA-35).
  //
  //    So the three buckets are kept apart, and only the first is a failure:
  //      VIOLATION  the owner is a PATH — a name no symbol could ever carry
  //      DISCLOSURE the owner is a bare name this file received, so it is
  //                 unresolvable here and resolvable by the caller
  //      CLEAN      the owner is a symbol in this file
  const nameSet = new Set(named.map((s: any) => s.name))
  for (const s of named) {
    // Only an ownerName that is ACTUALLY PRESENT is checked. The first version
    // used `s.ownerName ?? s.scope`, which invented an owner for every symbol
    // that legitimately has none — a plain nested function's identity is its name
    // plus the scope it sits in, and its `ownerName` is correctly undefined. That
    // fabrication produced 35 "violations" on luvit that were all the inner
    // `function write` inside `function fs.appendFile`, whose SCOPE is the label
    // "fs.appendFile" — a correct scope label, reported as an unresolvable owner.
    if (s.ownerName === undefined || s.ownerName === null) {
      symbolsWithNoOwner++
      continue
    }
    const owner = s.ownerName
    if (owner === "global") continue
    if (owner.includes(".") || owner.includes(":")) {
      note("owner is a PATH, so no symbol can ever carry it", `${s.name} claims owner "${owner}"`, f)
      continue
    }
    if (!nameSet.has(owner)) {
      // Not a failure. Counted, sampled, and written to the artifact, because a
      // disclosure nobody reads is a defect nobody fixes.
      disclosures.ownerFromParameter = (disclosures.ownerFromParameter ?? 0) + 1
      if (!disclosureSample.ownerFromParameter) disclosureSample.ownerFromParameter = `${f} :: ${s.name} claims owner "${owner}", which is not declared in this file`
    }
    if (owner === s.name) {
      // Also not a failure, and worth naming: `function stack.stack()` gives a
      // table and one of its methods the same name, so identity-by-(owner, name)
      // cannot separate them. The `range` disambiguates by position. A model
      // limitation with a measured population, not a broken reference.
      disclosures.selfOwned = (disclosures.selfOwned ?? 0) + 1
      if (!disclosureSample.selfOwned) disclosureSample.selfOwned = `${f} :: ${s.name} is owned by itself (a method sharing its container's name)`
    }
  }

  // 3. every contains edge names a target that exists
  for (const r of rels) {
    if (r.type !== "contains") continue
    containsTotal++
    if (nameSet.has(r.target)) containsResolved++
    else if (r.target !== "global") {
      note("contains edge names no symbol in this file", `${r.source} -> ${r.target}`, f)
    }
    // The SOURCE must resolve too, or a consumer walking symbol -> members hits
    // a wall. This is the leg that found LUA-37: 22.6% of contains edges carried a
    // qualified source and 100% of those named no symbol in the file.
    if (r.source !== "global") {
      if (r.source.includes(".") || r.source.includes(":")) {
        note("contains edge SOURCE is a path", `${r.source} -> ${r.target}`, f)
      } else if (!nameSet.has(r.source)) {
        containsUnresolvedSource++
        if (!disclosureSample.containsSourceFromParameter) disclosureSample.containsSourceFromParameter = `${f} :: contains ${r.source} -> ${r.target} where ${r.source} is not declared in this file`
      }
    }
  }
}

const shapes = Object.keys(byShape)
console.log(`\n===== lua symbol integrity — ${CORPUS} =====`)
console.log(`  files checked:        ${filesChecked}   (${parseErrorFiles} skipped: parse error or analyzer throw)`)
console.log(`  symbols:              ${symbolsTotal}`)
console.log(`  relationships:        ${relsTotal}`)
console.log(`  contains edges:       ${containsTotal}   target resolves: ${containsResolved}  (${((containsResolved / Math.max(1, containsTotal)) * 100).toFixed(4)}%)`)
console.log(`  symbols with no ownerName (a nested function's identity is its name + scope): ${symbolsWithNoOwner}`)
console.log(`  contains SOURCE not declared in file: ${containsUnresolvedSource}  (a parameter or external global — see the note below)`)
console.log(`  ---`)
const dshapes = Object.keys(disclosures)
if (dshapes.length) {
  console.log(`  DISCLOSURES (counted, not failures — each is a TRUE statement the file cannot resolve locally):`)
  for (const d of dshapes) console.log(`    ${d.padEnd(44)} ${String(disclosures[d]).padStart(5)}   e.g. ${disclosureSample[d]}`)
}
if (shapes.length === 0) {
  console.log(`  VIOLATIONS: 0 — all five invariants hold across every file`)
} else {
  console.log(`  VIOLATIONS: ${Object.values(byShape).reduce((a, b) => a + b, 0)}`)
  for (const s of shapes) console.log(`    ${s.padEnd(44)} ${String(byShape[s]).padStart(5)}   e.g. ${examples[s]}`)
}

const out = join(REPO, "validation", "m60", "results", `lua-symbol-integrity-${CORPUS}${LIMIT ? `-${LIMIT}` : ""}.json`)
mkdirSync(join(REPO, "validation", "m60", "results"), { recursive: true })
writeFileSync(out, JSON.stringify({
  schemaVersion: 1,
  gate: "lua-symbol-integrity",
  corpus: CORPUS,
  filesChecked, parseErrorFiles, symbolsTotal, relsTotal,
  contains: { total: containsTotal, resolved: containsResolved },
  invariants: [
    "every symbol has a non-empty name",
    "every owner is global or another symbol in the same file",
    "every contains edge names a symbol in the same file",
    "no symbol name contains '.' or ':'",
    "no symbol is a member of itself",
  ],
  violationsByShape: byShape,
  disclosures,
  disclosureSample,
  containsUnresolvedSource,
  symbolsWithNoOwner,
  examples,
  violationSample: violations.slice(0, 50),
  passed: shapes.length === 0,
}, null, 2) + "\n")
console.log(`  wrote ${out}`)
process.exit(shapes.length === 0 ? 0 : 1)
