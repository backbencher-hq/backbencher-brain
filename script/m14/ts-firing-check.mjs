// ts-firing-check.mjs — VERIFY_TS10's copy of the firing measurement, pointed at
// THIS worktree.
//
// WHY A COPY, and what it does and does not change.
//
// `script/m14/firing-check-v2.mjs` is MASTER-owned and its REPO is a hardcoded
// absolute path to the main checkout:
//
//     const REPO = "$HOME/backbencher-brain"
//
// so running it from a lane worktree measures the MAIN checkout's analyzer, not
// the branch under review. That is fine for a lane that has changed nothing and
// wrong for every lane that has — including this one, which changed the analyzer.
// Editing the shared file is not this lane's to do, so the measurement is
// reproduced here with REPO derived from this script's own location.
//
// WHAT IS REPRODUCED VERBATIM, because each of these is a correction that was
// measured and reverting any of them would make the number mean something else
// (docs/analyzers/REVIEW-2026-10-04.md):
//   * the production path: getParser -> parse -> analyze;
//   * the code-bearing SIGNAL filter per extension (blind walk-order sampling is
//     what scored Ruby 1/10 at NFILES=25 and 8/10 at NFILES=200 on one corpus);
//   * the DENOMINATOR: engine.ts's ASTEngine.RelationshipType, because
//     types.ts's `Imports` reads "brain_import" and no emitter produces it;
//   * the TWO CHANNELS reported separately — `relationships[]` and `imports[]`
//     (src/ast/types.ts:206-216), because the old instrument tallied only the
//     first and compared against the second;
//   * an unmatched lane exits non-zero instead of printing an empty table.
//
// NO REGEX.
//
// Usage:
//   bun script/m14/ts-firing-check.mjs [--repo element-plus] [--files 200]

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const argOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = argOf("--repo") ?? "element-plus"
const NFILES = Number(argOf("--files") ?? process.env.NFILES ?? "200")
const EXTS = [".ts", ".tsx"]

// Verbatim from firing-check-v2.mjs's SIGNAL table.
const SIGNAL = { ".ts": ["function ", "export ", "class ", "const "], ".tsx": ["function ", "export ", "class ", "const "] }

const endsWithAny = (n, exts) => {
  for (const e of exts) if (n.endsWith(e)) return true
  return false
}

const dir = join(CORPUS, REPO)
const files = []
let seen = 0
;(function walk(d, depth) {
  if (files.length >= NFILES || depth > 20) return
  let ents
  try {
    ents = readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (files.length >= NFILES) return
    const p = join(d, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      walk(p, depth + 1)
    } else if (endsWithAny(e.name, EXTS)) {
      seen++
      try {
        if (statSync(p).size >= 400_000) continue
        const src = readFileSync(p, "utf8")
        let ok = false
        for (const k of SIGNAL[endsWithAny(e.name, [".tsx"]) ? ".tsx" : ".ts"]) if (src.includes(k)) { ok = true; break }
        if (!ok) continue
        files.push(p)
      } catch {}
    }
  }
})(dir, 0)

if (!files.length) {
  console.error(`ts-firing-check: no code-bearing .ts/.tsx under ${dir}. This is NOT a pass.`)
  process.exit(2)
}

const { getParser, ASTEngine } = await import(`${REPO_ROOT}/src/ast/engine.ts`)
const mod = await import(`${REPO_ROOT}/src/ast/real-typescript-analyzer.ts`)
const Cls = Object.values(mod).find((v) => typeof v === "function" && v.name.endsWith("Analyzer"))
if (!Cls) {
  console.error("ts-firing-check: no analyzer class exported")
  process.exit(2)
}
const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]
const { RelationshipType } = await import(`${REPO_ROOT}/src/ast/types.ts`)
const TYPES_TS = [...new Set(Object.values(RelationshipType))]

const tally = new Map()
let imports = 0
let filesWithImports = 0
let parsed = 0
const examples = []
for (const f of files) {
  try {
    const content = readFileSync(f, "utf8")
    const parser = await getParser(f.endsWith(".tsx") ? "tsx" : "typescript")
    const pr = await parser.parse(content, f)
    const res = new Cls().analyze(pr.rootNode, content, f)
    parsed++
    const imps = res.imports || []
    imports += imps.length
    if (imps.length) filesWithImports++
    if (examples.length < 3) examples.push(f.slice(dir.length + 1))
    for (const r of res.relationships || []) {
      const t = r.relationshipType ?? r.type
      if (t) tally.set(t, (tally.get(t) || 0) + 1)
    }
  } catch {}
}
const fired = PROD.filter((t) => tally.has(t))
const silent = PROD.filter((t) => !tally.has(t))
console.log(`ts-firing-check  repo=${REPO}  NFILES=${NFILES}  analyzer=${REPO_ROOT}/src/ast/real-typescript-analyzer.ts`)
console.log(`POPULATION: ${files.length} code-bearing files drawn from ${seen} .ts/.tsx seen (readdir walk order, the same draw firing-check-v2 makes)`)
console.log(`parsed ${parsed}/${files.length}; imports[] channel ${imports} in ${filesWithImports} files`)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
console.log(`types.ts vocabulary (${TYPES_TS.length}): ${TYPES_TS.join(" ")}`)
console.log(`in types.ts but NOT produced: ${TYPES_TS.filter((t) => !PROD.includes(t)).join(" ") || "(none)"}\n`)
console.log(`RELATIONSHIP CHANNEL: ${fired.length}/10`)
console.log(`  fired:  ${fired.join(" ") || "(none)"}`)
console.log(`  silent: ${silent.join(" ") || "(none)"}`)
const top = [...tally.entries()].sort((a, b) => b[1] - a[1])
console.log(`  counts: ${top.map(([t, n]) => `${t}:${n}`).join("  ")}`)
console.log(`IMPORTS CHANNEL (the import verdict): ${imports} rows in ${filesWithImports} of ${parsed} files`)
console.log(`  e.g. ${examples.join("  ")}`)