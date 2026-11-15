/**
 * M14 ONTOLOGY LANE — DART INCOMING CENSUS: what REACHES a declaration, and
 * what a reverse walk can bind to.
 *
 * ## Why this file exists
 *
 * `census.ts` (this lane's outbound census) answers "what leaves a declaration".
 * This one answers the question `src/lsp/impact.ts` actually depends on, which is
 * the other direction: given an edge, can a consumer bind BOTH ends to symbols it
 * published, and if it binds them, does the name pick out exactly ONE declaration?
 *
 * Two distinct failures, and they look identical in a single count:
 *
 *   1. AMBIGUITY. A target name that matches N>1 published symbols. The reverse
 *      walk picks one by a rule nobody chose, so one edge is silently attributed
 *      to one of N real declarations and the other N-1 lose a caller they have.
 *   2. A HOPELESS TARGET. A name that matches nothing at all: an SDK type
 *      (`String`, `Future`), a package type, a member of an external type
 *      (`add`, `map`, `forEach`), a local variable, a filesystem path. In a count
 *      this is identical to "a declaration in my own corpus that the run failed to
 *      publish", and those two are opposite findings.
 *
 * So this harness separates them, and it separates a third class the count also
 * hides: a target that IS a local. Dart's family contract publishes no locals
 * (`src/ast/types.ts`, the csharp/python/go parity ruling recorded as DARTD8), so
 * every `uses` edge the analyzer tags `isLocalRead` has a target that is
 * deliberately not a symbol. That is not a defect and it is not "external" — it
 * is a fourth thing, and the honest report names it.
 *
 * ## WHAT IS MEASURED, PER RELATIONSHIP TYPE
 *
 *   emitted            rows the production `parseFile` returned
 *   bothInFile         both endpoints bind among THIS file's published symbols
 *   bothInSample       both bind among the SAMPLE's symbols (SAMPLE-scope repos)
 *   bothInRepoFull     both bind among EVERY .dart file of the repo (FULL repos)
 *   tgtUniqueInRepo    the target name matches exactly ONE published symbol
 *   tgtAmbiguous       the target name matches 2..5 published symbols
 *   tgtCrowded         the target name matches 6+ published symbols
 *   tgtNoSymbol        the target name matches NONE
 *   — and the tgtNoSymbol population is then split into:
 *       localNotPublished  tagged `isLocalRead` (a binding, never a symbol)
 *       uriEndpoint        an `imports`/`exports` target (a module path by design)
 *       externalCandidate  the file imports a `package:`/`dart:` URI and the name
 *                          is declared nowhere in the repo
 *       unexplained        neither of the above: the name is declared nowhere in
 *                          the repo AND the file imports nothing that could supply
 *                          it. This is the class that would be a defect.
 *
 * ## SCOPE DESIGN, AND WHY TWO SCOPES
 *
 * A per-file analyzer cannot see the other files of its own repository, so "does
 * this target resolve" has no single honest answer: at file scope most Dart
 * targets are SDK names, and at repository scope most resolve. Reporting one
 * number would pick a scope flattering to whichever claim is being made. So:
 *
 *   FULL repos    every .dart file is parsed, so the symbol table is the whole
 *                 repository and the resolution rates are upper bounds.
 *   SAMPLE repos  only the stride sample is parsed, so the rates are lower bounds
 *                 and are labelled `sample` everywhere they appear. Never mixed
 *                 into a `repoFull` column.
 *
 * ## SAMPLING
 *
 * Deterministic STRIDE over `git ls-files -- '*.dart'` sorted, per repository:
 * `stride = max(1, floor(tracked / perRepo))`, keep `i % stride === 0`. No
 * randomness, so a reviewer reproduces the same file set from a clean corpus.
 * Stride rather than a prefix because a sorted path list clusters by directory
 * and a prefix would sample one subtree.
 *
 * ## CONCURRENCY IS NOT SAFE FOR THIS MEASUREMENT — RUN IT AT 1
 *
 * Inherited from `census.ts`, and measured there rather than assumed: the FILE
 * SET is deterministic, the RESULT is not. Two runs of the same 1,000 files at
 * concurrency 6 gave 36,550 vs 36,503 symbols and 124,772 vs 124,638
 * relationships, every per-type count lower in the second run; the same two runs
 * at concurrency 1 are byte-identical. The engine prints
 * `[BB-PARSE-ERR] … memory access out of bounds` on some file-parses under
 * concurrency, so the loss is a failed parse inside the WASM parser.
 * `parseFile` is shared machinery (`src/ast/pool-worker.ts`) and this lane does not
 * change it; every number here is from `BB_DART_CONC=1` and the finding is
 * written up for the pool worker's owner.
 *
 * ## CLI
 *
 *   BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/incoming-census.ts
 *   BB_DART_FULL_REPOS=dart-http,riverpod,proxicall BB_DART_OUT=/tmp/in.json npx tsx ...
 */

import { execFileSync } from "node:child_process"
import { statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/** Repos parsed EXHAUSTIVELY. Their resolution rates are upper bounds over the
 *  whole repository, because the symbol table is the whole repository. */
const FULL_REPOS = (process.env.BB_DART_FULL_REPOS ?? "dart-http,riverpod,proxicall").split(",").map(s => s.trim()).filter(Boolean)
/** Repos sampled by stride. Their rates are lower bounds and are labelled so. */
const SAMPLE_REPOS = (process.env.BB_DART_SAMPLE_REPOS ?? "flutter-packages,dart-sdk").split(",").map(s => s.trim()).filter(Boolean)
const PER_REPO = Number(process.env.BB_DART_PER_REPO ?? 400)
const OUT = process.env.BB_DART_OUT ?? ""
const CONCURRENCY = Number(process.env.BB_DART_CONC ?? 1)

// ---------------------------------------------------------------- sample
interface FileRow { repo: string; rel: string; abs: string; bytes: number; scope: "full" | "sample" }
const files: FileRow[] = []
const repoStats: any[] = []

for (const repo of [...FULL_REPOS, ...SAMPLE_REPOS]) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.dart"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    repoStats.push({ repo, scope: "?", tracked: 0, drawn: 0, note: "not a git repo or no .dart tracked" })
    continue
  }
  tracked.sort()
  const isFull = FULL_REPOS.includes(repo)
  const stride = isFull ? 1 : Math.max(1, Math.floor(tracked.length / PER_REPO))
  let drawn = 0
  for (let i = 0; i < tracked.length; i += stride) {
    const abs = path.join(dir, tracked[i])
    let bytes = 0
    try { bytes = statSync(abs).size } catch { continue }
    files.push({ repo, rel: tracked[i], abs, bytes, scope: isFull ? "full" : "sample" })
    drawn++
  }
  repoStats.push({ repo, scope: isFull ? "full" : "sample", tracked: tracked.length, stride, drawn })
}

const overStructuralLimit = files.filter(f => f.bytes > 1024 * 1024).length
const overSkipLimit = files.filter(f => f.bytes > 5 * 1024 * 1024).length

// ---------------------------------------------------------------- symbol tables
/**
 * Symbol IDENTITY, not just name. Two declarations sharing a name are the whole
 * point of the ambiguity measurement, so the table stores a Set of identity keys
 * per name and ambiguity is the SET SIZE. A `Set<string>` of names (what
 * `census.ts` keeps) cannot answer this question at all: it collapses the
 * collision it is supposed to detect.
 *
 * Identity = kind | owner | repo | rel. `owner` is empty for a top-level symbol.
 */
const byName = new Map<string, Set<string>>()
/** Per-repo and per-scope name sets, for the scope-graded resolution columns. */
const namesInFile = new Map<string, Set<string>>()
const namesInScope = new Map<string, Set<string>>()   // repo|scope
const namesInRepoFull = new Map<string, Set<string>>() // repo (FULL repos only)

function addSymbol(nameSet: Set<string>, identitySet: Map<string, Set<string>>, name: string, id: string): void {
  nameSet.add(name)
  let s = identitySet.get(name)
  if (!s) { s = new Set(); identitySet.set(name, s) }
  s.add(id)
}

// ---------------------------------------------------------------- SDK index
//
// "Is this target a Dart SDK declaration?" is answerable, not a guess: the corpus
// carries the SDK's own sources at `dart-sdk/sdk/lib`, which is where
// `dart:core`, `dart:async`, `dart:collection` and the rest are written. Indexing
// them through the SAME production entry point means the answer uses the same
// symbol vocabulary the edges resolve against, instead of a hand-written list of
// "builtins" that would be a second, drifting definition of the same thing.
//
// Without it, `String`, `Future`, `Completer`, `State`, `StatelessWidget` and
// `package:test`'s `group` all land in one bucket, and that bucket is the one a
// reader is most likely to read as a defect. It is not: `dart-sdk` here is the
// VM/SDK repository, and Flutter's `StatelessWidget` is NOT in it — a name absent
// from both the project repo and the SDK, in a file that imports
// `package:flutter/...`, is a PACKAGE declaration, which is the fourth bucket.
const SDK_LIB = path.join(CR, "dart-sdk", "sdk", "lib")
const sdkNames = new Set<string>()
let sdkFilesDrawn = 0
let sdkFilesPresent = 0
{
  let sdkTracked: string[] = []
  try {
    sdkTracked = execFileSync("git", ["-C", path.join(CR, "dart-sdk"), "ls-files", "-z", "--", "sdk/lib/*.dart", "sdk/lib/**/*.dart"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).filter((p) => p.startsWith("sdk/lib/"))
  } catch { sdkTracked = [] }
  sdkFilesPresent = sdkTracked.length
  let sIdx = 0
  const sWorker = async (): Promise<void> => {
    while (true) {
      const i = sIdx++
      if (i >= sdkTracked.length) return
      const abs = path.join(CR, "dart-sdk", sdkTracked[i])
      let r: any
      try { r = await parseFile(abs, path.join(CR, "dart-sdk")) } catch { continue }
      sdkFilesDrawn++
      for (const s of r?.symbols ?? []) {
        const nm = String((s as any).name ?? "")
        if (nm.length > 0) sdkNames.add(nm)
        const owner = typeof (s as any).ownerName === "string" ? (s as any).ownerName : ""
        if (owner.length > 0 && nm.length > 0) sdkNames.add(`${owner}.${nm}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => sWorker()))
}

// ---------------------------------------------------------------- tallies
interface Row {
  n: number
  srcInFile: number; tgtInFile: number; bothInFile: number
  srcInScope: number; tgtInScope: number; bothInScope: number
  srcInRepoFull: number; tgtInRepoFull: number; bothInRepoFull: number
  tgtUnique: number; tgtAmbiguous: number; tgtCrowded: number; tgtNoSymbol: number
  noSymbolLocal: number; noSymbolUri: number; noSymbolSdk: number
  noSymbolPackage: number; noSymbolOutsideSample: number; noSymbolUnexplained: number
  heur: number
  /** Targets ambiguous at repo scope that the SOURCE half disambiguates — the
   *  population deliverable B is about. */
  qualifiedBySource: number
}
const rows = new Map<string, Row>()
const row = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = {
      n: 0, srcInFile: 0, tgtInFile: 0, bothInFile: 0,
      srcInScope: 0, tgtInScope: 0, bothInScope: 0,
      srcInRepoFull: 0, tgtInRepoFull: 0, bothInRepoFull: 0,
      tgtUnique: 0, tgtAmbiguous: 0, tgtCrowded: 0, tgtNoSymbol: 0,
      noSymbolLocal: 0, noSymbolUri: 0, noSymbolSdk: 0, noSymbolPackage: 0,
      noSymbolOutsideSample: 0, noSymbolUnexplained: 0,
      heur: 0, qualifiedBySource: 0,
    }
    rows.set(t, r)
  }
  return r
}

/** Edges kept for the second phase (per-repo resolution needs a settled symbol
 *  table, so it cannot be computed inside the walk). */
interface KeptEdge {
  repo: string; scope: "full" | "sample"; type: string; src: string; tgt: string
  fileKey: string; isLocal: boolean; isUriEndpoint: boolean
  /** The analyzer's own reason keys on this row (`is*` / `*Kind`), so the
   *  no-symbol population can be described by what the EMITTER said it was
   *  reading rather than by this harness's guess at what it meant. */
  reasonTag: string
}
/** no-symbol rows per `type|reasonTag`. */
const noSymbolReasons = new Map<string, number>()
/** unexplained rows per `type|target`, capped. A count of 2,422 named
 *  `Exception.toString` is a finding; a count of 2,422 spread over 2,422
 *  distinct names is a different one, and only the histogram tells them apart. */
const unexplainedTargets = new Map<string, Map<string, number>>()

/** Every drawn file's own import specifiers, and the drawn-file index the
 *  transitive closure below resolves against. All three keyed by `repo/rel` —
 *  ONE spelling, because the version that mixed `repo/rel` and `repo|rel`
 *  compiled, ran, and silently measured nothing. */
const importsByFile = new Map<string, string[]>()
const drawnFiles = new Set<string>()

/**
 * Edges that did NOT come from the analyzer.
 *
 * `src/ast/pool-worker.ts` routes a file over 1 MB to `extractFallback`, a REGEX
 * extractor, instead of the tree-sitter analyzer. Its rows carry
 * `metadata.method === "regex"` and sit at confidence 0.4/0.5, and its symbols
 * carry no `kind` at all. Counting them as analyzer output is how a lane ends up
 * quoting a resolution rate for edges no analyzer produced, so they are tallied
 * apart here and excluded from every analyzer column.
 *
 * This is not hypothetical for dart: `native_cupertino_bindings.dart` is 1.4 MB, so
 * 20 of its 24 relationships come from the fallback, and the fallback matched the
 * DECLARATION `extension type NSCachedURLResponse._(objc.ObjCObject object$)`
 * with its `obj.method(` pattern and published `calls NSCachedURLResponse -> _`
 * at 0.4 — a call to a symbol named `_`, for a constructor invocation that is a
 * declaration. That is a fabricated edge, and it is in shared machinery
 * (`extractBasicRelationships`), so this lane reports it rather than editing it.
 */
const fallbackEdges = new Map<string, number>()
let fallbackEdgeTotal = 0
const kept: KeptEdge[] = []

let symbols = 0
let relationships = 0
let parseErrors = 0
let filesWithErrors = 0
let fallbackFiles = 0
let symbolsNamedUnknown = 0
let emptyNames = 0
let emptyKinds = 0
let unknownEndpoints = 0
const filesParsed: Record<string, number> = {}
const failures: string[] = []
const examples: Record<string, string[]> = {}

const bumpExample = (key: string, row: string): void => {
  let arr = examples[key]
  if (!arr) { arr = []; examples[key] = arr }
  if (arr.length < 6) arr.push(row)
}

// ---------------------------------------------------------------- walk
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, path.join(CR, f.repo))
    } catch (e: any) {
      failures.push(`${f.repo}/${f.rel}: ${String(e?.message ?? e)}`)
      continue
    }
    filesParsed[f.repo] = (filesParsed[f.repo] ?? 0) + 1
    if ((r?.errors?.length ?? 0) > 0) filesWithErrors++
    parseErrors += r?.errors?.length ?? 0
    if (r?.fallback === true) fallbackFiles++

    const fileKey = `${f.repo}/${f.rel}`
    let fileNames = namesInFile.get(fileKey)
    if (!fileNames) { fileNames = new Set(); namesInFile.set(fileKey, fileNames) }
    const scopeKey = `${f.repo}|${f.scope}`
    let scopeNames = namesInScope.get(scopeKey)
    if (!scopeNames) { scopeNames = new Set(); namesInScope.set(scopeKey, scopeNames) }
    let repoNames = namesInRepoFull.get(f.repo)
    if (!repoNames) { repoNames = new Set(); namesInRepoFull.set(f.repo, repoNames) }

    for (const s of r?.symbols ?? []) {
      symbols++
      const kind = String((s as any).kind ?? "")
      const nm = String(s.name ?? "")
      const isFallback = kind === "" && (s as any).range === undefined && typeof (s as any).type === "string"
      if (isFallback) continue
      if (nm.length === 0) emptyNames++
      if (kind === "" || kind === "unknown") emptyKinds++
      if (nm === "unknown") symbolsNamedUnknown++
      const owner = typeof (s as any).ownerName === "string" ? (s as any).ownerName : ""
      const id = `${kind}|${owner}|${f.repo}/${f.rel}`
      addSymbol(fileNames, byName, nm, id)
      addSymbol(scopeNames, byName, nm, id)
      if (owner.length > 0) {
        // The qualified spelling a consumer needs to bind a member edge. Recorded
        // in the same tables so a resolution answer never depends on which form
        // the consumer happened to try.
        addSymbol(fileNames, byName, `${owner}.${nm}`, id)
        addSymbol(scopeNames, byName, `${owner}.${nm}`, id)
      }
      if (f.scope === "full") {
        addSymbol(repoNames, byName, nm, id)
        if (owner.length > 0) addSymbol(repoNames, byName, `${owner}.${nm}`, id)
      }
    }

    // This file's OWN import specifiers, read off parseFile's import records so
    // the classification is the production answer and not a re-read of the source.
    // The field is `path`: pool-worker.ts rewrites `module`/`source` into
    // `BasicImport.path`, and the first version of this harness read `module`,
    // matched nothing, and filed every SDK and package target under
    // `unexplained` — 2,994 `calls` rows and 347 `overrides` rows misfiled, with
    // the true package population reading 0.
    //
    // Kept as a LIST, not a boolean, because Dart's barrel imports make the
    // file-local test wrong. `riverpod/packages/flutter_riverpod/lib/src/core/
    // consumer.dart` declares exactly ONE import, `../core.dart`, and reaches
    // `package:flutter/widgets.dart` through it — so `ConsumerStatefulWidget
    // extends StatefulWidget` was filed `unexplained` while its real supplier sat
    // two hops away in the same repository. The transitive closure below is what
    // makes the bucket mean what it says.
    const specifiers: string[] = []
    for (const im of r?.imports ?? []) {
      const mod = String((im as any).path ?? (im as any).module ?? (im as any).source ?? "")
      if (mod.length > 0) specifiers.push(mod)
    }
    importsByFile.set(fileKey, specifiers)
    drawnFiles.add(fileKey)

    for (const rel of r?.relationships ?? []) {
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
      const label = ALL_TYPES.includes(t as Type) ? t : `<other:${t}>`
      if ((rel as any)?.metadata?.method === "regex") {
        // The degraded path's own marker. Counted, named, and kept OUT of every
        // analyzer column below.
        fallbackEdgeTotal++
        fallbackEdges.set(label, (fallbackEdges.get(label) ?? 0) + 1)
        continue
      }
      relationships++
      const rr = row(label)
      rr.n++
      const conf = typeof rel.confidence === "number" ? rel.confidence : 1
      if (conf < 0.7) rr.heur++

      const src = String(rel.source ?? rel.from ?? rel.fromSymbol ?? "")
      const tgt = String(rel.target ?? rel.to ?? rel.toSymbol ?? "")
      if (src === "unknown" || tgt === "unknown") unknownEndpoints++

      const md = (rel as any).metadata ?? {}
      const isLocal = md.isLocalRead === true
      const isUriEndpoint = label === "imports" || label === "exports"

      if (fileNames.has(src)) rr.srcInFile++
      if (fileNames.has(tgt)) rr.tgtInFile++
      if (fileNames.has(src) && fileNames.has(tgt)) rr.bothInFile++

      // EVERYTHING that needs a cross-file symbol set is deferred to phase 2.
      //
      // The first version resolved scope, ambiguity and the no-symbol buckets
      // inside the walk, against a table that was still being filled, and the
      // answer therefore depended on the order files happened to be parsed in.
      // That is not hypothetical: `pkgs/http2/lib/src/flowcontrol/window_handler.dart`
      // sorts BEFORE `pkgs/http2/lib/src/sync_errors.dart`, so at the moment the
      // walk read `processWindowUpdate -> FlowControlException` the declaration
      // had not been published yet and the edge was filed `unexplained` — a class
      // declared 200 lines away in the same FULL repository, misfiled as a defect.
      // `census.ts` records the same hazard in its own header and solves it the
      // same way. In-file resolution stays here because every symbol of a file is
      // published before any of that file's edges are read; nothing else is.
      const reasonKeys = Object.keys(md).filter(k => k.startsWith("is") || k.endsWith("Kind")).sort()
      kept.push({
        repo: f.repo, scope: f.scope, type: label, src, tgt,
        fileKey, isLocal, isUriEndpoint,
        reasonTag: reasonKeys.length ? reasonKeys.join("+") : "<none>",
      })
    }
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
const walkMs = Date.now() - t0

// ---------------------------------------------------------------- import closure
//
// "Could a package this corpus does not carry supply this name?" is asked of the
// file's REACHABLE import graph, not of its own import lines, because Dart's
// `library`/barrel convention routes most of a library's dependencies through one
// relative `export`/`import`. Resolution is pure path arithmetic over specifiers
// this harness already read out of parseFile — no regex, no YAML, no second
// parser — and a relative specifier that does not name a drawn file simply ends
// that branch, which is the honest result for a repo this run did not read whole.
function normalizeRepoPath(rel: string): string {
  const out: string[] = []
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") { out.pop(); continue }
    out.push(seg)
  }
  return out.join("/")
}
function resolveRelative(fromRel: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null
  const dir = fromRel.split("/").slice(0, -1).join("/")
  const joined = dir.length > 0 ? `${dir}/${spec}` : spec
  const norm = normalizeRepoPath(joined)
  return norm.length > 0 ? norm : null
}
/** fileKey -> does its reachable import graph name a package:/dart: URI? */
const closureHasPackage = new Map<string, boolean>()
const closureSize = new Map<string, number>()
function computeClosure(fileKey: string): { hasPackage: boolean; reached: number } {
  const hit = closureHasPackage.get(fileKey)
  if (hit !== undefined) return { hasPackage: hit, reached: closureSize.get(fileKey) ?? 0 }
  const repo = fileKey.split("/")[0]
  const start = fileKey.slice(repo.length + 1)
  const seen = new Set<string>([start])
  const queue: string[] = []
  let hasPackage = false
  const seed = importsByFile.get(fileKey) ?? []
  for (const spec of seed) {
    if (spec.startsWith("package:") || spec.startsWith("dart:")) { hasPackage = true; continue }
    const r = resolveRelative(start, spec)
    if (r) queue.push(r)
  }
  let reached = 0
  while (queue.length > 0) {
    const rel = queue.shift()!
    if (seen.has(rel)) continue
    seen.add(rel)
    reached++
    // `repo/rel`, NOT `repo|rel`: `importsByFile` is keyed by the same
    // `fileKey` the edges carry, and the first version of this walk looked the
    // hop up under a `|` separator. Every lookup missed, so the closure was a
    // single hop deep, `hasPackage` was true only for a file's OWN package
    // imports, and the barrel-import fix silently did nothing — the whole
    // `packageDeclared` population came out byte-identical to the run before it,
    // which is what exposed it. A fix that changes nothing measurable is not a
    // fix, and identical numbers across a change are the evidence.
    const hopKey = `${repo}/${rel}`
    if (!drawnFiles.has(hopKey)) continue
    for (const spec of importsByFile.get(hopKey) ?? []) {
      if (spec.startsWith("package:") || spec.startsWith("dart:")) { hasPackage = true; continue }
      const r = resolveRelative(rel, spec)
      if (r && !seen.has(r)) queue.push(r)
    }
  }
  closureHasPackage.set(fileKey, hasPackage)
  closureSize.set(fileKey, reached)
  return { hasPackage, reached }
}
// ---------------------------------------------------------------- phase 2
// Settled tables. Nothing below depends on parse order, so two runs of the same
// sample give the same numbers regardless of how the work was scheduled.
for (const e of kept) {
  const rr = row(e.type)
  const scopeNames = namesInScope.get(`${e.repo}|${e.scope}`)
  const repoNames = namesInRepoFull.get(e.repo)
  if (scopeNames) {
    if (scopeNames.has(e.src)) rr.srcInScope++
    if (scopeNames.has(e.tgt)) rr.tgtInScope++
    if (scopeNames.has(e.src) && scopeNames.has(e.tgt)) rr.bothInScope++
  }
  if (e.scope === "full" && repoNames) {
    if (repoNames.has(e.src)) rr.srcInRepoFull++
    if (repoNames.has(e.tgt)) rr.tgtInRepoFull++
    if (repoNames.has(e.src) && repoNames.has(e.tgt)) rr.bothInRepoFull++
  }

  // AMBIGUITY at the widest scope this repo can honestly offer.
  const ident = byName.get(e.tgt)
  const ambN = ident ? ident.size : 0
  if (ambN === 1) rr.tgtUnique++
  else if (ambN >= 2 && ambN <= 5) rr.tgtAmbiguous++
  else if (ambN >= 6) rr.tgtCrowded++
  else {
    rr.tgtNoSymbol++
    const reasonKey = `${e.type}|${e.reasonTag}`
    noSymbolReasons.set(reasonKey, (noSymbolReasons.get(reasonKey) ?? 0) + 1)
    // The order is a funnel, cheapest and most certain first, and each step is a
    // POSITIVE test — a name is only filed under a bucket when that bucket's own
    // evidence is present. Nothing is inferred from the absence of other evidence.
    //
    // The example is recorded INSIDE the arm that classified it. The first version
    // recorded every no-symbol target in one list and printed that list under the
    // `unexplained` heading, so the report showed `main -> group` and
    // `BookSearchApp.build -> StatelessWidget.build` as unexplained when both are
    // `package:test` / `package:flutter` declarations — the examples came from a
    // different population than the count they sat under, which is the exact
    // confusion this file exists to remove.
    if (e.isLocal) { rr.noSymbolLocal++; bumpExample(`local:${e.type}`, `${e.fileKey}: ${e.src} -> ${e.tgt}`) }
    else if (e.isUriEndpoint) { rr.noSymbolUri++; bumpExample(`uri:${e.type}`, `${e.fileKey}: ${e.src} -> ${e.tgt}`) }
    else if (sdkNames.has(e.tgt)) { rr.noSymbolSdk++; bumpExample(`sdk:${e.type}`, `${e.fileKey}: ${e.src} -> ${e.tgt}`) }
    else if (computeClosure(e.fileKey).hasPackage) { rr.noSymbolPackage++; bumpExample(`package:${e.type}`, `${e.fileKey}: ${e.src} -> ${e.tgt}`) }
    else if (e.scope === "sample") {
      // A SAMPLE-scope repo's symbol table is a stride of the repository, so
      // "declared nowhere in what I parsed" is NOT "declared nowhere in the
      // repository" — and calling it `unexplained` would file a 2% sample's
      // blind spot as a defect. Counted apart, never in the defect bucket.
      rr.noSymbolOutsideSample++; bumpExample(`outsideSample:${e.type}`, `${e.fileKey}: ${e.src} -> ${e.tgt}`)
    }
    else {
      rr.noSymbolUnexplained++
      bumpExample(`unexplained:${e.type}`, `${e.fileKey}: ${e.src} -> ${e.tgt}`)
      let th = unexplainedTargets.get(e.type)
      if (!th) { th = new Map(); unexplainedTargets.set(e.type, th) }
      th.set(e.tgt, (th.get(e.tgt) ?? 0) + 1)
    }
  }
  if (ambN >= 2) {
    // Would qualifying the TARGET by the SOURCE make it unique? That is the
    // disambiguation the edge could carry and does not.
    const fileNames = namesInFile.get(e.fileKey)
    const qualified = `${e.src}.${e.tgt}`
    if ((fileNames?.has(qualified) ?? false) || (scopeNames?.has(qualified) ?? false)) rr.qualifiedBySource++
  }
}

// ---------------------------------------------------------------- report
const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)

console.log(`dart incoming census — ${files.length} files: ${FULL_REPOS.length} repos FULL, ${SAMPLE_REPOS.length} repos SAMPLE`)
console.log(`corpus root ${CR}`)
for (const r of repoStats) console.log(`  ${w(r.repo, 20)}${w(String(r.scope), 8)}tracked=${r.tracked} stride=${r.stride ?? "-"} drawn=${r.drawn}`)
console.log(`Dart SDK index: ${sdkFilesPresent} tracked files under dart-sdk/sdk/lib, ${sdkFilesDrawn} parsed, ${sdkNames.size} distinct symbol spellings`)
{
  let withClosure = 0; let withPackage = 0; let reachedTotal = 0
  for (const k of importsByFile.keys()) {
    const c = computeClosure(k)
    withClosure++
    reachedTotal += c.reached
    if (c.hasPackage) withPackage++
  }
  console.log(`import closure: ${withClosure} files with import records, ${withPackage} (${pct(withPackage, withClosure)}) reach a package:/dart: URI through it, ${reachedTotal} relative-import hops followed`)
}
console.log(`files >1MB (structural fallback, analyzer never sees them) ${overStructuralLimit}   >5MB (skipped) ${overSkipLimit}`)
console.log(`filesParsed ${JSON.stringify(filesParsed)}  fallbackFiles(>1MB, regex extractor) ${fallbackFiles}`)
console.log(`EXCLUDED degraded-fallback edges (metadata.method=regex, NOT analyzer output): ${fallbackEdgeTotal} ${JSON.stringify(Object.fromEntries([...fallbackEdges.entries()].sort()))}`)
console.log(`symbols ${symbols}  relationships ${relationships}  filesWithParseErrors ${filesWithErrors}  parseErrors ${parseErrors}`)
console.log(`emptySymbolNames ${emptyNames}  emptyOrUnknownKind ${emptyKinds}  symbolsNamedUnknown ${symbolsNamedUnknown}  unknownEndpoints ${unknownEndpoints}`)
console.log(`wallMs(walk) ${walkMs}  concurrency ${CONCURRENCY}`)
if (failures.length) console.log(`FAILURES ${failures.length}: ${failures.slice(0, 5).join(" | ")}`)

console.log("")
console.log("RESOLUTION + AMBIGUITY per type. `bothInRepoFull` is over FULL repos only; `bothInScope` over SAMPLE repos only. Never mixed.")
console.log("")
const head = ["type", "emitted", "bothInFile", "bothInSample", "bothInRepoFull", "tgtUnique", "tgtAmb2-5", "tgtCrowd6+", "tgtNoSym", "heur<0.7"]
console.log(head.map((h, i) => w(h, i === 0 ? 14 : 13)).join(""))
console.log("-".repeat(150))
const ordered = [...rows.entries()].sort((a, b) => ALL_TYPES.indexOf(a[0] as Type) - ALL_TYPES.indexOf(b[0] as Type))
for (const [t, r] of ordered) {
  const cells = [
    t,
    String(r.n),
    `${r.bothInFile} ${pct(r.bothInFile, r.n)}`,
    `${r.bothInScope} ${pct(r.bothInScope, r.n)}`,
    `${r.bothInRepoFull} ${pct(r.bothInRepoFull, r.n)}`,
    `${r.tgtUnique} ${pct(r.tgtUnique, r.n)}`,
    `${r.tgtAmbiguous} ${pct(r.tgtAmbiguous, r.n)}`,
    `${r.tgtCrowded} ${pct(r.tgtCrowded, r.n)}`,
    `${r.tgtNoSymbol} ${pct(r.tgtNoSymbol, r.n)}`,
    `${r.heur} ${pct(r.heur, r.n)}`,
  ]
  console.log(cells.map((c, i) => w(c, i === 0 ? 14 : 13)).join(""))
}

console.log("")
console.log("TARGETS THAT RESOLVE TO NO SYMBOL — split by WHY (deliverable C). A positive test per bucket, in funnel order.")
console.log("  localNotPublished  a binding the family contract does not publish (DARTD8)")
console.log("  uriEndpoint        an imports/exports module path, which is not a bindable name by design")
console.log("  sdkDeclared        published by a .dart file under dart-sdk/sdk/lib — a real declaration, in a repo this run does not index")
console.log("  packageDeclared    the file imports a package:/dart: URI and the name is in neither the repo nor the SDK")
console.log("  outsideSample      SAMPLE-scope repo, so the symbol table is a stride of it: absence proves nothing either way")
console.log("  unexplained        none of the above, in a FULL-scope repo: the class that would be a defect")
console.log("")
console.log(w("type", 14) + w("noSymbol", 12) + w("localNotPub", 13) + w("uriEndpoint", 12) + w("sdkDeclared", 13) + w("packageDecl", 13) + w("outsideSamp", 13) + "unexplained")
console.log("-".repeat(110))
for (const [t, r] of ordered) {
  console.log(w(t, 14) + w(String(r.tgtNoSymbol), 12) + w(String(r.noSymbolLocal), 13) + w(String(r.noSymbolUri), 12) + w(String(r.noSymbolSdk), 13) + w(String(r.noSymbolPackage), 13) + w(String(r.noSymbolOutsideSample), 13) + String(r.noSymbolUnexplained))
}

console.log("")
console.log("AMBIGUOUS TARGETS THE EDGE COULD ALREADY DISAMBIGUATE (deliverable B): target name matches 2+ symbols,")
console.log("and `<source>.<target>` is itself a published spelling. Counted per type.")
console.log("")
console.log(w("type", 14) + w("ambiguous", 12) + "qualifiedBySource")
console.log("-".repeat(40))
for (const [t, r] of ordered) {
  if (r.tgtAmbiguous + r.tgtCrowded === 0) continue
  console.log(w(t, 14) + w(String(r.tgtAmbiguous + r.tgtCrowded), 12) + String(r.qualifiedBySource))
}

console.log("")
console.log("NO-SYMBOL POPULATION BY THE EMITTER'S OWN REASON TAG (not this harness's inference), top 3 per type:")
const reasonsByType = new Map<string, Array<[string, number]>>()
for (const [k, v] of noSymbolReasons) {
  const i = k.indexOf("|")
  const t = k.slice(0, i); const tag = k.slice(i + 1)
  const arr = reasonsByType.get(t) ?? []
  arr.push([tag, v]); reasonsByType.set(t, arr)
}
for (const [t] of ordered) {
  const arr = (reasonsByType.get(t) ?? []).sort((a, b) => b[1] - a[1]).slice(0, 3)
  if (arr.length === 0) continue
  console.log(`  ${w(t, 14)}${arr.map(([tag, v]) => `${tag}=${v}`).join("  ")}`)
}

console.log("")
console.log("UNEXPLAINED TARGETS, most frequent first (top 8 per type). A single name dominating a type is a SHAPE;")
console.log("a flat spread is a different defect, and only the histogram separates them.")
for (const [t] of ordered) {
  const th = unexplainedTargets.get(t)
  if (!th || th.size === 0) continue
  const top = [...th.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`  ${w(t, 14)}distinct=${String(th.size).padEnd(7)}${top.map(([n, v]) => `${n}=${v}`).join("  ")}`)
}

console.log("")
console.log("EXAMPLES, drawn from the bucket the row sits in (capped at 6 per type per bucket):")
const bucketOf: Record<string, keyof Row> = {
  unexplained: "noSymbolUnexplained", sdk: "noSymbolSdk",
  package: "noSymbolPackage", local: "noSymbolLocal", uri: "noSymbolUri",
  outsideSample: "noSymbolOutsideSample",
}
for (const bucket of ["unexplained", "outsideSample", "package", "sdk", "local", "uri"]) {
  for (const [t, r] of ordered) {
    const key = `${bucket}:${t}`
    const arr = examples[key]
    const n = r[bucketOf[bucket]] as number
    if (!arr || n === 0) continue
    console.log(`  [${bucket}] ${t} (${n}):`)
    for (const e of arr) console.log(`      ${e}`)
  }
}

const out: any = {
  corpusRoot: CR,
  sampling: {
    method: "deterministic stride over git ls-files -- '*.dart', sorted, per repo; stride 1 (FULL) or max(1,floor(tracked/perRepo)) (SAMPLE)",
    fullRepos: FULL_REPOS,
    sampleRepos: SAMPLE_REPOS,
    perRepo: PER_REPO,
    repos: repoStats,
  },
  filesDrawn: files.length,
  filesOverStructuralLimit1MB: overStructuralLimit,
  filesOverSkipLimit5MB: overSkipLimit,
  filesParsed,
  structuralFallbackFiles: fallbackFiles,
  degradedFallbackEdgesExcluded: fallbackEdgeTotal,
  degradedFallbackEdgesByType: Object.fromEntries([...fallbackEdges.entries()].sort()),
  symbols, relationships, filesWithParseErrors: filesWithErrors, parseErrors,
  emptySymbolNames: emptyNames, emptyOrUnknownKind: emptyKinds,
  symbolsNamedUnknown, unknownEndpoints,
  failures: failures.slice(0, 20),
  wallMsWalk: walkMs,
  concurrency: CONCURRENCY,
  distinctSymbolNames: byName.size,
  noSymbolByReasonTag: Object.fromEntries([...noSymbolReasons.entries()].sort()),
  unexplainedTargets: Object.fromEntries([...unexplainedTargets.entries()].sort().map(([k, m]) => [k, Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))])),
  sdkIndex: { filesTracked: sdkFilesPresent, filesParsed: sdkFilesDrawn, distinctSpellings: sdkNames.size },
  importClosure: { filesWithImportRecords: importsByFile.size, filesReachingAPackageUri: [...importsByFile.keys()].filter(k => closureHasPackage.get(k) === true).length },
  perType: Object.fromEntries([...rows.entries()].sort((a, b) => ALL_TYPES.indexOf(a[0] as Type) - ALL_TYPES.indexOf(b[0] as Type))),
  unexplainedExamples: examples,
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nwrote ${OUT}`)
}
