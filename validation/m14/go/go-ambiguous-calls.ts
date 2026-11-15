// AMBIG_CALLS_GO — WHY a `calls` endpoint fails to resolve, classified on the AST.
//
// THE QUESTION. `go-ambiguity-census.ts` measured that Go's `calls` is the worst
// of the ten types on endpoint resolution: 3,614 of 286,614 edges (1.261%) carry
// an endpoint no declaration answers to, across 276 files. A rate names the
// defect. It does not say WHICH defect, and there is more than one: a call into
// C through cgo and a call to a method on a type declared in a file this
// analyzer was not given are both "undeclared", and only one of them is
// fixable by an analyzer change. So this instrument attributes each ambiguous
// `calls` edge to a CAUSE read off the tree-sitter AST.
//
// THE CAUSE VOCABULARY, and why each class is distinguishable from the others.
// Every class below is a decision about node.type, node fields, and the file's
// own `import_spec` set. None of them is a decision about how a name is spelled,
// which is the only thing a text match could decide, and that is why this file
// contains no regular expression:
//
//   cgo-pseudo-package    the callee's selector operand is the identifier `C` and
//                         the file carries `import "C"`. The declaration the leaf
//                         names is a C function in the file's preamble COMMENT.
//   imported-module       the operand is a package name or alias bound by one of
//                         this file's `import_spec`s, and the specifier names a
//                         module whose path is not a package directory in the
//                         measured population. The leaf is a real declaration in
//                         a repository that is not on this disk.
//   dot-imported          the file has an `import_spec` with NO name and NO alias
//                         (`. "pkg"`), so a bare callee is that package's export.
//                         Go's own rule: a dot-import puts the package's exported
//                         names in the file block.
//   receiver-method       the operand is NOT a package binding, so the callee is a
//                         method on whatever the operand denotes — a local, a
//                         parameter, a field, a package-scope var. Whether the
//                         method is declared anywhere is a SEPARATE axis, split
//                         out below.
//   func-value-bare       the callee is a bare `identifier` that no import, no
//                         dot-import and no declaration in the package directory
//                         answers to. In Go a bare callee that is not a package
//                         function and not a builtin must be a variable or
//                         parameter of function type. This lane does not publish
//                         function locals as symbols (the C# `LocalsAreNotSymbols`
//                         contract), so the edge cannot bind whatever the source
//                         declares.
//   assembly-backed       the file carries an `import` whose specifier ends in
//                         `.s`, or the callee's declaration cannot exist in Go
//                         because the file's own directives say the body is in
//                         assembly. Recorded from the AST, not from the path.
//   self-package          the operand is THIS file's `package_identifier`, so the
//                         callee is a top-level function of the file's own
//                         package. If the name is undeclared it is declared in
//                         another file of the package under a build constraint,
//                         or the file's package clause is a recovery artifact.
//   unresolved-shape      the callee is neither an identifier nor a selector —
//                         the grammar's recovery shapes. Recorded, never merged
//         into any other class, because a recovery shape is an observation about
//         the tree and not about Go.
//
// WHY THE POPULATION IS DERIVED. The file list is a recursive readdir over the
// corpus root with the production `detectLanguageFromPath` rule and a size cap,
// both printed with their counts, and both identical to the census this file
// extends. A hand-written list would rot silently.
//
// WHY TWO PASSES. Cause attribution needs the file's tree, and the tree is
// cheaper to walk than the analyzer is to run — but the analyzer is what decides
// which edges are ambiguous, and the index is what decides it. So:
//   --pass1  re-derives the ambiguous `calls` edge SET through the production
//            path (ASTEngine.parseFile) and writes it per file. Shardable.
//   --pass2  raw-parses ONLY the files pass1 named, and attributes a cause to
//            every ambiguous edge in them. Shardable over that derived list.
//   --merge  sums the cause table.
// pass2's population is pass1's output, so it cannot be a list somebody typed.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const ARGS = process.argv.slice(2)
const MODE = ARGS[0] ?? "--usage"
const CORPUS_ROOT = process.env.GO_CORPUS ?? "/home/ishaq2321/bb_tests/repositories/go-stdlib"
const MAX_BYTES = Number(process.env.GO_MAX_BYTES ?? 512 * 1024)
const SKIP_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", "testdata"])

const CALLS = "calls"

interface CorpusFile { path: string; rel: string; dir: string; bytes: number }

function derivePopulation(root: string): CorpusFile[] {
  const files: CorpusFile[] = []
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 24) return
    let ents: ReturnType<typeof readdirSync>
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (!e.isFile()) continue
      const p = join(dir, e.name)
      if (detectLanguageFromPath(p) !== "go") continue
      let size = 0
      try { size = statSync(p).size } catch { continue }
      if (size > MAX_BYTES) continue
      const r = rel.length === 0 ? e.name : `${rel}/${e.name}`
      const d = r.lastIndexOf("/")
      files.push({ path: p, rel: r, dir: d < 0 ? "." : r.slice(0, d), bytes: size })
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue
      if (SKIP_DIRS.has(e.name)) continue
      walk(join(dir, e.name), rel.length === 0 ? e.name : `${rel}/${e.name}`, depth + 1)
    }
  }
  walk(root, "", 0)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return files
}

function shardOf<T>(items: T[], shard: string): { items: T[]; i: number; n: number } {
  if (!shard) return { items, i: 0, n: 1 }
  const slash = shard.lastIndexOf("/")
  const i = Number(shard.slice(0, slash))
  const n = Number(shard.slice(slash + 1))
  if (!Number.isFinite(i) || !Number.isFinite(n) || n < 1 || i < 0 || i >= n) {
    throw new Error(`--shard must be i/n with 0 <= i < n; got "${shard}"`)
  }
  return { items: items.filter((_, k) => k % n === i), i, n }
}

function valueOf(flag: string): string | undefined {
  const eq = ARGS.find((a) => a.startsWith(`${flag}=`))
  if (eq !== undefined) return eq.slice(flag.length + 1)
  const k = ARGS.indexOf(flag)
  if (k < 0 || k + 1 >= ARGS.length) return undefined
  const v = ARGS[k + 1]
  return v.startsWith("--") ? undefined : v
}

// ---------------------------------------------------------------------------
// The name index — the SAME derivation go-ambiguity-census.ts --index writes, so
// a resolution decision in this file and a resolution decision in the census are
// the same decision. Read from the census's merged index artifact; the ladder is
// reproduced here rather than imported so this file has no hidden dependency on
// the census's internals, and the class names match so the tables line up.
// ---------------------------------------------------------------------------
interface NameIndex {
  byDir: Record<string, string[]>
  methodsByDir: Record<string, string[]>
  allNames: string[]
  allMethods: string[]
  fileNames: Record<string, string[]>
  fileMethods: Record<string, string[]>
}

type Class = "local" | "package" | "corpus" | "undeclared" | "empty" | "unknownSpelling" | "placeholder" | "pathLike"

const UNKNOWN_SPELLINGS: ReadonlySet<string> = new Set([
  "unknown", "Unknown", "UNKNOWN", "unknown_target", "unknownSymbol",
  "unknown_symbol", "<unknown>",
])
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  "*", "module", "global", "_", "?", "??", "<missing>", "MISSING", "N/A",
  "null", "NULL", "none", "None", "anonymous", "<anonymous>", "undefined",
])

class Resolver {
  fileNames = new Set<string>()
  fileMethods = new Set<string>()
  dirNames = new Set<string>()
  dirMethods = new Set<string>()
  constructor(private allNames: Set<string>, private allMethods: Set<string>) {}
  classify(ep: string): Class {
    if (ep.length === 0) return "empty"
    if (UNKNOWN_SPELLINGS.has(ep)) return "unknownSpelling"
    if (PLACEHOLDERS.has(ep)) return "placeholder"
    if (ep.indexOf("/") >= 0) return "pathLike"
    if (ep.indexOf(".") >= 0) {
      const parts = ep.split(".")
      for (const p of parts) {
        if (p.length === 0) continue
        if (this.fileNames.has(p) || this.fileMethods.has(p)) return "local"
        if (this.dirNames.has(p) || this.dirMethods.has(p)) return "package"
        if (this.allNames.has(p) || this.allMethods.has(p)) return "corpus"
      }
      return "undeclared"
    }
    if (this.fileNames.has(ep)) return "local"
    if (this.dirNames.has(ep)) return "package"
    if (this.allNames.has(ep)) return "corpus"
    return "undeclared"
  }
}

function loadIndex(path: string): { idx: NameIndex; unparseable: Set<string> } {
  const raw = JSON.parse(readFileSync(path, "utf8"))
  return {
    idx: raw.index as NameIndex,
    unparseable: new Set((raw.stillFailed ?? []) as string[]),
  }
}

// ---------------------------------------------------------------------------
// PASS 1 — the ambiguous `calls` edge set, through the PRODUCTION path.
// ---------------------------------------------------------------------------
interface AmbigEdge { src: string; tgt: string; srcClass: Class; tgtClass: Class; line: number }

async function runPass1(): Promise<void> {
  const indexPath = process.env.GO_AMBIG_INDEX ?? "/tmp/opencode/ambig-calls/index-512kb.json"
  const { idx, unparseable } = loadIndex(indexPath)
  const allNames = new Set(idx.allNames)
  const allMethods = new Set(idx.allMethods)
  const pop = derivePopulation(CORPUS_ROOT)
  const { items: files, i, n } = shardOf(pop, valueOf("--shard") ?? "")

  const perFile: Record<string, { edges: number; ambig: number; rows: AmbigEdge[] }> = {}
  const edgesByFile = new Map<string, number>()
  let parsed = 0, failed = 0, skippedUnparseable = 0, callsEdges = 0, ambiguous = 0

  for (const f of files) {
    if (unparseable.has(f.rel)) { skippedUnparseable++; continue }
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { failed++; continue }
    let res: any
    let ok = false
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try { res = await ASTEngine.parseFile(f.path, content); ok = true } catch { res = undefined }
    }
    if (!ok || !res) { failed++; continue }
    parsed++
    const r = new Resolver(allNames, allMethods)
    for (const nm of idx.fileNames[f.rel] ?? []) r.fileNames.add(nm)
    for (const mm of idx.fileMethods[f.rel] ?? []) r.fileMethods.add(mm)
    for (const nm of idx.byDir[f.dir] ?? []) r.dirNames.add(nm)
    for (const mm of idx.methodsByDir[f.dir] ?? []) r.dirMethods.add(mm)
    for (const rel of (res.relationships as any[]) ?? []) {
      const ty = typeof rel?.type === "string" && rel.type.length > 0 ? rel.type
        : typeof rel?.relationshipType === "string" ? rel.relationshipType : ""
      if (ty !== CALLS) continue
      callsEdges++
      // The per-file denominator is tallied in the SAME loop. An earlier draft
      // counted it in a second parseFile pass per file, which doubled the most
      // expensive thing in this instrument to obtain a number the first loop
      // already had in hand — found by reading the code before running it.
      edgesByFile.set(f.rel, (edgesByFile.get(f.rel) ?? 0) + 1)
      const src = typeof rel?.source === "string" ? rel.source : typeof rel?.from === "string" ? rel.from : ""
      const tgt = typeof rel?.target === "string" ? rel.target : typeof rel?.to === "string" ? rel.to : ""
      const cs = r.classify(src)
      const ct = r.classify(tgt)
      if (cs === "local" || cs === "package" || cs === "corpus") {
        if (ct === "local" || ct === "package" || ct === "corpus") continue
      }
      ambiguous++
      const pf = perFile[f.rel] ?? (perFile[f.rel] = { edges: 0, ambig: 0, rows: [] })
      pf.ambig++
      pf.rows.push({
        src, tgt, srcClass: cs, tgtClass: ct,
        line: typeof rel?.line_number === "number" ? rel.line_number : 0,
      })
    }
  }

  const out = process.env.GO_AMBIG_CALLS_OUT ?? ""
  const body = {
    instrument: "go-ambiguous-calls/pass1",
    corpusRoot: CORPUS_ROOT, maxBytes: MAX_BYTES, admitted: pop.length,
    shard: { i, n, files: files.length },
    parsed, failed, skippedUnparseable,
    callsEdges, ambiguous, filesWithAmbiguous: Object.keys(perFile).length,
    edgesByFile: Object.fromEntries(edgesByFile),
    perFile,
  }
  if (out.length > 0) {
    writeFileSync(out, JSON.stringify(body))
    process.stderr.write(`pass1 shard ${i}/${n}: ${files.length} files, ${parsed} parsed, ${failed} failed, ` +
      `${callsEdges} calls edges, ${ambiguous} ambiguous in ${Object.keys(perFile).length} files -> ${out}\n`)
  } else {
    process.stderr.write(`pass1 shard ${i}/${n}: ${callsEdges} calls edges, ${ambiguous} ambiguous, ` +
      `${Object.keys(perFile).length} files\n`)
  }
}

// ---------------------------------------------------------------------------
// PASS 2 — attribute a cause, per ambiguous edge, from the tree.
// ---------------------------------------------------------------------------
interface FileFacts {
  pkgName: string
  /** Local name a package is bound to in THIS file, and the module path it came
   *  from. The key is the name a callee's selector operand would have to spell. */
  bindings: Map<string, string>
  cgo: boolean
  /** `. "pkg"` — a dot-import puts that package's exported names in file scope. */
  dotImported: boolean
  /** The module path of every `import_spec`, for the "is that package on this
   *  disk" question. The corpus's own directory names are the answer. */
  modulePaths: Set<string>
}

function collectFacts(root: any): FileFacts {
  const facts: FileFacts = {
    pkgName: "", bindings: new Map(), cgo: false, dotImported: false, modulePaths: new Set(),
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "package_clause") {
      for (let k = 0; k < n.namedChildCount; k++) {
        const c = n.namedChild(k)
        if (c && c.type === "package_identifier") { facts.pkgName = String(c.text ?? ""); break }
      }
    } else if (n.type === "import_spec") {
      const pathNode = n.childForFieldName("path")
      const raw = pathNode ? String(pathNode.text ?? "") : ""
      // Quote stripping by hand: `import "fmt"` types the specifier as an
      // interpreted_string_literal whose text carries the quotes.
      let spec = raw
      if (spec.length >= 2) spec = spec.slice(1, spec.length - 1)
      facts.modulePaths.add(spec)
      if (spec === "C") { facts.cgo = true; facts.bindings.set("C", "C"); continue }
      let alias = ""
      for (let k = 0; k < n.namedChildCount; k++) {
        const c = n.namedChild(k)
        if (c && c.type === "package_identifier") { alias = String(c.text ?? ""); break }
      }
      if (alias.length === 0) { facts.dotImported = true; continue }
      facts.bindings.set(alias, spec)
      continue
    }
    for (let k = n.namedChildCount - 1; k >= 0; k--) {
      const c = n.namedChild(k)
      if (c) stack.push(c)
    }
  }
  return facts
}

interface CalleeFact {
  leaf: string
  operand: string
  shape: string
}

/** Every call_expression's callee, reduced to (leaf, operand, shape). */
function collectCallees(root: any): CalleeFact[] {
  const out: CalleeFact[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "call_expression") {
      const f = n.childForFieldName("function")
      if (f) {
        if (f.type === "identifier") {
          out.push({ leaf: String(f.text ?? ""), operand: "", shape: "identifier" })
        } else if (f.type === "selector_expression") {
          const op = f.childForFieldName("operand")
          const fd = f.childForFieldName("field")
          const operandText = op ? flattenSelector(op) : ""
          out.push({
            leaf: fd ? String(fd.text ?? "") : "",
            operand: operandText,
            shape: "selector",
          })
        } else {
          out.push({ leaf: "", operand: "", shape: f.type })
        }
      }
    }
    for (let k = n.namedChildCount - 1; k >= 0; k--) {
      const c = n.namedChild(k)
      if (c) stack.push(c)
    }
  }
  return out
}

/** `a.b.c` -> "a.b.c": read the operand chain as written, no pattern matching. */
function flattenSelector(n: any): string {
  if (!n) return ""
  if (n.type === "selector_expression") {
    const op = n.childForFieldName("operand")
    const fd = n.childForFieldName("field")
    const base = flattenSelector(op)
    const leaf = fd ? String(fd.text ?? "") : ""
    if (base.length === 0) return leaf
    if (leaf.length === 0) return base
    return `${base}.${leaf}`
  }
  if (n.type === "parenthesized_expression") {
    for (let k = 0; k < n.namedChildCount; k++) {
      const c = n.namedChild(k)
      if (c) return flattenSelector(c)
    }
    return ""
  }
  return String(n.text ?? "")
}

/** The corpus's own top-level package directories, so "is that import path a
 *  package on this disk" is a set membership and not a guess about the string. */
function corpusPackageDirs(pop: CorpusFile[]): Set<string> {
  const dirs = new Set<string>()
  for (const f of pop) dirs.add(f.dir)
  const names = new Set<string>()
  for (const d of dirs) {
    const slash = d.lastIndexOf("/")
    names.add(slash < 0 ? d : d.slice(slash + 1))
  }
  // The `src/<pkg>` shape: go-stdlib's packages are directories under src/.
  for (const d of dirs) {
    const parts = d.split("/")
    if (parts.length >= 2 && parts[0] === "src") names.add(parts[1])
  }
  return names
}

type Cause =
  | "cgo-pseudo-package"
  | "dot-imported-member"
  | "imported-module-on-disk"
  | "imported-module-absent"
  | "receiver-method"
  | "func-value-bare"
  | "self-package"
  | "recovery-shape"
  | "no-callee-node-found"
  | "source-unattributable"

/** Does this endpoint class mean "binds to no declared name"? Same four classes
 *  the census counts as non-resolving; `local`/`package`/`corpus` resolve. */
function tgtFails(c: Class): boolean {
  return c !== "local" && c !== "package" && c !== "corpus"
}

function classifyCause(
  tgt: string,
  facts: FileFacts,
  callees: CalleeFact[],
  diskPackages: ReadonlySet<string>,
): Cause {
  // The leaf the edge names is what the analyzer published. Find the call sites
  // whose callee leaf is that name — a file may call the same leaf through
  // several shapes and each shape is a different reason it cannot resolve.
  let best: CalleeFact | undefined
  for (const c of callees) {
    if (c.leaf !== tgt) continue
    if (!best) { best = c; continue }
    // Prefer a shape that EXPLAINS the failure over one that does not: a package
    // binding is an explanation, a bare identifier is the weakest claim.
    if (best.shape === "identifier" && c.shape === "selector") best = c
  }
  if (!best) return "no-callee-node-found"
  if (best.shape !== "identifier" && best.shape !== "selector") return "recovery-shape"

  const operand = best.operand
  const binding = operand.length > 0 ? facts.bindings.get(headSegment(operand)) : undefined

  if (best.shape === "selector") {
    if (binding !== undefined) {
      if (binding === "C") return "cgo-pseudo-package"
      if (isDiskPackage(binding, diskPackages)) return "imported-module-on-disk"
      return "imported-module-absent"
    }
    if (headSegment(operand) === facts.pkgName && facts.pkgName.length > 0) return "self-package"
    return "receiver-method"
  }

  // Bare identifier callee.
  if (facts.dotImported) return "dot-imported-member"
  if (facts.pkgName.length > 0 && operand.length > 0 && headSegment(operand) === facts.pkgName) {
    return "self-package"
  }
  return "func-value-bare"
}

function headSegment(dotted: string): string {
  const d = dotted.indexOf(".")
  return d < 0 ? dotted : dotted.slice(0, d)
}

function isDiskPackage(modulePath: string, diskPackages: ReadonlySet<string>): boolean {
  if (diskPackages.has(modulePath)) return true
  const slash = modulePath.lastIndexOf("/")
  return diskPackages.has(slash < 0 ? modulePath : modulePath.slice(slash + 1))
}

async function runPass2(): Promise<void> {
  const pass1Paths = ARGS.slice(1).filter((a) => a.endsWith(".json"))
  if (pass1Paths.length === 0) throw new Error("--pass2 <pass1 shard.json>... — no pass1 artifact named")
  const shards = pass1Paths.map((p) => JSON.parse(readFileSync(p, "utf8")))

  // The derived population: the union of the files pass1 named, with the counts
  // printed so the reader can see it is a measured subset and not a hand list.
  const wanted = new Map<string, AmbigEdge[]>()
  let pass1Files = 0, pass1Ambiguous = 0
  for (const sh of shards) {
    pass1Files += Number(sh.filesWithAmbiguous ?? 0)
    pass1Ambiguous += Number(sh.ambiguous ?? 0)
    for (const [rel, rec] of Object.entries(sh.perFile ?? {}) as Array<[string, { rows: AmbigEdge[] }]>) {
      const cur = wanted.get(rel)
      if (cur) for (const row of rec.rows) cur.push(row)
      else wanted.set(rel, rec.rows.slice())
    }
  }

  const pop = derivePopulation(CORPUS_ROOT)
  const byRel = new Map(pop.map((f) => [f.rel, f]))
  const diskPackages = corpusPackageDirs(pop)
  const list = [...wanted.keys()].sort()
  const missing = list.filter((rel) => !byRel.has(rel))
  const { items: files, i, n } = shardOf(
    list.filter((rel) => byRel.has(rel)).map((rel) => ({ rel, f: byRel.get(rel)! })),
    valueOf("--shard") ?? "",
  )

  const byCause = new Map<Cause, number>()
  const byCauseFiles = new Map<Cause, Record<string, number>>()
  const fileTotals = new Map<string, number>()
  let edges = 0, parsed = 0, failed = 0
  const examples: string[] = []

  for (const { rel, f } of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { failed++; continue }
    let tree: any
    let ok = false
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const p = await ASTEngine.getParser("go")
        tree = p.parse(content)
        ok = true
      } catch { tree = undefined }
    }
    if (!ok || !tree) { failed++; continue }
    parsed++
    const facts = collectFacts(tree.rootNode)
    const callees = collectCallees(tree.rootNode)
    const rows = wanted.get(rel) ?? []
    fileTotals.set(rel, rows.length)
    // WHICH ENDPOINT failed decides the class, and the two failures are
    // different questions. A target that binds to no declaration is "where is
    // this callee declared"; a source that binds to no declaration is "which
    // function is this edge leaving", and no callee shape can answer that.
    for (const row of rows) {
      const key: Cause = tgtFails(row.tgtClass)
        ? classifyCause(row.tgt, facts, callees, diskPackages)
        : "source-unattributable"
      edges++
      byCause.set(key, (byCause.get(key) ?? 0) + 1)
      let fm = byCauseFiles.get(key)
      if (!fm) { fm = {}; byCauseFiles.set(key, fm) }
      fm[rel] = (fm[rel] ?? 0) + 1
      if (examples.length < 300) {
        examples.push(`${key.padEnd(28)} ${rel}:${row.line}  ${row.src} -> ${row.tgt}`)
      }
    }
  }

  const out = process.env.GO_AMBIG_CALLS_OUT ?? ""
  const body = {
    instrument: "go-ambiguous-calls/pass2",
    corpusRoot: CORPUS_ROOT, maxBytes: MAX_BYTES,
    population: {
      admittedGoFiles: pop.length,
      pass1FilesWithAmbiguous: pass1Files,
      pass1AmbiguousEdges: pass1Ambiguous,
      pass2InputFiles: list.length,
      pass2InputFilesNotOnDisk: missing.length,
      distinctPackageDirsOnDisk: diskPackages.size,
      shard: { i, n, files: files.length },
    },
    parsed, failed, edges,
    byCause: Object.fromEntries([...byCause.entries()].sort((a, b) => b[1] - a[1])),
    filesByCause: Object.fromEntries([...byCauseFiles.entries()].map(([k, v]) => [k, v])),
    perFileAmbiguous: Object.fromEntries(fileTotals),
  }
  if (out.length > 0) {
    writeFileSync(out, JSON.stringify(body))
    process.stderr.write(`pass2 shard ${i}/${n}: ${files.length} of ${list.length} files, ${parsed} parsed, ` +
      `${failed} failed, ${edges} edges attributed -> ${out}\n`)
  }
  const L = (s: string): void => { process.stderr.write(s + "\n") }
  L("")
  L(`CAUSE TABLE — ${CALLS} edges with a non-resolving endpoint, by AST-derived cause`)
  L(`  population: ${pop.length} admitted .go, ${pass1Files} carry an ambiguous ${CALLS} edge, ` +
    `${pass1Ambiguous} edges total, this shard ${files.length} files / ${edges} edges`)
  L("")
  const ordered = [...byCause.entries()].sort((a, b) => b[1] - a[1])
  for (const [cause, n] of ordered) {
    const fl = byCauseFiles.get(cause) ?? {}
    L(`  ${cause.padEnd(30)} ${String(n).padStart(6)}  in ${String(Object.keys(fl).length).padStart(4)} files`)
  }
  L("")
  L(`  ATTRIBUTED ${edges} of the ${pass1Ambiguous} pass1 reported (shard ${i}/${n}); ` +
    `${pass1Ambiguous - edges} are in shards this process did not take`)
  if (examples.length > 0) {
    L("")
    L(`EXAMPLES (terminal only — these keys are real go-stdlib identifiers): ${Math.min(examples.length, 60)}`)
    for (const e of examples.slice(0, 60)) L(`  ${e}`)
  }
  L("")
}

if (MODE === "--pass1") await runPass1()
else if (MODE === "--pass2") await runPass2()
else {
  process.stderr.write(
    `go-ambiguous-calls — AMBIG_CALLS_GO, Go\n` +
    `  --pass1 [--shard=i/n]   production parseFile; the ambiguous ${CALLS} edge SET per file\n` +
    `  --pass2 <pass1.json>... [--shard=i/n]   raw-parse those files; attribute an AST cause per edge\n` +
    `  env: GO_CORPUS GO_MAX_BYTES GO_AMBIG_INDEX GO_AMBIG_CALLS_OUT\n`,
  )
  process.exit(2)
}
