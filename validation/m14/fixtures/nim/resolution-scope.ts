/**
 * NIM RESOLUTION SCOPE — intra-file vs corpus-wide, per relationship type.
 *
 * ## The defect this measures, in this lane's OWN instrument first
 *
 * Both instruments that report a "both ends resolve" rate for this lane resolve each
 * edge against the symbols of **the file the edge is in**, not against the symbols of
 * the run. The cause is one line of scoping in each, and it is the same line in both:
 *
 *   census.ts:232            const symNames = new Set<string>()
 *   firing-check.ts:322      const published = new Set<string>()
 *
 * each declared INSIDE the `for (const file of files)` loop that opens at census.ts:220
 * and firing-check.ts:289, so both sets are rebuilt from scratch per file and carry one
 * file's declarations by the time an edge is resolved.
 *
 * That is the right instrument for one question — *can this file's own graph be walked
 * from this edge* — and the wrong one for the question the incoming direction asks:
 * `src/lsp/impact.ts` walks reverse edges against a whole index, so a `calls` edge into
 * another module is resolvable for the graph and unreadable to an intra-file resolver.
 * The workstream's own framing is the same: "a hopeless-string target — an external
 * package, a filesystem path, a builtin — is indistinguishable from a declaration that
 * was simply never indexed", and the way to tell those apart is to widen the universe.
 *
 * So this script reports BOTH numbers, per type, and the delta between them, and it
 * says which is which. It does not replace the census's column: the intra-file figure
 * is a real measurement of a real property and is quoted elsewhere in this lane's
 * document. It is named here so no reader has to guess which one they are looking at.
 *
 * ## Why the two instruments' intra-file rates disagree
 *
 * They register different SPELLINGS of the same symbol, which is a policy difference
 * and not an error in either:
 *
 *   census.ts        bare name, last dot-segment, `Owner.member` qualified, and
 *                    MODULE STEMS for `imports` (an import target is a module, not a
 *                    symbol, so resolving it against a symbol set is the wrong test)
 *   firing-check.ts  bare name and `qualifiedName` only
 *
 * So this script carries census.ts's spelling set — the wider one — so that the
 * intra-file column it prints reproduces the census's published figure. If it does not,
 * this script is wrong, and that is the check to look at first.
 *
 * ## Method
 *
 * ONE pass. Every edge's (type, source, target) is retained, and the symbol-name
 * universe is accumulated across the whole corpus; resolution against the full universe
 * happens after the walk. Holding ~267k (type, source, target) triples is a few tens of
 * MB, which is cheaper and less surprising than walking 6,063 files twice.
 *
 * Production entry point `parseFile` from `src/ast/pool-worker` — NOT `analyze()`.
 * Same corpus walk as census.ts: `git ls-files`, `detectLanguageFromPath`, 512 KB cap.
 * NO REGEX.
 *
 * READ-ONLY except an optional JSON path in argv[2].
 *
 * Run: BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/resolution-scope.ts [out.json]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

const ANALYZER = path.resolve(process.cwd(), "src/ast/real-nim-analyzer.ts")
const HASH_BEFORE = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** census.ts's spelling policy, reproduced so the intra-file column is comparable. */
const SYNTHETIC_SOURCES = new Set(["(global)", "(file)", "(declared-type)", "(module)"])

// ─────────────────────────────────────────────────────────────── corpus walk
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
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
    files.push({ repo: e, dir, rel, abs, text })
  }
}

/** Module stems per repo — an `imports` target is a module, not a symbol.
 *
 *  census.ts builds this set from the file's basename AND from every path SEGMENT of
 *  its module path (census.ts:144-149), and the intra column below reproduces that in
 *  full. The segment rule is generous — a directory named `lib` makes `lib` a
 *  resolvable module name — and it is why `imports` reads 37.1% intra-file rather than
 *  the 2.6% a basename-only match gives. It is reproduced rather than corrected because
 *  this script's job is to isolate ONE variable, the width of the symbol universe, and
 *  changing the module rule at the same time would change two. The consequence is
 *  stated where it matters: `imports` is the one type whose corpus-wide figure below
 *  rests on a module-path heuristic rather than on a symbol match, and neither
 *  instrument resolves a Nim module path like `std/strutils` properly. */
const moduleStemsByRepo = new Map<string, Set<string>>()
for (const f of files) {
  const stem = path.basename(f.rel).slice(0, path.extname(f.rel).length)
  const set = moduleStemsByRepo.get(f.repo) ?? new Set<string>()
  set.add(stem)
  const noExt = f.rel.slice(0, f.rel.length - path.extname(f.rel).length)
  for (const seg of noExt.split("/")) set.add(seg)
  moduleStemsByRepo.set(f.repo, set)
}

// ─────────────────────────────────────────────────────────────── accumulators
/** The corpus-wide name universe. This is the set the arbiter and the census do NOT
 *  have, and its existence is the whole point of the script. */
const universe = new Set<string>()
/** Retained edges, resolved after the walk. */
const edges: { t: Type; src: string; tgt: string; repo: string; intra: boolean }[] = []

let parseFailures = 0
let offOntology = 0
let idx = 0

async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      parseFailures++
      continue
    }
    const fileNames = new Set<string>()
    const fileQualified = new Set<string>()
    for (const s of r.symbols ?? []) {
      const nm = String(s.name ?? "")
      if (nm === "") continue
      fileNames.add(nm)
      universe.add(nm)
      if (!SYNTHETIC_SOURCES.has(nm)) {
        const tail = nm.split(".").pop() ?? nm
        fileNames.add(tail)
        universe.add(tail)
      }
      const owner = String(s.ownerName ?? "")
      if (owner) {
        const q = `${owner}.${nm}`
        fileQualified.add(q)
        universe.add(q)
      }
    }
    const mods = moduleStemsByRepo.get(f.repo) ?? new Set<string>()
    // census.ts:276-280's documented contract, reproduced so the intra column is
    // COMPARABLE rather than merely similar:
    //   - a synthetic source label is not a symbol and counts as resolved. Omitting
    //     this rule is what made an earlier run of this script report 34.0% on calls
    //     where census.ts reports 38.9% — 15,801 edges have a synthetic source.
    //   - an `imports` TARGET is a module, not a symbol, so it resolves against the
    //     repo's module stems.
    const intraSrc = (n: string): boolean => SYNTHETIC_SOURCES.has(n) || fileNames.has(n) || fileQualified.has(n)
    const intraTgt = (n: string, type: Type): boolean =>
      type === "imports" ? mods.has(n) || fileNames.has(n) || fileQualified.has(n) : fileNames.has(n) || fileQualified.has(n)
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!(ALL_TYPES as readonly string[]).includes(t)) { offOntology++; continue }
      const src = String(x.source ?? x.from ?? "")
      const tgt = String(x.target ?? x.to ?? "")
      edges.push({ t, src, tgt, repo: f.repo, intra: intraSrc(src) && intraTgt(tgt, t) })
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => worker()))

/** Corpus-wide resolution. The same two rules apply, with the SYMBOL universe widened
 *  from one file to the whole corpus: a synthetic source is resolved, and an `imports`
 *  target resolves against the module stems of the repo that declared the importing
 *  file — module stems stay per-repo in both columns, so the only thing that widens
 *  between them is the symbol set. */
const repoStems = moduleStemsByRepo
const wideSrc = (n: string): boolean => SYNTHETIC_SOURCES.has(n) || universe.has(n)
const wideTgt = (n: string, repo: string, type: Type): boolean =>
  type === "imports" ? (repoStems.get(repo)?.has(n) ?? false) || universe.has(n) : universe.has(n)

const rows: Record<string, { edges: number; intra: number; wide: number }> = {}
for (const t of ALL_TYPES) rows[t] = { edges: 0, intra: 0, wide: 0 }
for (const e of edges) {
  const row = rows[e.t]
  row.edges++
  if (e.intra) row.intra++
  if (wideSrc(e.src) && wideTgt(e.tgt, e.repo, e.t)) row.wide++
}

const body = {
  lang: LANG,
  corpusRoot: CR,
  analyzerSha256: HASH_BEFORE,
  analyzerStableDuringRun: HASH_BEFORE === analyzerHash(),
  workers: WORKERS,
  files: files.length,
  parseFailures,
  offOntologyEdges: offOntology,
  universeSize: universe.size,
  edgesRetained: edges.length,
  scope: {
    intra: "symbols published by the edge's own file (+ repo module stems) — what census.ts and firing-check.ts both report",
    wide: "symbols published anywhere in the 6,063-file corpus (+ repo module stems) — what src/lsp/impact.ts's reverse walk has",
  },
  perType: rows,
}

console.log(`nim resolution scope — intra-file vs corpus-wide`)
console.log(`analyzer    : sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`corpus      : ${CR}`)
console.log(`workers     : ${WORKERS}`)
console.log(`files       : ${files.length}   parse failures: ${parseFailures}   off-ontology edges: ${offOntology}`)
console.log(`universe    : ${universe.size} distinct published name spellings across the corpus`)
console.log(``)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("edges", 9)}${w("intra", 9)}${w("wide", 9)}${w("delta", 9)}`)
for (const t of ALL_TYPES) {
  const r = rows[t]
  const pi = r.edges === 0 ? "  -  " : `${(100 * r.intra / r.edges).toFixed(1)}%`
  const pw = r.edges === 0 ? "  -  " : `${(100 * r.wide / r.edges).toFixed(1)}%`
  console.log(`${w(t, 14)}${String(r.edges).padStart(7)}  ${pi.padStart(7)}  ${pw.padStart(7)}  ${String(r.wide - r.intra).padStart(7)}`)
}
console.log(``)
console.log(`The intra column is what BOTH instruments print today. The wide column is what a`)
console.log(`reverse walk over a whole index has. A negative delta is impossible by`)
console.log(`construction (the universe only grows) and none appears.`)
console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${body.analyzerStableDuringRun ? "  (unchanged)" : "  CHANGED DURING THE RUN"}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify(body, null, 2))
  console.log(`\nwrote ${OUT}`)
}
