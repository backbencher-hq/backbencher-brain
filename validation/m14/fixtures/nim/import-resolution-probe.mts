/**
 * NIM `imports` EDGE-SUBKIND RESOLUTION — the probe that decides cause C.
 *
 * ## The question
 *
 * After the module-symbol pass, `imports` resolves at both ends on 92.0% of its
 * corpus edges (s17-module-census.txt). The B/A/C brief needs one thing decided
 * about the residual: how much of it is EXTERNAL — a stdlib module that
 * legitimately has no declaration in the corpus — versus a defect.
 *
 * `imports` is not one kind of edge. It is two:
 *
 *   nim_import   `import std/os`   — names a MODULE, and a module has a symbol
 *   nim_include  `include foo`     — textually splices a FILE into this one
 *
 * and they answer to different questions. The census groups them, so a reader
 * cannot tell whether the residual is `import std/os` (external, correct, and
 * countable) or `include ./brokenTypo` (a defect). This probe splits them.
 *
 * ## Comparability, which is the only reason the numbers mean anything
 *
 * The file set, the 512 KB cap, the language test and the MODULE-RESOLUTION RULE
 * are lifted from `census.ts` unchanged: sub-directories of the corpus root that
 * are git repos, `git ls-files`, and an `imports` target resolved against
 * PER-REPO .nim stems (both the bare basename and every path segment) or against
 * the whole-corpus symbol names. A probe with its own file list or its own stem
 * rule would answer a different question and its ratio would not decompose the
 * census figure. Reuse is the point; the only thing added is the subkind split.
 *
 * ## What it measures, per subkind
 *
 *   edges                       — how many of each
 *   both-ends resolution        — the census rule above
 *   the UNRESOLVED population, grouped by what the WRITTEN path
 *   (`meta.nimModulePath`) says. A `std/`-prefixed path is Nim's own
 *   standard-library root and is the only stdlib form Nim writes with a path
 *   prefix; `..`-relative is local; anything else with a `/` is some other path;
 *   a BARE name is per-file indistinguishable from a local module, a `lib/pure`
 *   module (`import re`) or a typo, and is not claimed for any bucket
 *   `recoveredByVerbatim` — of the edges the normalised target left unresolved,
 *   how many the PRE-normalisation target (the written path, no segment
 *   expansion) would have bound. This is the number that decides whether
 *   normalising was a win or a loss, and it is measured rather than assumed
 *
 * ## The decision this probe feeds
 *
 * If the residual is dominated by `std/`-prefixed paths, cause C is implementable
 * per-file and syntactically: `import std/os` is external BY ITS SPELLING. If it
 * is dominated by bare names, it is not, because nothing in one file tells those
 * three apart.
 *
 * READ-ONLY. Worker count is `BB_NIM_WORKERS` (default 6) and every number is a
 * function of it — see the doc's Limitations 8/11.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { detectLanguageFromPath, EXTENSION_LANGUAGE } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

const ANALYZER = "src/ast/real-nim-analyzer.ts"
const digest = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

console.log(`nim imports-subkind probe — production ASTEngine.parseFile`)
console.log(`analyzer    : ${ANALYZER} sha256:${digest.slice(0, 16)}`)
console.log(`corpus root : ${CR}`)
console.log(`workers     : ${WORKERS}`)

// ───────────────────────────────────────────── file set, lifted from census.ts
const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      // The 512 KB cap and the CONTENT argument are both lifted from census.ts.
      // `detectLanguageFromPath(abs)` without the text is not the same predicate: it
      // decides on the extension alone, so a file whose CONTENT says Nim in a
      // non-.nim container is admitted here and excluded there. The two walks would
      // then be over different populations while this document's header claims they
      // are the same set, which is the failure the header exists to prevent.
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, rel, abs })
  }
}
files.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))

// ───────────────────────────────────────────── module stems, per census.ts
const NIM_SOURCE_EXTS: ReadonlySet<string> = new Set(
  Object.entries(EXTENSION_LANGUAGE)
    .filter(([, lang]) => lang === LANG)
    .map(([ext]) => ext.toLowerCase()),
)
const stripSourceExt = (p: string): string => {
  const slash = p.lastIndexOf("/")
  const dot = p.lastIndexOf(".")
  if (dot <= slash + 1) return p
  return NIM_SOURCE_EXTS.has(p.slice(dot + 1).toLowerCase()) ? p.slice(0, dot) : p
}
const moduleStemsByRepo = new Map<string, Set<string>>()
for (const f of files) {
  const set = moduleStemsByRepo.get(f.repo) ?? new Set<string>()
  set.add(stripSourceExt(path.basename(f.rel)))
  for (const seg of stripSourceExt(f.rel).split("/")) if (seg) set.add(seg)
  moduleStemsByRepo.set(f.repo, set)
}

console.log(`files       : ${files.length.toLocaleString()}  (repos: ${moduleStemsByRepo.size})`)

// ────────────────────────────────────────────────────────── edge accounting
type Row = {
  edges: number
  files: Set<string>
  /** resolves against THIS FILE's symbol names — census.ts's rule, and the rule the
   *  analyzer documents ("declared in this file", because Nim's declare-before-use
   *  makes anything else an import or an error) */
  resolvedInFile: number
  /** resolves against the WHOLE CORPUS's symbol names, which is the rule the store
   *  actually applies: its insert-time resolver matches `brain_symbol.name` and
   *  knows nothing about which file emitted the edge
   *
   *  Both are reported because they answer two questions and an earlier version of
   *  this probe reported only the second, which read 94.2% against the census's
   *  92.0% on the identical 13,365 edges — a disagreement that looked like a
   *  measurement error and was a rule difference. The gap IS the cross-file
   *  population, which is a real number a reader needs and not a defect. */
  resolvedInCorpus: number
  residual: Map<string, number>
  /** the same grouping under the WHOLE-CORPUS rule — this is the population whose
   * members are declared nowhere in the corpus, which is what "external" names */
  residualCorpus: Map<string, number>
  examples: Map<string, number>
  recoveredByVerbatim: number
  examplesByVerbatim: string[]
  /** of the in-file residual, how many had a written path that normalisation
   *  actually CHANGED (`import std/os` -> target `os`; `import os` -> target `os`) */
  normalisationChanged: number
  /** edges carrying `meta.nimStdlibModule: true` — the cause-C marker. Counted
   *  here rather than asserted, so the number quoted in the doc is measured by the
   *  same walk that measures the residual the marker is supposed to explain */
  stdlibMarked: number
  stdlibTargets: Map<string, number>
}
const rows = new Map<string, Row>()
const row = (k: string): Row => {
  let r = rows.get(k)
  if (!r) {
    rows.set(
      k,
      (r = {
        edges: 0,
        files: new Set(),
        resolvedInFile: 0,
        resolvedInCorpus: 0,
        residual: new Map(),
        residualCorpus: new Map(),
        examples: new Map(),
        recoveredByVerbatim: 0,
        examplesByVerbatim: [],
        normalisationChanged: 0,
        stdlibMarked: 0,
        stdlibTargets: new Map(),
      }),
    )
  }
  return r
}

/** The only stdlib form nim writes with a PATH PREFIX. `lib/pure`/`lib/impure`
 *  modules are imported BARE (`import re`), which no per-file rule separates from
 *  a local module — so they are not claimed here and the probe prints the bucket
 *  they fall into instead. */
const isStdPath = (p: string): boolean => /^\s*"?std\s*\//.test(p)

const names = new Set<string>()
const qualified = new Set<string>()
let cursor = 0
let parsed = 0
let failed = 0
const emptyNames: string[] = []
/** The signal that actually detects a degraded walk.
 *
 *  `parseFile` does NOT throw when the WASM parser exhausts its heap: it logs
 *  `[BB-PARSE-ERR]` and returns a result with fewer symbols and fewer edges. So a
 *  `parseFile threw` counter reads 0 on a walk that lost a file, which is what the
 *  first version of this guard checked. Two runs of this probe 2 edges apart
 *  (13,365 then 13,363) came from exactly that: the clean run and a run that lost
 *  `nimony/tests/nimony/misc/tlenientnils_seq_cstring.nim` to a logged parse error
 *  and published 59,740 names against the clean run's 59,741.
 *
 *  The detectable consequence is a symbol published with an EMPTY `kind`, which is
 *  what census.ts counts. That is the guard, and `failed` is kept alongside it
 *  because a genuine throw should also refuse to write. */
const emptyKind: string[] = []
const unknownEndpoints: string[] = []
const bump = (m: Map<string, number>, k: string): void => m.set(k, (m.get(k) ?? 0) + 1)

async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i] as { repo: string; rel: string; abs: string }
    let content: string
    try {
      content = readFileSync(f.abs, "utf8")
    } catch {
      continue
    }
    let r: any
    try {
      r = await parseFile(f.abs, content)
      parsed++
    } catch {
      failed++
      continue
    }
    const stems = moduleStemsByRepo.get(f.repo) ?? new Set<string>()
    const fileNames = new Set<string>()
    const fileQualified = new Set<string>()
    for (const s of r?.symbols ?? []) {
      const n = String(s?.name ?? "")
      if (!n) {
        emptyNames.push(`${f.abs}`)
        continue
      }
      names.add(n)
      fileNames.add(n)
      const q = String(s?.qualifiedName ?? "")
      if (q) {
        qualified.add(q)
        fileQualified.add(q)
      }
      if (String(s?.kind ?? "") === "") emptyKind.push(`${f.abs}:${n}`)
    }
    for (const e of r?.relationships ?? []) {
      if (String(e?.type ?? "").toLowerCase() !== "imports") continue
      const kind = String(e?.metadata?.relationshipType ?? "unlabelled")
      const rw = rows.get(kind) ?? row(kind)
      const tgt = String(e?.target ?? "")
      const src = String(e?.source ?? "")
      const written = String(e?.metadata?.nimModulePath ?? "")
      rw.edges++
      rw.files.add(f.rel)
      if (e?.metadata?.nimStdlibModule === true) {
        rw.stdlibMarked++
        const w = String(e?.metadata?.nimModulePath ?? "")
        bump(rw.stdlibTargets, String(tgt || "(empty)"))
      }
      // Module stems resolve under BOTH rules — a module is a file, not a symbol,
      // so `mods.has(t)` applies whichever name set is in play. That is census.ts's
      // rule too (`t === "imports" ? mods.has(tgt) || resolve(tgt)`).
      const sOkFile = src === "(global)" ? true : fileNames.has(src) || fileQualified.has(src)
      const tOkFile = stems.has(tgt) || fileNames.has(tgt) || fileQualified.has(tgt)
      const sOkCorpus = src === "(global)" ? true : names.has(src) || qualified.has(src)
      const tOkCorpus = stems.has(tgt) || names.has(tgt) || qualified.has(tgt)
      if (sOkFile && tOkFile) rw.resolvedInFile++
      if (sOkCorpus && tOkCorpus) rw.resolvedInCorpus++
      // The residual is grouped under BOTH rules, because they select different
      // populations and cause C is about one of them specifically: "not declared
      // ANYWHERE in the corpus" is what "external" means, and that is the in-corpus
      // column. The in-file column is kept because it is census.ts's number and a
      // reader comparing the two needs to know which rule produced which.
      if (!(sOkFile && tOkFile)) {
        // Does normalisation change this edge's target AT ALL? `import strutils`
        // writes one segment, so the written path and the normalised target are the
        // same string and there is no normalisation decision to evaluate. Only the
        // population where the two DIFFER is the question, and it is counted
        // separately so a reader can see how large it is rather than infer it.
        //
        // This distinction is not cosmetic. An earlier version of this probe counted
        // "verbatim would bind" over the whole in-file residual while testing the
        // written path against the CORPUS name set, and reported 408 edges recovered
        // by going back to the written path — on 408 edges where the written path and
        // the normalised target are the same string, so "recovered" described a name
        // set, not a normalisation. A correct implementation reads 0 or near 0 there,
        // and an instrument that cannot tell 408 from 0 cannot be used to decide
        // whether to keep the normalisation.
        if (written && written !== tgt) rw.normalisationChanged++
        const vOk =
          written !== "" && written !== tgt && (stems.has(written) || names.has(written) || qualified.has(written))
        if (vOk) {
          rw.recoveredByVerbatim++
          if (rw.examplesByVerbatim.length < 10) rw.examplesByVerbatim.push(`${f.repo}/${f.rel} -> ${written}`)
        }
        if (!written) bump(rw.residual, "no written path on the edge")
        else if (isStdPath(written)) bump(rw.residual, "stdlib path prefix (std/…)")
        else if (written.startsWith("..")) bump(rw.residual, "parent-relative (../…)")
        else if (written.includes("/")) bump(rw.residual, "other path")
        else bump(rw.residual, "bare name")
        bump(rw.examples, tgt)
      }
      if (!(sOkCorpus && tOkCorpus)) {
        if (!written) bump(rw.residualCorpus, "no written path on the edge")
        else if (isStdPath(written)) bump(rw.residualCorpus, "stdlib path prefix (std/…)")
        else if (written.startsWith("..")) bump(rw.residualCorpus, "parent-relative (../…)")
        else if (written.includes("/")) bump(rw.residualCorpus, "other path")
        else bump(rw.residualCorpus, "bare name")
      }
      if (tgt === "unknown" || src === "unknown") unknownEndpoints.push(`${f.abs}:${e?.line_number}`)
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const digestAfter = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

console.log(`parsed ${parsed.toLocaleString()}  parseFile threw ${failed}`)
console.log(`published names ${names.size.toLocaleString()}  empty names ${emptyNames.length}  EMPTY-KIND SYMBOLS ${emptyKind.length}  endpoints equal to "unknown" ${unknownEndpoints.length}`)
console.log("")
console.log(`subkind          edges    files   resolved IN-FILE   resolved IN-CORPUS   unres(in-file)   norm.changed   verbatim-would-bind`)
console.log(`-`.repeat(130))
const out: any = {
  instrument: "imports subkind split",
  note:
    "Two resolution rules are reported because they answer two different questions. " +
    "IN-FILE is census.ts's rule and the analyzer's documented contract. IN-CORPUS is " +
    "what the store does: its insert-time resolver matches brain_symbol.name and does " +
    "not know which file emitted the edge. The gap between them IS the cross-file population.",
  analyzer: ANALYZER,
  analyzerSha256: digest,
  analyzerSha256After: digestAfter,
  corpusRoot: CR,
  files: files.length,
  repos: moduleStemsByRepo.size,
  workers: WORKERS,
  parsed,
  failed,
  publishedNames: names.size,
  emptyNames: emptyNames.length,
  emptyKindSymbols: emptyKind.length,
  emptyKindExamples: emptyKind.slice(0, 5),
  unknownEndpoints: unknownEndpoints.length,
  subkinds: {} as any,
}
let tEdges = 0
let tFile = 0
let tCorpus = 0
for (const [k, r] of [...rows].sort((a, b) => b[1].edges - a[1].edges)) {
  const unres = r.edges - r.resolvedInFile
  const pctF = r.edges ? ((r.resolvedInFile / r.edges) * 100).toFixed(1) : "0.0"
  const pctC = r.edges ? ((r.resolvedInCorpus / r.edges) * 100).toFixed(1) : "0.0"
  tEdges += r.edges
  tFile += r.resolvedInFile
  tCorpus += r.resolvedInCorpus
  console.log(
    `${k.padEnd(14)} ${String(r.edges).padStart(6)}  ${String(r.files.size).padStart(6)}   ${pctF.padStart(6)}%          ${pctC.padStart(6)}%            ${String(unres).padStart(6)}       ${String(r.normalisationChanged).padStart(6)}      ${r.recoveredByVerbatim}`,
  )
  for (const [shape, n] of [...r.residual].sort((a, b) => b[1] - a[1])) {
    console.log(`${" ".repeat(15)}${shape}  ${n}`)
  }
  for (const ex of r.examplesByVerbatim) console.log(`${" ".repeat(15)}verbatim-binds: ${ex}`)
  console.log(`${" ".repeat(15)}-- grouped under the IN-CORPUS rule (declared nowhere in the corpus) --`)
  for (const [shape, n] of [...r.residualCorpus].sort((a, b) => b[1] - a[1])) {
    console.log(`${" ".repeat(15)}${shape}  ${n}`)
  }
  console.log(`${" ".repeat(15)}meta.nimStdlibModule: true on ${r.stdlibMarked} of these edges`)
  if (r.stdlibMarked > 0) {
    const top = [...r.stdlibTargets].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`${" ".repeat(15)}marked targets: ${top.map(([k, v]) => `${k}(${v})`).join(" ")}`)
  }
  out.subkinds[k] = {
    edges: r.edges,
    files: r.files.size,
    resolvedInFile: r.resolvedInFile,
    resolvedInCorpus: r.resolvedInCorpus,
    unresolvedInFile: unres,
    resolvedPctInFile: r.edges ? Number(((r.resolvedInFile / r.edges) * 100).toFixed(1)) : 0,
    resolvedPctInCorpus: r.edges ? Number(((r.resolvedInCorpus / r.edges) * 100).toFixed(1)) : 0,
    residualByWrittenPathInFile: Object.fromEntries([...r.residual].sort((a, b) => b[1] - a[1])),
    residualByWrittenPathInCorpus: Object.fromEntries([...r.residualCorpus].sort((a, b) => b[1] - a[1])),
    topUnresolvedTargets: [...r.examples].sort((a, b) => b[1] - a[1]).slice(0, 20),
    stdlibMarked: r.stdlibMarked,
    stdlibMarkedTargets: [...r.stdlibTargets].sort((a, b) => b[1] - a[1]).slice(0, 20),
    recoveredByVerbatimWrittenPath: r.recoveredByVerbatim,
    examplesRecoveredByVerbatim: r.examplesByVerbatim,
    normalisationChangedTarget: r.normalisationChanged,
  }
}
out.total = {
  edges: tEdges,
  resolvedInFile: tFile,
  resolvedInCorpus: tCorpus,
  resolvedPctInFile: tEdges ? Number(((tFile / tEdges) * 100).toFixed(1)) : 0,
  resolvedPctInCorpus: tEdges ? Number(((tCorpus / tEdges) * 100).toFixed(1)) : 0,
}
console.log(
  `${"TOTAL".padEnd(14)} ${String(tEdges).padStart(6)}  ${"".padStart(6)}   ${((tFile / tEdges) * 100).toFixed(1).padStart(6)}%          ${((tCorpus / tEdges) * 100).toFixed(1).padStart(6)}%`,
)
console.log("")
console.log(
  `analyzer sha256 after the walk : ${digestAfter.slice(0, 16)}${digestAfter === digest ? "  (unchanged)" : "  *** CHANGED — every number above is stale ***"}`,
)
if (OUT) {
  // The census's guard, for the same reason. A walk that lost files to the WASM
  // heap (the doc's Limitations 8) produces a plausible, correctly-named artifact
  // full of numbers that are wrong, which is strictly worse than no artifact — it
  // is indistinguishable from a clean one to every later reader. The name says
  // which it is, and the committed artifact is left alone.
  const clean = failed === 0 && emptyKind.length === 0
  const target = clean
    ? OUT
    : `${OUT.endsWith(".json") ? OUT.slice(0, -5) : OUT}.degraded.json`
  writeFileSync(target, JSON.stringify(out, null, 2))
  if (!clean) {
    const why =
      failed > 0
        ? `${failed} files did not parse`
        : `${emptyKind.length} symbols published with an empty kind (logged [BB-PARSE-ERR], no throw)`
    console.log(`\nDEGRADED WALK — ${why}.`)
    console.log(`  REFUSING to overwrite ${OUT}: written to ${target} instead.`)
  }
  console.log(`wrote ${target}`)
}
