/**
 * PYTHON ENDPOINT RESOLUTION CENSUS — JOB 2's instrument for INCOMING_PY.
 *
 * The ontology programme's other half. Everything measured so far is OUTGOING: one
 * file in, edges out, and the count of those edges says nothing about whether the
 * thing at the other end EXISTS. A `calls` edge whose target is a method dispatched
 * at runtime looks identical in the graph to one that names a real function, and
 * only one of them can be traversed.
 *
 * Two resolution scopes, because they answer different questions and collapsing
 * them is how a number gets to mean nothing:
 *
 *   FILE     the endpoint binds to a symbol the ANALYZED FILE declares. This is the
 *            strict reading: it is what a reader of one file can check, and it is
 *            where python's dynamic dispatch shows up.
 *   PROJECT  the endpoint binds to a symbol in ANY file of the corpus. This is what
 *            a consumer actually does — `bb_graph` resolves a non-`contains`
 *            target by NAME across the index — so an edge that resolves here and
 *            not at FILE scope is a real edge into a real symbol in another module,
 *            not a dangling one.
 *
 * The bins, and what each one means:
 *
 *   RESOLVED     binds to exactly ONE symbol, by the spelling the edge uses
 *   VIA_LEAF     `Owner.method` did NOT bind as a whole, but a DIFFERENT declaration
 *                sharing the leaf does. Not a resolution: for an `overrides` guess it is
 *                a coincidental binding to the wrong class, and it gets its own bin
 *                because folding it into RESOLVED is how "how many targets bind to the
 *                thing they NAME" comes out wrong
 *   AMBIGUOUS    binds to 2+ DISTINCT symbols. Not a failure and not a fact: the
 *                interpreter picks by the receiver's runtime type and the source
 *                does not say which. Recorded with the COUNT, because "ambiguous"
 *                without N is not a measurement.
 *   EXTERNAL     binds to a name this file IMPORTED and to nothing in the corpus.
 *                Real, and out of file — the store's import resolution owns it.
 *   UNRESOLVED   binds to nothing: not declared here, not declared in the corpus,
 *                not imported. THIS is the number that matters. An unresolved
 *                outgoing edge is a lie the graph tells.
 *   MODULE       the synthetic module scope (the file stem) — navigable, not a symbol.
 *   MODULE_ITEM  `module:item`, python's own import endpoint spelling.
 *   EMPTY / R7   a name field holding nothing, or holding a placeholder literal.
 *
 * The companion-count form (`call f -> inner`, `inner` declared by three classes in
 * the file) is python's hard case and the reason AMBIGUOUS exists as its own bin.
 *
 * NO REGEX. Every test is a Set lookup, a char scan, or a substring test against the
 * text the analyzer was handed. The instrument never re-parses source and never
 * pattern-matches it; it reads what the PRODUCTION path returned.
 *
 * Usage: bun run script/m14/python-endpoint-resolution.ts [--repo python-codesql]
 *                                                       [--stdlib] [--out p.json]
 * READ-ONLY. Writes only the JSON passed with --out.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { starImportBindsOutOfView as starAxis } from "./python-star-axis"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const LANG = "python"
const OUT = argOf("--out")
/**
 * DIAGNOSTIC SIDECAR, opt-in. Writes EVERY UNEXPLAINED edge (not the report's top-40 slice) as
 * `label\tfile\tsource\ttarget\treasonCode\tqualified` so a reader can price the axis by hand
 * instead of reading a truncated histogram. Additive and read-only: the committed artifact keeps
 * its shape, and the verdict this instrument renders is unchanged whether or not the flag is given.
 */
const DUMP_UNEXPLAINED = argOf("--dump-unexplained")
/**
 * DIAGNOSTIC SIDECAR #2, opt-in. Writes EVERY edge that carries a dotted `metadata.qualified`
 * ROUTE, one per line:
 *
 *   file \t label \t source \t target \t route \t reasonCode \t projectBin \t rootIsPopulationModule
 *
 * It exists to answer a question the per-label tables cannot: of the routes this lane publishes,
 * how many are rooted at a module the POPULATION declares (a resolution the store could actually
 * make) and how many are rooted at an import that is external to it (where NULL is the honest
 * answer). Those two are one axis in the verdict — `qualified-external` — and averaging them would
 * report a rate that means neither.
 */
const DUMP_QUALIFIED = argOf("--dump-qualified")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_FILTER = argOf("--repo")
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))
const STDLIB = argv.includes("--stdlib")
const STDLIB_DIR = argOf("--stdlib-dir") ?? "/usr/lib/python3.10"
const SKIP_DIR_NAMES = new Set(["test", "tests", "lib2to3", "idlelib", "site-packages", "testdata"])
/**
 * Worker count. DEFAULT 1, and it is a measured choice rather than a preference.
 * `getParser` memoises ONE tree-sitter Parser per language and a tree-sitter parser
 * carries its parse state on the object, so two concurrent `parser.parse()` calls on
 * that instance interleave and hand back each other's partial trees. Measured on
 * this corpus: the same file returned 223 relationships in one 8-worker run and 32
 * in another. The defect is in `src/ast/engine.ts` (master-owned) and is reported,
 * not fixed here. Serialising costs wall-clock and buys a number that means
 * something.
 */
const WORKERS = Number(argOf("--workers") ?? "1")

/**
 * R7's placeholder literals, restricted to strings that are not program names in
 * ANY python program, and — unlike a bare word list — GATED ON THE SOURCE.
 *
 * The first version of this census flagged the exact string `unknown`, and CPython's
 * own `uuid.py` convicted it: `class SafeUUID: unknown = None` at L81 declares a real
 * class attribute, so `SafeUUID -> unknown` is a true edge and the instrument was
 * wrong. A word list cannot tell an invented name from a declared one; the test that
 * can is the strong one below — does the string occur in the file at all. So a
 * placeholder is only reported when it is ALSO absent from the source, and the
 * cases where a placeholder-shaped name IS in the source are counted separately and
 * labelled, because "the rule fired on real code" is a fact about the rule.
 */
const PLACEHOLDER_LITERALS = new Set([
  "<unknown>", "unknown_symbol", "unknownsymbol", "unknownSymbol",
  "<anonymous>", "AnonymousFunction", "<lambda>", "PLACEHOLDER_SYMBOL", "PLACEHOLDER",
])
const PLACEHOLDER_PREFIXES = ["<"]

/**
 * PYTHON'S OWN synthetic scope names, and the store's list of them
 * (`GENERIC_SOURCE_NAMES` in the indexer) is the authority: a name that is a
 * synthetic scope in the store must not be counted as a project symbol.
 */
const SYNTHETIC_SCOPE_NAMES = new Set([
  "unknown", "SCSS_FILE_SCOPE", "window", "exports", "default", "GlobalScope", "global",
])

/**
 * THE VERDICT AXES — of an UNRESOLVED incoming target, WHY it is unresolved. Each axis is a fact
 * the ANALYZER itself publishes on the edge, or a fact about the interpreter, and none is a guess
 * the census makes. The point of naming them is that "unresolved" is not one thing: a member read
 * whose receiver's type nothing knows (`self.x` -> `x`) is DERIVED unresolved, while a bare name
 * that binds to nothing is a possible DEFECT, and averaging them would report a rate that means
 * neither.
 *
 *   declared-dynamic   the edge's own reasonCode says the target is chosen at runtime
 *                      (`dispatch-on-receiver`/`dispatch-on-parameter` for a call,
 *                      `member-read` for a read, `first-parent-guess` for an override). The lane
 *                      MEASURES this; it is python being python, not a missing resolution.
 *   declared-external  `external-member-call` — the receiver is rooted at a module THIS file
 *                      imported, so the member is reachable through the import edge even though its
 *                      definition is out of view. Followable, and NOT a dangling name.
 *   declared-local     `local-callee` — the callee is bound in an ENCLOSING FUNCTION's scope (a
 *                      nested `def`, a parameter, a local binding), so no project-wide declaration
 *                      exists for it to bind to. Python's LEGB rule resolves such a name to that
 *                      binding, which SHADOWS any module-level declaration of the same spelling —
 *                      so "unresolvable at project scope" is the correct answer, not a failed
 *                      lookup. The lane states this per edge (`isLocalCalleeName`); it is not
 *                      inferred here from the name's shape, which would be a guess.
 *   qualified-external the edge's `qualified` spelling is a DOTTED chain whose root this file
 *                      imported (or which names a module in the population): `nn.Module` as a base,
 *                      `os.path.join` as a callee. The name is bare in the endpoint, but the ROUTE
 *                      says which module owns it, so it is out-of-file rather than nowhere.
 *   star-import-external the file says `from M import *` (PY-D19, round 10 — the fact is published on
 *                      the analyzer's own `imports` edge as `metadata.starImport`, because the
 *                      store's per-item projection flattens it into the same row as `import M`),
 *                      EVERY module the file star-imports is OUT OF VIEW (not a module this
 *                      population declares, and not a relative import), and the target is a BARE
 *                      name. The binding route exists — M's public namespace is bound into this
 *                      module — and M is not checkable here, so the row dangles structurally. The
 *                      gate is the whole honesty of the axis: an IN-VIEW star module is checkable,
 *                      and the residual row already proves it does not declare the name.
 *   builtin            the target leaf is a name the INTERPRETER owns (`dir(builtins)`): a call to
 *                      `SystemExit` under `raise`, a `-> int` that survived the scalar filter. No
 *                      file CAN declare it, so binding to nothing is correct.
 *   not-bound-in-file  PY-D25 (round 12) — the edge's OWN reasonCode says the analyzer's binding
 *                      checks found nothing (`bare-name-callee` for a call, `annotation-type` /
 *                      `instanceof-check` for a reference), the file does not import the leaf, and
 *                      the target is UNRESOLVED against every declaration in the population. That
 *                      is the complete, checkable statement "nothing in this file can supply this
 *                      name": python's LEGB rule makes a module-level or function binding visible
 *                      to the read, so with a binding anywhere in the file the resolution above
 *                      would have found it (module/class binders are published since PY-D23) or
 *                      the reason would be `local-…` instead. PRICED before it was written with
 *                      CPython's own `ast`, per row, scope by scope (`.tmp-py/price-bare-names.py`:
 *                      42 rows, every one agreed by CPython; `.tmp-py/price-module-bindings.py`
 *                      found the ONE row where the analyzer itself was wrong — wagtail's `mixin`,
 *                      which PY-D23 fixed rather than excused). The gate that re-checks this
 *                      axis's whole population with CPython on every run is
 *                      `validation/m14/fixtures/python/not-bound-in-file-gate.mts`; it exists
 *                      because an axis like this one is exactly where a future analyzer gap would
 *                      hide, and the gate fails on any row whose file DOES bind the name.
 *   UNEXPLAINED        none of the above. This is the ONLY axis that names a defect, and it is the
 *                      number the verdict below must drive to zero or to a pinned allowance.
 */
const DECLARED_NO_STATIC_TARGET = new Set([
  "dispatch-on-receiver", "dispatch-on-parameter", "member-read", "first-parent-guess",
])
const DECLARED_EXTERNAL = new Set(["external-member-call"])
/**
 * The reason codes that mean "the analyzer's binding checks found nothing": `bare-name-callee` is
 * set on a call after the local/module/import checks, and the two reference codes are the POSITION
 * codes the emitter falls back to when `dynamicTypeBindingReason` finds no binding
 * (`annotation-type`, `instanceof-check`). A code outside this set already states a binding
 * (`local-…`, `member-read`, a dispatch code), so the axis must not touch it.
 */
const NO_BINDING_REASONS = new Set(["bare-name-callee", "annotation-type", "instanceof-check"])
/**
 * A name bound in an enclosing FUNCTION scope — see `declared-local` above. THREE codes, one axis,
 * because the axis is about the BINDING (no project-wide declaration can exist for it, and python's
 * LEGB rule makes the local win over any module-level namesake) while the codes name which kind of
 * binding it is:
 *
 *   local-callee           a CALL whose callee binds in the enclosing function (PY-D14).
 *   local-binding-target   a REFERENCE or a BASE whose name binds in the enclosing function — a
 *                          parameter, a walrus target, an assignment/`for`/`with`/`except` target,
 *                          a nested `def`/`class` name (PY-D15: `isinstance(obj, type_or_tuple)`
 *                          where `type_or_tuple` is a walrus target; `class Row(dump_cls)` where
 *                          the base was chosen by an `if`).
 *   inline-type-parameter  a REFERENCE to a PEP-695 `def f[T]` / `class C[T]` type parameter
 *                          (PY-D16) — a type the signature introduces, bound nowhere else.
 *
 * The last two are published by the analyzer PER EDGE, from the reference's own ancestor chain,
 * never inferred here from the name's shape. The distinction between them is kept because the
 * facts differ (a value vs a type) and the axis does not need it; a reader querying
 * `reasonCode` gets it either way.
 */
const DECLARED_LOCAL = new Set(["local-callee", "local-binding-target", "inline-type-parameter"])

const QUAL_SEP = "\u0000"

/**
 * PYTHON'S OWN BUILTIN NAMES, taken from the INTERPRETER rather than from a list
 * someone typed.
 *
 * This is a decision input, not a verdict: the question "which of these dangling
 * targets are names the graph can never hold, because the interpreter owns them" is
 * answered here by asking the interpreter. `dir(builtins)` on this machine's python
 * is the authority, so a name added in a later python is counted here without anyone
 * remembering to add it, and a name REMOVED from `builtins` stops being excused.
 *
 * Read through a subprocess and a JSON parse. No regex: `json.dumps` of the sorted
 * list, and `JSON.parse` of it back.
 */
const PY_BUILTIN_NAMES: Set<string> = (() => {
  try {
    const out = execFileSync("python3", ["-c", "import builtins, json; print(json.dumps(sorted(dir(builtins))))"], {
      encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    })
    const arr = JSON.parse(out) as string[]
    return new Set(arr)
  } catch {
    return new Set<string>()
  }
})()

type Bin = "RESOLVED" | "AMBIGUOUS" | "VIA_LEAF" | "EXTERNAL" | "MODULE" | "MODULE_ITEM" | "UNRESOLVED" | "R7_PLACEHOLDER" | "EMPTY"
const BINS: Bin[] = ["RESOLVED", "AMBIGUOUS", "VIA_LEAF", "EXTERNAL", "MODULE", "MODULE_ITEM", "UNRESOLVED", "R7_PLACEHOLDER", "EMPTY"]

type Rel = {
  type?: string
  relationshipType?: string
  source?: string
  target?: string
  from?: string
  fromSymbol?: string
  to?: string
  toSymbol?: string
  confidence?: number
  line_number?: number
  metadata?: Record<string, any>
  [k: string]: any
}
type Sym = { name?: string; kind?: string; ownerName?: string; scope?: string; id?: string; range?: any; [k: string]: any }
type FileRecord = {
  label: string
  rel: string
  moduleScope: string
  symbols: Sym[]
  imports: Array<{ name?: string; path?: string; module?: string; items?: string[] }>
  rels: Rel[]
  text: string
}

const typeOf = (r: Rel): string => String(r.type ?? r.relationshipType ?? "").toLowerCase()
const endpointsOf = (r: Rel): [string, string] => [
  String(r.source ?? r.from ?? r.fromSymbol ?? ""),
  String(r.target ?? r.to ?? r.toSymbol ?? ""),
]

// ---------------------------------------------------------------- corpus
type CorpusFile = { repo: string; dir: string; rel: string; abs: string }
const all: CorpusFile[] = []
if (STDLIB) {
  const walk = (d: string, depth: number): void => {
    if (depth > 8 || all.length > 20000) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (SKIP_DIR_NAMES.has(e.name)) continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) { walk(abs, depth + 1); continue }
      if (!(e.name.endsWith(".py") || e.name.endsWith(".pyi"))) continue
      try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
      all.push({ repo: "cpython-stdlib", dir: STDLIB_DIR, rel: path.relative(STDLIB_DIR, abs), abs })
    }
  }
  walk(STDLIB_DIR, 0)
}
for (const e of readdirSync(CR)) {
  if (STDLIB) break
  const dir = path.join(CR, e)
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
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
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== LANG) continue
    all.push({ repo: e, dir, rel, abs })
  }
  if (REPO_FILTER && all.length) break
}
const admitted = LIMIT ? all.slice(0, LIMIT) : all

/**
 * The module scope, derived by the SAME character scan the analyzer uses (PY-13),
 * so the two cannot drift on the spelling. `my-module.py` publishes `my_module`.
 */
const moduleScopeOf = (rel: string): string => {
  const base = rel.split("/").pop() ?? "module"
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  let out = ""
  for (let i = 0; i < stem.length; i++) {
    const c = stem.charCodeAt(i)
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    out += ok ? stem[i] : "_"
  }
  if (out.length === 0) out = "module"
  const first = out.charCodeAt(0)
  if (first >= 48 && first <= 57) out = `_${out}`
  return out
}

// ---------------------------------------------------------------- parse once
const files: FileRecord[] = []
let parsed = 0
let failed = 0
let idx = 0
const worker = async (): Promise<void> => {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    let text = ""
    try { text = readFileSync(f.abs, "utf8") } catch { text = "" }
    try { r = await parseFile(f.abs, f.dir) } catch { failed++; continue }
    parsed++
    files.push({
      label: `${f.repo}/${f.rel}`,
      rel: f.rel,
      moduleScope: moduleScopeOf(f.rel),
      symbols: (r?.symbols ?? []) as Sym[],
      // THE SHAPE, read off a real parse rather than assumed. `parseFile` returns
      // ImportInfo with a SINGULAR `name` per item and a `path`; the first version
      // of this census read `items`/`module`, which are always absent, so the EXTERNAL
      // bin was STRUCTURALLY UNREACHABLE and every imported name was reported as
      // UNRESOLVED. An instrument with an unreachable bin reports a worse number than
      // no instrument, because it looks like a finding.
      imports: (r?.imports ?? []) as any,
      rels: (r?.relationships ?? []) as Rel[],
      text,
    })
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ---------------------------------------------------------------- indices
/** bare name -> the DISTINCT declarations of it, project-wide. */
const projectByName = new Map<string, Set<string>>()
/** `Owner.name` -> the declaration, project-wide. */
const projectByQual = new Map<string, string>()
/** every module scope and every file path, for the `module:item` spelling. */
const projectModules = new Set<string>()
/**
 * PY-D19's in-view test: every DOTTED module path this population declares, built from file paths the
 * same way an import writes them (`pyspark/sql/types.py` -> `pyspark.sql.types`, and a package's
 * `__init__.py` -> the package). A star module is CHECKABLE when its path exists here or when some
 * path lives under it. File STEMS are deliberately NOT used: the first version of the axis used
 * module scopes, and over the round-9 residual it blocked 169 of the 171 priced rows on name
 * collisions between unrelated repositories (stdlib `dataclasses` against some repo's
 * `dataclasses.py`) — a collision is not evidence that the module is this project's.
 */
const projectModulePaths = new Set<string>()
/** every edge carrying a dotted `metadata.qualified` route, when `--dump-qualified` is given */
const qualifiedDump: string[] = []
const projectFiles = new Set<string>()
/** per file: bare name -> declarations in THAT file only. */
const fileByName = new Map<FileRecord, Map<string, Set<string>>>()
/** per file: the names it binds by import. */
const fileImported = new Map<FileRecord, Set<string>>()
/**
 * per file: the modules it STAR-imports (`from M import *`), read from the analyzer's own
 * `imports` edges — `metadata.starImport`, published by PY-D19. The store's per-item projection
 * cannot carry the distinction (`from M import *` and `import M` both flatten to
 * `{name: "*", type: "namespace"}`), so the edge is the surface that has it.
 */
const fileStarModules = new Map<FileRecord, Set<string>>()

/**
 * THE SYMBOL SHAPE, read off a real production parse rather than assumed.
 *
 * `parseFile` returns symbols with FLATTENED `startLine` / `endLine`, not the
 * `range` object the analyzer's own `UniversalSymbol` interface declares. The first
 * version of this census read `s.range?.startLine`, which is `undefined` on every
 * symbol the production path returns — so every declaration signature collapsed to
 * `kind|owner|`, two declarations of one name in one class counted as ONE, and the
 * AMBIGUOUS bin under-reported. Both shapes are read; the nested one is kept because
 * the analyzer's own fixtures carry it and a future parse path may restore it.
 */
const startLineOf = (s: Sym): number | string => {
  const flat = (s as any).startLine
  if (typeof flat === "number") return flat
  const nested = (s as any).range?.startLine
  if (typeof nested === "number") return nested
  return ""
}
const declSig = (s: Sym, f: FileRecord): string =>
  `${f.label}|${s.kind ?? ""}|${s.ownerName ?? ""}|${startLineOf(s)}`

for (const f of files) {
  projectModules.add(f.moduleScope)
  projectFiles.add(f.rel)
  const local = new Map<string, Set<string>>()
  const imported = new Set<string>()
  const addLocal = (k: string, sig: string) => {
    const set = local.get(k) ?? new Set<string>()
    set.add(sig)
    local.set(k, set)
  }
  for (const s of f.symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    const sig = declSig(s, f)
    addLocal(n, sig)
    const ps = projectByName.get(n) ?? new Set<string>()
    ps.add(sig)
    projectByName.set(n, ps)
    if (s?.ownerName) {
      const q = `${s.ownerName}${QUAL_SEP}${n}`
      projectByQual.set(q, sig)
      addLocal(q, sig)
    }
  }
  for (const im of f.imports) {
    // Both shapes are read, because a name is a name: `parseFile` emits
    // `{name, path}` per item, and a caller that aggregated would emit `items`.
    const nm = String(im?.name ?? "").trim()
    if (nm && nm !== "*") imported.add(nm)
    for (const it of im?.items ?? []) {
      const n2 = String(it ?? "").trim()
      if (n2 && n2 !== "*") imported.add(n2)
    }
    const root = String(im?.path ?? im?.module ?? "").split(".")[0]
    if (root) imported.add(root)
  }
  // PY-D13 (round 7) — THE BOUND NAME OF AN ALIASED IMPORT.
  //
  // `import typing as t` binds `t`; the file's own words for the module are then `t.Protocol`,
  // `t.Callable`, `t.Self`. The projection this census reads (`pool-worker`'s per-item
  // `{name, path, type, isExternal, line}`) does NOT carry the alias, so `fileImported` held only
  // `typing` and every `t.X` route fell through the `qualified-external` axis to UNEXPLAINED — a
  // defect axis — while `typing.X` from the un-aliased spelling classified correctly. The alias IS
  // on the analyzer's own surface: the `imports` edge carries `metadata.importedAs`, which the lane
  // publishes (PY-D13) for exactly the shapes where the binding differs from the imported name.
  // Reading a fact off the edge the analyzer returned is what this instrument does — it never
  // re-parses source — so the alias is read HERE rather than inferred from the path.
  //
  // PY-D19 (round 10) — and the SAME loop reads the wildcard fact, for the same reason: it is a
  // fact the analyzer states on its own edge (`metadata.starImport`) and that the projection one
  // layer below cannot carry. The module is the target's `module:*` half.
  const stars = new Set<string>()
  for (const r of f.rels) {
    if (typeOf(r) !== "imports") continue
    const md = (r.metadata ?? {}) as Record<string, any>
    const as = md.importedAs
    if (typeof as === "string" && as) imported.add(as)
    if (md.starImport === true) {
      const tgt = endpointsOf(r)[1]
      const colon = tgt.lastIndexOf(":")
      const mod = colon > 0 ? tgt.slice(0, colon) : ""
      if (mod) stars.add(mod)
    }
  }
  // PY-D19: this file's own contribution to the dotted-module-path index (see
  // `projectModulePaths`). Derived from the same repo-relative path the analyzer was handed, with
  // the package spelling rule: `pkg/__init__.py` declares `pkg`.
  {
    const parts = f.rel.split("/")
    const last = (parts[parts.length - 1] ?? "").replace(/\.pyi?$/, "")
    const dirs = parts.slice(0, -1)
    const mod = last === "__init__" ? dirs : [...dirs, last]
    if (mod.length > 0) projectModulePaths.add(mod.join("."))
  }
  fileByName.set(f, local)
  fileImported.set(f, imported)
  fileStarModules.set(f, stars)
}

/**
 * PY-D19 (round 10) — the axis's DECISION, read from the per-file star set `python-star-axis.ts`
 * documents and exercises in every direction. The function is imported rather than inlined here
 * because a guard that lives inside an 11,488-file census cannot be falsified without running one.
 */
const starImportBindsOutOfView = (f: FileRecord, tgt: string): boolean =>
  starAxis(fileStarModules.get(f), projectModulePaths, tgt)

/**
 * PY-D25 — "nothing in this file can supply this name", read from the analyzer's own statement
 * plus the file's import set. See the axis doc above for why the resolution above already
 * exhausted every binding the file publishes, and for the CPython price and the gate.
 */
const notBoundInFile = (f: FileRecord, tgt: string, why: string): boolean => {
  if (!NO_BINDING_REASONS.has(why)) return false
  const leaf = leafOf(tgt)
  if (!leaf) return false
  const imported = fileImported.get(f)
  if (imported && imported.has(leaf)) return false
  return true
}

// ---------------------------------------------------------------- classify
type Stat = {
  count: number
  files: Set<string>
  fileSrc: Map<Bin, number>
  fileTgt: Map<Bin, number>
  projSrc: Map<Bin, number>
  projTgt: Map<Bin, number>
  /** ambiguity multiplicity, project scope: 2 -> count of 2-matchers, etc. */
  ambN: Map<number, number>
  conf: Map<string, number>
  evidence: Map<string, number>
  reason: Map<string, number>
  selfLoop: number
  emptyEndpoints: number
  examples: string[]
  unresolvedFileTgt: string[]
  unresolvedProjTgt: string[]
  ambTgt: string[]
  r7: string[]
  /** placeholder-SHAPED name that IS in the source — a fact about the RULE, not the graph */
  placeholderInSource: string[]
  /** the most common unresolved target names, so the number can be acted on */
  unresolvedNames: Map<string, number>
  /** project-scope target bin, split by the edge's own declared reasonCode */
  byReason: Map<string, Map<Bin, number>>
  /** project-scope target bin, split by evidenceClass */
  byEvidence: Map<string, Map<Bin, number>>
  /** project scope: of the UNRESOLVED targets, WHY each one is unresolved (the verdict axes below) */
  unresolvedClass: Map<string, number>
  /** UNRESOLVED targets that NO declared reason code, NO imported-root spelling and NO builtin explains */
  unexplained: number
  unexplainedNames: Map<string, number>
  unexplainedExamples: string[]
  unexplainedEdges: string[]
}
const mkStat = (): Stat => ({
  count: 0, files: new Set(),
  fileSrc: new Map(), fileTgt: new Map(), projSrc: new Map(), projTgt: new Map(), ambN: new Map(),
  conf: new Map(), evidence: new Map(), reason: new Map(),
  selfLoop: 0, emptyEndpoints: 0, examples: [],
  unresolvedFileTgt: [], unresolvedProjTgt: [], ambTgt: [], r7: [], placeholderInSource: [],
  unresolvedNames: new Map(), byReason: new Map(), byEvidence: new Map(),
  unresolvedClass: new Map(), unexplained: 0, unexplainedNames: new Map(), unexplainedExamples: [], unexplainedEdges: [],
})
const rows = new Map<Type, Stat>()
for (const t of ALL_TYPES) rows.set(t, mkStat())
const untyped = mkStat()

/** Generic in the key: the tables below are keyed on strings AND on numbers
 *  (`ambN` is multiplicity -> count), and the old `Map<string, number>` signature
 *  made the numeric one unreachable — it was "fixed" with a cast that did not
 *  check anything (`as Map<number, number>` onto a parameter typed
 *  `Map<string, number>`). The body is identical for both. */
const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1)
const bumpBin = (m: Map<Bin, number>, k: Bin) => m.set(k, (m.get(k) ?? 0) + 1)

const leafOf = (name: string): string => {
  const colon = name.indexOf(":")
  if (colon > 0) return name.slice(colon + 1)
  const dot = name.lastIndexOf(".")
  if (dot > 0) return name.slice(dot + 1)
  return name
}

const isPlaceholderShape = (s: string): boolean => {
  const n = s.trim()
  if (PLACEHOLDER_LITERALS.has(n)) return true
  for (const p of PLACEHOLDER_PREFIXES) if (n.startsWith(p)) return true
  return false
}

/**
 * Classify ONE endpoint under one scope.
 *
 * `scope` picks the index: the FILE's own declarations, or the PROJECT's. The order
 * is a decision order and getting it wrong produces findings about the instrument:
 * MODULE before the placeholder test (a file called `string.py` publishes the scope
 * `string`), `module:item` before the dotted rule (`:` is not `.`), and the whole
 * spelling before its leaf for `Owner.member`, which names ONE declaration.
 */
const classify = (
  name: string,
  file: FileRecord,
  project: boolean,
): { bin: Bin; n: number } => {
  if (name === "") return { bin: "EMPTY", n: 0 }
  if (name === file.moduleScope) return { bin: "MODULE", n: 0 }
  if (isPlaceholderShape(name) && !file.text.includes(name)) return { bin: "R7_PLACEHOLDER", n: 0 }
  const colon = name.indexOf(":")
  if (colon > 0) {
    // `module:item` — a reference into the import graph, resolvable only by the
    // store's import resolution. Counted apart from the dangling names so the
    // external-call rate is not wrong.
    const mod = name.slice(0, colon)
    const item = name.slice(colon + 1)
    if (item === "*") return { bin: "MODULE_ITEM", n: 0 }
    if (projectModules.has(mod)) return { bin: "MODULE_ITEM", n: 0 }
    return { bin: "EXTERNAL", n: 0 }
  }
  const local = fileByName.get(file)!
  const imported = fileImported.get(file)!
  if (name.includes(".")) {
    const dot = name.lastIndexOf(".")
    const qual = `${name.slice(0, dot)}${QUAL_SEP}${name.slice(dot + 1)}`
    if (project) {
      if (projectByQual.has(qual)) return { bin: "RESOLVED", n: 1 }
    } else if (local.has(qual)) {
      return { bin: "RESOLVED", n: local.get(qual)!.size }
    }
    const leaf = name.slice(dot + 1)
    if (imported.has(leaf)) return { bin: "EXTERNAL", n: 0 }
    if (project) {
      const p = projectByName.get(leaf)
      // VIA_LEAF, not RESOLVED. `Owner.method` names ONE declaration and the whole
      // spelling did not bind, so what binds is a DIFFERENT declaration that happens to
      // share the leaf. For `overrides` that is the normal case and calling it RESOLVED
      // overstates the graph: `NamedTuple.create_map` does not bind, but `create_map`
      // exists on six sibling `class Extension*(NamedTuple)` in the same file, and an
      // edge resolved to one of those is a FALSE POSITIVE, not a resolution. It is its
      // own bin because the number that matters downstream is "how many targets bind to
      // the thing they NAME", and folding this into RESOLVED is exactly how that number
      // comes out wrong.
      if (p && p.size === 1) return { bin: "VIA_LEAF", n: 1 }
      if (p && p.size > 1) return { bin: "AMBIGUOUS", n: p.size }
    }
    return { bin: "UNRESOLVED", n: 0 }
  }
  if (SYNTHETIC_SCOPE_NAMES.has(name)) return { bin: "MODULE", n: 0 }
  const decls = project ? projectByName.get(name) : local.get(name)
  if (decls && decls.size === 1) return { bin: "RESOLVED", n: 1 }
  if (decls && decls.size > 1) return { bin: "AMBIGUOUS", n: decls.size }
  if (imported.has(name)) return { bin: "EXTERNAL", n: 0 }
  return { bin: "UNRESOLVED", n: 0 }
}

// ---------------------------------------------------------------- tally
// Declared BEFORE the tally reads it. It sat after this loop, and the loop is
// top-level: the `placeholderInSource` note called it from inside the loop, so the
// one run that had a placeholder-shaped name present in real source raised
// "Cannot access 'fileTextHas' before initialization" instead of reporting — an
// instrument that dies exactly on the case it exists to describe. Only the ORDER
// changes; the predicate body is the same.
const fileTextHas = (f: FileRecord, name: string): boolean => {
  if (name === "") return false
  return f.text.includes(name)
}

for (const f of files) {
  for (const rel of f.rels) {
    const t = typeOf(rel) as Type
    const s = rows.get(t) ?? untyped
    const [src, tgt] = endpointsOf(rel)
    s.count++
    if (s.files.size < 500) s.files.add(f.label)
    const fs = classify(src, f, false)
    const ft = classify(tgt, f, false)
    const ps = classify(src, f, true)
    const pt = classify(tgt, f, true)
    bumpBin(s.fileSrc, fs.bin)
    bumpBin(s.fileTgt, ft.bin)
    bumpBin(s.projSrc, ps.bin)
    bumpBin(s.projTgt, pt.bin)
    if (pt.bin === "AMBIGUOUS") bump(s.ambN, pt.n)
    if (src === "" || tgt === "") s.emptyEndpoints++
    if (src === tgt && src !== "") s.selfLoop++
    bump(s.conf, String(rel.confidence ?? "absent"))
    bump(s.evidence, String((rel.metadata as any)?.evidenceClass ?? "absent"))
    const reason = (rel.metadata as any)?.reasonCode
    if (reason) bump(s.reason, String(reason))
    if (s.examples.length < 6) s.examples.push(`${src} -> ${tgt}`)
    if (ft.bin === "UNRESOLVED") {
      if (s.unresolvedFileTgt.length < 10) s.unresolvedFileTgt.push(`${f.label} ${src} -> ${tgt}`)
      bump(s.unresolvedNames, leafOf(tgt))
    }
    if (pt.bin === "UNRESOLVED") {
      if (s.unresolvedProjTgt.length < 10) s.unresolvedProjTgt.push(`${f.label} ${src} -> ${tgt}`)
      bump(s.unresolvedNames, leafOf(tgt))
    }
    if (pt.bin === "AMBIGUOUS" && s.ambTgt.length < 6) {
      s.ambTgt.push(`${f.label} ${src} -> ${tgt} (${pt.n} declarations)`)
    }
    // The cross-tabs that answer the honesty questions rather than the counting ones.
    // `overrides` is the case that matters: a verified edge and a 0.5 guess must not be
    // averaged into one resolution rate, because they are different claims with
    // different confidence and different evidenceClass, and the rate that matters is
    // the rate of the WEAK one.
    const why = String((rel.metadata as any)?.reasonCode ?? "none")
    const evc = String((rel.metadata as any)?.evidenceClass ?? "absent")
    const whyRow = s.byReason.get(why) ?? new Map<Bin, number>()
    bumpBin(whyRow, pt.bin)
    s.byReason.set(why, whyRow)
    const evRow = s.byEvidence.get(evc) ?? new Map<Bin, number>()
    bumpBin(evRow, pt.bin)
    s.byEvidence.set(evc, evRow)
    // THE VERDICT: classify each UNRESOLVED incoming target by WHY, in a fixed order that prefers
    // the analyzer's own statement over the census's inference. Only the LAST axis is a defect.
    // The edge's written ROUTE, read once — the verdict needs it for the axis, and the
    // `--dump-qualified` sidecar needs it for EVERY edge (not only the unresolved ones).
    const route = String((rel.metadata as any)?.qualified ?? "")
    if (pt.bin === "UNRESOLVED") {
      const root = route.includes(".") ? route.split(".")[0]! : ""
      const imported = fileImported.get(f)!
      const cls = DECLARED_NO_STATIC_TARGET.has(why) ? "declared-dynamic"
        : DECLARED_LOCAL.has(why) ? "declared-local"
        : DECLARED_EXTERNAL.has(why) ? "declared-external"
        : root && (imported.has(root) || projectModules.has(root)) ? "qualified-external"
        : starImportBindsOutOfView(f, tgt) ? "star-import-external"
        : PY_BUILTIN_NAMES.has(leafOf(tgt)) ? "builtin"
        : notBoundInFile(f, tgt, why) ? "not-bound-in-file"
        : "UNEXPLAINED"
      bump(s.unresolvedClass, cls)
      if (cls === "UNEXPLAINED") {
        s.unexplained++
        bump(s.unexplainedNames, leafOf(tgt))
        if (s.unexplainedExamples.length < 8) s.unexplainedExamples.push(`${f.label} ${src} -> ${tgt} [${why}]`)
        s.unexplainedEdges.push(`${t}\t${f.label}\t${src}\t${tgt}\t${why}\t${route}`)
      }
    }
    if (qualifiedDump && route.includes(".")) {
      const r = route.split(".")[0]!
      qualifiedDump.push(`${f.label}\t${t}\t${src}\t${tgt}\t${route}\t${why}\t${pt.bin}\t${projectModules.has(r) ? "1" : "0"}`)
    }
    if (fs.bin === "R7_PLACEHOLDER" || ft.bin === "R7_PLACEHOLDER") {
      if (s.r7.length < 8) s.r7.push(`${f.label} ${src} -> ${tgt}`)
    }
    if (isPlaceholderShape(src) || isPlaceholderShape(tgt)) {
      if (s.placeholderInSource.length < 8) {
        s.placeholderInSource.push(`${f.label} ${src} -> ${tgt} (in source: ${fileTextHas(f, src) || fileTextHas(f, tgt)})`)
      }
    }
  }
}

// ---------------------------------------------------------------- report
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (s: Stat, m: Map<Bin, number>, b: Bin) => (s.count ? ((100 * (m.get(b) ?? 0)) / s.count).toFixed(1) : "-")
const hist = (s: Stat, m: Map<Bin, number>): string =>
  BINS.filter((b) => (m.get(b) ?? 0) > 0).map((b) => `${b}:${pct(s, m, b)}%`).join(" ")

let totalRels = 0
let totalSyms = 0
for (const f of files) { totalRels += f.rels.length; totalSyms += f.symbols.length }

console.log(`python endpoint resolution census — ${admitted.length} admitted, ${parsed} parsed, ${failed} failed`)
console.log(`workers ${WORKERS}   corpus ${STDLIB ? STDLIB_DIR : REPO_FILTER ?? CR}`)
console.log(`symbols ${totalSyms.toLocaleString()}  relationships ${totalRels.toLocaleString()}  files ${files.length}\n`)

console.log("== PER TYPE — does it FIRE, and do its endpoints resolve? ==")
console.log(`${w("type", 14)}${w("edges", 10)}${w("files", 7)}${w("scope", 7)}  ${w("bins", 92)}`)
console.log("-".repeat(130))
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  console.log(`${w(t, 14)}${w(s.count.toLocaleString(), 10)}${w(String(s.files.size), 7)}${w("FILE src", 7)}  ${hist(s, s.fileSrc) || "(none)"}`)
  console.log(`${w("", 14)}${w("", 10)}${w("", 7)}${w("FILE tgt", 7)}  ${hist(s, s.fileTgt) || "(none)"}`)
  console.log(`${w("", 14)}${w("", 10)}${w("", 7)}${w("PROJ src", 7)}  ${hist(s, s.projSrc) || "(none)"}`)
  console.log(`${w("", 14)}${w("", 10)}${w("", 7)}${w("PROJ tgt", 7)}  ${hist(s, s.projTgt) || "(none)"}`)
}
console.log("-".repeat(130))

console.log("\n== AMBIGUOUS multiplicity (project scope, target) ==")
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  if (s.ambN.size === 0) continue
  const m = [...s.ambN.entries()].sort((a, b) => a[0] - b[0])
    .map(([n, c]) => `${n}:${c}`).join(" ")
  console.log(`${w(t, 14)} declarations-per-name -> ${m}`)
}

console.log("\n== NAMED SAMPLES of endpoints that bind to nothing (project scope) ==")
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  if (s.count === 0) continue
  if (!s.unresolvedProjTgt.length && !s.r7.length) continue
  console.log(`\n${t}`)
  for (const x of s.unresolvedProjTgt) console.log(`   UNRESOLVED TGT  ${x}`)
  for (const x of s.r7) console.log(`   R7 PLACEHOLDER   ${x}`)
}

console.log("\n== MOST COMMON unresolved target names per type (population, actionable) ==")
let grandUnresolved = 0
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  if (s.unresolvedNames.size === 0) continue
  const sum = [...s.unresolvedNames.values()].reduce((a, b) => a + b, 0)
  grandUnresolved += sum
  const builtinNamed = [...s.unresolvedNames.entries()]
    .filter(([k]) => PY_BUILTIN_NAMES.has(leafOf(k)))
    .reduce((a, b) => a + b[1], 0)
  const top = [...s.unresolvedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`${w(t, 14)} ${sum} unresolved (${builtinNamed} name an interpreter builtin: ${PY_BUILTIN_NAMES.size} in dir(builtins))`)
  console.log(`${w("", 14)} top: ${top.map(([k, v]) => `${k}:${v}`).join("  ")}`)
}
console.log(`\nunresolved targets across all ten types: ${grandUnresolved} of ${totalRels.toLocaleString()} edges (${(100 * grandUnresolved / Math.max(1, totalRels)).toFixed(1)}%)`)

// ---------------------------------------------------------------- verdict
// THE PER-LABEL VERDICT, in BOTH directions. Outgoing first, because it is a one-line claim and
// must be stated rather than assumed: an edge whose SOURCE binds to nothing is a lie the graph
// tells about WHAT made the edge, and the census measures it the same way as a target.
console.log("\n== PER-LABEL RESOLUTION VERDICT (project scope) ==")
let grandSrcUnresolved = 0
let grandUnexplained = 0
let emittedCount = 0
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  if (s.count === 0) { console.log(`${w(t, 14)} EMITTED: NO`); continue }
  emittedCount++
  const srcUnresolved = s.projSrc.get("UNRESOLVED") ?? 0
  grandSrcUnresolved += srcUnresolved
  const tgtUnresolved = s.projTgt.get("UNRESOLVED") ?? 0
  const unexplained = s.unexplained
  grandUnexplained += unexplained
  const axes = [...s.unresolvedClass.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`${w(t, 14)} emitted ${String(s.count).padStart(8)} · OUTGOING unresolved ${String(srcUnresolved).padStart(3)} · INCOMING resolved ${pct(s, s.projTgt, "RESOLVED")}% ambiguous ${pct(s, s.projTgt, "AMBIGUOUS")}% external ${pct(s, s.projTgt, "EXTERNAL")}% unresolved ${String(tgtUnresolved).padStart(7)}`)
  if (tgtUnresolved > 0) console.log(`${w("", 14)}   axes: ${axes || "-"}`)
  if (unexplained > 0) {
    console.log(`${w("", 14)}   ** UNEXPLAINED ${unexplained} **  top names: ${[...s.unexplainedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]): string => `${k}:${v}`).join("  ")}`)
    for (const x of s.unexplainedExamples.slice(0, 6)) console.log(`${w("", 14)}      ${x}`)
  }
}
console.log(`\nlabels emitted ${emittedCount}/10   OUTGOING (source) UNRESOLVED across all ten: ${grandSrcUnresolved}`)
console.log(`INCOMING (target) UNEXPLAINED across all ten: ${grandUnexplained}  <- the only defect axis; every other unresolved target is declared-dynamic, declared-local, declared-external, qualified-external, or an interpreter builtin`)

console.log("\n== confidence / evidenceClass / reasonCode / hygiene ==")
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  if (s.count === 0) continue
  const conf = [...s.conf.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  const ev = [...s.evidence.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  const rs = [...s.reason.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`${w(t, 14)} conf ${conf}`)
  console.log(`${w("", 14)} ev   ${ev}`)
  if (rs) console.log(`${w("", 14)} why  ${rs}`)
  console.log(`${w("", 14)} self-loop ${s.selfLoop}  empty-endpoint ${s.emptyEndpoints}  files ${[...s.files].slice(0, 3).join(", ")}`)
  if (s.placeholderInSource.length) {
    console.log(`${w("", 14)} NOTE placeholder-shaped name present in source (rule fired on real code): ${s.placeholderInSource.slice(0, 3).join(" | ")}`)
  }
}
console.log("\n== TARGET RESOLUTION SPLIT BY reasonCode / evidenceClass (project scope) ==")
console.log("   a verified edge and a 0.5 guess must not be averaged: they are different claims")
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  if (s.count === 0) continue
  for (const [why, m] of s.byReason) {
    const hist = BINS.filter((b) => (m.get(b) ?? 0) > 0).map((b) => `${b}:${m.get(b)}`).join(" ")
    console.log(`${w(t, 14)} reason=${why.padEnd(26)} ${hist}`)
  }
  for (const [ev, m] of s.byEvidence) {
    const hist = BINS.filter((b) => (m.get(b) ?? 0) > 0).map((b) => `${b}:${m.get(b)}`).join(" ")
    console.log(`${w(t, 14)} evidence=${ev.padEnd(25)} ${hist}`)
  }
}
if (untyped.count) {
  console.log(`\n!! ${untyped.count} relationships carried a type outside the ten: ` +
    [...new Set(untyped.examples)].slice(0, 5).join(" | "))
}

console.log("\n== FILES carrying each type (up to 4) ==")
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  if (s.count === 0) { console.log(`${w(t, 14)} EMITTED: NO — 0 edges over ${parsed} files`); continue }
  console.log(`${w(t, 14)} ${s.count.toLocaleString()} edges in ${s.files.size}+ files`)
}

const out: any = {
  at: new Date().toISOString(),
  lang: LANG,
  corpus: STDLIB ? STDLIB_DIR : REPO_FILTER ?? CR,
  filesAdmitted: admitted.length,
  filesParsed: parsed,
  filesFailed: failed,
  totalSymbols: totalSyms,
  totalRelationships: totalRels,
  types: Object.fromEntries(ALL_TYPES.map((t) => {
    const s = rows.get(t)!
    return [t, {
      count: s.count,
      files: s.files.size,
      fileSample: [...s.files].slice(0, 12),
      fileScope: { source: Object.fromEntries(s.fileSrc), target: Object.fromEntries(s.fileTgt) },
      projectScope: { source: Object.fromEntries(s.projSrc), target: Object.fromEntries(s.projTgt) },
      ambiguousMultiplicity: Object.fromEntries([...s.ambN.entries()].map(([k, v]) => [String(k), v])),
      confidence: Object.fromEntries(s.conf),
      evidenceClass: Object.fromEntries(s.evidence),
      reasonCode: Object.fromEntries(s.reason),
      targetBinsByReason: Object.fromEntries([...s.byReason.entries()].map(([k, m]) => [k, Object.fromEntries(m)])),
      targetBinsByEvidence: Object.fromEntries([...s.byEvidence.entries()].map(([k, m]) => [k, Object.fromEntries(m)])),
      selfLoop: s.selfLoop,
      emptyEndpoints: s.emptyEndpoints,
      unresolvedTargetNames: Object.fromEntries([...s.unresolvedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
      unresolvedClass: Object.fromEntries(s.unresolvedClass),
      unexplained: s.unexplained,
      unexplainedTargetNames: Object.fromEntries([...s.unexplainedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
      unexplainedExamples: s.unexplainedExamples,
      examples: s.examples,
      unresolvedProjectTargets: s.unresolvedProjTgt,
      ambiguousTargets: s.ambTgt,
      r7: s.r7,
      placeholderInSource: s.placeholderInSource,
    }]
  })),
  untyped: untyped.count,
}
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
if (DUMP_QUALIFIED) {
  writeFileSync(DUMP_QUALIFIED, qualifiedDump.join("\n") + "\n")
  console.log(`wrote ${qualifiedDump.length} qualified-route edge(s) to ${DUMP_QUALIFIED}`)
}
if (DUMP_UNEXPLAINED) {
  const all: string[] = []
  for (const t of ALL_TYPES) all.push(...rows.get(t)!.unexplainedEdges)
  writeFileSync(DUMP_UNEXPLAINED, all.join("\n") + "\n")
  console.log(`wrote ${all.length} unexplained edge(s) to ${DUMP_UNEXPLAINED}`)
}