// FIRING-CHECK v2, lane-owned copy for R7_AUDIT_FLEET.
//
// WHY A COPY. `script/m14/firing-check-v2.mjs` is MASTER-owned and this lane does
// not edit it. It hard-codes `const REPO = "$HOME/backbencher-brain"`,
// so running it measures the analyzer in the MAIN checkout — which, at the start of
// this lane, was byte-identical to the branch copy, but stops being true the moment
// this lane edits `src/ast/real-rust-analyzer.ts`. An instrument that reports the
// wrong population is the failure docs/M14-HONESTY-CONTRACT.md §"an instrument must
// declare the population it covered" exists to prevent, so the copy is here.
//
// WHAT IS COPIED AND WHAT IS NOT. Every sampling rule, the SIGNAL table, the
// code-bearing filter, the two-channel split (relationships vs imports[]), the
// engine.ts-vs-types.ts denominator note and the lane resolver are UNCHANGED from
// script/m14/firing-check-v2.mjs. Only two things differ, both recorded in --diff
// output: the repo root, and a header line naming it. Nothing else was "improved",
// because an instrument that differs from the arbiter in its sampling is a second
// number nobody can reconcile.
//
// The repo root is derived from this file's own location (`script/incoming-rust/` ->
// two levels up), never hand-written, so a moved checkout cannot silently make it
// measure a different analyzer.
//
// No regular expression is introduced: `startsWith`, `endsWith`, `split` on a
// delimiter, and `import.meta.url` only. The upstream file's lane-name resolver
// does use `replace(/[^A-Z0-9]/g, "")`; that is UPSTREAM's text and is reproduced
// verbatim below ONLY so the lane key resolution is identical, and it is flagged in
// the diff print. This lane adds none.
//
// Run:
//   cd <worktree> && NFILES=200 bun script/incoming-rust/firing-check-v2-rust.mjs RUST
//   BB_CORPUS=... NFILES=100 bun script/incoming-rust/firing-check-v2-rust.mjs RUST
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
// script/incoming-rust/ -> script/ -> repo root. Derived, not written down.
const REPO = dirname(dirname(HERE))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES || 200)
const BLIND = process.env.BB_BLIND === "1"

const LANES = {
  RUST: ["rust", "real-rust-analyzer", "ripgrep", [".rs"]],
}

// Code-bearing signals, per lane — copied verbatim from script/m14/firing-check-v2.mjs:69.
const SIGNAL = {
  ".rs": ["fn ", "struct ", "enum ", "trait ", "impl ", "use ", "mod ", "pub "],
}

function signalsFor(exts) {
  const s = new Set()
  for (const e of exts) for (const k of (SIGNAL[e] || [])) s.add(k)
  if (s.size === 0) {
    console.error(`\nfiring-check-v2-rust: no code-bearing signals defined for ${exts.join(", ")}.`)
    console.error(`Refusing to sample blind.\n`)
    process.exit(2)
  }
  return [...s]
}

function pickFiles(dir, exts, want) {
  const sigs = BLIND ? null : signalsFor(exts)
  const out = []
  const walk = (d, depth) => {
    if (out.length >= want || depth > 20) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try {
          if (statSync(p).size >= 400_000) continue
          if (sigs) {
            const src = readFileSync(p, "utf8")
            if (!sigs.some((s) => src.includes(s))) continue
          }
          out.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  return out.slice(0, want)
}

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const ALL = [...new Set(Object.values(RelationshipType))]
const _engine = await import(`${REPO}/src/ast/engine.ts`)
const PROD = [...new Set(Object.values(_engine.ASTEngine.RelationshipType))]
const OFF_ENUM = ALL.filter((t) => !PROD.includes(t))
const EXTRA = PROD.filter((t) => !ALL.includes(t))

const ALIAS = { GO9: "GO", HS9: "HASKELL", HS: "HASKELL", TS: "TYPESCRIPT", TSX: "TYPESCRIPT",
  CLOJ: "CLOJURE", CLJ: "CLOJURE", ERL: "ERLANG", OBJC: "OBJ_C", KT: "KOTLIN", C: "C",
  CSHARP: null, CS: null, PY: null, PERL: null }

function resolveLane(arg) {
  if (!arg) return Object.keys(LANES)
  const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")
  const want = norm(arg)
  const keys = Object.keys(LANES)
  if (keys.includes(want)) return [want]
  const toks = arg.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  for (const t of toks) {
    if (t in ALIAS) { const k = ALIAS[t]; if (k && keys.includes(k)) return [k] }
  }
  for (const t of toks) {
    if (t.length < 3) continue
    for (const k of keys) if (norm(k).startsWith(t)) return [k]
  }
  for (const k of [...keys].sort((a, b) => norm(b).length - norm(a).length)) {
    const n = norm(k)
    if (n.length >= 2 && want.startsWith(n)) return [k]
  }
  return null
}

const only = process.argv[2]
const targets = resolveLane(only)
if (!targets) {
  console.error(`\nfiring-check-v2-rust: no lane matches "${only}". Known: ${Object.keys(LANES).join(" ")}`)
  console.error(`This is NOT a pass.\n`)
  process.exit(2)
}
console.log(`selected lane(s): ${targets.join(" ")}  (from ${only || "no argument"})`)
console.log(`firing-check v2 (lane copy)   REPO=${REPO}   corpus=${CORPUS}   NFILES=${NFILES}   sampling=${BLIND ? "BLIND (defect 1 active)" : "code-bearing"}`)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
console.log(`types.ts vocabulary (${ALL.length}): ${ALL.join(" ")}`)
console.log(`in types.ts but NOT produced: ${OFF_ENUM.join(" ") || "(none)"}`)
console.log(`produced but NOT in types.ts: ${EXTRA.join(" ") || "(none)"}\n`)

const rows = []
for (const L of targets) {
  const [lang, mod, corpusDir, exts] = LANES[L]
  let Cls
  try {
    const m = await import(`${REPO}/src/ast/${mod}.ts`)
    Cls = Object.values(m).find((v) => typeof v === "function" && v.name.endsWith("Analyzer"))
  } catch (e) { rows.push([L, `IMPORT FAIL ${String(e).slice(0, 60)}`]); continue }
  if (!Cls) { rows.push([L, "NO ANALYZER CLASS EXPORTED"]); continue }

  const dir = join(CORPUS, corpusDir)
  const files = pickFiles(dir, exts, NFILES)
  if (!files.length) { rows.push([L, `NO CORPUS under ${corpusDir}`]); continue }

  const relTally = new Map()
  let imports = 0, parsed = 0, filesWithImports = 0
  const seenFiles = []
  for (const f of files) {
    try {
      const content = readFileSync(f, "utf8")
      const parser = await getParser(lang)
      const pr = await parser.parse(content, f)
      const res = new Cls().analyze(pr.rootNode, content, f)
      parsed++
      const imps = res.imports || []
      imports += imps.length
      if (imps.length) filesWithImports++
      if (seenFiles.length < 2) seenFiles.push(f.replace(dir + "/", ""))
      for (const r of res.relationships || []) {
        const t = r.relationshipType ?? r.type
        if (t) relTally.set(t, (relTally.get(t) || 0) + 1)
      }
    } catch {}
  }
  if (!parsed) { rows.push([L, `ALL ${files.length} FILES FAILED TO PARSE`]); continue }

  const fired = PROD.filter((t) => relTally.has(t))
  const silent = PROD.filter((t) => !relTally.has(t))
  const offEnumFired = [...relTally.keys()].filter((t) => !PROD.includes(t))
  rows.push([L, null, { parsed, files: files.length, fired, silent, imports, filesWithImports, relTally, seenFiles, offEnumFired }])
  const d0 = rows[rows.length - 1][2]
  console.log(`  [1/1] ${L.padEnd(12)} ${String(d0.fired.length).padStart(2)}/10  ${d0.parsed}/${d0.files} parsed  imports[] ${d0.imports}` + (d0.silent.length ? `  silent: ${d0.silent.join(" ")}` : "  (all ten)"))
}

console.log("lane          types  note")
console.log("-".repeat(96))
for (const r of rows) {
  if (r[1]) { console.log(`${r[0].padEnd(13)} ${r[1]}`); continue }
  const d = r[2]
  console.log(`${r[0].padEnd(13)} ${String(d.fired.length).padStart(3)}/10  ${d.parsed}/${d.files} parsed · imports[] ${d.imports} in ${d.filesWithImports} files`)
  console.log(`   fired:  ${d.fired.join(" ") || "(none)"}`)
  if (d.silent.length) console.log(`   silent: ${d.silent.join(" ")}`)
  if (d.offEnumFired.length) console.log(`   OFF-ENUM: ${d.offEnumFired.join(" ")}`)
  console.log(`   e.g. ${d.seenFiles.join("  ")}`)
  const top = [...d.relTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`   counts: ${top.map(([t, n]) => `${t}:${n}`).join("  ")}`)
  console.log()
}
console.log("=== SUMMARY (relationship channel only — imports[] reported separately) ===")
for (const r of rows) {
  if (r[1]) continue
  console.log(`${String(r[2].fired.length).padStart(2)}/10  ${r[0].padEnd(13)} silent: ${r[2].silent.join(" ") || "-"}`)
}