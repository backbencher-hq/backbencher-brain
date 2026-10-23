#!/usr/bin/env bun
/**
 * CLOJURE — THE WHOLE-INVENTORY NODE CENSUS ✓✓
 *
 * ★ WHY THIS EXISTS. The fleet's most recent ruling-shape defect is the scala lane's: its ruling
 * scanned the grammar-side vocabulary over the node types the POPULATION REACHED, and a reader
 * could not tell whether the remaining types of the grammar's inventory had been counted and found
 * irrelevant, or simply not looked at. The scala lane's answer was a WHOLE-INVENTORY NODE CENSUS:
 * a parse-only pass over the whole admitted population, 260 node types seen, **169 NAMED against the
 * grammar's 189** — so 20 named node types of the pinned build are NEVER EXERCISED by the population,
 * and the ruling's grammar-side scan must be over the FULL 189.
 *
 * ⇒ CLOJURE'S INVENTORY IS **35 NAMED / 73 IDS** — one of the smallest in the fleet, and a small
 *   inventory is a GOOD candidate for a complete near-miss table, because 35 names is a table a
 *   reader can check by eye. **THAT IS THE POINT OF THIS INSTRUMENT: A COMPLETE TABLE, NOT A
 *   SHORTLIST.**
 *
 * ⇒ THIS INSTRUMENT ANSWERS, IN ONE PARSE-ONLY PASS:
 *
 *   1 · THE FULL INVENTORY — every named node type of the SERVED build, read from the live
 *       parser's own `Language` object with `nodeTypeIsNamed(id)` (NOT `t.named`, and NOT a
 *       `startsWith("(")` convention: tree-sitter's ANONYMOUS node types are literal tokens such
 *       as `"class"`, `"extends"`, `"("` — the convention is what made the scala lane's first run
 *       print "260 NAMED · 0 ANONYMOUS");
 *   2 · THE EXERCISED SET — which of those named types the population actually reaches, and the
 *       **NEVER-EXERCISED SET** printed beside it (the scala lane's finding, measured for clojure);
 *   3 · **THE COMPLETE TABLE, PER RULED TYPE: EVERY ONE OF THE 35 NAMED TYPES, with its site count
 *       and a verdict** — so the completeness question has an answer: **IS THERE A NODE TYPE IN THE
 *       GRAMMAR THAT MEANS THE RULED CONSTRUCT THAT THE RULING DID NOT COUNT?**
 *   4 · **THE PROTOCOL-IMPLEMENTATION POSITION MEASUREMENT** — the javascript lane's discriminator
 *       is a POSITION, not a NAME: "a call in heritage position is class-producing BY CONSTRUCTION
 *       and a call in argument position is not." THE SAME DISCRIMINATOR IS APPLIED HERE, IN THE
 *       LANGUAGE'S OWN GRAMMAR: the protocol name in a `defrecord`/`deftype` body stands in a
 *       **HERITAGE CLAUSE** position (the type's supertype list — exactly `class Foo implements
 *       Proto`), while the protocol name in `extend`/`extend-type`/`extend-protocol`/`reify`/`proxy`
 *       stands in a **CALL-ARGUMENT** position (the first argument of a call). The two are
 *       counted SEPARATELY, and the heritage-clause set is SPLIT by whether the named symbol is
 *       DEFINED AS A PROTOCOL in the corpus — because a non-protocol supertype in a heritage clause
 *       is the one shape that would be a mixin rather than a conformance.
 *
 * ⇒ NO REGEX OVER SOURCE TEXT. Every reading is a node type, a named child, or a stored row.
 * ⇒ THE ANALYZER IS NEVER CALLED: this is a parse-only census, so it cannot measure the analyzer.
 *
 * RUN: bun run script/m14/clojure-whole-inventory-census.ts \
 *        --out validation/m14/measurements/clojure-whole-inventory-census.json
 *
 * EXIT: 0 always (the instrument MEASURES; it does not judge) · 3 if the pinned grammar's digest
 * moved, because then the run answers nothing.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")
const PINNED_WASM_SHA256 = "90f8866b74d04e1643ed73cce25720c732df2aaa38b45da9dcc773bae8181c27"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1] ?? ""
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const OUT = argOf("--out") ?? ""
const CR = argOf("--corpus-root") ?? process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

const EXTS = ["clj", "cljs", "cljc", "edn"]
const SIZE_CAP = 1024 * 1024

function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch { return [] }
}
function discover(): { files: string[]; repos: Map<string, number> } {
  const files: string[] = []
  const repos = new Map<string, number>()
  for (const repo of readdirSync(CR).sort()) {
    const repoDir = path.join(CR, repo)
    let st: any
    try { st = statSync(repoDir) } catch { continue }
    if (!st.isDirectory()) continue
    let n = 0
    for (const rel of gitTracked(repoDir)) {
      const ext = rel.split(".").pop()?.toLowerCase() ?? ""
      if (!EXTS.includes(ext)) continue
      const abs = path.join(repoDir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      files.push(abs)
      n++
    }
    if (n > 0) repos.set(repo, n)
  }
  files.sort()
  return { files, repos }
}

/* ── the production parser, with the pinned grammar's digest ASSERTED ── */
const wasmBytes = readFileSync(WASM)
const wasmSha256 = createHash("sha256").update(wasmBytes).digest("hex")
if (wasmSha256 !== PINNED_WASM_SHA256) {
  console.error(`THE PINNED GRAMMAR's DIGEST MOVED — expected ${PINNED_WASM_SHA256}, read ${wasmSha256} ⇒ THIS RUN ANSWERS NOTHING`)
  process.exit(3)
}
const { getParser } = await import("../../src/ast/engine")
const parser = await getParser("clojure" as any)
const lang: any = (parser as any).language ?? (parser as any).getLanguage?.()

/* ── THE FULL INVENTORY, read from the live `Language` object.
 *    `nodeTypeIsNamed(id)` IS THE SPLIT: tree-sitter's ANONYMOUS node types are literal tokens. ── */
const fullNamed: string[] = []
const fullAnon: string[] = []
for (let id = 0; id < lang.nodeTypeCount; id++) {
  const nm = lang.nodeTypeForId(id)
  if (lang.nodeTypeIsNamed(id)) fullNamed.push(nm)
  else fullAnon.push(nm)
}
const NAMED_SET = new Set(fullNamed)

/* ── THE THREE RULED TYPES, AND THE TABLE OVER ALL 35 NAMED TYPES EACH OF THEM GETS.
 *    EVERY ROW IS PRESENT — a type that was not considered is a row that says so. ── */
type RuledType = {
  type: string
  /** what the construct MEANS, in the shared vocabulary */
  meaning: string
  /** the ruling's own near-miss set, as the ruling wrote it */
  rulingNearMiss: string[]
  /** the heritage/argument position families that could carry it */
  positionFamilies: string[]
}
const RULED: RuledType[] = [
  {
    type: "decorates",
    meaning: "source = the decorating symbol, target = the decorated declaration; a decorator is APPLIED TO a declaration (src/ast/types.ts:119-160)",
    rulingNearMiss: ["meta_lit"],
    positionFamilies: ["meta_lit on a sym_lit that wraps a declaration form"],
  },
  {
    type: "mixes_in",
    meaning: "source = the class, target = the mixin; a mixin is COMPOSED into a supertype chain and is NOT implements (no conformance is declared) (src/ast/types.ts:144-149)",
    rulingNearMiss: ["extend", "extend-type", "extend-protocol", "defprotocol", "reify", "proxy"],
    positionFamilies: [
      "HERITAGE CLAUSE of a defrecord/deftype body (a bare sym_lit after the field vector)",
      "CALL-ARGUMENT of extend / extend-type / extend-protocol / reify / proxy",
    ],
  },
  {
    type: "part_of",
    meaning: "a library unit INCLUDES a part file (the directive's own direction) (src/ast/types.ts:150-160)",
    rulingNearMiss: ["ns", "require", "use", "import", "load", "load-file", "load-string", "load-reader"],
    positionFamilies: ["a form that names a file to be INCLUDED, in a directive's own direction"],
  },
]

/* ── the protocol-implementation POSITION families, with their grammar-shape signature ── */
const PROTOCOL_HEADS = new Set(["defprotocol"])
/** the type-declaration forms whose body carries a HERITAGE CLAUSE */
const TYPE_DECL_HEADS = new Set(["defrecord", "deftype"])
/** the extension forms whose protocol names sit in CALL-ARGUMENT position */
const EXTENSION_HEADS = new Set(["extend", "extend-type", "extend-protocol", "reify", "proxy"])

type PositionRow = {
  family: "HERITAGE_CLAUSE" | "CALL_ARGUMENT"
  head: string
  sites: number
  files: number
  repos: number
  /** the names in that position, counted */
  namedSymbols: number
  /** how many of those names are DEFINED as a protocol somewhere in the corpus */
  protocolNames: number
  /** how many are NOT — the mixin candidate count */
  nonProtocolNames: number
  /** the non-protocol names themselves, so a reader can look */
  nonProtocolNameSamples: string[]
  realNodes: number
  errorNodes: number
}
const positionRows = new Map<string, PositionRow>()
function posRow(family: PositionRow["family"], head: string): PositionRow {
  const k = `${family}|${head}`
  let r = positionRows.get(k)
  if (!r) {
    r = {
      family, head, sites: 0, files: 0, repos: 0, namedSymbols: 0,
      protocolNames: 0, nonProtocolNames: 0, nonProtocolNameSamples: [], realNodes: 0, errorNodes: 0,
    }
    positionRows.set(k, r)
  }
  return r
}

/* ── the counts ── */
const namedSites = new Map<string, number>()
const anonSites = new Map<string, number>()
const namedFiles = new Map<string, Set<string>>()
const protoDefs = new Set<string>()
let totalNodes = 0
let filesParsed = 0
let parseFailures = 0
const typeDeclFiles = new Map<string, Set<string>>()

/** the head symbol of a form: `list_lit.namedChild(0)` — `children[0]` is the anonymous `(` */
function headSym(form: any): string | null {
  const h = form?.namedChild?.(0)
  if (!h) return null
  if (h.type !== "sym_lit") return null
  const n = h.namedChild?.(0)
  if (!n) return null
  return n.type === "sym_name" ? (n.text ?? "") : (n.text ?? "")
}

function walk(node: any, file: string, repo: string, onForm?: (form: any) => void) {
  totalNodes++
  const t = node.type
  const named = NAMED_SET.has(t)
  if (named) {
    namedSites.set(t, (namedSites.get(t) ?? 0) + 1)
    let s = namedFiles.get(t)
    if (!s) { s = new Set(); namedFiles.set(t, s) }
    s.add(file)
  } else {
    anonSites.set(t, (anonSites.get(t) ?? 0) + 1)
  }
  if (t === "list_lit") onForm?.(node)
  for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), file, repo, onForm)
}

const { files, repos } = discover()
console.log(`POPULATION: ${files.length} files over ${repos.size} repositories`)

for (const abs of files) {
  const repo = path.basename(path.dirname(path.dirname(abs)))
  let src: string
  try { src = readFileSync(abs, "utf8") } catch { continue }
  const tree = parser.parse(src)
  if (!tree) { parseFailures++; continue }
  filesParsed++
  const root = tree.rootNode
  // FIRST PASS: the protocol names the corpus DEFINES (so a heritage clause can be classified)
  const collectProtos = (form: any) => {
    if (headSym(form) === "defprotocol") {
      const nm = form.namedChild?.(1)
      if (nm && nm.type === "sym_lit") {
        const leaf = nm.namedChild?.(0)
        const txt = leaf?.text ?? ""
        if (txt) protoDefs.add(txt)
      }
    }
  }
  walk(root, abs, repo, collectProtos)
  // SECOND PASS: the positions
  const measure = (form: any) => {
    const head = headSym(form)
    if (!head) return
    if (head === "defprotocol") return
    const children: any[] = []
    for (let i = 0; i < form.namedChildCount; i++) children.push(form.namedChild(i))
    // children[0] is the head sym_lit
    const rest = children.slice(1)
    const hasError = (n: any): boolean => {
      // walk up: the subtree carries an ERROR or MISSING node
      let cur = n
      while (cur) {
        if (cur.type === "ERROR" || cur.isMissing) return true
        cur = cur.parent
      }
      return false
    }
    if (TYPE_DECL_HEADS.has(head)) {
      // `(defrecord Name [fields] Proto (method ...) Proto2 ...)`
      // The HERITAGE CLAUSE is every bare `sym_lit` child AFTER the field vector; the method
      // implementations are `list_lit` children. THE POSITION, NOT THE NAME, IS THE DISCRIMINATOR.
      const row = posRow("HERITAGE_CLAUSE", head)
      let seenFieldVector = false
      for (const ch of rest) {
        if (ch.type === "vec_lit") { seenFieldVector = true; continue }
        if (!seenFieldVector) continue
        if (ch.type !== "sym_lit") continue // a method implementation (list_lit) or something else
        const leaf = ch.namedChild?.(0)
        const txt = leaf?.text ?? ""
        if (!txt) continue
        row.sites++
        row.namedSymbols++
        if (protoDefs.has(txt)) row.protocolNames++
        else {
          row.nonProtocolNames++
          if (row.nonProtocolNameSamples.length < 12 && !row.nonProtocolNameSamples.includes(txt)) {
            row.nonProtocolNameSamples.push(txt)
          }
        }
        if (hasError(ch)) row.errorNodes++
        else row.realNodes++
      }
      let fs = typeDeclFiles.get(head)
      if (!fs) { fs = new Set(); typeDeclFiles.set(head, fs) }
      fs.add(abs)
    } else if (EXTENSION_HEADS.has(head)) {
      // the protocol names sit in CALL-ARGUMENT position
      const row = posRow("CALL_ARGUMENT", head)
      // `extend`/`extend-type`: (head Type Proto... (method ...)) — the protocols are the bare
      // sym_lit children before the first list_lit method implementation.
      // `extend-protocol`: (head Proto Type (method ...)) — the protocol is the FIRST argument.
      // `reify`: (head Proto (method ...)) — first argument. `proxy`: (head [Super] [Proto] ...).
      let idx = 0
      const protos: any[] = []
      if (head === "extend-protocol" || head === "reify") {
        if (rest[0]?.type === "sym_lit") protos.push(rest[0])
      } else if (head === "proxy") {
        // the interfaces vector is the second argument; each element a sym_lit
        const ifv = rest[1]
        if (ifv?.type === "vec_lit") {
          for (let i = 0; i < ifv.namedChildCount; i++) {
            const e = ifv.namedChild(i)
            if (e.type === "sym_lit") protos.push(e)
          }
        }
      } else {
        // extend / extend-type: the bare sym_lit children before the first method implementation
        for (const ch of rest) {
          if (ch.type === "list_lit") break
          if (ch.type === "sym_lit") protos.push(ch)
          idx++
        }
      }
      for (const p of protos) {
        const leaf = p.namedChild?.(0)
        const txt = leaf?.text ?? ""
        if (!txt) continue
        row.sites++
        row.namedSymbols++
        if (protoDefs.has(txt)) row.protocolNames++
        else {
          row.nonProtocolNames++
          if (row.nonProtocolNameSamples.length < 12 && !row.nonProtocolNameSamples.includes(txt)) {
            row.nonProtocolNameSamples.push(txt)
          }
        }
        if (hasError(p)) row.errorNodes++
        else row.realNodes++
      }
    }
  }
  walk(root, abs, repo, measure)
  try { tree.delete() } catch { /* a tree that cannot be freed is not a failed measurement */ }
}

/* ── the never-exercised set: the named types of the FULL inventory the population NEVER reaches ── */
const exercised = fullNamed.filter((n) => (namedSites.get(n) ?? 0) > 0)
const neverExercised = fullNamed.filter((n) => (namedSites.get(n) ?? 0) === 0)

/* ── THE COMPLETE TABLE: for EACH ruled type, EVERY ONE OF THE 35 NAMED TYPES, with a verdict ── */
type Row = {
  namedType: string
  sites: number
  files: number
  /** could this node type carry the ruled construct? */
  verdict: "CARRIES" | "NEAR-MISS" | "IRRELEVANT"
  /** why — one line, so a reader can check it */
  reason: string
}
/** per named type, what it is — the reader's key to the table */
const TYPE_MEANING: Record<string, string> = {
  anon_fn_lit: "an anonymous function literal",
  auto_res_mark: "the #_ / #? reader macro marker",
  bool_lit: "true/false",
  char_lit: "a character literal",
  comment: "a comment",
  derefing_lit: "@x",
  dis_expr: "a disabled form (#_x)",
  evaling_lit: "#=(...)",
  kwd_lit: "a keyword literal",
  kwd_name: "the name part of a keyword",
  kwd_ns: "the namespace part of a keyword",
  list_lit: "a list/parenthesised form — THE form carrier",
  map_lit: "a map literal",
  meta_lit: "METADATA: ^ followed by the metadata value",
  nil_lit: "nil",
  ns_map_lit: "the #:ns{...} namespaced-map literal",
  num_lit: "a number",
  old_meta_lit: "the legacy ^:meta form",
  quoting_lit: "'x",
  read_cond_lit: "#?(...)",
  regex_lit: "#\"...\"",
  set_lit: "#{...}",
  source: "the source-file node",
  splicing_read_cond_lit: "#?@(...)",
  str_lit: "a string literal",
  sym_lit: "a symbol literal — the form head and every bare symbol",
  sym_name: "the name part of a symbol",
  sym_ns: "the namespace part of a symbol",
  sym_val_lit: "a symbol's value in an evaluated position",
  syn_quoting_lit: "syntax-quote",
  tagged_or_ctor_lit: "#inst \"...\" / a tagged literal",
  unquote_splicing_lit: "~@x",
  unquoting_lit: "~x",
  var_quoting_lit: "#'x",
  vec_lit: "a vector literal",
}

/** for each ruled type, the named types that MEAN it (VERDict CARRIES) and the near-misses */
function tableFor(r: RuledType): Row[] {
  const rows: Row[] = []
  for (const nt of fullNamed) {
    const sites = namedSites.get(nt) ?? 0
    const files = namedFiles.get(nt)?.size ?? 0
    const meaning = TYPE_MEANING[nt] ?? "(not catalogued)"
    let verdict: Row["verdict"] = "IRRELEVANT"
    let reason = `a ${meaning}; it cannot carry "${r.type}"`
    if (r.type === "decorates") {
      if (nt === "meta_lit") {
        verdict = "NEAR-MISS"
        reason = `METADATA (^value) — the ONLY node type that attaches something to a declaration; ${sites} sites, and the measurement decides whether any of them ATTACHES A CALLABLE`
      } else if (nt === "old_meta_lit") {
        verdict = "NEAR-MISS"
        reason = `the legacy ^:meta form — a metadata carrier like meta_lit; ${sites} sites`
      } else if (nt === "list_lit") {
        verdict = "CARRIES"
        reason = `a form — the carrier of an APPLIED callable ((decorator target)); ${sites} sites; the question is whether the callable is APPLIED (in argument position) rather than NAMED`
      } else if (nt === "sym_lit") {
        verdict = "NEAR-MISS"
        reason = `a bare symbol — the thing a metadata carrier NAMES; ${sites} sites`
      } else if (nt === "vec_lit" || nt === "map_lit") {
        verdict = "NEAR-MISS"
        reason = `a ${meaning} — could hold a decorator map; ${sites} sites`
      }
    } else if (r.type === "mixes_in") {
      if (nt === "list_lit") {
        verdict = "CARRIES"
        reason = `a form — the carrier of BOTH a heritage clause (defrecord/deftype body) and a call argument (extend/...); ${sites} sites; the POSITION decides which`
      } else if (nt === "sym_lit") {
        verdict = "NEAR-MISS"
        reason = `a bare symbol — the supertype/mixin NAME, wherever it sits; ${sites} sites`
      } else if (nt === "vec_lit") {
        verdict = "NEAR-MISS"
        reason = `a ${meaning} — proxy's interface vector sits in one; ${sites} sites`
      } else if (nt === "map_lit") {
        verdict = "NEAR-MISS"
        reason = `a ${meaning} — a mixin map could sit in one; ${sites} sites`
      }
    } else if (r.type === "part_of") {
      if (nt === "list_lit") {
        verdict = "CARRIES"
        reason = `a form — the carrier of every inclusion directive; ${sites} sites; the question is whether any directive names a FILE IN A DIRECTIVE'S OWN DIRECTION`
      } else if (nt === "str_lit") {
        verdict = "NEAR-MISS"
        reason = `a string — a part directive would name its file as a STRING; ${sites} sites`
      } else if (nt === "vec_lit" || nt === "map_lit") {
        verdict = "NEAR-MISS"
        reason = `a ${meaning} — could name part files; ${sites} sites`
      } else if (nt === "sym_lit") {
        verdict = "NEAR-MISS"
        reason = `a bare symbol — a part file could be named by one; ${sites} sites`
      }
    }
    rows.push({ namedType: nt, sites, files, verdict, reason })
  }
  return rows
}

const tables = RULED.map((r) => ({
  type: r.type,
  meaning: r.meaning,
  rulingNearMiss: r.rulingNearMiss,
  positionFamilies: r.positionFamilies,
  /** THE COMPLETENESS ANSWER, per type: how many rows of the FULL inventory could mean it */
  table: tableFor(r),
  carries: tableFor(r).filter((x) => x.verdict === "CARRIES").map((x) => x.namedType),
  nearMiss: tableFor(r).filter((x) => x.verdict === "NEAR-MISS").map((x) => x.namedType),
  irrelevant: tableFor(r).filter((x) => x.verdict === "IRRELEVANT").map((x) => x.namedType),
  /** THE RULING'S OWN NEAR-MISS SET vs THE COMPLETE TABLE's near-miss set */
  rulingNearMissAllInTable: tableFor(r)
    .filter((x) => r.rulingNearMiss.includes(x.namedType))
    .length === r.rulingNearMiss.length,
  /** named types that COULD mean it and that the ruling's near-miss set did NOT list */
  unlistedCouldMean: tableFor(r)
    .filter((x) => (x.verdict === "CARRIES" || x.verdict === "NEAR-MISS") && !r.rulingNearMiss.includes(x.namedType))
    .map((x) => x.namedType),
}))

const report = {
  instrument: "clojure-whole-inventory-census",
  generated: new Date().toISOString(),
  method: {
    parseOnly: true,
    analyzerCalled: false,
    grammarSource: "the live production parser's own Language object",
    namedSplit: "nodeTypeIsNamed(id)",
    servedWasmSha256: wasmSha256,
  },
  population: {
    files: files.length,
    filesParsed,
    parseFailures,
    repos: Object.fromEntries(repos),
    totalNodesVisited: totalNodes,
  },
  fullInventory: {
    totalIds: lang.nodeTypeCount,
    namedCount: fullNamed.length,
    anonymousCount: fullAnon.length,
    namedTypes: fullNamed,
    anonymousTypes: fullAnon,
  },
  exercised: {
    namedTypesExercised: exercised.length,
    namedTypesNeverExercised: neverExercised.length,
    neverExercised,
    namedSites: Object.fromEntries([...namedSites.entries()].sort((a, b) => b[1] - a[1])),
    namedFiles: Object.fromEntries([...namedFiles.entries()].map(([k, v]) => [k, v.size])),
    anonymousSites: Object.fromEntries([...anonSites.entries()].sort((a, b) => b[1] - a[1])),
  },
  /** THE POSITION MEASUREMENT */
  protocolPositions: {
    note: "the javascript lane's discriminator is a POSITION, not a NAME: a call in HERITAGE position is class-producing BY CONSTRUCTION; a call in ARGUMENT position is not. THE SAME DISCRIMINATOR, IN THIS GRAMMAR.",
    protocolNamesDefinedInCorpus: protoDefs.size,
    protocolNameSamples: [...protoDefs].slice(0, 20),
    rows: [...positionRows.values()].sort((a, b) => b.sites - a.sites),
  },
  /** THE COMPLETE TABLE, PER RULED TYPE */
  ruledTypeTables: tables,
  /** THE COMPLETENESS ANSWER, IN ONE LINE PER RULED TYPE */
  completeness: tables.map((t) => ({
    type: t.type,
    namedTypesInFullInventory: fullNamed.length,
    rowsInTable: t.table.length,
    tableIsComplete: t.table.length === fullNamed.length,
    carries: t.carries,
    nearMiss: t.nearMiss,
    rulingNearMissAllInTable: t.rulingNearMissAllInTable,
    unlistedCouldMean: t.unlistedCouldMean,
    /** THE ANSWER: is there a node type in the grammar that MEANS this construct that the ruling did not count? */
    answer:
      t.unlistedCouldMean.length === 0
        ? "NO — every named type of the full inventory that could carry this construct is either listed in the ruling's own near-miss set or carries it; the table is over ALL of them."
        : `YES — ${t.unlistedCouldMean.join(", ")} could carry it and the ruling's near-miss set did not list them.`,
  })),
}

if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), JSON.stringify(report, null, 2))
  console.log(`WROTE ${OUT}`)
}

/* ── THE PRINTED REPORT ── */
console.log("")
console.log("=== THE FULL INVENTORY (read from the live Language object) ===")
console.log(`named ${fullNamed.length} · anonymous ${fullAnon.length} · total ids ${lang.nodeTypeCount}`)
console.log(`served wasm sha256 ${wasmSha256}`)
console.log("")
console.log(`=== THE EXERCISED SET (${exercised.length} of ${fullNamed.length} named types reached) ===`)
console.log(`NEVER EXERCISED BY THE POPULATION (${neverExercised.length}): ${neverExercised.join(", ") || "(none)"}`)
console.log("")
console.log("=== THE POSITION MEASUREMENT (the discriminator is a POSITION, not a NAME) ===")
for (const r of [...positionRows.values()].sort((a, b) => b.sites - a.sites)) {
  console.log(
    `${r.family.padEnd(16)} ${r.head.padEnd(18)} sites ${String(r.sites).padStart(5)} · protocol-named ${String(r.protocolNames).padStart(4)} · NOT-protocol ${String(r.nonProtocolNames).padStart(4)} · real ${r.realNodes} · error ${r.errorNodes}`,
  )
  if (r.nonProtocolNameSamples.length) console.log(`                   non-protocol names: ${r.nonProtocolNameSamples.join(", ")}`)
}
console.log("")
console.log("=== THE COMPLETE TABLE, PER RULED TYPE (ALL named types of the full inventory) ===")
for (const t of tables) {
  const c = report.completeness.find((x) => x.type === t.type)!
  console.log("")
  console.log(`--- ${t.type} --- ${c.rowsInTable}/${fullNamed.length} rows · ${t.carries.length} CARRIES · ${t.nearMiss.length} NEAR-MISS · ${t.irrelevant.length} IRRELEVANT`)
  console.log(`    the ruling's near-miss set: ${t.rulingNearMiss.join(", ") || "(none)"}`)
  console.log(`    ALL of the ruling's near-miss named types are in the table: ${t.rulingNearMissAllInTable}`)
  console.log(`    ANSWER — is there a node type that MEANS it that the ruling did NOT count? ${c.answer}`)
  for (const row of t.table) {
    if (row.verdict === "IRRELEVANT") continue
    console.log(`      ${row.namedType.padEnd(24)} ${String(row.sites).padStart(7)} sites / ${String(row.files).padStart(3)} files · ${row.verdict}`)
  }
}
console.log("")
console.log(`nodes visited ${totalNodes} · files parsed ${filesParsed} · failures ${parseFailures}`)
process.exit(0)
