// CORPUS_PY — the python lane's firing census.
//
// WHY THIS FILE EXISTS (I own src/ast/real-python-analyzer and this lane's
// fixtures; script/m14/firing-check-v2.mjs is shared machinery and I do not edit
// it, so the lane needs its own runner):
//
//   1. v2's LANES table has no PYTHON row (measured 2026-10-04: `grep PYTHON
//      script/m14/firing-check-v2.mjs` → nothing) and its SIGNAL table has no
//      ".py" entry, so `signalsFor` would exit(2) with "no code-bearing signals
//      defined for .py". The master needs to add both; this file is the
//      measurement that says what they should say, not a substitute for them.
//   2. The corpus dir was MISSING at handover. v2 pointed PYTHON at
//      `python-codesql`, which does not exist on disk. This file defaults to
//      `python-corpus`, acquired 2026-10-04 (5,982 .py files across django,
//      ansible, pydantic, flask, requests and CPython 3.10's own Lib/).
//
// It is v2's measurement with three lane-specific additions, all of which answer
// questions v2 does not ask:
//
//   * per-type FILE LISTS (v2 prints only two example paths for the whole lane),
//   * endpoint RESOLUTION (workstream question 5) against every symbol the
//     measured sample declares, with NOT_AN_IDENTIFIER and PLACEHOLDER_LITERAL
//     reported separately from RESOLVES:no, because they are three different
//     defects (a fabrication, a policy question, and a legitimate cross-file
//     reference an analyzer cannot see from one file),
//   * the confidence / evidenceClass distribution per type (question 6).
//
// NO REGEX ANYWHERE. Sampling uses `String.includes` on a code-bearing signal
// list; name-shape and placeholder tests are char-code scans. Per rule 1, a
// regex over source text matches comments and string literals.
//
// Usage:
//   BB_CORPUS=$HOME/fixtures/repositories/python-corpus \
//   NFILES=200 bun script/m14/python-lane-census.mjs
//   NFILES=0 bun script/m14/python-lane-census.mjs            # whole corpus
//   LANE=django NFILES=200 bun script/m14/python-lane-census.mjs   # one repo
//   OUT=/tmp/x.json bun script/m14/python-lane-census.mjs      # machine-readable
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "$HOME/backbencher-brain"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories/python-corpus"
const NFILES = Number(process.env.NFILES ?? "200")
const LANE = process.env.LANE || ""
const OUT = process.env.OUT || ""
const MAX_BYTES = 400_000 // v2's own cap, kept identical so the numbers compare
const MAX_PARSE_FILES = Number(process.env.MAX_FILES ?? "0") // 0 = no cap

// v2's own code-bearing rule for python, written the way v2 writes them: a file
// must contain at least one declaration keyword. Data/config files (setup.py
// with a dict of strings, generated tables) do not.
const SIGNAL = ["def ", "class ", "import ", "async def ", "from "]

function collectFiles(dir, exts, want, sigs) {
  const out = []
  const walk = (d, depth) => {
    if (out.length >= want || depth > 24) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) {
        // String test, not a regex: these are the two directory names that
        // would blow up a census (vcs metadata and installed trees).
        if (e.name === "node_modules" || e.name === ".git") continue
        walk(p, depth + 1)
      } else if (e.name.endsWith(exts)) {
        try {
          if (statSync(p).size >= MAX_BYTES) continue
          const src = readFileSync(p, "utf8")
          let hit = false
          for (const s of sigs) if (src.includes(s)) { hit = true; break }
          if (!hit) continue
          out.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  // Deterministic order: v2 takes walk order, which is readdir order and is not
  // stable across machines. Sorting is what makes "re-run at a different
  // NFILES" a nested sample rather than a different sample.
  out.sort()
  return out.slice(0, want)
}

/** A python name: identifier chars plus the dots a qualified endpoint carries.
 *  Anything else (whitespace, brackets, parens, quotes) is not a name any
 *  python declaration can carry — a fabrication, not a reference. */
function nameShapeOk(s) {
  if (!s) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok =
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") ||
      c === "_" || c === "." || c === "*" || c === ":"
    if (!ok) return false
  }
  return true
}

// R7's placeholder literals. Stand-ins for an absent name, not names.
const PLACEHOLDERS = new Set([
  "unknown", "anonymous", "TODO", "todo", "n/a", "N/A", "default", "unknown_symbol",
  "unnamed", "<unknown>", "placeholder",
])

function isPlaceholder(s) {
  if (!s) return false
  if (PLACEHOLDERS.has(s)) return true
  // `Foo.bar` where the LEAF is a placeholder is the same defect one segment in.
  const parts = s.split(".")
  for (const p of parts) if (PLACEHOLDERS.has(p)) return true
  return false
}

function leaf(s) {
  const i = s.lastIndexOf(".")
  return i >= 0 ? s.slice(i + 1) : s
}

const { getParser, ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const mod = await import(`${REPO}/src/ast/real-python-analyzer.ts`)
const Cls = Object.values(mod).find((v) => typeof v === "function" && v.name.endsWith("Analyzer"))
if (!Cls) { console.error("no analyzer class exported"); process.exit(2) }
const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]
const ALL_TYPES = PROD.slice()

const dirs = LANE ? [join(CORPUS, LANE)] : [CORPUS]
let files = []
for (const d of dirs) files = files.concat(collectFiles(d, ".py", NFILES === 0 ? 1e9 : NFILES, SIGNAL))
if (MAX_PARSE_FILES) files = files.slice(0, MAX_PARSE_FILES)
files.sort()

console.log(`CORPUS_PY census  repo=${REPO}  corpus=${CORPUS}${LANE ? " lane=" + LANE : ""}`)
console.log(`NFILES=${NFILES}  sampled=${files.length}  sampling=code-bearing(signal list, ${SIGNAL.length} tokens)  cap=${MAX_BYTES}B`)

const relTally = new Map()          // type -> count
const filesByType = new Map()       // type -> Set<file>
const confTally = new Map()         // `${type}|${conf}|${evidenceClass}` -> count
const resTally = new Map()          // `${type}|srcRes|srcLeaf|tgtRes|tgtLeaf` -> count
const badSamples = []               // non-identifier / empty endpoints
const phTally = new Map()           // `${SOURCE|TARGET}|${type}|${name}` -> count
const perTypeRelCount = new Map()
const names = new Set()             // every declared symbol name (bare)
const qualified = new Set()         // owner.name
const modules = new Set()           // module stems, for `module:item` import targets
let imports = 0, filesWithImports = 0, exports = 0, symbols = 0, errors = 0, filesWithErrors = 0
let parsed = 0, failed = 0
let importTargetSample = []

function bump(m, k, n = 1) { m.set(k, (m.get(k) || 0) + n) }

for (const f of files) {
  let res, content
  try {
    content = readFileSync(f, "utf8")
    const parser = await getParser("python")
    const pr = await parser.parse(content, f)
    res = new Cls().analyze(pr.rootNode, content, f)
    parsed++
  } catch (e) {
    failed++
    continue
  }
  for (const s of res.symbols || []) {
    symbols++
    names.add(s.name)
    if (s.ownerName) qualified.add(`${s.ownerName}.${s.name}`)
    modules.add(s.name)
  }
  const stem = f.split("/").pop().split(".")[0]
  modules.add(stem)
  const imps = res.imports || []
  imports += imps.length
  if (imps.length) filesWithImports++
  exports += (res.exports || []).length
  const errs = res.errors || []
  errors += errs.length
  if (errs.length) filesWithErrors++

  for (const r of res.relationships || []) {
    const t = r.relationshipType ?? r.type
    if (!t) continue
    bump(relTally, t)
    bump(perTypeRelCount, t)
    if (!filesByType.has(t)) filesByType.set(t, new Set())
    filesByType.get(t).add(f)
    // evidenceClass lives on metadata (classifyEvidenceTier writes
    // md.evidenceClass, real-python-analyzer.ts:2217-2238). Reading it off the
    // top level reports "(none)" for every edge in the fleet and looks like a
    // defect that is not there — recorded here because this probe's first run
    // made exactly that mistake.
    const conf = String(r.confidence)
    const ec = String(r.evidenceClass ?? r.metadata?.evidenceClass ?? "(none)")
    bump(confTally, `${t}|${conf}|${ec}`)
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    const sOk = nameShapeOk(src), tOk = nameShapeOk(tgt)
    // An `imports` target is `<modulePath>:<item>` BY CONTRACT (types.ts
    // ImportInfo), so "does that string name a symbol this corpus declares" is
    // the wrong question for it — the module half is what has to be real, and
    // python's `import x.y.z` names a module path, not a declared symbol.
    const tIsModule = t === "imports" && tgt.includes(":")
    const tModuleOk = tIsModule && modules.has(tgt.slice(0, tgt.lastIndexOf(":")))
    const sRes = sOk && (names.has(src) || qualified.has(src) || names.has(leaf(src)))
    const tRes = tOk && (tIsModule ? tModuleOk : (names.has(tgt) || qualified.has(tgt) || names.has(leaf(tgt))))
    bump(resTally, `${t}|${sRes}|${sOk}|${tRes}|${tOk}`)
    const sPh = isPlaceholder(src), tPh = isPlaceholder(tgt)
    if (sPh) bump(phTally, `SOURCE|${t}|${src}`)
    if (tPh) bump(phTally, `TARGET|${t}|${tgt}`)
    if (!sOk || !tOk || !src || !tgt) {
      if (badSamples.length < 40) {
        badSamples.push(`${t}  ${JSON.stringify(src)} -> ${JSON.stringify(tgt)}  ${f}:${r.line ?? r.line_number ?? "?"}`)
      }
    }
    if (t === "imports" && importTargetSample.length < 5) importTargetSample.push(`${src} -> ${tgt}`)
  }
}

const fired = ALL_TYPES.filter((t) => relTally.has(t))
const silent = ALL_TYPES.filter((t) => !relTally.has(t))
const offEnum = [...relTally.keys()].filter((t) => !PROD.includes(t))

console.log(`\nparsed ${parsed}/${files.length}  failed=${failed}  symbols=${symbols}  errors=${errors} in ${filesWithErrors} files`)
console.log(`imports[] channel: ${imports} imports in ${filesWithImports} files   exports[]: ${exports}`)
console.log(`relationship channel: ${[...relTally.values()].reduce((a, b) => a + b, 0)} edges over ${relTally.size} types`)
console.log(`\nVERDICT ${fired.length}/10 fired   silent: ${silent.join(" ") || "(none)"}`)
if (offEnum.length) console.log(`OFF-ENUM (not a production relationship type): ${offEnum.join(" ")}`)

console.log(`\n--- per type: count | files | confidence x evidenceClass | endpoints resolve ---`)
for (const t of ALL_TYPES) {
  const n = relTally.get(t)
  if (!n) { console.log(`${t.padEnd(13)} ABSENT from the relationship channel in this sample`); continue }
  const fs_ = filesByType.get(t)
  const conf = [...confTally.entries()].filter(([k]) => k.startsWith(t + "|"))
    .map(([k, v]) => `${k.slice(t.length + 1)}=${v}`).join(" ")
  let rTot = 0, rBoth = 0, rLines = []
  for (const [k, v] of resTally.entries()) {
    if (!k.startsWith(t + "|")) continue
    const parts = k.split("|")
    // parts: [type, srcRes, srcShapeOk, tgtRes, tgtShapeOk]
    rTot += v
    const both = (parts[1] === "true" ? 1 : 0) + (parts[3] === "true" ? 1 : 0)
    if (both === 2) rBoth += v
    const badShape = (parts[2] === "false" ? 1 : 0) + (parts[4] === "false" ? 1 : 0)
    if (badShape > 0) rLines.push(`shape-bad=${v}`)
  }
  const pct = rTot ? ((100 * rBoth) / rTot).toFixed(1) : "0.0"
  console.log(`${t.padEnd(13)} ${String(n).padStart(6)} edges in ${String(fs_.size).padStart(4)} files  bothEndpointsResolve=${pct}%${rLines.length ? " " + rLines.join(" ") : ""}`)
  console.log(`${"".padEnd(13)} conf: ${conf || "(none)"}`)
  console.log(`${"".padEnd(13)} files: ${[...fs_].slice(0, 4).map((x) => x.replace(CORPUS + "/", "")).join("  ")}`)
}
console.log(`\nfiles per type (all, relative to corpus):`)
for (const t of ALL_TYPES) {
  const fs_ = filesByType.get(t)
  if (!fs_) continue
  console.log(`  ${t.padEnd(13)} ${fs_.size}`)
}
if (badSamples.length) {
  console.log(`\nNON-IDENTIFIER / EMPTY endpoint samples (up to 40) — these are fabrications:`)
  for (const b of badSamples) console.log("  " + b)
} else {
  console.log(`\nR7 shape: no non-identifier and no empty endpoint in this sample`)
}
// R7 placeholder literals, counted per SIDE. A placeholder on the SOURCE side is
// a synthetic scope standing in for an absent name (the M60 GENERIC_SOURCE_NAMES
// class); on the TARGET side it needs adjudication, because `default` is ALSO an
// ordinary python attribute name (`model_fields[x].default`) and calling every
// such read a placeholder would report a real edge as debt.
const ph = [...phTally.entries()].sort((a, b) => b[1] - a[1])
if (ph.length) {
  console.log(`\nR7 placeholder-literal endpoints (top 30 of ${ph.length} distinct):`)
  for (const [k, v] of ph.slice(0, 30)) console.log(`  ${String(v).padStart(6)}  ${k}`)
} else {
  console.log(`R7 placeholders: none`)
}
if (importTargetSample.length) console.log(`\nimports relationship targets: ${importTargetSample.join(" | ")}`)

if (OUT) {
  const payload = {
    generatedBy: "script/m14/python-lane-census.mjs",
    repo: REPO, corpus: CORPUS, lane: LANE || "(all)", nfiles: NFILES,
    sampledFiles: files.length, parsed, failed, symbols, errors,
    importsChannel: imports, filesWithImports, exportsChannel: exports,
    fired, silent,
    perType: ALL_TYPES.map((t) => ({
      type: t, edges: relTally.get(t) || 0, files: (filesByType.get(t) || new Set()).size,
      fileList: [...(filesByType.get(t) || new Set())].slice(0, 50),
    })),
    confidence: [...confTally.entries()].map(([k, v]) => ({ key: k, count: v })),
  }
  writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(`\nwrote ${OUT}`)
}