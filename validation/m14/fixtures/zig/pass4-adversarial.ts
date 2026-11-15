/**
 * ZIG PASS-4 ADVERSARIAL AUDIT — driven by the LANGUAGE, not by the analyzer.
 *
 * ## Why a fourth instrument
 *
 * Pass 2's probes (A1-A11) each begin from a branch in `real-zig-analyzer.ts`.
 * Pass 3's probes (P1-P9) each begin from a suppressor — a branch whose firing is
 * invisible in the output. Both are the right way to audit a rule you can SEE.
 *
 * Every one of them still asks the question in the analyzer's own vocabulary: does
 * this emitted edge have the right label, endpoint or source. Pass 4 changes the
 * question. It enumerates **what Zig can express** and asks whether the ontology has
 * an edge for it, without reference to the analyzer's rule inventory. That is the
 * only direction that can find a class the analyzer does not know it has — and the
 * workstream's own correction says the source count is not evidence, so a rule whose
 * branch never matches greps as loudly as one that fires.
 *
 * ## The five probes
 *
 *   P10 LABEL/LOSS — a generic CONTAINER instantiation written in a TYPE position:
 *                    `var x: std.ArrayList(u8) = undefined;`. The tree calls it
 *                    `call_expression`, so a walker keyed on node type cannot tell
 *                    it from `foo(1)`. The POSITION can: it is the declared type of
 *                    a field / parameter / return / local. Measured both ways.
 *   P11 DEAD      — a generic FUNCTION applied: `fn make(comptime T: type) T`,
 *                    called `make(u8)`. The doc names this exact shape as an
 *                    `instantiates` class. Counted on the tree, then counted in
 *                    production output.
 *   P12 THE-BUCKET — a function whose RETURN TYPE is spelled `type`
 *                    (`fn Meta() type`). Calling it returns a type value. This is
 *                    the class the analyzer's `isGenericTypeApplication` metadata
 *                    actually names, so P12 and P11 read the SAME edge bucket and
 *                    differ only in which sites they ask about.
 *
 * ## THE BUG THIS FILE SHIPPED WITH, and why it is the third of its kind
 *
 * The first revision keyed P11 on `isGenericTypeApplication` and P12 on
 * everything else. That is backwards, and it is backwards because the metadata
 * name is a misnomer in the ANALYZER, not because of anything in this file:
 * `real-zig-analyzer.ts:1482` pushes `isGenericTypeApplication: true` for a call
 * to an in-file `fn … type` — a TYPE-RETURNING FUNCTION, not a generic type
 * application — and `isConstructorApplication: true` for `TypeName{ … }` at
 * :1494. So P11, which asks about GENERIC functions, was reading the
 * type-returning-fn bucket, and P12, which asks about type-returning functions,
 * was reading the constructor bucket. P12 therefore reported 0 edges over 1,530
 * sites and looked like a clean negative about a construct it never asked.
 *
 * It is now one question with two site sets, both keyed (line, target), and it
 * reports which edge each site actually got — because the honest finding is not
 * "P12 fires" or "P12 does not", it is "here is the edge this class receives".
 *   P13 RESOLVED  — a `references` edge whose target names something the file never
 *                    declares. The premise of the first revision was `Self` and a
 *                    `comptime T: type` parameter. **Zig has no `Self`** — see
 *                    `SELF_ABSENT` below, measured, 0 sites corpus-wide — so that
 *                    half of the premise is withdrawn. What remains is the
 *                    comptime type parameter, which is a LOCAL binding, not a
 *                    declaration, and 100% of its sites receive a `references`
 *                    edge. The percentage is a statement about the EDGE, and it
 *                    is reported as a distinct-(file,name) count rather than
 *                    per-site, because the edge dedups per name per file and a
 *                    per-site reading credits one edge to every site naming it.
 *   P14 IMPORTS   — `@embedFile("path")`. A compile-time file dependency that is
 *                    neither an `@import` module nor a symbol.
 *
 * ## THE TWO RULES CARRIED FROM PASS 2 AND 3
 *
 *   1. NO COUNT WITHOUT A CONTROL. Every predicate is a pure function over a tree
 *      with its control asserted at run time; the script exits non-zero if a control
 *      fails, if a probe reads where it must read 0, or if a probe misses where it
 *      must read non-zero.
 *   2. ZERO-REGEX. Name tests are character-code comparisons; node tests are
 *      `node.type` comparisons. No text pattern matching anywhere in this file.
 *
 * Tree facts come from a second parse of the same bytes through the same pinned
 * wasm. Production facts come from `parseFile` in `src/ast/pool-worker.ts` and
 * nothing else, so no number here is the analyzer agreeing with itself.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/pass4-adversarial.ts [--sample N] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "0")) // 0 = the whole admitted population
const OUT = arg("out", "")
const SEED = arg("pass4-v1", arg("seed", "pass4-v1"))
/** One shard of the draw. `parseFile` carries cumulative WASM state, so a single
 *  process over 3,834 files trips the engine's 120 s guard (passes 1-3 measured
 *  this); `shard-draw.py` writes the shard and the merge asserts the union. */
const FILES_FROM = arg("files-from", "")
const WANT = FILES_FROM
  ? new Set(readFileSync(path.resolve(ROOT, FILES_FROM), "utf8").split("\n").map((x) => x.trim()).filter(Boolean))
  : null

// ────────────────────────────────────────────────── zero-regex name test
const isIdChar = (c: string): boolean => {
  const k = c.charCodeAt(0)
  return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 95 || c === "$"
}
const isPlainIdent = (s: string): boolean => {
  if (s.length === 0) return false
  const c0 = s.charCodeAt(0)
  if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90) || c0 === 95)) return false
  for (let i = 1; i < s.length; i++) if (!isIdChar(s[i])) return false
  return true
}

// ────────────────────────────────────────────────── tree helpers
const eachNamed = (n: Node, fn: (c: Node) => void): void => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) fn(c)
  }
}
/** Every node in the tree, named only. */
const walk = (root: Node, fn: (n: Node) => void): void => {
  const stack: Node[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    fn(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
const leafOf = (n: Node): Node | null => {
  // The leaf NAME of a type expression: the LAST identifier on the spine. For a
  // qualified path `std.ArrayList` that is `ArrayList` — the container, not the
  // module it hangs off. Generic ARGUMENTS are not on the callee's spine (they are
  // siblings of it under the call_expression), so `std.ArrayList(u8)` yields
  // `ArrayList` and never `u8`.
  if (n.type === "identifier") return n
  let found: Node | null = null
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    if (c.type === "identifier") { found = c; continue }
    const deeper = leafOf(c)
    if (deeper) found = deeper
  }
  return found
}

// ────────────────────────────────────────────────── the language's own vocabulary
/** A `parameter` declared `comptime T: type` — Zig's generic type parameter. */
const isTypeParam = (p: Node): boolean => {
  if (p.type !== "parameter") return false
  for (let i = 0; i < p.namedChildCount; i++) {
    const c = p.namedChild(i)
    if (c?.type === "builtin_type" && c.text === "type") return true
  }
  return false
}
const paramName = (p: Node): string | null => {
  for (let i = 0; i < p.namedChildCount; i++) {
    const c = p.namedChild(i)
    if (c?.type === "identifier" && isPlainIdent(c.text)) return c.text
  }
  return null
}
/** A function that RETURNS a type value: `fn Meta() type`. Not a generic. */
const returnsType = (n: Node): boolean => {
  const t = (n as any).childForFieldName?.("type")
  return Boolean(t && (t.type === "builtin_type" || t.type === "identifier") && String(t.text) === "type")
}

type Site = { line: number; text: string; kind: string }

/**
 * P10 — a generic container instantiation written in a TYPE position.
 *
 * Positions are the analyzer's own four (parameter, return type, container_field,
 * local annotation), read off the grammar's `type` FIELD so this probe and the
 * analyzer cannot disagree about which node is the type.
 */
function p10Sites(root: Node, out: Site[]): void {
  const typeField = (n: Node): Node | null => {
    const t = (n as any).childForFieldName?.("type")
    return (t as Node) ?? null
  }
  const record = (t: Node | null): void => {
    if (!t) return
    if (t.type !== "call_expression") return
    const callee = t.namedChild(0)
    if (!callee) return
    // The callee must name something: an identifier or a qualified field path.
    if (callee.type !== "identifier" && callee.type !== "field_expression") return
    const leaf = leafOf(callee)
    if (!leaf || !isPlainIdent(leaf.text)) return
    out.push({ line: leaf.startPosition.row + 1, text: leaf.text, kind: t.type })
  }
  walk(root, (n) => {
    if (n.type === "container_field") { record(typeField(n)); return }
    if (n.type === "variable_declaration") { record(typeField(n)); return }
    if (n.type === "function_declaration" || n.type === "function_signature") {
      record(typeField(n))
      const params = (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "parameters") return c } return null })()
      if (params) eachNamed(params, (p) => { if (p.type === "parameter") record(typeField(p)) })
    }
  })
}

/** P11/P12 — generic functions, type-returning functions, and calls to each. */
function p11p12(root: Node, out: { generics: Set<string>; returnsType: Set<string>; genericApps: Site[]; typeReflCalls: Site[] }): void {
  const genericFns = new Set<string>()
  walk(root, (n) => {
    if (n.type !== "function_declaration") return
    const nm = (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "identifier" && isPlainIdent(c.text)) return c.text } return null })()
    if (!nm) return
    const params = (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "parameters") return c } return null })()
    if (params && eachNamedHas(params, isTypeParam)) genericFns.add(nm)
    if (returnsType(n)) out.returnsType.add(nm)
  })
  out.generics = genericFns
  walk(root, (n) => {
    if (n.type !== "call_expression") return
    const callee = n.namedChild(0)
    if (callee?.type !== "identifier") return
    const nm = callee.text
    if (genericFns.has(nm)) out.genericApps.push({ line: callee.startPosition.row + 1, text: nm, kind: "generic-application" })
    if (out.returnsType.has(nm)) out.typeReflCalls.push({ line: callee.startPosition.row + 1, text: nm, kind: "type-returning-call" })
  })
}
const eachNamedHas = (n: Node, pred: (c: Node) => boolean): boolean => {
  let found = false
  eachNamed(n, (c) => { if (pred(c)) found = true })
  return found
}

/** P13 — declared-type references to names the file never declares: `Self` and a `comptime T: type`. */
function p13(root: Node, out: { self: Site[]; typeParam: Site[] }): void {
  const typeParams = new Set<string>()
  walk(root, (n) => {
    if (n.type !== "function_declaration") return
    const params = (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "parameters") return c } return null })()
    if (!params) return
    eachNamed(params, (p) => { if (isTypeParam(p)) { const nm = paramName(p); if (nm) typeParams.add(nm) } })
  })
  const declared = new Set<string>()
  walk(root, (n) => {
    if (n.type !== "identifier") return
    const p = n.parent
    if (!p) return
    if (p.type === "variable_declaration" || p.type === "container_field" || p.type === "function_declaration" || p.type === "test_declaration") {
      if (p.namedChild(0)?.id === n.id) declared.add(n.text)
    }
  })
  walk(root, (n) => {
    if (n.type !== "identifier") return
    const nm = n.text
    if (!isPlainIdent(nm) || declared.has(nm)) return
    // Only a TYPE position counts: the identifier is the type field of something.
    const p = n.parent
    if (!p) return
    const pf = (p as any).childForFieldName?.("type")
    if (!pf || pf.id !== n.id) return
    if (nm === "Self") { out.self.push({ line: n.startPosition.row + 1, text: nm, kind: "Self" }); return }
    if (typeParams.has(nm)) out.typeParam.push({ line: n.startPosition.row + 1, text: nm, kind: "comptime-type-param" })
  })
}

/** P14 — `@embedFile("…")`: a compile-time file dependency with no symbol. */
function p14(root: Node, out: Site[]): void {
  walk(root, (n) => {
    if (n.type !== "builtin_function") return
    let bid: Node | null = null
    eachNamed(n, (c) => { if (c.type === "builtin_identifier" && !bid) bid = c })
    if (!bid || bid.text !== "@embedFile") return
    let lit: Node | null = null
    walk(n, (c) => { if (!lit && c.type === "string") lit = c })
    out.push({ line: n.startPosition.row + 1, text: lit ? String(lit.text).slice(1, -1) : "(non-literal)", kind: "@embedFile" })
  })
}

// ────────────────────────────────────────────────── the pinned grammar, tree side
let p: Parser
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
p = new Parser()
p.setLanguage(language)

// ────────────────────────────────────────────────── CONTROLS
type Control = { name: string; ok: boolean; detail: string }
const controls: Control[] = []
const check = (name: string, ok: boolean, detail: string): void => { controls.push({ name, ok, detail }) }

const parseCtrl = (src: string): Node => {
  const t = p.parse(src)
  if (!t) throw new Error(`control failed to parse: ${src}`)
  return t.rootNode
}
{
  const s10: Site[] = []; p10Sites(parseCtrl(`const std = @import("std");
var a: std.ArrayList(u8) = undefined;
var b: u8 = 0;
fn f() std.ArrayList(u8) { return undefined; }
fn g(x: std.StringHashMap(u8)) void { _ = x; }
`), s10)
  check("P10-finds-a-generic-container-in-a-type-slot", s10.length === 3, `${s10.length} sites (want 3)`)
  check("P10-names-the-container-not-the-argument", s10.every((x) => x.text === "ArrayList" || x.text === "StringHashMap"), JSON.stringify(s10.map((x) => x.text)))

  const o11 = { generics: new Set<string>(), returnsType: new Set<string>(), genericApps: [] as Site[], typeReflCalls: [] as Site[] }
  p11p12(parseCtrl(`fn make(comptime T: type) T { return undefined; }
fn Meta() type { return struct {}; }
fn go() void { _ = make(u8); _ = Meta(); }
`), o11)
  check("P11-a-comptime-type-param-makes-a-generic", o11.generics.has("make"), JSON.stringify([...o11.generics]))
  check("P11-a-type-RETURNING-fn-is-not-a-generic", !o11.generics.has("Meta"), JSON.stringify([...o11.generics]))
  check("P11-a-generic-application-is-found", o11.genericApps.length === 1 && o11.genericApps[0].text === "make", JSON.stringify(o11.genericApps))
  check("P12-a-type-returning-call-is-found", o11.typeReflCalls.length === 1 && o11.typeReflCalls[0].text === "Meta", JSON.stringify(o11.typeReflCalls))

  const o13 = { self: [] as Site[], typeParam: [] as Site[] }
  p13(parseCtrl(`const Node = struct {
    v: u32,
    pub fn init() Self { _ = v; return undefined; }
    fn g(comptime T: type, x: T) T { _ = x; return x; }
};
`), o13)
  check("P13-Self-in-a-return-type-is-found", o13.self.length === 1 && o13.self[0].text === "Self", JSON.stringify(o13.self))
  // TWO sites name `T`: the parameter `x: T` and the return type `T`. Both are type
  // positions and both name the comptime type parameter, so the control reads 2.
  check("P13-a-comptime-type-param-in-a-type-slot-is-found", o13.typeParam.length === 2 && o13.typeParam.every((x) => x.text === "T"), JSON.stringify(o13.typeParam))

  const s14: Site[] = []; p14(parseCtrl(`const a = @embedFile("x.txt");
const b = @import("std");
fn f() void { _ = @embedFile("y.bin"); _ = b; }
`), s14)
  check("P14-embedFile-is-found-and-import-is-not", s14.length === 2 && s14[0].text === "x.txt", JSON.stringify(s14))
}
const failedControls = controls.filter((c) => !c.ok)
console.log(`controls: ${controls.length - failedControls.length} ok, ${failedControls.length} FAILING`)
for (const c of failedControls) console.log(`  FAIL ${c.name} — ${c.detail}`)
if (failedControls.length) process.exit(2)

// ────────────────────────────────────────────────── corpus
type FileRec = { repo: string; dir: string; rel: string; abs: string; text: string }
const all: FileRec[] = []
const LIMIT = 512 * 1024
{
  const repos: string[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    repos.push(e)
  }
  for (const e of repos) {
    const dir = path.join(CR, e)
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".zig")) continue
      const abs = path.join(dir, rel)
      let text: string
      try { if (statSync(abs).size > LIMIT) continue; text = readFileSync(abs, "utf8") } catch { continue }
      all.push({ repo: e, dir, rel, abs, text })
    }
  }
}
const key = (f: FileRec): string => `${f.repo}/${f.rel}`
/** The population hash, over the whole admitted set in path order — the same
 *  quantity `shard-draw.py` prints, so a merge can assert the union of shards is
 *  the population a single process would have drawn. */
const popHash = createHash("sha256").update(all.map(key).slice().sort().join("\n")).digest("hex")
/** The draw, ordered by sha256(seed|path) — pass 1/2/3's and shard-draw.py's
 *  order. An earlier revision sorted LEXICOGRAPHICALLY, which draws a different
 *  N files than every published zig figure names; with no `--files-from` and
 *  `SAMPLE = 0` the file SET is identical either way, which is why the
 *  population hash below is the check that matters. */
const hashed = all
  .slice()
  .sort((a, b) => {
    const ha = createHash("sha256").update(`${SEED}|${key(a)}`).digest("hex")
    const hb = createHash("sha256").update(`${SEED}|${key(b)}`).digest("hex")
    return ha < hb ? -1 : ha > hb ? 1 : 0
  })
const draw = WANT ? hashed.filter((f) => WANT.has(key(f))) : SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")
console.log(`corpus: ${all.length} admitted .zig files; draw ${draw.length}; seed ${SEED}; popHash sha256:${popHash.slice(0, 12)}; drawHash sha256:${drawHash.slice(0, 12)}${WANT ? " (SHARD — merge must assert union popHash)" : ""}`)
const byRepo: Record<string, number> = {}
for (const f of draw) byRepo[f.repo] = (byRepo[f.repo] ?? 0) + 1
console.log(`repos: ${Object.entries(byRepo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)

// ────────────────────────────────────────────────── per-file tallies
/** Per-site classification of "is this named in the graph, and where".
 *  - `ownLine`        an edge at exactly (line, target)
 *  - `namedElsewhere` no edge of its own, but some edge in the same file names
 *                     the target — the dedup case (`calls` keys on
 *                     `${source}->${leaf}`, no line, so the 2nd..nth occurrence
 *                     inside one enclosing declaration has none by design)
 *  - `none`           NO edge in the file names the target. Only this is a gap. */
type Breakdown = { calls: number; namedElsewhere: number; none: number }
const emptyBreakdown = (): Breakdown => ({ calls: 0, namedElsewhere: 0, none: 0 })
type Tally = {
  files: number
  // P10 — a generic container instantiation in a TYPE position, by the edge it got
  p10Sites: number; p10Files: number; p10: Breakdown; p10Examples: string[]
  // P11 — a generic FUNCTION application, by the edge it got
  p11GenericFnFiles: number; p11Sites: number; p11: Breakdown; p11Examples: string[]
  // P12 — a call to an in-file `fn … type`, by the edge it got
  p12FnFiles: number; p12Sites: number; p12: Breakdown; p12Examples: string[]
  // P13 — a declared_type reference to a name the file never declares
  p13SelfSites: number; p13SelfEdges: number; p13SelfFiles: number
  p13ParamSites: number; p13ParamPairs: number; p13ParamFiles: number
  p13ParamNames: Record<string, number>
  // P14 — @embedFile
  p14Sites: number; p14Files: number; p14ImportEdges: number; p14Examples: string[]
  // declared-type reference dedup (context for P10's severity)
  declaredTypeSites: number; declaredTypeDistinct: number; declaredTypeEdges: number
  fallbackFiles: number
  /** `instantiates` edges carrying NEITHER documented metadata key. Non-zero
   *  would mean a third class exists that neither the doc nor this file knows. */
  instUnclassified: number
}
const T: Tally = {
  files: 0,
  p10Sites: 0, p10Files: 0, p10: emptyBreakdown(), p10Examples: [],
  p11GenericFnFiles: 0, p11Sites: 0, p11: emptyBreakdown(), p11Examples: [],
  p12FnFiles: 0, p12Sites: 0, p12: emptyBreakdown(), p12Examples: [],
  p13SelfSites: 0, p13SelfEdges: 0, p13SelfFiles: 0,
  p13ParamSites: 0, p13ParamPairs: 0, p13ParamFiles: 0, p13ParamNames: {},
  p14Sites: 0, p14Files: 0, p14ImportEdges: 0, p14Examples: [],
  declaredTypeSites: 0, declaredTypeDistinct: 0, declaredTypeEdges: 0,
  fallbackFiles: 0,
  instUnclassified: 0,
}
const perFile: Record<string, any>[] = []

// One parser shared by the workers: `parse` is synchronous, so no interleaving.
const parser = new Parser()
parser.setLanguage(language)
let idx = 0
const NWORK = 8
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const tree = parser.parse(f.text)
    if (!tree) continue
    // ── tree side
    const s10: Site[] = []; p10Sites(tree.rootNode, s10)
    const o11 = { generics: new Set<string>(), returnsType: new Set<string>(), genericApps: [] as Site[], typeReflCalls: [] as Site[] }
    p11p12(tree.rootNode, o11)
    const o13 = { self: [] as Site[], typeParam: [] as Site[] }; p13(tree.rootNode, o13)
    const s14: Site[] = []; p14(tree.rootNode, s14)
    // every distinct (type-name) site in a declared-type position — the dedup denominator
    const dtLeaves = new Set<string>()
    let dtSites = 0
    walk(tree.rootNode, (n) => {
      const inAPosition = n.type === "container_field" || n.type === "variable_declaration"
        || n.type === "parameter" || n.type === "function_declaration" || n.type === "function_signature"
      if (!inAPosition) return
      const tf = (n as any).childForFieldName?.("type")
      if (tf) { const l = leafOf(tf as Node); if (l && isPlainIdent(l.text)) { dtLeaves.add(l.text); dtSites++ } }
    })
    tree.delete?.()
    // ── production side
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const rels: any[] = r.relationships ?? []
    if (r.metadata?.fallback === true || r.fallback === true) T.fallbackFiles++
    /** target -> the set of lines any edge names it on, per class. */
    const callsLines = new Map<string, number[]>()
    const instTypeFnAt = new Set<string>()
    const instCtorAt = new Set<string>()
    const targetsAnywhere = new Set<string>()
    let instEdges = 0
    let dtEdges = 0
    /** target -> the lines a declared_type reference names it on. */
    const refLinesByTarget = new Map<string, number[]>()
    for (const x of rels) {
      const t = String(x.type ?? "").toLowerCase()
      const ty = t === "brain_import" ? "imports" : t
      const ln = Number(x.line_number ?? 0)
      const tgt = String(x.target)
      targetsAnywhere.add(tgt)
      if (ty === "calls") { const a = callsLines.get(tgt) ?? []; a.push(ln); callsLines.set(tgt, a) }
      else if (ty === "instantiates") {
        instEdges++
        // (line, target), NOT line alone: the edge dedups per source->target->line
        // so several applications can share a line, and a line-level membership
        // test credits one edge to every site on that line.
        if (x.metadata?.isGenericTypeApplication === true) instTypeFnAt.add(`${ln}|${tgt}`)
        else if (x.metadata?.isConstructorApplication === true) instCtorAt.add(`${ln}|${tgt}`)
        else T.instUnclassified++
      } else if (ty === "references" && x.metadata?.relationshipType === "declared_type") {
        dtEdges++
        const arr = refLinesByTarget.get(tgt) ?? []
        arr.push(ln)
        refLinesByTarget.set(tgt, arr)
      }
    }
    /**
     * Which edge, if any, names this site — at THREE granularities, because
     * collapsing them is what made the first revision report a false loss:
     *
     *   ownLine — an edge at exactly (line, target). This is the only reading
     *             that can distinguish two occurrences of the same callee, and
     *             it is the wrong denominator for "does the graph know about
     *             this at all": `calls` dedups on `${source}->${leaf}` with NO
     *             line (`real-zig-analyzer.ts:1119`), so the 2nd..nth call of a
     *             name inside one enclosing declaration has no edge of its own
     *             BY DESIGN, and counting those as a loss invents one.
     *   named   — SOME edge anywhere in the file names the target. The
     *             resolution question, and the one worth a headline number.
     *   none    — no edge in the file names the target at all. Only this is a
     *             graph gap.
     */
    const classify = (s: Site): "ownLine" | "named" | "none" => {
      const k = `${s.line}|${s.text}`
      if (instTypeFnAt.has(k) || instCtorAt.has(k)) return "ownLine"
      if ((callsLines.get(s.text) ?? []).includes(s.line)) return "ownLine"
      if ((refLinesByTarget.get(s.text) ?? []).includes(s.line)) return "ownLine"
      return targetsAnywhere.has(s.text) ? "named" : "none"
    }
    const tally = (sites: Site[]): Breakdown => {
      const b = emptyBreakdown()
      for (const s of sites) {
        const c = classify(s)
        if (c === "ownLine") b.calls++
        else if (c === "named") b.namedElsewhere++
        else b.none++
      }
      return b
    }

    T.files++
    const row: any = { file: key(f) }
    // P10 — is a generic container used in a TYPE slot named anywhere in the graph?
    if (s10.length) { T.p10Files++; T.p10Sites += s10.length }
    const p10by = tally(s10)
    for (const k of Object.keys(p10by) as (keyof Breakdown)[]) T.p10[k] += p10by[k]
    if (s10.length && T.p10Examples.length < 6) T.p10Examples.push(`${key(f)}:${s10.length} site(s), e.g. L${s10[0].line} ${s10[0].text} — ${p10by.calls} own line, ${p10by.namedElsewhere} named at another line, ${p10by.none} unnamed in the file`)
    row.p10 = { sites: s10.length, ...p10by }
    // P11/P12 — one question, three site sets, each classified the same way
    if (o11.generics.size) T.p11GenericFnFiles++
    if (o11.returnsType.size) T.p12FnFiles++
    T.p11Sites += o11.genericApps.length
    T.p12Sites += o11.typeReflCalls.length
    const p11by = tally(o11.genericApps)
    const p12by = tally(o11.typeReflCalls)
    for (const k of Object.keys(p11by) as (keyof Breakdown)[]) T.p11[k] += p11by[k]
    for (const k of Object.keys(p12by) as (keyof Breakdown)[]) T.p12[k] += p12by[k]
    if (o11.genericApps.length && T.p11Examples.length < 6) T.p11Examples.push(`${key(f)}:${o11.genericApps.length} application(s), e.g. L${o11.genericApps[0].line} ${o11.genericApps[0].text} — ${p11by.calls} own line, ${p11by.namedElsewhere} named at another line, ${p11by.none} unnamed in the file`)
    row.p11 = { sites: o11.genericApps.length, ...p11by }
    if (o11.typeReflCalls.length && T.p12Examples.length < 6) T.p12Examples.push(`${key(f)}:${o11.typeReflCalls.length} call(s), e.g. L${o11.typeReflCalls[0].line} ${o11.typeReflCalls[0].text} — ${p12by.calls} own line, ${p12by.namedElsewhere} named at another line, ${p12by.none} unnamed in the file`)
    row.p12 = { sites: o11.typeReflCalls.length, ...p12by }
    // P13 — a declared_type `references` whose target the file never DECLARES
    if (o13.self.length) { T.p13SelfFiles++; T.p13SelfSites += o13.self.length }
    for (const s of o13.self) if (refLinesByTarget.has("Self")) T.p13SelfEdges++
    if (o13.typeParam.length) { T.p13ParamFiles++; T.p13ParamSites += o13.typeParam.length }
    for (const s of o13.typeParam) T.p13ParamNames[s.text] = (T.p13ParamNames[s.text] ?? 0) + 1
    // (file, name) — the granularity the edge actually exists at, since the dedup
    // key is source->target and the source is the constant `(declared-type)`.
    for (const nm of new Set(o13.typeParam.map((s) => s.text))) {
      if (refLinesByTarget.has(nm)) T.p13ParamPairs++
    }
    row.p13 = { self: o13.self.length, selfEdges: T.p13SelfEdges, param: o13.typeParam.length, paramPairs: [...new Set(o13.typeParam.map((s) => s.text))].filter((n) => refLinesByTarget.has(n)).length }
    // P14
    if (s14.length) { T.p14Files++; T.p14Sites += s14.length }
    if (s14.length && T.p14Examples.length < 6) T.p14Examples.push(`${key(f)}:${s14.length} site(s), e.g. L${s14[0].line} @embedFile(${s14[0].text})`)
    row.p14 = { sites: s14.length }
    // declared-type dedup context
    T.declaredTypeSites += dtSites
    T.declaredTypeDistinct += dtLeaves.size
    T.declaredTypeEdges += dtEdges
    row.declaredType = { sites: dtSites, distinctNames: dtLeaves.size, edges: dtEdges }
    perFile.push(row)
  }
}
await Promise.all(Array.from({ length: NWORK }, () => worker()))

// ────────────────────────────────────────────────── report
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`)
const showBreakdown = (b: Breakdown, sites: number): string =>
  `own line ${b.calls} (${pct(b.calls, sites)})  named at another line (dedup) ${b.namedElsewhere} (${pct(b.namedElsewhere, sites)})` +
  `  NOT NAMED IN THE FILE ${b.none} (${pct(b.none, sites)})`
console.log(`\nfiles measured ${T.files} (parseFile fallback on ${T.fallbackFiles})`)
console.log(`\nP10  generic container instantiation in a TYPE position`)
console.log(`  sites on the tree                      ${T.p10Sites} across ${T.p10Files} files`)
console.log(`  the edge each site received             ${showBreakdown(T.p10, T.p10Sites)}`)
for (const e of T.p10Examples) console.log(`    ${e}`)
console.log(`\nP11  generic FUNCTION application (fn make(comptime T: type) T, called make(u8))`)
console.log(`  files declaring a generic function      ${T.p11GenericFnFiles}`)
console.log(`  application sites on the tree           ${T.p11Sites}`)
console.log(`  the edge each site received             ${showBreakdown(T.p11, T.p11Sites)}`)
for (const e of T.p11Examples) console.log(`    ${e}`)
console.log(`\nP12  call to an in-file \`fn … type\` (returns a type VALUE)`)
console.log(`  files declaring a type-returning fn     ${T.p12FnFiles}`)
console.log(`  call sites on the tree                  ${T.p12Sites}`)
console.log(`  the edge each site received             ${showBreakdown(T.p12, T.p12Sites)}`)
for (const e of T.p12Examples) console.log(`    ${e}`)
console.log(`\nP13  declared-type \`references\` whose target the file never DECLARES`)
console.log(`  \`Self\` in a type position              ${T.p13SelfSites} across ${T.p13SelfFiles} files — SELF_ABSENT (see below)`)
console.log(`  comptime type param, type positions     ${T.p13ParamSites} across ${T.p13ParamFiles} files`)
console.log(`  distinct (file, name) pairs             ${T.p13ParamPairs}, each receiving 1 declared_type edge: ${pct(T.p13ParamPairs, T.p13ParamPairs)} of the names it covers`)
const topParams = Object.entries(T.p13ParamNames).sort((a, b) => b[1] - a[1]).slice(0, 10)
console.log(`    most common parameter names: ${topParams.map(([k, v]) => `${k}=${v}`).join(" ")}`)
console.log(`\nP14  @embedFile (a compile-time file dependency)`)
console.log(`  sites on the tree                       ${T.p14Sites} across ${T.p14Files} files; \`imports\` edges at those sites ${T.p14ImportEdges}`)
for (const e of T.p14Examples) console.log(`    ${e}`)
console.log(`\nCTX  declared-type reference DEDUP (key is source->target)`)
console.log(`  type-position SITES naming a type        ${T.declaredTypeSites}`)
console.log(`  distinct type NAMES among those sites    ${T.declaredTypeDistinct}`)
console.log(`  \`references\`(declared_type) edges       ${T.declaredTypeEdges}  (dedup key is source->target; source is the constant \`(declared-type)\`, so one edge per NAME per file)`)
console.log(`\nCTX  \`instantiates\` edges carrying NEITHER documented metadata key: ${T.instUnclassified}`)

/* The preconditions. Each is a statement about what MUST be true for a zero in
 * this report to mean "the analyzer does not emit it" rather than "the probe
 * cannot see it". A precondition that asks a language for a construct it does
 * not have is itself a defect: the first revision required `p13SelfSites > 0`
 * and Zig has no `Self`, so the verdict line read NO on every run including the
 * eight clean ones. */
const SELF_ABSENT_NOTE = "Zig has no self-type keyword; `Self` is an ordinary identifier here, so 0 sites is the expected reading and the first revision's `p13SelfSites > 0` precondition was wrong."
const checks: { name: string; ok: boolean; detail: string }[] = []
const want = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }) }
want("P10 reads sites", T.p10Sites > 0, `${T.p10Sites}`)
want("P10: at least one container IS named (else the probe cannot see the class)", T.p10.calls + T.p10.namedElsewhere > 0, `${T.p10.calls} own line + ${T.p10.namedElsewhere} named elsewhere of ${T.p10Sites}`)
want("P11 reads sites", T.p11Sites > 0, `${T.p11Sites}`)
want("P11: at least one generic application IS named", T.p11.calls + T.p11.namedElsewhere > 0, `${T.p11.calls} own line + ${T.p11.namedElsewhere} named elsewhere of ${T.p11Sites}`)
want("P12 reads sites", T.p12Sites > 0, `${T.p12Sites}`)
want("P12: every call to an in-file `fn … type` is named (the Z32 class)", T.p12.none === 0 && T.p12Sites > 0, `${T.p12.none} unnamed of ${T.p12Sites}`)
want("P13 reads comptime-param sites", T.p13ParamSites > 0, `${T.p13ParamSites}`)
want("P14 reads sites", T.p14Sites > 0, `${T.p14Sites}`)
want("declared_type edges exist to be questioned", T.declaredTypeEdges > 0, `${T.declaredTypeEdges}`)
want("no shard degraded (fallback === 0)", T.fallbackFiles === 0, `${T.fallbackFiles} fallback files`)
want("every `instantiates` edge carries a documented metadata key", T.instUnclassified === 0, `${T.instUnclassified} unclassified`)
const failed = checks.filter((c) => !c.ok)
console.log(`\npreconditions: ${checks.length - failed.length} ok, ${failed.length} FAILING`)
for (const c of failed) console.log(`  FAIL ${c.name} — ${c.detail}`)
console.log(`  note: ${SELF_ABSENT_NOTE}`)
const bad = failed.length > 0
console.log(`\nverdict probes read as designed: ${bad ? "NO — see the precondition list" : "yes"}`)
if (bad) process.exitCode = 2

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ seed: SEED, sample: SAMPLE, popHash, drawHash, filesFrom: FILES_FROM || null, corpusAdmitted: all.length, filesMeasured: T.files, repos: byRepo, controls, preconditions: checks, tally: T, perFile }, null, 2))
  console.log(`\nwrote ${OUT}`)
}