// AMBIGUITY_FLEET — the per-edge endpoint-resolution census for Go.
//
// THE QUESTION. For every edge the production path emits, does BOTH endpoints
// bind to a real declared symbol? Four failure classes are named by the brief
// and each is counted separately, never folded into one flattering figure:
//
//   1 UNKNOWN TARGETS      an endpoint spelled `unknown` / `Unknown` / …
//   2 EMPTY-STRING TARGETS an endpoint of length 0
//   3 PLACEHOLDER LITERALS R7's vocabulary: '*', 'module', 'global', '_', and
//                          the tree-sitter recovery marks
//   4 NAMES NO SYMBOL DECLARES   the endpoint is a real-looking name that no
//                          declaration in the measured population answers to
//
// The headline is the AMBIGUITY RATE = (edges with at least one non-resolving
// endpoint) / (edges emitted), per relationship type, with counts and files.
//
// WHAT "RESOLVES" CAN AND CANNOT MEAN HERE, STATED UP FRONT.
//
// The lane is a PER-FILE analyzer and Go's names are PACKAGE-scoped, so
// "resolves" is measured on a ladder and the rungs are reported apart:
//
//   FILE-LOCAL  every part of the endpoint is declared in the SAME file
//   PACKAGE     …in another file of the same package directory
//   CORPUS      …somewhere in the measured population
//   UNDECLARED  nowhere
//
// A PATH-LIKE endpoint (it contains "/") is neither. A module path is not a
// declaration — it names a package — and a source that is a file path is the
// analyzer reporting that the file had no package clause. Both are real
// outcomes and both are counted in their own class, because calling them
// "ambiguous" would be a category error the ontology workstream explicitly
// warns about.
//
// TWO RATES, BOTH PRINTED, NEITHER SUPPRESSED:
//
//   strict   an endpoint resolves only if it is a declared name. A module path
//            and a file path therefore count as un-resolving.
//   contract as strict, except that a path-like endpoint on an `imports`
//            TARGET counts as by-contract rather than as a defect.
//
// WHY TWO PASSES. Resolution needs an index of every declaration in the
// population, and the population is far larger than one process can hold a
// wasm heap for (measured on this lane: an unsharded pass dies at ~1,000 files
// with "memory access out of bounds" + the engine's 120 s hang guard, which is
// a `process.exit` inside MASTER-owned engine.ts, so a probe cannot catch it —
// the run reports on the files it reached and stops, which reads exactly like
// a clean result). So:
//
//   --index  parse with the RAW parser, walk the tree, record declarations
//            per package directory. No analyzer runs. Shardable.
//   --edges  run the PRODUCTION path (ASTEngine.parseFile) per file and
//            resolve every endpoint against the merged index. Shardable.
//   --merge  sum the shards into one table.
//
// The index is INTERMEDIATE and is written outside `validation/m14/` by
// default: it is ~1,000,000 names and fully re-derivable by re-running the
// command. The measurement table is the artifact that is committed.
//
// NO REGEX. Every name decision here is a Set/Map lookup, a charCodeAt range
// test, `split`/`lastIndexOf`, or string equality against a fixed vocabulary.
// A regex over source text is how an analyzer lies: it matches comments and
// string literals and breaks silently on the next grammar version.
//
// POPULATION. Derived from the corpus directory by a recursive readdir walk —
// never a hand-written file list (honesty contract §"an instrument must
// declare the population it covered"). The admission rule is the production
// one (`detectLanguageFromPath(p) === "go"`) plus a size cap, and every
// exclusion is COUNTED and printed so a reader can see the denominator rather
// than take it on trust.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const ARGS = process.argv.slice(2)
const MODE = ARGS[0] ?? "--usage"
const CORPUS_ROOT = process.env.GO_CORPUS ?? "$HOME/fixtures/repositories/go-stdlib"
// The lane's recorded admission rule (docs/analyzers/go.md,
// "Draws, stated once"): git-tracked, <=512 KB, detected as go, testdata out.
// The cap is NOT the engine's own 16 MiB truncation limit; it is this lane's
// historical draw rule and it is printed so a reader can compare.
const MAX_BYTES = Number(process.env.GO_MAX_BYTES ?? 512 * 1024)
const SKIP_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", "testdata"])

// ---------------------------------------------------------------------------
// The R7 placeholder vocabulary. Compared by STRING EQUALITY, in this order,
// and the order is load-bearing: `global` is checked before the name index, so
// a Go declaration that happens to be named `global` would still be reported
// as a placeholder. That is the intended reading — the analyzer publishes the
// STRING "global" to mean "no attributable declaration", and a declaration
// sharing that spelling does not make the edge attributable.
//
// Deliberately NOT in this list: `root`, `self`, `program`, `unknown` is in
// the UNKNOWN list below but `root`/`self`/`program` are legal Go
// declarations (this lane measured all three as real names the pool-worker
// denylist wrongly drops) and calling them placeholders here would
// manufacture a defect class out of three correct edges.
// ---------------------------------------------------------------------------
const UNKNOWN_SPELLINGS: ReadonlySet<string> = new Set([
  "unknown", "Unknown", "UNKNOWN", "unknown_target", "unknownSymbol",
  "unknown_symbol", "<unknown>",
])
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  "*", "module", "global", "_", "?", "??", "<missing>", "MISSING", "N/A",
  "null", "NULL", "none", "None", "anonymous", "<anonymous>", "undefined",
])

const TYPE_ORDER = [
  "calls", "uses", "references", "exports", "contains", "imports",
  "instantiates", "extends", "implements", "overrides",
]

type Class =
  | "local" | "package" | "corpus" | "undeclared"
  | "empty" | "unknownSpelling" | "placeholder" | "pathLike"

const CLASSES: Class[] = [
  "local", "package", "corpus", "undeclared",
  "empty", "unknownSpelling", "placeholder", "pathLike",
]

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------
interface CorpusFile { path: string; rel: string; dir: string; bytes: number }

interface Population {
  files: CorpusFile[]
  seenGo: number
  skippedTestdata: number
  skippedOversize: number
  skippedUndetected: number
  skippedDir: number
  roots: string[]
}

function derivePopulation(root: string): Population {
  const files: CorpusFile[] = []
  let seenGo = 0, skippedTestdata = 0, skippedOversize = 0, skippedUndetected = 0, skippedDir = 0
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 24) return
    let ents: ReturnType<typeof readdirSync>
    try {
      ents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      const p = join(dir, e.name)
      const r = rel.length === 0 ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) {
          if (e.name === "testdata") skippedTestdata++
          else skippedDir++
          continue
        }
        walk(p, r, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      if (detectLanguageFromPath(p) !== "go") continue
      seenGo++
      let size = 0
      try { size = statSync(p).size } catch { continue }
      if (size > MAX_BYTES) { skippedOversize++; continue }
      const dirRel = r.lastIndexOf("/") < 0 ? "." : r.slice(0, r.lastIndexOf("/"))
      files.push({ path: p, rel: r, dir: dirRel, bytes: size })
    }
  }
  walk(root, "", 0)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  let roots: string[] = []
  try {
    roots = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
      .map((d) => d.name)
      .sort()
  } catch { roots = [] }
  return { files, seenGo, skippedTestdata, skippedOversize, skippedUndetected, skippedDir, roots }
}

// Shard by a deterministic sort-order stride, and PRINT the shard's own file
// count so a merged table's denominator can be checked against the sum.
function shardOf(pop: Population, shard: string): { files: CorpusFile[]; i: number; n: number } {
  if (!shard) return { files: pop.files, i: 0, n: 1 }
  const slash = shard.lastIndexOf("/")
  const i = Number(shard.slice(0, slash))
  const n = Number(shard.slice(slash + 1))
  if (!Number.isFinite(i) || !Number.isFinite(n) || n < 1 || i < 0 || i >= n) {
    throw new Error(`--shard must be i/n with 0 <= i < n; got "${shard}"`)
  }
  return { files: pop.files.filter((_, k) => k % n === i), i, n }
}

// ---------------------------------------------------------------------------
// PASS 1 — the declaration index (raw grammar, no analyzer)
// ---------------------------------------------------------------------------
interface NameIndex {
  byDir: Record<string, string[]>
  methodsByDir: Record<string, string[]>
  allNames: string[]
  allMethods: string[]
  byDirCounts: Record<string, number>
  fileNames: Record<string, string[]>
  fileMethods: Record<string, string[]>
}

function isPackageScope(n: any): boolean {
  for (let q = n.parent; q; q = q.parent) {
    const t = q.type
    if (t === "source_file") return true
    if (t === "function_declaration" || t === "method_declaration" || t === "func_literal") return false
  }
  return false
}

function leafName(raw: string): string {
  const d = raw.lastIndexOf(".")
  const leaf = d >= 0 ? raw.slice(d + 1) : raw
  const lt = leaf.indexOf("[")
  const l2 = lt >= 0 ? leaf.slice(0, lt) : leaf
  const st = l2.lastIndexOf("*")
  return st >= 0 ? l2.slice(st + 1) : l2
}

/** Every declaration the grammar hands back, keyed by what kind of name it is. */
function indexFile(root: any): { names: Set<string>; methods: Set<string> } {
  const names = new Set<string>()
  const methods = new Set<string>()
  const add = (s: string | undefined): void => {
    if (typeof s !== "string" || s.length === 0) return
    names.add(s)
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    const t = n.type
    if (t === "package_clause") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "package_identifier") add(String(c.text ?? ""))
      }
    } else if (t === "type_spec") {
      const nm = n.childForFieldName("name")
      if (nm) add(String(nm.text ?? ""))
      else {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "type_identifier") { add(String(c.text ?? "")); break }
        }
      }
    } else if (t === "function_declaration") {
      const nm = n.childForFieldName("name")
      if (nm) add(String(nm.text ?? ""))
    } else if (t === "method_declaration") {
      const nm = n.childForFieldName("name")
      const name = nm ? String(nm.text ?? "") : ""
      add(name)
      // The receiver TYPE is a declared name too, and a method endpoint is
      // published as `Receiver.Method`, so the pair is indexed verbatim.
      const recvList = n.childForFieldName("receiver")
      let recvType = ""
      if (recvList && recvList.namedChildCount > 0) {
        const rp = recvList.namedChild(0)
        if (rp) {
          const rt = rp.childForFieldName("type")
          if (rt) recvType = leafName(String(rt.text ?? ""))
        }
      }
      if (recvType === "") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "parameter_list") {
            const p0 = c.namedChild(0)
            if (p0 && p0.type === "parameter_declaration") {
              const pt = p0.childForFieldName("type")
              if (pt) { recvType = leafName(String(pt.text ?? "")); break }
            }
          }
        }
      }
      if (name.length > 0 && recvType.length > 0) {
        add(recvType)
        methods.add(`${recvType}.${name}`)
        add(name)
      }
    } else if (t === "field_declaration") {
      const nm = n.childForFieldName("name")
      if (nm) {
        // A grouped declaration `a, b int` has ONE field_declaration carrying
        // every name in this grammar? No — it repeats the node. Either way the
        // loop below collects them all, and a nameless field is an EMBED whose
        // type is the declared name the `extends` edge targets.
        add(String(nm.text ?? ""))
      } else {
        const ty = n.childForFieldName("type")
        if (ty) {
          if (ty.type === "qualified_type") {
            for (let i = 0; i < ty.namedChildCount; i++) {
              const c = ty.namedChild(i)
              if (c && c.type === "type_identifier") add(String(c.text ?? ""))
            }
          } else if (ty.type === "type_identifier" || ty.type === "pointer_type" || ty.type === "generic_type") {
            add(leafName(String(ty.text ?? "")))
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "field_identifier") add(String(c.text ?? ""))
      }
    } else if (t === "method_spec" || t === "method_elem") {
      const nm = n.childForFieldName("name")
      if (nm) add(String(nm.text ?? ""))
    } else if (t === "var_spec" || t === "const_spec") {
      // Package scope only: a function-local `var x` is NOT a symbol in this
      // lane (the C# LocalsAreNotSymbols contract) and an edge that targets one
      // can never bind to anything a consumer can look up.
      if (isPackageScope(n)) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") add(String(c.text ?? ""))
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return { names, methods }
}

async function runIndex(): Promise<void> {
  const full = derivePopulation(CORPUS_ROOT)
  const pop: Population = { ...full, files: drawFiles(full) }
  const shardArg = valueOf("--shard")
  const { files, i, n } = shardOf(pop, shardArg ?? "")
  const out = process.env.GO_AMBIGUITY_INDEX_OUT ?? "/tmp/opencode/go-ambiguity-index.json"
  const byDir = new Map<string, Set<string>>()
  const methodsByDir = new Map<string, Set<string>>()
  const fileNames = new Map<string, Set<string>>()
  const fileMethods = new Map<string, Set<string>>()
  const allNames = new Set<string>()
  const allMethods = new Set<string>()
  let parsed = 0, failed = 0

  // The corpus destroys a wasm heap: measured on this lane, an unsharded pass
  // dies at ~1,000 files with "memory access out of bounds" plus the engine's
  // 120 s hang guard (a `process.exit` inside MASTER-owned engine.ts). A parse
  // that THROWS is recoverable — the tree it built is already gone and the
  // parser object may be the exhausted one — so each failure is retried on a
  // fresh parser and the counts of both are recorded. A file that fails on
  // every attempt is left out of the index AND out of the edge population
  // below, so the two passes measure the same files (the honesty rule: an
  // instrument must declare the population it covered).
  const MAX_ATTEMPTS = 3
  const attempts = new Map<string, number>()
  const stillFailed: string[] = []
  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { failed++; stillFailed.push(f.rel); continue }
    let ok = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      attempts.set(f.rel, attempt)
      let tree: any
      try {
        const p = await ASTEngine.getParser("go")
        tree = p.parse(content)
      } catch {
        continue
      }
      try {
        const { names, methods } = indexFile(tree.rootNode)
        fileNames.set(f.rel, names)
        fileMethods.set(f.rel, methods)
        let ds = byDir.get(f.dir)
        if (!ds) { ds = new Set(); byDir.set(f.dir, ds) }
        let ms = methodsByDir.get(f.dir)
        if (!ms) { ms = new Set(); methodsByDir.set(f.dir, ms) }
        for (const nm of names) { ds.add(nm); allNames.add(nm) }
        for (const mm of methods) { ms.add(mm); allMethods.add(mm) }
        ok = true
      } catch {
        break
      }
    }
    if (ok) parsed++
    else { failed++; stillFailed.push(f.rel) }
  }
  const arr = (s: Set<string>): string[] => [...s].sort()
  const idx: NameIndex = {
    byDir: Object.fromEntries([...byDir.entries()].map(([k, v]) => [k, arr(v)])),
    methodsByDir: Object.fromEntries([...methodsByDir.entries()].map(([k, v]) => [k, arr(v)])),
    allNames: arr(allNames),
    allMethods: arr(allMethods),
    byDirCounts: Object.fromEntries([...byDir.entries()].map(([k, v]) => [k, v.size])),
    fileNames: Object.fromEntries([...fileNames.entries()].map(([k, v]) => [k, arr(v)])),
    fileMethods: Object.fromEntries([...fileMethods.entries()].map(([k, v]) => [k, arr(v)])),
  }
  writeFileSync(out, JSON.stringify({
    population: popSummary(pop), shard: { i, n, files: files.length },
    parsed, failed, retriedFiles: [...attempts.entries()].filter(([, a]) => a > 1).length,
    maxAttempts: MAX_ATTEMPTS, stillFailed, dirs: byDir.size,
    names: allNames.size, methods: allMethods.size, index: idx,
  }))
  process.stderr.write(
    `INDEX shard ${i}/${n}: ${files.length} of ${pop.files.length} admitted files, ` +
    `${parsed} parsed, ${failed} failed, ${byDir.size} package dirs, ${allNames.size} distinct names, ` +
    `${allMethods.size} distinct Receiver.Method pairs -> ${out}\n`,
  )
}

function popSummary(pop: Population): Record<string, unknown> {
  const limit = Number(process.env.GO_LIMIT ?? "0")
  const files = limit > 0 ? pop.files.slice(0, limit) : pop.files
  return {
    corpusRoot: CORPUS_ROOT, maxBytes: MAX_BYTES, skipDirs: [...SKIP_DIRS],
    roots: pop.roots, goFilesSeen: pop.seenGo, admitted: pop.files.length,
    limitApplied: limit > 0 ? limit : "none",
    admittedAfterLimit: files.length,
    skippedTestdataDirs: pop.skippedTestdata, skippedOversize: pop.skippedOversize,
    skippedUndetected: pop.skippedUndetected, skippedOtherDirs: pop.skippedDir,
    totalBytes: files.reduce((a, f) => a + f.bytes, 0),
    fileList: limit > 0 ? files.map((f) => f.rel) : undefined,
  }
}

/** The draw this process actually walks — GO_LIMIT truncates, and says so. */
function drawFiles(pop: Population): CorpusFile[] {
  const limit = Number(process.env.GO_LIMIT ?? "0")
  return limit > 0 ? pop.files.slice(0, limit) : pop.files
}

// ---------------------------------------------------------------------------
// PASS 2 — production path, per-edge endpoint resolution
// ---------------------------------------------------------------------------
interface PerFilePerType {
  edges: number
  ambiguous: number
  s: Record<string, number>
  t: Record<string, number>
}
interface TypeBucket {
  edges: number
  ambiguous: number
  ambiguousByContract: number
  files: Record<string, PerFilePerType>
  confBelow07: number
  confBelow10: number
  confByValue: Record<string, number>
  evidenceClass: Record<string, number>
  metaShapes: Record<string, number>
  noReasonCode: number
  subOneNoReasonCode: number
  hasReasonCode: number
  sourceEqualsTarget: number
  /** "srcClass>tgtClass" -> edges. Without this the headline rate cannot be
   *  adjudicated: a caller cannot tell `calls` failing on an undeclared stdlib
   *  LEAF from `contains` failing on an undeclared OWNER. */
  classPairs: Record<string, number>
  /** Distinct endpoint TEXTS per non-resolving class, with counts. Terminal
   *  only — see examples. */
  undeclaredTargets: Record<string, number>
  placeholderTargets: Record<string, number>
  /** Of the placeholder/unknown-spelling endpoints, how many a declaration in
   *  the measured population DOES answer to, and at which rung. The difference
   *  between the total and the "local"+"package" columns is a vocabulary
   *  collision, not an analyzer defect — see Resolver.wouldResolve. The `corpus`
   *  column is deliberately kept apart from the first two: a corpus-rung match on
   *  a three-letter word is weak evidence that the endpoint means that
   *  declaration. */
  placeholderWouldResolve: Record<string, number>
  unknownWouldResolve: Record<string, number>
}

function emptyPerFile(): PerFilePerType {
  const s: Record<string, number> = {}
  const t: Record<string, number> = {}
  for (const c of CLASSES) { s[c] = 0; t[c] = 0 }
  return { edges: 0, ambiguous: 0, s, t }
}

function emptyBucket(): TypeBucket {
  return {
    edges: 0, ambiguous: 0, ambiguousByContract: 0, files: {}, confBelow07: 0,
    confBelow10: 0, confByValue: {}, evidenceClass: {}, metaShapes: {}, noReasonCode: 0,
    subOneNoReasonCode: 0, hasReasonCode: 0, sourceEqualsTarget: 0,
    classPairs: {}, undeclaredTargets: {}, placeholderTargets: {},
    placeholderWouldResolve: { local: 0, package: 0, corpus: 0, none: 0 },
    unknownWouldResolve: { local: 0, package: 0, corpus: 0, none: 0 },
  }
}

class Resolver {
  fileNames = new Set<string>()
  fileMethods = new Set<string>()
  dirNames = new Set<string>()
  dirMethods = new Set<string>()
  analyzerNames = new Set<string>()

  constructor(
    private allNames: Set<string>,
    private allMethods: Set<string>,
  ) {}

  /** `isModulePath` is passed from the edge's OWN metadata, never inferred from
   *  the spelling. A module path need not contain a separator — `import "C"`
   *  (cgo) and `import "unsafe"` are both legal and both separator-free — so a
   *  "/" test would score them as an undeclared NAME, which is a category
   *  error, not a measurement. */
  classify(ep: string, hasDot: boolean, isModulePath: boolean): Class {
    if (ep.length === 0) return "empty"
    if (UNKNOWN_SPELLINGS.has(ep)) return "unknownSpelling"
    if (PLACEHOLDERS.has(ep)) return "placeholder"
    if (isModulePath) return "pathLike"
    if (ep.indexOf("/") >= 0) return "pathLike"
    if (hasDot) {
      const whole = ep
      if (this.fileMethods.has(whole)) return "local"
      if (this.dirMethods.has(whole)) return "package"
      if (this.allMethods.has(whole)) return "corpus"
      const parts = ep.split(".")
      let allLocal = true, allDir = true, allCorpus = true
      for (const p of parts) {
        if (p.length === 0) { allLocal = false; allDir = false; allCorpus = false; continue }
        if (!this.fileNames.has(p) && !this.fileMethods.has(p)) allLocal = false
        if (!this.dirNames.has(p) && !this.dirMethods.has(p)) allDir = false
        if (!this.allNames.has(p) && !this.allMethods.has(p)) allCorpus = false
      }
      if (allLocal) return "local"
      if (allDir) return "package"
      if (allCorpus) return "corpus"
      return "undeclared"
    }
    if (this.fileNames.has(ep)) return "local"
    if (this.dirNames.has(ep)) return "package"
    if (this.allNames.has(ep)) return "corpus"
    return "undeclared"
  }

  /** The rung this endpoint WOULD take if the placeholder/unknown vocabulary
   *  were not consulted first. Every token in that vocabulary is also a legal Go
   *  identifier and all of them ARE declared somewhere in go-stdlib — `module`
   *  is the package name of `golang.org/x/mod/module` (2 files, 43 edge
   *  sources), `None`/`none`/`null`/`NULL` are real declarations, `global` is a
   *  real package-scope `var` in src/runtime, and `_` is written in 614 files.
   *  So "spelled like a placeholder" and "binds to a declaration" are two
   *  different questions; the brief's class is the first, and this answers the
   *  second for the same endpoint so the artifact can say which it is instead of
   *  leaving the reader to assume. Returns "undeclared" for an endpoint no
   *  declaration answers to, which is the honest answer either way. */
  wouldResolve(ep: string, hasDot: boolean): "local" | "package" | "corpus" | "none" {
    if (ep.length === 0) return "none"
    if (ep.indexOf("/") >= 0) return "none"
    if (hasDot) {
      if (this.fileMethods.has(ep)) return "local"
      if (this.dirMethods.has(ep)) return "package"
      if (this.allMethods.has(ep)) return "corpus"
      for (const p of ep.split(".")) {
        if (p.length === 0) continue
        if (this.fileNames.has(p) || this.fileMethods.has(p)) return "local"
        if (this.dirNames.has(p) || this.dirMethods.has(p)) return "package"
        if (this.allNames.has(p) || this.allMethods.has(p)) return "corpus"
      }
      return "none"
    }
    if (this.fileNames.has(ep)) return "local"
    if (this.dirNames.has(ep)) return "package"
    if (this.allNames.has(ep) || this.allMethods.has(ep)) return "corpus"
    return "none"
  }
}

function loadIndex(path: string): {
  idx: NameIndex
  population: Record<string, unknown>
  shards: unknown[]
  unparseable: Set<string>
} {
  const raw = JSON.parse(readFileSync(path, "utf8"))
  return {
    idx: raw.index as NameIndex,
    population: raw.population as Record<string, unknown>,
    shards: (raw.shards ?? [raw.shard]) as unknown[],
    unparseable: new Set((raw.stillFailed ?? []) as string[]),
  }
}

async function runEdges(): Promise<void> {
  const indexPath = process.env.GO_AMBIGUITY_INDEX ?? "/tmp/opencode/go-ambiguity-index.json"
  const { idx, population, unparseable } = loadIndex(indexPath)
  const allNames = new Set(idx.allNames)
  const allMethods = new Set(idx.allMethods)
  const full = derivePopulation(CORPUS_ROOT)
  const pop: Population = { ...full, files: drawFiles(full) }
  const shardArg = valueOf("--shard")
  const { files, i, n } = shardOf(pop, shardArg ?? "")

  const buckets = new Map<string, TypeBucket>()
  for (const t of TYPE_ORDER) buckets.set(t, emptyBucket())
  const examples: string[] = []
  // Terminal-only, WITH endpoint text. Adjudicating an undeclared-target count
  // means reading the name: "1,250 of them come from one SIMD intrinsic table"
  // is a conclusion, and reaching it requires the names. go-stdlib contains real
  // identifiers that the honesty gate's banned-vocabulary lint matches
  // case-insensitively over `validation/`, so these lines go to stderr and are
  // NOT written into any artifact. The artifact keeps the class/file form only.
  const examplesFull: string[] = []
  let parsed = 0, failed = 0, noType = 0, filesWithEdges = 0, skippedUnparseable = 0

  const MAX_ATTEMPTS = 3
  for (const f of files) {
    // Both passes must measure the SAME files, or the index answers questions
    // about declarations the edge pass never saw. A file the index pass could
    // not parse after 3 attempts is excluded here too, and COUNTED.
    if (unparseable.has(f.rel)) { skippedUnparseable++; continue }
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { failed++; continue }
    let res: any
    let ok = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      try { res = await ASTEngine.parseFile(f.path, content); ok = true } catch { res = undefined }
    }
    if (!ok || !res) { failed++; continue }
    parsed++
    const r = new Resolver(allNames, allMethods)
    for (const nm of idx.fileNames[f.rel] ?? []) r.fileNames.add(nm)
    for (const mm of idx.fileMethods[f.rel] ?? []) r.fileMethods.add(mm)
    for (const nm of idx.byDir[f.dir] ?? []) r.dirNames.add(nm)
    for (const mm of idx.methodsByDir[f.dir] ?? []) r.dirMethods.add(mm)
    for (const sym of (res.symbols as any[]) ?? []) {
      const nm = typeof sym?.name === "string" ? sym.name : ""
      const ow = typeof sym?.ownerName === "string" ? sym.ownerName : ""
      if (nm.length > 0) r.analyzerNames.add(nm)
      if (ow.length > 0) r.analyzerNames.add(ow)
    }
    const rels = (res.relationships as any[]) ?? []
    if (rels.length > 0) filesWithEdges++
    for (const rel of rels) {
      const ty = typeof rel?.type === "string" && rel.type.length > 0
        ? rel.type
        : typeof rel?.relationshipType === "string" ? rel.relationshipType : ""
      if (ty.length === 0) { noType++; continue }
      let b = buckets.get(ty)
      if (!b) { b = emptyBucket(); buckets.set(ty, b) }
      const src = typeof rel?.source === "string" ? rel.source : typeof rel?.from === "string" ? rel.from : ""
      const dst = typeof rel?.target === "string" ? rel.target : typeof rel?.to === "string" ? rel.to : ""
      // The edge's own metadata decides what a target IS. `isImport` is set by
      // the analyzer's PHASE 3b push site (src/ast/real-go-analyzer.ts:352) on
      // exactly one edge kind, whose target is `imp.module` — a module path by
      // construction. Reading the marker rather than guessing from the spelling
      // is what keeps `import "C"` out of the undeclared bucket.
      const isImport = isImportEdge(rel)
      const cs = r.classify(src, src.indexOf(".") >= 0, false)
      const ct = r.classify(dst, dst.indexOf(".") >= 0, isImport)
      b.edges++
      if (src.length > 0 && src === dst) b.sourceEqualsTarget++
      const conf = typeof rel?.confidence === "number" ? rel.confidence : 1
      const confKey = String(conf)
      b.confByValue[confKey] = (b.confByValue[confKey] ?? 0) + 1
      if (conf < 1) { b.confBelow10++; if (!hasReasonCode(rel)) b.subOneNoReasonCode++ }
      if (conf < 0.7) b.confBelow07++
      if (hasReasonCode(rel)) b.hasReasonCode++
      else b.noReasonCode++
      const ev = evidenceClassOf(rel, conf)
      b.evidenceClass[ev] = (b.evidenceClass[ev] ?? 0) + 1
      b.metaShapes[metaShapeOf(rel)] = (b.metaShapes[metaShapeOf(rel)] ?? 0) + 1
      const pf = b.files[f.rel] ?? (b.files[f.rel] = emptyPerFile())
      pf.edges++
      pf.s[cs] = (pf.s[cs] ?? 0) + 1
      pf.t[ct] = (pf.t[ct] ?? 0) + 1
      const srcOk = cs === "local" || cs === "package" || cs === "corpus"
      const tgtOk = ct === "local" || ct === "package" || ct === "corpus"
      const pair = `${cs}>${ct}`
      b.classPairs[pair] = (b.classPairs[pair] ?? 0) + 1
      if (ct === "undeclared") b.undeclaredTargets[dst] = (b.undeclaredTargets[dst] ?? 0) + 1
      const phEp = cs === "placeholder" ? src : cs === "placeholder" ? "" : ct === "placeholder" ? dst : ""
      if (phEp.length > 0) {
        const key = `${cs === "placeholder" ? "src" : "tgt"}:${phEp}`
        b.placeholderTargets[key] = (b.placeholderTargets[key] ?? 0) + 1
        const rung = r.wouldResolve(phEp, phEp.indexOf(".") >= 0)
        b.placeholderWouldResolve[rung] = (b.placeholderWouldResolve[rung] ?? 0) + 1
      }
      const unkEp = cs === "unknownSpelling" ? src : cs === "unknownSpelling" ? "" : ct === "unknownSpelling" ? dst : ""
      if (unkEp.length > 0) {
        const rung = r.wouldResolve(unkEp, unkEp.indexOf(".") >= 0)
        b.unknownWouldResolve[rung] = (b.unknownWouldResolve[rung] ?? 0) + 1
      }
      if (!srcOk || !tgtOk) {
        pf.ambiguous++
        b.ambiguous++
        // By-contract means exactly: a module path on an imports TARGET, with a
        // resolving source. An `imports` SOURCE that is a file path is NOT
        // by-contract — it is the analyzer reporting that the file declared no
        // package clause, and it is counted as a defect.
        if (srcOk && ct === "pathLike" && isImport) b.ambiguousByContract++
        if (examples.length < 400) {
          examples.push(`${ty} src=${cs} tgt=${ct} ${f.rel}`)
        }
        if (examplesFull.length < 20000) {
          examplesFull.push(
            `${ty.padEnd(12)} src=${cs.padEnd(9)} tgt=${ct.padEnd(9)} ${f.rel}  ::  ${src} -> ${dst}`,
          )
        }
      }
    }
  }
  const out = process.env.GO_AMBIGUITY_ARTIFACT ?? ""
  const payload = {
    instrument: "go-ambiguity-census/edges",
    population, shard: { i, n, files: files.length },
    parsed, failed, skippedUnparseable, maxAttempts: MAX_ATTEMPTS,
    filesWithEdges, relationshipsWithoutType: noType,
    types: Object.fromEntries(buckets),
    examples,
  }
  if (out.length > 0) {
    writeFileSync(out, JSON.stringify(payload))
    process.stderr.write(`artifact: ${out}\n`)
  }
  printTable(payload, examples, examplesFull)
}

// The lane reads evidenceClass off metadata; where metadata carries none the
// family classifier in src/lsp/evidence_tier.ts derives the tier FROM the
// confidence, which is why a 0.8 edge can read `inferred` and a 0.95 edge
// `usage_contextual`. This census records what the EDGE carries, and where it
// carries nothing it records `none` rather than guessing the classifier.
function evidenceClassOf(rel: any, conf: number): string {
  const md = rel?.metadata
  if (md && typeof md === "object") {
    const v = (md as any).evidenceClass
    if (typeof v === "string" && v.length > 0) return v
  }
  return "none"
}

/** The metadata KEY SET, sorted — question 4 is "the right label, not a
 *  neighbour", and the key set is what says which construct produced the edge.
 *  Two metadata values of the same key are NOT counted here: the census
 *  measures shape, and a value histogram over go-stdlib identifiers would put
 *  real symbol names into a committed artifact. */
function metaShapeOf(rel: any): string {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return "(none)"
  const keys: string[] = []
  for (const k of Object.keys(md as object)) keys.push(k)
  keys.sort()
  return keys.length === 0 ? "(empty)" : keys.join("+")
}

function hasReasonCode(rel: any): boolean {
  const md = rel?.metadata
  if (md && typeof md === "object") {
    const v = (md as any).reasonCode
    if (typeof v === "string" && v.length > 0) return true
  }
  return false
}

/** The analyzer's own marker that this edge names a MODULE, not a symbol.
 *  Read as a boolean, never inferred from the target's spelling — see the
 *  `isModulePath` note in Resolver.classify. */
function isImportEdge(rel: any): boolean {
  const md = rel?.metadata
  if (md && typeof md === "object" && (md as any).isImport === true) return true
  return false
}

function valueOf(flag: string): string | undefined {
  const eq = ARGS.find((a) => a.startsWith(`${flag}=`))
  if (eq !== undefined) return eq.slice(flag.length + 1)
  const k = ARGS.indexOf(flag)
  if (k < 0 || k + 1 >= ARGS.length) return undefined
  const v = ARGS[k + 1]
  return v.startsWith("--") ? undefined : v
}

function runIndexMerge(): Promise<void> {
  const paths = ARGS.slice(1).filter((a) => a.endsWith(".json"))
  if (paths.length === 0) throw new Error("--index-merge <shard.json>... — no shard artifacts named")
  const shards = paths.map((p) => JSON.parse(readFileSync(p, "utf8")))
  const byDir = new Map<string, Set<string>>()
  const methodsByDir = new Map<string, Set<string>>()
  const fileNames = new Map<string, Set<string>>()
  const fileMethods = new Map<string, Set<string>>()
  const allNames = new Set<string>()
  const allMethods = new Set<string>()
  let parsed = 0, failed = 0, retriedFiles = 0, population: Record<string, unknown> = {}
  const shardInfo: unknown[] = []
  const stillFailed = new Set<string>()
  for (const sh of shards) {
    parsed += sh.parsed ?? 0
    failed += sh.failed ?? 0
    retriedFiles += sh.retriedFiles ?? 0
    for (const r of sh.stillFailed ?? []) stillFailed.add(r as string)
    shardInfo.push(sh.shard)
    if (sh.population) population = sh.population
    const ix = sh.index as NameIndex
    for (const [k, v] of Object.entries(ix.byDir)) addAll(byDir, k, v)
    for (const [k, v] of Object.entries(ix.methodsByDir)) addAll(methodsByDir, k, v)
    for (const [k, v] of Object.entries(ix.fileNames)) addAll(fileNames, k, v)
    for (const [k, v] of Object.entries(ix.fileMethods ?? {})) addAll(fileMethods, k, v)
    for (const nm of ix.allNames) allNames.add(nm)
    for (const mm of ix.allMethods) allMethods.add(mm)
  }
  const arr = (s: Set<string>): string[] => [...s].sort()
  const idx: NameIndex = {
    byDir: Object.fromEntries([...byDir.entries()].map(([k, v]) => [k, arr(v)])),
    methodsByDir: Object.fromEntries([...methodsByDir.entries()].map(([k, v]) => [k, arr(v)])),
    allNames: arr(allNames), allMethods: arr(allMethods),
    byDirCounts: Object.fromEntries([...byDir.entries()].map(([k, v]) => [k, v.size])),
    fileNames: Object.fromEntries([...fileNames.entries()].map(([k, v]) => [k, arr(v)])),
    fileMethods: Object.fromEntries([...fileMethods.entries()].map(([k, v]) => [k, arr(v)])),
  }
  const out = process.env.GO_AMBIGUITY_INDEX_OUT ?? "/tmp/opencode/go-ambiguity-index.json"
  writeFileSync(out, JSON.stringify({
    instrument: "go-ambiguity-census/index-merged", population, shards: shardInfo,
    parsed, failed, retriedFiles, stillFailed: [...stillFailed].sort(),
    dirs: byDir.size, names: allNames.size, methods: allMethods.size, index: idx,
  }))
  process.stderr.write(
    `INDEX MERGED from ${shards.length} shards: ${parsed} parsed, ${failed} failed after ` +
    `${retriedFiles} retried files, ${stillFailed.size} still unparseable, ` +
    `${byDir.size} package dirs, ${allNames.size} distinct names, ${allMethods.size} distinct ` +
    `Receiver.Method pairs -> ${out}\n`,
  )
  return Promise.resolve()
}

function addAll(m: Map<string, Set<string>>, k: string, vals: string[]): void {
  let s = m.get(k)
  if (!s) { s = new Set(); m.set(k, s) }
  for (const v of vals) s.add(v)
}

// ---------------------------------------------------------------------------
// merge + print
// ---------------------------------------------------------------------------
function runMerge(): Promise<void> {
  const paths = ARGS.slice(1).filter((a) => a.endsWith(".json"))
  if (paths.length === 0) throw new Error("--merge <shard.json>... — no shard artifacts named")
  const shards = paths.map((p) => JSON.parse(readFileSync(p, "utf8")))
  const out = new Map<string, TypeBucket>()
  // Kept OUT of the merged artifact and printed to the terminal instead: these
  // keys are real go-stdlib identifiers, and the honesty gate lints
  // /complete/i over every file under validation/. A committed histogram of
  // corpus symbol names is a lint failure AND a copy of the corpus.
  const undeclaredTop = new Map<string, number>()
  let parsed = 0, failed = 0, filesWithEdges = 0, noType = 0, skippedUnparseable = 0
  let population: Record<string, unknown> = {}
  const shardInfo: unknown[] = []
  for (const sh of shards) {
    parsed += sh.parsed ?? 0
    failed += sh.failed ?? 0
    filesWithEdges += sh.filesWithEdges ?? 0
    noType += sh.relationshipsWithoutType ?? 0
    skippedUnparseable += sh.skippedUnparseable ?? 0
    if (sh.population) population = sh.population
    shardInfo.push(sh.shard)
    for (const [ty, b] of Object.entries(sh.types ?? {}) as Array<[string, TypeBucket]>) {
      let acc = out.get(ty)
      if (!acc) { acc = emptyBucket(); out.set(ty, acc) }
      acc.edges += b.edges
      acc.ambiguous += b.ambiguous
      acc.ambiguousByContract += b.ambiguousByContract
      acc.confBelow07 += b.confBelow07
      acc.confBelow10 += b.confBelow10
      acc.noReasonCode += b.noReasonCode
      acc.subOneNoReasonCode += b.subOneNoReasonCode
      acc.hasReasonCode += b.hasReasonCode
      acc.sourceEqualsTarget += b.sourceEqualsTarget
      for (const k of ["local", "package", "corpus", "none"] as const) {
        acc.placeholderWouldResolve[k] = (acc.placeholderWouldResolve[k] ?? 0) + (b.placeholderWouldResolve?.[k] ?? 0)
        acc.unknownWouldResolve[k] = (acc.unknownWouldResolve[k] ?? 0) + (b.unknownWouldResolve?.[k] ?? 0)
      }
      for (const [k, v] of Object.entries(b.confByValue ?? {})) acc.confByValue[k] = (acc.confByValue[k] ?? 0) + v as number
      for (const [k, v] of Object.entries(b.evidenceClass ?? {})) acc.evidenceClass[k] = (acc.evidenceClass[k] ?? 0) + v as number
      for (const [k, v] of Object.entries(b.metaShapes ?? {})) acc.metaShapes[k] = (acc.metaShapes[k] ?? 0) + v as number
      for (const [k, v] of Object.entries(b.classPairs ?? {})) acc.classPairs[k] = (acc.classPairs[k] ?? 0) + v as number
      for (const [k, v] of Object.entries(b.undeclaredTargets ?? {})) {
        undeclaredTop.set(k, (undeclaredTop.get(k) ?? 0) + (v as number))
      }
      // placeholderTargets is keyed by a member of the FIXED R7 vocabulary, so
      // it carries no corpus identifier and stays in the artifact.
      for (const [k, v] of Object.entries(b.placeholderTargets ?? {})) acc.placeholderTargets[k] = (acc.placeholderTargets[k] ?? 0) + v as number
      for (const [rel, pf] of Object.entries(b.files ?? {}) as Array<[string, PerFilePerType]>) {
        const d = acc.files[rel] ?? (acc.files[rel] = emptyPerFile())
        d.edges += pf.edges
        d.ambiguous += pf.ambiguous
        for (const c of CLASSES) {
          d.s[c] = (d.s[c] ?? 0) + (pf.s?.[c] ?? 0)
          d.t[c] = (d.t[c] ?? 0) + (pf.t?.[c] ?? 0)
        }
      }
    }
  }
  const payload = {
    instrument: "go-ambiguity-census/merged", population, shards: shardInfo,
    parsed, failed, skippedUnparseable, filesWithEdges, relationshipsWithoutType: noType,
    types: Object.fromEntries(out), examples: [],
  }
  const target = process.env.GO_AMBIGUITY_ARTIFACT ?? ""
  if (target.length > 0) {
    // COMPACT (default ON for --merge). The full table is ~12 MB at the whole-
    // corpus population and 95% of it is the per-file class ladder, which no
    // number in the doc reads. Compact keeps every per-type total, the DISTINCT
    // FILE COUNT and the file list, and drops only the per-file class vectors.
    // `GO_AMBIGUITY_COMPACT=0` writes the full table; both are re-derivable from
    // the same shard set, so the choice is a size decision and not a measurement.
    const compact = (process.env.GO_AMBIGUITY_COMPACT ?? "1") !== "0"
    const body: any = compact
      ? {
          ...payload,
          types: Object.fromEntries(Object.entries(payload.types).map(([ty, b]: any) => [
            ty,
            {
              ...b,
              files: Object.fromEntries(
                Object.entries(b.files ?? {}).map(([f, pf]: [string, any]) => [f, pf.ambiguous]),
              ),
              filesWithAmbiguous: Object.values(b.files ?? {}).filter((pf: any) => pf.ambiguous > 0).length,
            },
          ])),
          compact: { filesVectorDropped: true },
        }
      : payload
    writeFileSync(target, JSON.stringify(compact ? body : payload))
    process.stderr.write(`artifact: ${target}${compact ? " (compact)" : " (full)"}\n`)
  }
  printTable(payload, [])
  const L = (s: string) => process.stderr.write(s + "\n")
  L("")
  const top = [...undeclaredTop.entries()].sort((a, b) => b[1] - a[1])
  L(`UNDECLARED TARGET NAMES — ${fmt(undeclaredTop.size)} distinct names over ${fmt(top.reduce((a, [, v]) => a + v, 0))} edges`)
  L("  (terminal only — these keys are real go-stdlib identifiers, so they are not written into the artifact)")
  for (const [k, v] of top.slice(0, 60)) L(`  ${String(v).padStart(9)}  ${k}`)
  L("")
  return Promise.resolve()
}

function fmt(n: number): string { return n.toLocaleString("en-US") }
function rate(a: number, b: number): string { return b === 0 ? "n/a" : (a / b).toFixed(4) }

function printTable(p: any, examples: string[], examplesFull: string[] = []): void {
  const L = (s: string) => process.stderr.write(s + "\n")
  const pop = p.population ?? {}
  L("")
  L("=" )
  L(`AMBIGUITY CENSUS — go — ${p.instrument}`)
  L("POPULATION (derived from disk; every exclusion counted)")
  L(`  corpus root        ${pop.corpusRoot}`)
  L(`  top-level dirs     ${(pop.roots ?? []).join(" ")}`)
  L(`  .go seen           ${fmt(pop.goFilesSeen ?? 0)}`)
  L(`  skipped testdata   ${fmt(pop.skippedTestdataDirs ?? 0)} dirs`)
  L(`  skipped oversize   ${fmt(pop.skippedOversize ?? 0)}  (> ${pop.maxBytes} B)`)
  L(`  ADMITTED           ${fmt(pop.admitted ?? 0)}`)
  L(`  shard              ${JSON.stringify(p.shards ?? p.shard ?? null)}`)
  L(`  parsed / failed    ${fmt(p.parsed)} / ${fmt(p.failed)}   files with >=1 edge: ${fmt(p.filesWithEdges)}`)
  L(`  excluded unparseable ${fmt(p.skippedUnparseable ?? 0)}  (the index pass could not parse them after 3 attempts; both passes measure the same files)`)
  L("")
  L("AMBIGUITY RATE = edges with >=1 endpoint that does not bind to a declared name / edges emitted")
  L("")
  const header = ["type", "edges", "ambig", "rate", "by-contract", "contract-rate", "files", "files+ambig", "c<0.7", "c<1 no-rc"]
  const widths = [14, 10, 9, 8, 10, 12, 8, 11, 7, 9]
  L(header.map((h, k) => h.padEnd(widths[k])).join(""))
  L("-".repeat(widths.reduce((a, b) => a + b, 0)))
  const ordered = [...Object.keys(p.types)].sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  let totE = 0, totA = 0, totBc = 0, totF = new Set<string>(), totFA = new Set<string>()
  for (const ty of ordered) {
    const b = p.types[ty]
    const files = Object.keys(b.files ?? {})
    const fAmb = files.filter((f) => (b.files[f]?.ambiguous ?? 0) > 0)
    totE += b.edges; totA += b.ambiguous; totBc += b.ambiguousByContract
    for (const f of files) { totF.add(f); if ((b.files[f]?.ambiguous ?? 0) > 0) totFA.add(f) }
    L([
      ty.padEnd(widths[0]), fmt(b.edges).padEnd(widths[1]), fmt(b.ambiguous).padEnd(widths[2]),
      rate(b.ambiguous, b.edges).padEnd(widths[3]), fmt(b.ambiguousByContract).padEnd(widths[4]),
      rate(b.ambiguous - b.ambiguousByContract, b.edges).padEnd(widths[5]),
      fmt(files.length).padEnd(widths[6]), fmt(fAmb.length).padEnd(widths[7]),
      fmt(b.confBelow07).padEnd(widths[8]), fmt(b.subOneNoReasonCode).padEnd(widths[9]),
    ].join(""))
  }
  L("-".repeat(widths.reduce((a, b) => a + b, 0)))
  L([
    "ALL TYPES".padEnd(widths[0]), fmt(totE).padEnd(widths[1]), fmt(totA).padEnd(widths[2]),
    rate(totA, totE).padEnd(widths[3]), fmt(totBc).padEnd(widths[4]),
    rate(totA - totBc, totE).padEnd(widths[5]), fmt(totF.size).padEnd(widths[6]),
    fmt(totFA.size).padEnd(widths[7]), "", "",
  ].join(""))
  L("")
  L("ENDPOINT LADDER — source side / target side, per type")
  L("")
  const cw = 11
  L(["type", ...CLASSES.map((c) => c.slice(0, cw - 1).padEnd(cw))].join(""))
  for (const ty of ordered) {
    const b = p.types[ty]
    const sumS = new Map<string, number>()
    const sumT = new Map<string, number>()
    for (const pf of Object.values(b.files ?? {}) as PerFilePerType[]) {
      for (const c of CLASSES) { sumS.set(c, (sumS.get(c) ?? 0) + (pf.s?.[c] ?? 0)); sumT.set(c, (sumT.get(c) ?? 0) + (pf.t?.[c] ?? 0)) }
    }
    L(`${ty.padEnd(14)} S ` + CLASSES.map((c) => fmt(sumS.get(c) ?? 0).padEnd(cw)).join(""))
    L(`${"".padEnd(14)} T ` + CLASSES.map((c) => fmt(sumT.get(c) ?? 0).padEnd(cw)).join(""))
  }
  L("")
  L("PLACEHOLDER-LITERAL ENDPOINTS (R7 vocabulary, by side)")
  for (const ty of ordered) {
    const b = p.types[ty]
    const ks = Object.entries(b.placeholderTargets ?? {}).sort((x, y) => (y[1] as number) - (x[1] as number))
    if (ks.length === 0) continue
    const tot = ks.reduce((a, [, v]) => a + (v as number), 0)
    const w = b.placeholderWouldResolve ?? {}
    const strong = (w.local ?? 0) + (w.package ?? 0)
    L(`  ${ty.padEnd(14)} ${ks.map(([k, v]) => `${k} x${fmt(v as number)}`).join("  ")}`)
    L(`  ${"".padEnd(14)} -> ${fmt(tot)} placeholder endpoints; a declaration answers to ${fmt(w.local ?? 0)} file-local, ${fmt(w.package ?? 0)} package, ${fmt(w.corpus ?? 0)} corpus-only, ${fmt(w.none ?? 0)} neither`)
  }
  const unkTot = ordered.reduce((a, ty) => {
    const w = p.types[ty].unknownWouldResolve ?? {}
    return a + (w.local ?? 0) + (w.package ?? 0) + (w.corpus ?? 0) + (w.none ?? 0)
  }, 0)
  const unkStrong = ordered.reduce((a, ty) => {
    const w = p.types[ty].unknownWouldResolve ?? {}
    return a + (w.local ?? 0) + (w.package ?? 0)
  }, 0)
  if (unkTot > 0) {
    L(`  unknown-spelling endpoints: ${fmt(unkTot)} total, ${fmt(unkStrong)} answered file-local or package, the rest corpus-only or neither`)
  }
  L("")
  L("NON-RESOLVING CLASS PAIRS, per type (src>tgt)")
  for (const ty of ordered) {
    const b = p.types[ty]
    const ks = Object.entries(b.classPairs ?? {})
      .filter(([k]) => !k.startsWith("local>local"))
      .sort((x, y) => (y[1] as number) - (x[1] as number))
    if (ks.length === 0) { L(`  ${ty.padEnd(14)} (every edge local>local)`); continue }
    L(`  ${ty.padEnd(14)} ` + ks.map(([k, v]) => `${k} x${fmt(v as number)}`).join("  "))
  }
  L("")
  L("CONFIDENCE / evidenceClass / reasonCode, per type")
  L("")
  for (const ty of ordered) {
    const b = p.types[ty]
    const confs = Object.entries(b.confByValue ?? {}).sort().map(([k, v]) => `${k}x${fmt(v as number)}`).join(" ")
    const ev = Object.entries(b.evidenceClass ?? {}).sort().map(([k, v]) => `${k}=${fmt(v as number)}`).join(" ")
    L(`  ${ty.padEnd(14)} conf[${confs}] evidenceClass[${ev}] reasonCode present ${fmt(b.hasReasonCode)}/${fmt(b.edges)} sub-1.0 without reasonCode ${fmt(b.subOneNoReasonCode)}`)
    const shapes = Object.entries(b.metaShapes ?? {}).sort((x, y) => (y[1] as number) - (x[1] as number))
    for (const [k, v] of shapes) L(`      metadata ${String(k).padEnd(58)} ${fmt(v as number)}`)
  }
  L("")
  L(`src == tgt: ${ordered.map((ty) => `${ty}=${fmt(p.types[ty].sourceEqualsTarget)}`).join(" ")}`)
  if (examples.length > 0) {
    L("")
    L(`AMBIGUOUS EDGE EXAMPLES WITH ENDPOINT TEXT (first ${Math.min(examplesFull.length, 400)} of ${fmt(examplesFull.length)} captured; terminal only)`)
    for (const e of examplesFull.slice(0, 400)) L(`  ${e}`)
  }
  L("")
}

if (MODE === "--index") await runIndex()
else if (MODE === "--index-merge") await runIndexMerge()
else if (MODE === "--edges") await runEdges()
else if (MODE === "--merge") await runMerge()
else if (MODE === "--usage") {
  process.stderr.write(
    `go-ambiguity-census — AMBIGUITY_FLEET, Go\n` +
    `  --index  [--shard=i/n]        declaration index over the population (raw grammar, no analyzer)\n` +
    `  --edges  [--shard=i/n]        production parseFile, per-edge endpoint resolution\n` +
    `  --merge  <shard.json>...     sum shards into one table\n` +
    `  env: GO_CORPUS GO_AMBIGUITY_INDEX GO_AMBIGUITY_INDEX_OUT GO_AMBIGUITY_ARTIFACT GO_MAX_BYTES\n` +
    `        GO_AMBIGUITY_COMPACT=0 keeps the per-file class vectors (~12 MB at whole corpus)\n`,
  )
  process.exit(2)
}