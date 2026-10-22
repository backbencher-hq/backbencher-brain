#!/usr/bin/env bun
/**
 * CLOJURE — THE PER-TYPE CONSTRUCT CENSUS ✓✓
 *
 * ★ WHY THIS EXISTS. The fleet's most important recent result is a DEFECT in a ruling's SHAPE: the
 * scala lane ruled `implements` NOT-APPLICABLE on the falsifier "a Scala construct that declares
 * conformance WITH NO COMPOSITION semantics" — and NAMED the self-type `this: T =>` in the same
 * sentence, with the parenthetical "none measured". THAT PARENTHETICAL WAS THE DEFECT: the ruling
 * had already identified the construct and never measured it. MEASURED over 19,347 admitted files
 * the self-type is 1,017 sites in 636 files, so `implements` WAS A GAP, NOT A RULING.
 *
 * ⇒ THE GENERAL FORM, AND THE QUESTION THIS INSTRUMENT ANSWERS FOR EVERY ONE OF THE FOURTEEN
 * TYPES: **DID SOMEBODY MEASURE THE CONSTRUCT THE RULING ALREADY NAMED?** A named construct with
 * "none measured" beside it is not a ruling; it is a todo wearing a ruling's clothes.
 *
 * ⇒ SO THIS INSTRUMENT ANSWERS, PER TYPE, IN ONE PASS OVER THE WHOLE ADMITTED POPULATION:
 *
 *   1 · THE CONSTRUCT — the language's own form family that could carry the type, named in the
 *       instrument's source, so a reader can audit the claim rather than trust it;
 *   2 · THE NODE TYPE THAT CARRIES IT — read from the PRODUCTION parser's own `Language` object,
 *       so it is the grammar production is configured with and not a second load of the same bytes;
 *   3 · THE SITES — how many places in the corpus carry that construct, in how many files, in how
 *       many repositories;
 *   4 · **THE REAL-NODE TEST — THE MEASUREMENT THE WHOLE INSTRUMENT EXISTS FOR: how many of those
 *       sites carry an ERROR or MISSING subtree.** A site that arrives as a REAL NODE is a construct
 *       the language EXPRESSES; a site that arrives as recovery text is not. This is the difference
 *       between "the grammar has no such construct" (a language fact, and the only half that makes
 *       a ruling an exclusion) and "the analyzer never looked" (an analyzer fact, and a gap).
 *
 * ⇒ AND THE ZEROS ARE READABLE ZEROS, NOT SILENCE: for every type whose construct the language does
 *   NOT have, the instrument prints the NEAR-MISS FAMILIES it measured and their counts, so a zero
 *   is a zero over a NAMED row set and not an absence of looking.
 *
 * ⇒ NO REGEX OVER SOURCE TEXT: every reading is a node type, a field, a named child, or a stored
 *   row. NO UNKNOWN SYMBOLS: every site counted here is a node the grammar produced.
 *
 * RUN: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-type-construct-census.ts \
 *        --out validation/m14/measurements/clojure-type-construct-census.json
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
function discover(): { files: string[]; repos: Map<string, number>; byExt: Map<string, number> } {
  const files: string[] = []
  const repos = new Map<string, number>()
  const byExt = new Map<string, number>()
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
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
      n++
    }
    if (n > 0) repos.set(repo, n)
  }
  files.sort()
  return { files, repos, byExt }
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

/* ── THE CONSTRUCT TABLE: for each of the FOURTEEN types, the language's own form family that
 *    could carry it, and the node type that carries that form. THE TABLE IS THE CLAIM, AND IT IS
 *    IN THE SOURCE so a reader can audit it instead of trusting it. ── */
type Construct = {
  /** the language's form family — the HEADS that make the construct, or the node type itself */
  heads: string[]
  /** the node type the form arrives as */
  nodeType: string
  /** the near-miss families measured when the construct does NOT exist, so a zero is a zero */
  nearMiss: string[]
  /** the lane's disposition, and the class that carries it */
  disposition: "IMPLEMENTED" | "RULED"
  rulingClass: string
}
const CONSTRUCTS: Record<string, Construct> = {
  calls: {
    heads: ["*CALL*"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  uses: {
    heads: ["*SYM*"],
    nodeType: "sym_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  contains: {
    heads: ["*CONTAINER*"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  imports: {
    heads: ["require", "use", "import", "ns", "load", "load-file", "load-string", "load-reader"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  references: {
    heads: ["*SYM*"],
    nodeType: "sym_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  exports: {
    heads: ["def", "defn", "defn-", "defmacro", "defmulti", "defmethod", "defprotocol", "defrecord", "deftype", "defonce", "definline", "declare"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  extends: {
    heads: ["deftype", "defrecord", "proxy", "extend-type", "extend", "gen-class"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  implements: {
    heads: ["defprotocol", "defrecord", "deftype", "extend", "extend-type", "extend-protocol", "reify", "proxy", "gen-class", "gen-interface"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  overrides: {
    heads: ["defmethod", "defmulti", "deftype", "defrecord", "extend-type", "extend", "reify", "proxy"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  instantiates: {
    heads: ["new", "->", "->>", "make", "map->", "vector", "hash-map", "atom", "ref", "agent", "deftype", "defrecord"],
    nodeType: "list_lit",
    nearMiss: [],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  decorates: {
    heads: [],
    nodeType: "(none — the language has no node that applies a callable to a declaration)",
    nearMiss: ["meta_lit"],
    disposition: "RULED", rulingClass: "ontological",
  },
  renders: {
    heads: [],
    nodeType: "vec_lit (a keyword-led vector is a render ELEMENT; the component is its child)",
    nearMiss: ["vec_lit"],
    disposition: "IMPLEMENTED", rulingClass: "",
  },
  mixes_in: {
    heads: [],
    nodeType: "(none — the language has no node that composes a mixin into a supertype chain)",
    nearMiss: ["extend", "extend-type", "extend-protocol", "defprotocol", "reify", "proxy"],
    disposition: "RULED", rulingClass: "ontological",
  },
  part_of: {
    heads: [],
    nodeType: "(none — the language has no part directive; the compilation unit is the namespace)",
    nearMiss: ["ns", "require", "use", "import", "load", "load-file", "load-string", "load-reader"],
    disposition: "RULED", rulingClass: "grammar-remedy-ruled",
  },
}
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
]

/** The node types the grammar has that could CARRY a supertype, a mixin, a decorator or a part —
 *  THE GRAMMAR-SIDE HALF, ENUMERATED so the zero is a zero over a READABLE row set. */
const GRAMMAR_SIDE_VOCABULARY = /super|extend|mixin|mix|decor|render|part|include|inherit|impl|with|compose|prepend/i

type Site = { file: string; line: number; head: string; nodeType: string; hasError: boolean }
const sites: Record<string, Site[]> = {}
for (const t of ALL_TYPES) sites[t] = []
/** the near-miss families, counted for the RULED types so their zeros are over a NAMED row set */
const nearMissCounts: Record<string, Record<string, number>> = {}

function subtreeHasError(n: any): boolean {
  if (!n) return false
  if (n.type === "ERROR" || n.isMissing) return true
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && subtreeHasError(c)) return true
  }
  return false
}

const { files, repos, byExt } = discover()
let parsed = 0
let parseFail = 0
const nodeTypesSeen = new Map<string, number>()
/** THE GRAMMAR'S OWN INVENTORY — read from the PRODUCTION parser's own Language object. */
const grammarTypes: { type: string; named: boolean }[] = []
try {
  const lang = (parser as any).getLanguage ? (parser as any).getLanguage() : (parser as any).language
  for (let i = 0; i < lang.nodeTypeCount; i++) {
    grammarTypes.push({ type: lang.nodeTypeForId(i), named: lang.nodeTypeIsNamed(i) })
  }
} catch { /* the inventory is reported as absent rather than guessed */ }

for (const abs of files) {
  const rel = path.relative(CR, abs).split(path.sep).join("/")
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { parseFail++; continue }
  let tree: any
  try { tree = parser.parse(content) } catch { parseFail++; continue }
  if (!tree) { parseFail++; continue }
  parsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const node = stack.pop()
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) stack.push(c)
    }
    nodeTypesSeen.set(node.type, (nodeTypesSeen.get(node.type) ?? 0) + 1)
    if (node.type !== "list_lit" && node.type !== "sym_lit" && node.type !== "vec_lit" && node.type !== "map_lit" && node.type !== "meta_lit") continue
    const line = node.startPosition.row + 1
    const head = node.type === "list_lit" ? (node.namedChild(0)?.type === "sym_lit" ? node.namedChild(0)!.text : "") : ""
    const hasError = subtreeHasError(node)
    for (const t of ALL_TYPES) {
      const c = CONSTRUCTS[t]!
      let hit = false
      if (c.heads.includes("*CALL*")) hit = node.type === "list_lit" && head !== ""
      else if (c.heads.includes("*SYM*")) hit = node.type === "sym_lit"
      else if (c.heads.includes("*CONTAINER*")) hit = node.type === "list_lit" || node.type === "vec_lit" || node.type === "map_lit" || node.type === "set_lit"
      else if (c.heads.includes("")) hit = false
      else if (t === "renders") {
        // THE RENDER ELEMENT: a keyword-led vector. The COMPONENT is its child.
        hit = node.type === "vec_lit" && node.namedChild(0)?.type === "kwd_lit"
      } else if (t === "decorates") {
        // THE METADATA CARRIER — the ONLY candidate this type could ever have.
        hit = node.type === "meta_lit"
      } else if (t === "mixes_in" || t === "part_of") {
        // THE CONSTRUCT DOES NOT EXIST. The near-miss families are counted BELOW instead, so the
        // zero is a zero over a NAMED row set.
        hit = false
      } else {
        hit = node.type === "list_lit" && c.heads.includes(head)
      }
      if (hit) sites[t]!.push({ file: rel, line, head: head || node.type, nodeType: node.type, hasError })
    }
    /* the near-miss families for the RULED types — the shapes that COULD have been the construct */
    for (const t of ["decorates", "mixes_in", "part_of"]) {
      const fam = CONSTRUCTS[t]!.nearMiss
      if (node.type === "meta_lit" && fam.includes("meta_lit")) bumpNearMiss(t, "meta_lit")
      if (node.type === "list_lit" && head && fam.includes(head)) bumpNearMiss(t, head)
    }
  }
  try { tree.delete() } catch { /* the tree is released below */ }
}
function bumpNearMiss(t: string, fam: string): void {
  if (!nearMissCounts[t]) nearMissCounts[t] = {}
  nearMissCounts[t]![fam] = (nearMissCounts[t]![fam] ?? 0) + 1
}

/* ── the report ── */
const perType: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const rows = sites[t]!
  const filesHit = new Set(rows.map((r) => r.file))
  const reposHit = new Set(rows.map((r) => r.file.split("/")[0]!))
  const real = rows.filter((r) => !r.hasError)
  perType[t] = {
    disposition: CONSTRUCTS[t]!.disposition,
    rulingClass: CONSTRUCTS[t]!.rulingClass,
    construct: CONSTRUCTS[t]!.heads.filter((h) => !h.startsWith("*")).join(", ") ||
      ({ calls: "a call form (a list_lit whose head is a sym_lit)", uses: "a symbol occurrence (sym_lit)", contains: "a container form (list_lit/vec_lit/map_lit/set_lit)", references: "a symbol occurrence (sym_lit)", renders: "a keyword-led vector (a render ELEMENT)" } as Record<string, string>)[t] || "",
    nodeType: CONSTRUCTS[t]!.nodeType,
    sites: rows.length,
    files: filesHit.size,
    repos: reposHit.size,
    REAL_NODES: real.length,
    errorOrMissingSubtrees: rows.length - real.length,
    nearMissFamilies: nearMissCounts[t] ?? {},
  }
}
const grammarSide = grammarTypes.filter((g) => g.named && GRAMMAR_SIDE_VOCABULARY.test(g.type)).map((g) => g.type)
const report = {
  instrument: "script/m14/clojure-type-construct-census.ts",
  question: "for EACH of the fourteen types: did somebody MEASURE the construct the disposition names, and does that construct arrive as a REAL NODE?",
  population: { files: files.length, repos: Object.fromEntries(repos), byExt: Object.fromEntries(byExt), root: CR, rule: "the gate's own admitted set: a real git checkout · git ls-files · the lane's extension list · the 1 MB SIZE_CAP" },
  grammar: { file: path.relative(ROOT, WASM), sha256: wasmSha256, namedTypes: grammarTypes.filter((g) => g.named).length, anonymousTypes: grammarTypes.filter((g) => !g.named).length },
  parse: { parsed, parseFail },
  perType,
  /** THE GRAMMAR-SIDE HALF, ENUMERATED: the named node types whose NAMES could carry a supertype,
   *  a mixin, a decorator, a render or a part. The enumeration is READABLE (the whole inventory is
   *  printed beside it) so the zero is a zero over a named row set. */
  grammarSideVocabulary: { pattern: String(GRAMMAR_SIDE_VOCABULARY), matching: grammarSide, note: "the vocabulary is matched against the NAMED node types of the wired build, read from the production parser's own Language object" },
  nodeTypesSeen: Object.fromEntries([...nodeTypesSeen.entries()].sort((a, b) => b[1] - a[1])),
}

const L: string[] = []
const say = (s = "") => L.push(s)
say("CLOJURE — THE PER-TYPE CONSTRUCT CENSUS (did somebody MEASURE the construct the disposition names?)")
say()
say(`  population   ${files.length} admitted file(s) over ${repos.size} repo(s) — ${[...repos.entries()].map(([r, n]) => `${r} ${n}`).join(" · ")}`)
say(`  grammar      ${path.relative(ROOT, WASM)} sha256 ${wasmSha256} · ${report.grammar.namedTypes} named · ${report.grammar.anonymousTypes} anonymous`)
say(`  parsed       ${parsed} file(s) · parse failures ${parseFail}`)
say()
say("  PER TYPE — the construct, the node type that carries it, the sites, and THE REAL-NODE TEST")
for (const t of ALL_TYPES) {
  const p = perType[t]!
  const label = p.disposition === "IMPLEMENTED" ? "E    " : "RULED"
  say(`  ${label} ${t.padEnd(13)} ${String(p.sites).padStart(6)} site(s) · ${String(p.files).padStart(4)} file(s) · ${String(p.repos).padStart(2)} repo(s) · REAL NODES ${String(p.REAL_NODES).padStart(6)} · ERROR/MISSING ${String(p.errorOrMissingSubtrees).padStart(4)} · ${p.disposition === "RULED" ? p.rulingClass : "implemented"}`)
  say(`       construct: ${p.construct || "(none)"}`)
  say(`       node type: ${p.nodeType}`)
  if (Object.keys(p.nearMissFamilies).length) {
    const parts = Object.entries(p.nearMissFamilies).map(([k, v]) => `${k} ${v}`).join(" · ")
    say(`       near-miss families measured: ${parts}`)
  }
}
say()
say(`  THE GRAMMAR-SIDE VOCABULARY ${String(GRAMMAR_SIDE_VOCABULARY)} over the ${report.grammar.namedTypes} named types: ${grammarSide.length ? grammarSide.join(" ") : "NONE"}`)
say(`  the whole named inventory (so the zero is readable): ${grammarTypes.filter((g) => g.named).map((g) => g.type).join(" ")}`)
console.log(L.join("\n"))

if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
  console.log(`\nJSON written: ${OUT}`)
}
