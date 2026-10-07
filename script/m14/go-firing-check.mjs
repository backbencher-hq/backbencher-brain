// GO FIRING CHECK — does each relationship type actually FIRE, and under which
// SPELLING?
//
// WHY THIS FILE EXISTS NEXT TO script/m14/firing-check.mjs
//
// The shared runner is MASTER-owned and its REPO constant is the main checkout.
// This lane runs inside a worktree, so the shared runner would measure another
// branch's analyzer and report it as this lane's number. The LOGIC is copied
// verbatim — same pickFiles admission rule, same production path
// (getParser -> parse -> analyze), same per-type tally — and two things are
// added, both of which the shared runner cannot see and both of which are the
// point of ENUM_SWEEP:
//
//   1. the RAW `relationship.type` string is tallied BEFORE it is folded to the
//      ontology name, so "does the analyzer emit `imports` or `brain_import`" is
//      answered by a count rather than by reading an enum;
//   2. a R7 endpoint check over every emitted edge (empty / placeholder /
//      non-identifier, and dotted endpoints, which no Go declaration may carry).
//
// NO REGULAR EXPRESSION (workstream rule 1). The shared runner uses two
// (`/node_modules|\.git|testdata|fixtures/` on a directory name and an extension
// list test). Both are replaced here with explicit string operations over path
// SEGMENTS, because a text pattern over a path is how a census admits a file the
// language never had.
//
// USAGE
//   npx tsx script/m14/go-firing-check.mjs [--corpus=<dir>] [--want=<n>]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"

const REPO = process.env.BB_LANE_REPO ?? "/tmp/opencode/wt/ENUM_SWEEP"
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const CORPUS_DIR = argOf("--corpus", "go-stdlib")
const WANT = Number(argOf("--want", "400"))
const CAP = Number(argOf("--cap", String(WANT)))

/** Directory-name exclusion, by SEGMENT equality. The shared runner's
 *  `/node_modules|\.git|testdata|fixtures/` also matches `my_testdata_dir` and
 *  `fixtures_old`; this does not, which is the point. */
const SKIP_DIR_SEGMENTS = new Set(["node_modules", ".git", "testdata", "fixtures", "vendor"])

function walk(d, depth, out) {
  if (out.length >= CAP || depth > 6) return
  let ents
  try {
    ents = readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    if (out.length >= CAP) return
    const p = join(d, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIR_SEGMENTS.has(e.name)) continue
      walk(p, depth + 1, out)
    } else if (basename(p) === "Negative.go") {
      continue
    } else if (p.endsWith(".go")) {
      try {
        if (statSync(p).size < 400_000) out.push(p)
      } catch {}
    }
  }
}

const files = []
walk(join(CORPUS, CORPUS_DIR), 0, files)
console.log(`go firing check — ${REPO}\ncorpus: ${CORPUS_DIR}, ${files.length} files drawn (want ${WANT})\n`)
if (!files.length) {
  console.log(`NO CORPUS under ${CORPUS_DIR}`)
  process.exit(2)
}

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const ONTOLOGY = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const wire = new Map()
const folded = new Map()
const filesByType = new Map()
for (const t of ONTOLOGY) filesByType.set(t, new Set())
const filesByWire = new Map()
const r7 = { emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0, nonIdentSource: 0, nonIdentTarget: 0, dottedSource: 0, dottedTarget: 0, samples: [] }
const PLACEHOLDER = new Set(["unknown", "undefined", "null", "nil", "n/a", "todo", "fixme", "?", "", "<name>", "unnamed", "anonymous", "symbol"])

function isPlainIdent(s) {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    if (!ok) return false
  }
  const f = s.charCodeAt(0)
  return !(f >= 48 && f <= 57)
}
const bump = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by)

let parsed = 0
let failed = 0
let firstErr = ""
const t0 = Date.now()
for (const f of files) {
  try {
    const content = readFileSync(f, "utf8")
    const parser = await getParser("go")
    const pr = await parser.parse(content, f)
    const res = await new (await import(`${REPO}/src/ast/real-go-analyzer.ts`)).RealGoAnalyzer().analyze(pr.rootNode, content, f)
    parsed++
    const symNames = new Set()
    for (const s of res?.symbols ?? []) if (typeof s?.name === "string") symNames.add(s.name)
    for (const r of res?.relationships ?? []) {
      const raw = String(r.type ?? r.relationshipType ?? "")
      bump(wire, raw)
      if (!filesByWire.has(raw)) filesByWire.set(raw, new Set())
      filesByWire.get(raw).add(f)
      const lc = raw.toLowerCase()
      if (ONTOLOGY.includes(lc)) {
        bump(folded, lc)
        filesByType.get(lc).add(f)
        const src = String(r.source ?? "")
        const tgt = String(r.target ?? "")
        if (src.length === 0) r7.emptySource++
        if (tgt.length === 0) r7.emptyTarget++
        // A placeholder is convicted only when THE FILE DOES NOT DECLARE IT: Go
        // declares `Unknown` (a `sql`/`crypto` sentinel) and `nil`, so a
        // value-only rule convicts real members.
        if (PLACEHOLDER.has(tgt.trim().toLowerCase()) && !symNames.has(tgt)) {
          r7.placeholderTarget++
          if (r7.samples.length < 12) r7.samples.push(`${lc} target=${JSON.stringify(tgt)} ${f}`)
        }
        if (PLACEHOLDER.has(src.trim().toLowerCase()) && !symNames.has(src)) {
          r7.placeholderSource++
          if (r7.samples.length < 12) r7.samples.push(`${lc} source=${JSON.stringify(src)} ${f}`)
        }
        if (!isPlainIdent(src)) {
          r7.nonIdentSource++
          if (src.indexOf(".") !== -1) r7.dottedSource++
        }
        if (!isPlainIdent(tgt)) {
          r7.nonIdentTarget++
          if (tgt.indexOf(".") !== -1) r7.dottedTarget++
        }
      }
    }
  } catch (e) {
    failed++
    if (!firstErr) firstErr = String(e).slice(0, 90)
  }
}
const wall = Date.now() - t0

console.log(`production path: ${parsed}/${files.length} parsed, ${failed} failed${firstErr ? ` (first: ${firstErr})` : ""}, ${wall} ms\n`)

console.log(`RAW relationship.type strings (verbatim, before folding to the ontology name):`)
for (const k of Array.from(wire.keys()).sort()) {
  console.log(`  ${JSON.stringify(k).padEnd(20)} ${String(wire.get(k)).padStart(9)} edges in ${String(filesByWire.get(k).size).padStart(5)} files`)
}
console.log(`\nENUM_SWEEP: "imports" = ${wire.get("imports") ?? 0}   "brain_import" = ${wire.get("brain_import") ?? 0}`)
console.log(`  src/ast/engine.ts:454 ASTEngine.RelationshipType.Imports = "imports"  <- the path analyzers use`)
console.log(`  src/ast/types.ts:69  RelationshipType.Imports          = "brain_import" <- a second enum, and the TABLE name`)

console.log(`\ntype            edges     files  verdict`)
console.log("-".repeat(70))
let fired = 0
for (const t of ONTOLOGY) {
  const n = folded.get(t) ?? 0
  const nf = filesByType.get(t).size
  if (n > 0) fired++
  console.log(`${t.padEnd(14)}${String(n).padStart(9)}${String(nf).padStart(9)}  ${n > 0 ? "FIRES" : "produced nothing"}`)
}
console.log("-".repeat(70))
console.log(`${fired}/10 types fired`)

console.log(`\nR7 endpoint check over every emitted edge:`)
console.log(`  empty source/target            ${r7.emptySource}/${r7.emptyTarget}`)
console.log(`  placeholder source/target      ${r7.placeholderSource}/${r7.placeholderTarget}   (file-scope rule; a corpus-declared sentinel is NOT convicted)`)
console.log(`  non-identifier source/target  ${r7.nonIdentSource}/${r7.nonIdentTarget}`)
console.log(`  dotted source/target           ${r7.dottedSource}/${r7.dottedTarget}   (no Go DECLARATION may contain '.')`)
for (const s of r7.samples) console.log(`    ${s}`)
process.exitCode = 0