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
const projectFiles = new Set<string>()
/** per file: bare name -> declarations in THAT file only. */
const fileByName = new Map<FileRecord, Map<string, Set<string>>>()
/** per file: the names it binds by import. */
const fileImported = new Map<FileRecord, Set<string>>()

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
  fileByName.set(f, local)
  fileImported.set(f, imported)
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
}
const mkStat = (): Stat => ({
  count: 0, files: new Set(),
  fileSrc: new Map(), fileTgt: new Map(), projSrc: new Map(), projTgt: new Map(), ambN: new Map(),
  conf: new Map(), evidence: new Map(), reason: new Map(),
  selfLoop: 0, emptyEndpoints: 0, examples: [],
  unresolvedFileTgt: [], unresolvedProjTgt: [], ambTgt: [], r7: [], placeholderInSource: [],
  unresolvedNames: new Map(), byReason: new Map(), byEvidence: new Map(),
})
const rows = new Map<Type, Stat>()
for (const t of ALL_TYPES) rows.set(t, mkStat())
const untyped = mkStat()

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
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
    if (pt.bin === "AMBIGUOUS") bump(s.ambN as Map<number, number>, pt.n)
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

const fileTextHas = (f: FileRecord, name: string): boolean => {
  if (name === "") return false
  return f.text.includes(name)
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