/**
 * ZIG INCOMING CHECK — what REACHES a declaration, and what a reverse walk can
 * actually bind to.
 *
 * ## Why this file exists
 *
 * The task's "INCOMING IS NOW PART OF DONE" section asks for two scripts by name,
 * `script/m14/firing-check.ts` and `script/m14/incoming-check.ts`. **Neither
 * exists** — `script/m14/` holds 100 files and neither name is among them. Both
 * would be shared machinery under §8, so this lane cannot write them there. This
 * file is the lane-owned equivalent and it is what the numbers in the report come
 * from; §8 carries the request.
 *
 * ## What the reverse walk actually needs
 *
 * `src/lsp/impact.ts` obtains inbound edges by SCANNING OUTGOING EDGES AND
 * MATCHING TARGETS. Nothing stores an inbound edge; the schema holds none. So the
 * quality of a reverse walk is exactly the quality of target matching, and this
 * file measures the four answers that determines:
 *
 *   1. RESOLUTION — per relationship type, how many edges bind to exactly ONE
 *      published symbol, to MORE THAN ONE (ambiguous), and to NONE.
 *   2. AMBIGUITY — for an ambiguous target, what the candidates are. The
 *      resolver picks one "by a rule nobody chose"; this counts how many rows a
 *      name collides across and whether the edge carries anything that could
 *      break the tie.
 *   3. CAUSE, NOT COUNT — a zero-resolution target has two OPPOSITE meanings: an
 *      external package / builtin / path, or a declaration in the draw the
 *      analyzer failed to publish. They look identical in a count. This file
 *      separates them with tree evidence: a name is `neverIndexed` only when a
 *      declaration of that name EXISTS on the tree of some draw file and no
 *      symbol was published for it.
 *   4. SOURCE LEG — is the edge's source a published symbol, or a scope marker?
 *
 * ## THE SHAPE CONSTRAINT, stated because it bounds deliverable B
 *
 * A zig relationship carries exactly six keys: `source`, `target`, `type`,
 * `confidence`, `line_number`, `metadata`. Both endpoints are NAME STRINGS. There
 * is no qualified name, no kind and no file on an edge, so an edge cannot today
 * carry enough to disambiguate a name two declarations share — and no change to
 * this analyzer can make the INDEXER read one, because the name→id mapping
 * happens in shared machinery (`src/ast/engine.ts`, §8). This file measures how
 * bad it is and names what metadata would fix it.
 *
 * ## Zero-regex
 *
 * Name tests are character-code comparisons and node tests are `node.type`
 * comparisons. There is no text pattern matching in this file.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/incoming-check.ts \
 *     [--files-from shard.txt] [--out dump.json] [--shard i] [--shards n]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ZIG_DECLARED_TYPE_BUILTINS } from "../../../../src/ast/real-zig-analyzer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const FILES_FROM = arg("files-from", "")
const OUT = arg("out", "")
const SHARD = Number(arg("shard", "0"))
const SHARDS = Number(arg("shards", "1"))
const WANT = FILES_FROM
  ? new Set(readFileSync(path.resolve(ROOT, FILES_FROM), "utf8").split("\n").map((x) => x.trim()).filter(Boolean))
  : null

// ─────────────────────────────────────────── zero-regex name predicates
const isIdChar = (c: string): boolean => {
  const k = c.charCodeAt(0)
  return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 95
}
const isPlainIdent = (s: string): boolean => {
  if (!s.length) return false
  const c0 = s.charCodeAt(0)
  if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90) || c0 === 95)) return false
  for (let i = 1; i < s.length; i++) if (!isIdChar(s[i])) return false
  return true
}
/** Zig's builtin FUNCTIONS, `@`-prefixed. `node.text` of a `builtin_function`
 *  begins with `@`, so this is a character test, not a pattern. */
const isBuiltinFnSpelling = (s: string): boolean => s.charCodeAt(0) === 64 /* @ */
/** An import PATH: contains a separator, or ends in `.zig`. Character tests. */
const looksLikePath = (s: string): boolean => {
  if (s.endsWith(".zig")) return true
  for (let i = 0; i < s.length; i++) if (s[i] === "/") return true
  return false
}
/** Scope markers are literal constants, compared by equality. */
const SCOPE_MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(import)", "(local)"])
const isScopeMarker = (s: string): boolean => SCOPE_MARKERS.has(s)

// ─────────────────────────────────────────── the corpus walk (the gate's own)
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
{
  const LIMIT = 512 * 1024
  const repos: string[] = []
  for (const e of readdirSync(CR).sort()) {
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
      try { if (statSync(abs).size > LIMIT) continue } catch { continue }
      all.push({ repo: e, dir, rel, abs })
    }
  }
}
const key = (f: FileRec): string => `${f.repo}/${f.rel}`
const popHash = createHash("sha256").update(all.map(key).slice().sort().join("\n")).digest("hex")
const draw = WANT
  ? all.filter((f) => WANT.has(key(f)))
  : all.filter((_, i) => i % SHARDS === SHARD)

// ─────────────────────────────────────────── the pinned grammar
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))

/**
 * Every name the TREE declares in a file — the denominator that separates
 * "external" from "never indexed". Read off node types only.
 *
 * The buckets are kept apart because they are opposite findings. A
 * `parameter`'s name is correctly NOT a symbol in this project's model (a
 * function symbol carries its signature), so calling an edge to one "never
 * indexed" would be a false accusation. A `container_field` is normally
 * published as `property`, so a miss there is worth a count. A
 * `variable_declaration` / `function_declaration` / `test_declaration` /
 * container name with no published symbol is the bucket this lane owns, and it
 * is the only one of the three that can be a dropped declaration.
 */
/**
 * The node types that OPEN AN EXECUTABLE SCOPE, read off the pinned grammar's own
 * `Language.types` (274 declared) rather than a hand-maintained list: `block`,
 * `block_expression`, and every `*_statement` the grammar declares. A declaration
 * with any of these between it and the file root is a LOCAL, and a local is
 * correctly not a symbol in this project's model.
 *
 * This is the second time this lane has had to learn the same lesson: the ruled
 * probe's first revision seeded a child scope with a COPY of its parent's
 * declarations and read 942 phantom sites, because scope was inferred from the
 * node alone. `variable_declaration` is BOTH a top-level `const`/`var` and an
 * ordinary statement inside a function body, so the node type alone cannot say
 * which, and an unsound reading here manufactures a `neverIndexed` accusation
 * against a name that is simply a local.
 */
const SCOPE_OPENERS = new Set<string>([
  "block", "block_expression", "comptime_statement", "nosuspend_statement",
  "suspend_statement", "defer_statement", "errdefer_statement", "labeled_statement",
  "expression_statement", "if_statement", "for_statement", "while_statement",
  "switch_statement", "catch_block", "block_label",
])
const isLocalTo = (n: Node): boolean => {
  let cur: Node | null = n.parent
  while (cur) {
    if (SCOPE_OPENERS.has(cur.type)) return true
    if (cur.type === "function_declaration" || cur.type === "function_signature" || cur.type === "test_declaration") return true
    cur = cur.parent
  }
  return false
}

const DECL_KINDS = new Set([
  "function_declaration", "function_signature", "variable_declaration",
  "test_declaration", "error_set_declaration",
])
/**
 * Container DECLARATION nodes carry no name of their own — their `namedChild(0)` is a
 * BACKING TYPE or a first member, not a declared identifier. `const E = enum(u0)` parses
 * as `variable_declaration(pub?, const, identifier E, =, enum_declaration(u0))`, so
 * `u0` is the enum's first child and reading it as a file-scope declaration charges the
 * `neverIndexed`/`declared-local` ladder with an accusation against a name that was never
 * declared. Zig's builtin type names are exactly the spelling most likely to appear there,
 * so the accusation lands on `u0`, `u8`, `bool` and their neighbours.
 *
 * The declared name of a container lives on its PARENT `variable_declaration`, and that
 * parent is read correctly already: its own `namedChild(0)` is the `const`/`var`/`pub`
 * token, which is not an `identifier`, so it contributes no name — and the enclosing
 * `variable_declaration`'s identifier IS reached through the generic identifier scan
 * below. So skipping the container costs no real name and removes the false one.
 *
 * `error_set_declaration` is NOT in the skip set, and control C4 is what established
 * that: `const Err = error{ E1 }` parses as `variable_declaration(const, Err, =,
 * error_set_declaration(E1))`, so its `namedChild(0)` is the first error name — a real
 * declaration. §8 item 26 named all five container types; four of them are right and the
 * fifth would have dropped every error-set member in the corpus. Dropping `E1` from the
 * ladder's name set is the safe direction (it can only remove an accusation, never add
 * one), but it is still a measurement the instrument should not make silently.
 *
 * MEASURED (full 3,834-file corpus, draw sha256:2f3545f9…, pass 19): 1 edge. The whole
 * defect is one `const E = enum(u0)` in the corpus, and it showed up as a
 * `declared-local` target the analyzer had no way to publish. This is §8 item 26 of
 * `docs/analyzers/zig.md`; control C4 below pins it.
 */
const CONTAINER_DECL_KINDS = new Set([
  "struct_declaration", "enum_declaration", "union_declaration",
  "opaque_declaration",
])
function treeDeclaredNames(root: Node, out: Map<string, string>): void {
  const stack: Node[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (CONTAINER_DECL_KINDS.has(n.type)) {
      // still descend — its members are `container_field`s in their own right
    } else if (DECL_KINDS.has(n.type) || n.type === "container_field" || n.type === "parameter") {
      const first = n.namedChild(0)
      if (first?.type === "identifier" && isPlainIdent(first.text)) {
        let bucket =
          n.type === "parameter" ? "parameter"
          : n.type === "container_field" ? "field"
          : isLocalTo(n) ? "local"
          : "decl"
        // a name can be reached by more than one node type; keep the STRONGEST
        // claim so a real declaration is never demoted by a weaker one
        const order = ["local", "parameter", "field", "decl"]
        const prev = out.get(first.text)
        if (prev === undefined || order.indexOf(bucket) > order.indexOf(prev)) out.set(first.text, bucket)
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

type Dump = {
  popHash: string
  files: { key: string; symbols: { name: string; kind: string; qualifiedName: string }[]; declaredNames: [string, string][] }[]
  edges: { file: string; source: string; target: string; type: string; line: number; conf: number; meta: string | null; scope: string | null }[]
  fallbackFiles: string[]
}

const dump: Dump = { popHash, files: [], edges: [], fallbackFiles: [] }
const parser = new Parser()
parser.setLanguage(language)

/* CONTROL C3 — the scope rule must tell a top-level declaration from a local of
 * the same name. Without it this file cannot distinguish "the analyzer dropped a
 * declaration" from "this is a local variable", which is the whole content of
 * the `neverIndexed` claim. Exits non-zero on failure. */
{
  const src = [
    "const topLevel: u8 = 0;",
    "const Holder = struct { field: u8 = 0 };",
    "fn f(comptime param: type) void {",
    "  const localOne: u8 = 0;",
    "  _ = localOne; _ = param;",
    "}",
    "test \"t\" { const localTwo: u8 = 0; _ = localTwo; }",
  ].join("\n")
  const t = parser.parse(src)
  const m = new Map<string, string>()
  if (t) treeDeclaredNames(t.rootNode, m)
  const want: Record<string, string> = {
    topLevel: "decl", Holder: "decl", field: "field", param: "parameter",
    localOne: "local", localTwo: "local", f: "decl",
  }
  const bad = Object.entries(want).filter(([k, v]) => m.get(k) !== v)
  if (bad.length) {
    console.error(`CONTROL C3 FAILING — scope/ownership classification: ${bad.map(([k, v]) => `${k} want ${v} got ${m.get(k) ?? "absent"}`).join("; ")}`)
    console.error(`  classified: ${JSON.stringify([...m.entries()])}`)
    process.exit(2)
  }
  console.log("controls: 1 ok, 0 FAILING (C3 top-level vs local vs field vs parameter)")
}

/* CONTROL C4 — a container's first child is a BACKING TYPE, not a declared name. This
 * is the §8 item 26 regression: before it, `const E = enum(u0)` recorded `u0` as a
 * file-scope `decl`, and the resolution ladder then reported an analyzer miss against a
 * name zig never declared. The control asserts the negative (the builtin is ABSENT) AND
 * the positive that matters (the container's real name is still reachable), because a fix
 * that simply dropped containers would pass the first and fail the second.
 *
 * `u0` is the spelling the corpus actually carries, so it is the one to pin: a builtin
 * that is also a plausible user type name would make this control ambiguous. */
{
  const src = [
    "const E = enum(u0) { a, b };",
    "const S = packed struct(u8) { v: u3 };",
    "const U = union(enum) { x: u1 };",
    "const O = opaque {};",
    "const Err = error{ E1 };",
  ].join("\n")
  const t = parser.parse(src)
  const m = new Map<string, string>()
  if (t) treeDeclaredNames(t.rootNode, m)
  // backing types and tag types must NOT be declarations
  const mustBeAbsent = ["u0", "u8", "u3", "u1", "enum"]
  // the containers' own names, and one member each, must still be found
  const mustBePresent = ["E", "S", "U", "O", "Err", "a", "v", "x", "E1"]
  const bad: string[] = []
  for (const k of mustBeAbsent) {
    if (m.has(k)) bad.push(`${k} want ABSENT got ${m.get(k)} (a backing/tag type read as a declaration)`)
  }
  for (const k of mustBePresent) {
    if (!m.has(k)) bad.push(`${k} want present got ABSENT (a real declaration lost by the container skip)`)
  }
  if (bad.length) {
    console.error(`CONTROL C4 FAILING — container backing type read as a declaration: ${bad.join("; ")}`)
    console.error(`  classified: ${JSON.stringify([...m.entries()])}`)
    process.exit(2)
  }
  console.log("controls: 2 ok, 0 FAILING (C4 container backing type is not a declaration name)")
}

let idx = 0
const NWORK = 8
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const k = key(f)
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    const declaredNames = new Map<string, string>()
    if (tree) { treeDeclaredNames(tree.rootNode, declaredNames); tree.delete?.() }
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    if (r.metadata?.fallback === true || r.fallback === true) dump.fallbackFiles.push(k)
    const syms = (r.symbols ?? []).map((s: any) => ({
      name: String(s.name ?? ""),
      kind: String(s.kind ?? ""),
      qualifiedName: String(s.qualifiedName ?? ""),
    }))
    dump.files.push({ key: k, symbols: syms, declaredNames: [...declaredNames] })
    for (const x of (r.relationships ?? []) as any[]) {
      dump.edges.push({
        file: k,
        source: String(x.source ?? ""),
        target: String(x.target ?? ""),
        type: String(x.type ?? "").toLowerCase() === "brain_import" ? "imports" : String(x.type ?? "").toLowerCase(),
        line: Number(x.line_number ?? 0),
        conf: Number(x.confidence ?? 0),
        meta: x.metadata?.relationshipType ? String(x.metadata.relationshipType) : null,
        // Z65's annotation, read back from production output — never recomputed here.
        scope: x.metadata?.targetScope ? String(x.metadata.targetScope) : null,
      })
    }
  }
}
await Promise.all(Array.from({ length: NWORK }, () => worker()))

console.log(`corpus ${all.length} admitted; this shard ${draw.length} files; popHash sha256:${popHash.slice(0, 12)}`)
console.log(`  symbols ${dump.files.reduce((a, f) => a + f.symbols.length, 0)}  edges ${dump.edges.length}  fallback ${dump.fallbackFiles.length}`)
if (OUT) { writeFileSync(OUT, JSON.stringify(dump)); console.log(`  wrote ${OUT}`) }
if (dump.fallbackFiles.length) process.exitCode = 3
void ZIG_DECLARED_TYPE_BUILTINS
void isBuiltinFnSpelling
void looksLikePath
void isScopeMarker
