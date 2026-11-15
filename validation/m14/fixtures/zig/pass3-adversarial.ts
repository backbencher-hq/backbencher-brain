/**
 * ZIG PASS-3 ADVERSARIAL AUDIT — the third reading of the same question.
 *
 * ## Why a third instrument, when pass 2 already ran one
 *
 * Pass 1 answered the six questions at the level "does the aggregate hold".
 * Pass 2 asked each emitted type for a case where its LABEL or its ENDPOINT is
 * wrong, and found four classes. Pass 3 does the only thing left to do to an
 * audit that has already found things: **assume the two earlier passes chose
 * their probes from the analyzer's own structure, and ask questions the
 * analyzer's structure does not suggest.**
 *
 * Every pass-2 probe (A1-A11) begins from a branch in `real-zig-analyzer.ts` —
 * from a reason code, a metadata key, an emission site. That is the right way
 * to find a bug in a rule you can see. It is the wrong way to find a bug in a
 * rule you cannot see, and there is one category of rule in this analyzer that
 * no reason code names: **the ones that decide what is NOT an edge.** Every
 * suppressor is a branch whose firing is invisible in the output, because the
 * output is the set of edges that survived it. A suppressor that fires when it
 * should not produces a MISSING edge, and a missing edge is invisible to every
 * count in the lane — a census counts what was published, so a loss reads as
 * the same number as a correct run.
 *
 * So pass 3 is built from LOSS probes and from SHAPE probes:
 *
 *   P1  `uses`        — an `error.X` leaf attributed to a symbol that is not an
 *                       error-set member anywhere in the file. (Labelled: the
 *                       reason code says `identifier_usage`, and the name it
 *                       publishes is a real declaration of the file — just not
 *                       of the kind `error.X` can name.)
 *   P2  `uses`        — a DESTRUCTURING declaration binds one slot and the
 *                       analyzer reads all of them as one. (Correct + Resolved:
 *                       a read of the local is published against the file-scope
 *                       declaration of the same name.)
 *   P3  `uses`        — the RECEIVER of a method call is a bare read, and the
 *                       callee-span suppressor swallows it. (Fires: a LOSS.)
 *   P4  `calls`/`uses`/`instantiates` — the SOURCE disagrees with the named
 *                       scope the recorded line actually sits in. (Correct.)
 *   P5  SYMBOLS       — the (kind, node-type) histogram. Nothing has ever asked
 *                       whether a published symbol's KIND matches the grammar
 *                       node it was read from; every label question so far was
 *                       asked about edges. (Labelled, at the symbol level.)
 *   P6  `instantiates` — a target that binds to a published symbol of a
 *                       NON-container kind. (Labelled: A4 asked whether the
 *                       target binds AT ALL; this asks what it binds to.)
 *   P7  `contains`    — does the tree say the named owner declares the named
 *                       member? (Correct. A5 asked whether the owner is
 *                       AMBIGUOUS; this asks whether it is simply wrong.)
 *   P8  `exports`     — is the target declared at FILE scope? (Labelled: Z20
 *                       says a container-member `pub` is not an export.)
 *   P9  COVERAGE      — tree sites per published edge, per class. The
 *                       deduplication key is `source->leaf`, so N sites of the
 *                       same name from one source are ONE edge. (Fires.)
 *
 * ## THE TWO RULES THIS FILE KEEPS FROM PASS 2
 *
 * 1. **NO COUNT WITHOUT A CONTROL.** A probe reporting 0 is indistinguishable
 *    from a probe that cannot see. Every predicate here is a pure function
 *    extracted so its controls are direct calls on synthetic strings/trees, and
 *    every control is asserted at run time — the script prints
 *    `controls: N ok, M FAILING` and exits non-zero on a failure.
 * 2. **ZERO-REGEX.** Word boundaries are character-code tests. The ontology
 *    gate's first version returned two false positives from text probes (a
 *    telnet IAC word list read as `class voice`, a heredoc read as `new Map(`),
 *    and this lane's own pass-2 instrument had to name four separate Zig
 *    spelling ambiguities before its line probes stopped inventing defects.
 *
 * ## Tree facts vs production facts
 *
 * Production facts (symbols, relationships) come from `parseFile` in
 * `src/ast/pool-worker.ts` and nothing else. Tree facts come from a SECOND
 * parse of the same bytes through the same pinned wasm. The paths are separate
 * on purpose — the question is asked of the analyzer's OUTPUT, and a tree
 * walked by the analyzer's own code would agree with it by construction.
 *
 * ## Sharding
 *
 * `--sample 0` is REQUIRED with `--files-from`. `SAMPLE` truncates the hashed
 * draw BEFORE the shard filter, so the default `--sample 400` silently caps a
 * 480-file shard at 400 files and prints a report that looks finished. (The
 * published usage string of the pass-1 census omitted this; the merge's union
 * -hash assertion catches it, which is why it was caught.) `shard-draw.py`
 * writes the shards, `pass3-merge.py` re-derives every ratio from summed
 * primitives and asserts the union hash.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/pass3-adversarial.ts [--sample 0]
 *     [--seed pass3-v1] [--out p] [--files-from p] [--raw p]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { stripZigQuoting } from "../../../../src/ast/real-zig-analyzer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "pass3-v1")
const OUT = arg("out", "")
const RAW = arg("raw", "")
const FILES_FROM = arg("files-from", "")
const WANT = FILES_FROM
  ? new Set(readFileSync(path.resolve(ROOT, FILES_FROM), "utf8").split("\n").map((x) => x.trim()).filter(Boolean))
  : null

// ────────────────────────────────────────────────── corpus walk (the census's own)
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
const LIMIT = 512 * 1024
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > LIMIT) continue } catch { continue }
    all.push({ repo: e, dir, rel, abs })
  }
}
const key = (f: FileRec) => `${f.repo}/${f.rel}`
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : -1))
  .map((x) => x.f)
let draw = SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
if (WANT) draw = draw.filter((f) => WANT.has(key(f)))
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ────────────────────────────────────────────────── the pinned grammar, tree side
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// ────────────────────────────────────────────────── zero-regex word test
const isIdChar = (c: string): boolean => {
  const k = c.charCodeAt(0)
  return (k >= 65 && k <= 90) || (k >= 97 && k <= 122) || (k >= 48 && k <= 57) || k === 95
}
/** Every whole-word occurrence of `name` in `line`, left to right. */
function occurrences(line: string, name: string): number[] {
  const out: number[] = []
  if (!name) return out
  let i = 0
  for (;;) {
    const at = line.indexOf(name, i)
    if (at === -1) return out
    const before = at > 0 ? line[at - 1] : " "
    const after = line[at + name.length] ?? " "
    if (!isIdChar(before) && !isIdChar(after)) out.push(at)
    i = at + 1
    if (i > line.length) return out
  }
}

// ────────────────────────────────────────────────── tree helpers (pure, testable)
const firstIdentifierChild = (n: Node): Node | null => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "identifier") return c
  }
  return null
}
/** The name a container declaration binds, read as the analyzer's own
 *  declaration surface states it: the first identifier of the
 *  `variable_declaration` the container is the right-hand side of. */
const containerBoundName = (n: Node): string | null => {
  const p = n.parent
  if (!p || p.type !== "variable_declaration") return null
  return firstIdentifierChild(p)?.text ?? null
}
/** The leftmost identifier of a dotted chain — the RECEIVER of a method call.
 *  `std.mem.copy` -> `std`; `b.method` -> `b`; a chain rooted at a call
 *  (`f().x`) has no receiver identifier and returns null. */
const chainBaseIdentifier = (n: Node): Node | null => {
  let cur: Node | null = n
  while (cur && cur.type === "field_expression") {
    const first = cur.namedChildCount > 0 ? cur.namedChild(0) : null
    if (!first) return null
    cur = first
  }
  return cur && cur.type === "identifier" ? cur : null
}
/** Is this declaration at FILE scope — nothing but containers between it and
 *  the root, and every container on the way also at file scope? A `fn` that is
 *  a member of a LOCAL container has no file-scope identity, which is the
 *  Z22 / C-negative contract, and the analyzer legitimately refuses to publish
 *  it and falls the edge's SOURCE back to `(global)`. P4 has to separate the
 *  two, or it convicts the analyzer on the fallback it documented. */
function atFileScope(n: Node): boolean {
  const CONTAINERS = new Set([
    "struct_declaration", "enum_declaration", "union_declaration",
    "opaque_declaration", "error_set_declaration",
  ])
  const EXEC = new Set(["function_declaration", "test_declaration", "comptime_declaration", "block"])
  let cur: Node | null = n.parent
  while (cur) {
    if (EXEC.has(cur.type)) return false
    if (CONTAINERS.has(cur.type)) {
      const binding = cur.parent
      if (!binding || binding.type !== "variable_declaration") return false
      let up: Node | null = binding.parent
      while (up) {
        if (EXEC.has(up.type) || CONTAINERS.has(up.type)) return false
        up = up.parent
      }
      return true
    }
    cur = cur.parent
  }
  return true
}

/** Named `function_declaration` / `test_declaration` scopes, as byte ranges.
 *  A test whose name is a STRING (`test "x" { }`) has no identifier child and
 *  therefore no name to attribute an edge to; it is not in this list, and P4
 *  treats its body as nameless. */
function namedScopes(root: Node): { name: string; start: number; end: number; fileScope: boolean }[] {
  const out: { name: string; start: number; end: number; fileScope: boolean }[] = []
  const walk = (n: Node): void => {
    if (n.type === "function_declaration" || n.type === "test_declaration") {
      const id = firstIdentifierChild(n)
      // The PUBLISHED name is quote-stripped (M60/Z18), so a quoted `fn @"a/b"`
      // reaches the edge source as `a/b`. Comparing the raw tree spelling to the
      // published one convicts the analyzer on 11 of 754 P4 rows in 40 files,
      // every one of them a quoted zls handler name.
      if (id) out.push({ name: stripZigQuoting(id.text), start: n.startIndex, end: n.endIndex, fileScope: atFileScope(n) })
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(root)
  return out
}
/** The outermost node starting at each byte offset — the declaration node a
 *  published symbol's `range.startIndex` was taken from. */
function indexByStart(root: Node): Map<number, Node> {
  const into = new Map<number, Node>()
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (!into.has(n.startIndex)) into.set(n.startIndex, n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return into
}
/** Members declared DIRECTLY inside a container declaration node.
 *
 *  Two shapes, and conflating them is what made the first draft of this probe
 *  report 15 phantom `contains` edges in 40 files:
 *   - an `error_set_declaration` IS the member list — its direct children are
 *     the member names (`error{ A, B }`), one `identifier` each;
 *   - a `struct`/`enum`/`union`/`opaque` declares its members as CHILDREN
 *     (`container_field`, a member `fn`, a `variable_declaration`).
 *  A member name is taken from the child's FIRST identifier child, except for
 *  an error set, where every direct identifier is a member. */
function directMembers(container: Node): Set<string> {
  const out = new Set<string>()
  // The PUBLISHED name is quote-stripped (M60/Z18), so `@"error"` reaches the
  // edge target as `error` and `@"1Monochrome"` as `1Monochrome`. Comparing the
  // raw tree spelling to the published one reported 1,501 phantom `contains`
  // edges in the first draft — every quoted member in the corpus.
  if (container.type === "error_set_declaration") {
    for (let j = 0; j < container.namedChildCount; j++) {
      const id = container.namedChild(j)
      if (id && id.type === "identifier") out.add(stripZigQuoting(id.text))
    }
    return out
  }
  for (let i = 0; i < container.namedChildCount; i++) {
    const c = container.namedChild(i)
    if (!c) continue
    if (c.type === "container_field" || c.type === "function_declaration" || c.type === "variable_declaration") {
      const id = firstIdentifierChild(c)
      if (id) out.add(stripZigQuoting(id.text))
    } else if (c.type === "error_set_declaration") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const id = c.namedChild(j)
        if (id && id.type === "identifier") out.add(stripZigQuoting(id.text))
      }
    }
  }
  return out
}
/** A file-scope `const X = @import("…")` binding. Zig models a module alias as
 *  a binding, and a module is NOT a value read: `std.mem.copy(...)` reads
 *  `copy`, not `std`. The receiver probe has to exclude these or it reports a
 *  loss for every method call in the corpus — 107 of its first 146 rows were
 *  `uses -> std`, and `std` is an import binding. */
function isImportBinding(decl: Node): boolean {
  const rhs = decl.childForFieldName?.("value") ?? decl.namedChild(decl.namedChildCount - 1)
  if (!rhs) return false
  const host = rhs.type === "builtin_function" || rhs.type === "call_expression" ? rhs : null
  if (!host) return false
  for (let i = 0; i < host.namedChildCount; i++) {
    const c = host.namedChild(i)
    if (c && (c.type === "import" || c.type === "builtin_identifier" || c.type === "identifier")) {
      if (c.text === "@import" || c.text === "@cImport" || c.text === "import" || c.text === "cImport") return true
    }
  }
  return false
}
/** What KIND of thing a file-scope declaration binds, read off its RHS shape:
 *  `import` (a module alias — not a value read), `alias` (a re-export of
 *  another module's member, `const testing = std.testing;` — indistinguishable
 *  from a value by NAME, so a receiver probe must discount it rather than
 *  convict on it), or `value` (everything else, where a receiver read is a
 *  real read the analyzer should have published). */
function declRhsKind(decl: Node): "import" | "alias" | "value" {
  if (isImportBinding(decl)) return "import"
  const rhs = decl.childForFieldName?.("value") ?? decl.namedChild(decl.namedChildCount - 1)
  if (!rhs) return "value"
  if (rhs.type === "field_expression") {
    // `math.complex` — a qualified path. If its base is an import binding it is
    // a module alias; the tree cannot know what `math` binds to, so the honest
    // answer for a receiver probe is "alias, discount it".
    return "alias"
  }
  return "value"
}

/**
 * Is this identifier occurrence a DEFINING one rather than a read?
 *
 * THIS MIRRORS the analyzer's published rule, and the mirror is the point: P2's
 * question is "given the rule the analyzer states, does the published edge name
 * the wrong entity?". The independent half of the probe is the corpus side —
 * which names collide, and where a read of the shadowed slot occurs — read from
 * a second parse the analyzer never sees. Stated here rather than borrowed so
 * that a change to the analyzer's rule shows up as a probe disagreement instead
 * of being silently inherited.
 *
 * The subtlety that made the first draft of P2 report 0 on a defect it was
 * built to find: in tree-sitter-zig an ASSIGNMENT is a `variable_declaration`
 * too (ZGD1), so `_ = c` puts the read `c` under a `variable_declaration` parent
 * and a naive "skip identifiers under a variable_declaration" filter discards
 * the very read it is looking for. A `const`/`var` declaration BINDS and its
 * right-hand side READS; a plain `=` WRITES its first child.
 */
function isDefiningIdentifier(n: Node): boolean {
  const p = n.parent
  if (!p) return false
  if (p.type === "variable_declaration") {
    if (hasBindingKeyword(p)) return false
    const lhs = p.namedChildCount > 0 ? p.namedChild(0) : null
    return !!lhs && lhs.id === n.id
  }
  if (p.type === "error_set_declaration") return true
  if (
    p.type === "function_declaration" || p.type === "test_declaration" ||
    p.type === "container_field" || p.type === "struct_declaration" ||
    p.type === "enum_declaration" || p.type === "union_declaration" ||
    p.type === "opaque_declaration"
  ) {
    const id = firstIdentifierChild(p)
    return !!id && id.id === n.id
  }
  return false
}

/** The BINDING SLOTS of a destructuring declaration.
 *
 * Getting this discriminator right took two corrections, and each wrong version
 * manufactured a defect class out of correct code — which is the pass-3
 * instrument's own version of the mistake this lane's history records six times
 * (a name rule applied on one side of a comparison and not the other):
 *
 *  1. "two or more direct `identifier` children" convicts the analyzer of 128
 *     wrong edges in 40 files. `pub const Error = IteratorError;` has two: the
 *     bound name and the right-hand-side READ, and that read is published
 *     correctly.
 *  2. "identifiers before the `=`" convicts it of 38, all in
 *     `zig/lib/std/c.zig`, where `var dummy_execute_header: mach_hdr = undefined;`
 *     puts the TYPE between the name and the `=`.
 *
 * The shape that is actually a destructuring — `const a, const c = .{1,2}` and
 * `x, const y: u64 = .{1,2,3}` — has a COMMA between its slots before the `=`.
 * An ordinary declaration never does, whatever its type annotation looks like. */
function bindingSlots(decl: Node): Node[] {
  const out: Node[] = []
  let sawComma = false
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i)
    if (!c) continue
    if (!c.isNamed && c.type === "=") break
    if (!c.isNamed && c.type === ",") { sawComma = true; continue }
    if (c.isNamed && c.type === "identifier") out.push(c)
  }
  return sawComma ? out : []
}

/** `const`/`var` as an AST token, never as source text — the analyzer's own
 *  `hasToken` rule. A destructuring declaration is ONE `variable_declaration`
 *  carrying SEVERAL identifier children, and the discriminator is the keyword:
 *  `a, const c = .{1,2}` has two, `_ = c` also has two (`_` and `c`), and only
 *  the first is a binding site. */
function hasBindingKeyword(decl: Node): boolean {
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i)
    if (c && !c.isNamed && (c.type === "const" || c.type === "var")) return true
  }
  return false
}

/** P4's predicate, as a pure function: is a recorded LINE inside any named
 *  scope carrying `name`? An empty `scopes` and a null `name` both mean the
 *  question is not answerable, which the caller reads as "consistent". */
function lineInsideNamedScope(
  lineStart: number, lineEnd: number,
  scopes: { name: string; start: number; end: number; fileScope?: boolean }[],
  name: string | null,
): boolean | null {
  if (name === null) return null
  for (const s of scopes) {
    if (s.name !== name) continue
    if (lineStart < s.end && lineEnd > s.start) return true
  }
  return false
}

// ────────────────────────────────────────────────── CONTROLS
// Every predicate above is exercised on a synthetic before the corpus is
// touched. A control that cannot fail is not a control.
type Control = { name: string; ok: boolean; detail: string }
const controls: Control[] = []
const check = (name: string, ok: boolean, detail: string): void => { controls.push({ name, ok, detail }) }

/** `const a, const c = .{1,2}` is ONE `variable_declaration` with TWO binding
 *  slots. The analyzer binds the FIRST identifier child and breaks; the second
 *  slot is never bound, so a read of it resolves outward to the file-scope
 *  declaration of the same name. The collision is deliberately on the SECOND
 *  slot — a control that collides on the first proves nothing, because the
 *  first slot IS bound. */
const CTRL_DESTRUCTURE = `const c = 1;
fn f() void {
    const a, const c = .{ 1, 2 };
    _ = c;
}
`
const CTRL_PLAIN = `fn f() void {
    const c = 1;
    _ = c;
}
`
const CTRL_METHOD = `const recv = 1;
fn f() void {
    recv.method();
}
`
/** The spelling collision P1 exists to catch: a file-scope CONSTANT named
 *  `Foo` and an error-set leaf `error.Foo`. Zig resolves an error leaf BY NAME
 *  (the error namespace is global), so the analyzer's gate
 *  `fileValues.has(name) || (inError && enumMemberNames.has(name))` admits the
 *  read on the strength of the CONSTANT alone — and the published edge points at
 *  the constant. */
const CTRL_ERROR_LEAF = `const Foo = 1;
fn f() !void {
    return error.Foo;
}
`
const CTRL_ERROR_MEMBER = `const E = error{ Foo };
fn f() !void {
    return error.Foo;
}
`

/** RETAINED TREES. `parser.parse(src).rootNode` on its own drops the `Tree`
 *  that owns the node, and every later read of that node is a read of freed
 *  memory — which is exactly how this file's first draft crashed three lines
 *  into its controls with `Cannot read properties of undefined (reading
 *  'type')`, in three different places, on inputs that parse fine in
 *  isolation. The main loop keeps its `tree` in a local for the same reason. */
const KEPT: unknown[] = []
const parseCtrl = (src: string): Node => {
  const t = parser.parse(src)
  KEPT.push(t)
  return t.rootNode
}

// P2 control — the destructuring shape must be visible on the tree.
{
  const r = parseCtrl(CTRL_DESTRUCTURE)
  let multi = 0
  let plain = 0
  const walk = (n: Node): void => {
    if (n.type === "variable_declaration" && hasBindingKeyword(n) && bindingSlots(n).length >= 2) multi++
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(r)
  const r2 = parseCtrl(CTRL_PLAIN)
  const walk2 = (n: Node): void => {
    if (n.type === "variable_declaration") {
      let ids = 0
      for (let i = 0; i < n.namedChildCount; i++) if (n.namedChild(i)?.type === "identifier") ids++
      if (ids >= 2) plain++
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk2(r2)
  check("P2-tree-sees-multi-slot-destructuring", multi === 1, `saw ${multi} (want 1)`)
  check("P2-tree-plain-declaration-is-not-destructuring", plain === 0, `saw ${plain} (want 0)`)
  // `pub const Error = IteratorError;` has TWO direct identifier children and is
  // NOT a destructuring: the second is the right-hand-side READ. The first draft
  // of this probe counted it as a second binding slot and reported 128 wrong
  // edges in 40 files that are entirely correct.
  const typedDecl = (() => {
    let f: Node | null = null
    const w = (n: Node): void => { if (n.type === "variable_declaration" && hasBindingKeyword(n)) f = n; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) w(c) } }
    w(parseCtrl("var dummy_execute_header: mach_hdr = undefined;\n"))
    return f
  })()
  check("P2-a-typed-declaration-is-not-a-destructuring", typedDecl !== null && bindingSlots(typedDecl).length === 0,
    `slots=${typedDecl ? bindingSlots(typedDecl).length : "no-decl"} (want 0)`)
  const aliasDecl = (() => {
    let f: Node | null = null
    const w = (n: Node): void => { if (n.type === "variable_declaration" && hasBindingKeyword(n)) f = n; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) w(c) } }
    w(parseCtrl("pub const Error = IteratorError;\n"))
    return f
  })()
  check("P2-an-alias-declaration-is-not-a-destructuring", aliasDecl !== null && bindingSlots(aliasDecl).length === 0,
    `slots=${aliasDecl ? bindingSlots(aliasDecl).length : "no-decl"} (want 0)`)
}
// P3 control — the receiver of a method call is reachable from the callee.
{
  /** First node of `type` in document order, or null. */
  const firstOfType = (root: Node | null, type: string): Node | null => {
    if (!root) return null
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (!n) continue
      if (n.type === type) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }
  const methodCallee = firstOfType(parseCtrl(CTRL_METHOD), "call_expression")
  const base = methodCallee && methodCallee.namedChildCount > 0 ? chainBaseIdentifier(methodCallee.namedChild(0)!) : null
  check("P3-receiver-of-method-call-is-found", base?.text === "recv", `base=${base?.text}`)

  const chainedCallee = firstOfType(parseCtrl("fn g() void { std.mem.copy(u8, a, b); }"), "call_expression")
  const chained = chainedCallee && chainedCallee.namedChildCount > 0 ? chainBaseIdentifier(chainedCallee.namedChild(0)!) : null
  check("P3-chained-receiver-is-the-leftmost", chained?.text === "std", `base=${chained?.text}`)

  const rootedCallee = firstOfType(parseCtrl("fn g() void { f().x(); }"), "call_expression")
  const rooted = rootedCallee && rootedCallee.namedChildCount > 0 ? chainBaseIdentifier(rootedCallee.namedChild(0)!) : null
  check("P3-chain-rooted-at-a-call-has-no-receiver-identifier", rooted === null, `got ${rooted?.text}`)
}
// P4 control — the predicate can both convict and clear.
{
  const r = parseCtrl("fn alpha() void {\n  helper();\n}\nconst AFTER = 1;\n")
  const sc = namedScopes(r)
  const l0 = r.text.indexOf("helper")
  const inside = lineInsideNamedScope(l0, l0 + 6, sc, "alpha")
  const wrongName = lineInsideNamedScope(l0, l0 + 6, sc, "beta")
  const afterAt = r.text.indexOf("const AFTER")
  const fileLevel = lineInsideNamedScope(afterAt, afterAt + 5, sc, "alpha")
  check("P4-inside-the-named-scope-reads-true", inside === true, `got ${inside}`)
  check("P4-a-different-name-reads-false", wrongName === false, `got ${wrongName}`)
  check("P4-outside-the-scope-reads-false", fileLevel === false, `got ${fileLevel} at byte ${afterAt}`)
  check("P4-a-null-name-is-not-answerable", lineInsideNamedScope(l0, l0 + 6, sc, null) === null, "want null")
}
// P7 control — directMembers reads the members of a container and nothing else.
{
  const r = parseCtrl("const S = struct { x: u32, y: u32 };\nfn S2() void {}\n")
  let members: Set<string> | null = null
  const walk = (n: Node): void => {
    if (n.type === "struct_declaration" && members === null) members = directMembers(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(r)
  check("P7-direct-members-of-a-struct", members !== null && members.has("x") && members.has("y") && members.size === 2,
    `members=${members ? [...members].join(",") : "none"}`)
  let errMembers: Set<string> | null = null
  const walk2 = (n: Node): void => {
    if (n.type === "error_set_declaration" && errMembers === null) errMembers = directMembers(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk2(c) }
  }
  walk2(parseCtrl("const E = error{ Foo, Bar };\n"))
  check("P7-direct-members-of-an-error-set", errMembers !== null && errMembers.has("Foo") && errMembers.has("Bar") && errMembers.size === 2,
    `members=${errMembers ? [...errMembers].join(",") : "none"}`)
}
// P1 control — the error-leaf text is a distinct shape from a plain bare read,
// and the corpus predicate keys on it rather than on a substring.
{
  check("P1-error-leaf-shape-is-distinguishable",
    occurrences("return error.Foo;", "Foo").length === 1 && occurrences("return Foo;", "Foo").length === 1,
    "both spellings locate the name once; P1 additionally requires the error_type parent")
}

// ────────────────────────────────────────────────── per-file tallies
const MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(module)", "(package)"])
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

type P3 = {
  filesParsed: number
  parseFailures: number
  filesWithParseErrMarker: string[]
  /** Files whose production `parseFile` result carries `fallback: true` — the
   *  regex `extractFallback` path in shared machinery. This is the SELF-
   *  CERTIFYING detector for the corruption pass 3 measured: `Language.load`
   *  is handed a truncated wasm buffer, the throw is caught in
   *  `pool-worker.parseFile`, and a file's real graph is silently replaced by
   *  regex-derived symbols with NO kind and edges at confidence 0.4/0.5. A
   *  shard that reports a non-zero here has NOT measured the analyzer, and the
   *  merge refuses to add it. Measured on the same draw at the same commit:
   *  6 of 32 shard-runs degraded, in four runs of 0, 1, 2 and 3 shards. */
  fallbackFiles: number
  // P1
  p1: { errorLeafUses: number; filesWithP1: number; notAnErrorMember: number; examples: string[]; kindHistogram: Record<string, number> }
  // P2
  p2: { destructuringDecls: number; nonFirstSlots: number; collidingSlots: number; publishedFileScopeRead: number; localReadAfterBinding: number; examples: string[] }
  // P3
  p3: { methodCalls: number; receivers: number; receiversNamingFileScopeValue: number; lostReads: number; lostReadsOnAliasReceivers: number; examples: string[] }
  // P4
  p4: { checked: number; globalSourceInsideNamedScope: number; globalSourceInsideLocalScope: number; namedSourceOutsideItself: number; examples: string[] }
  // P5
  p5: { symbols: number; mappedToNode: number; unmapped: number; zeroStartIndex: number; startIndexCollisions: number; kindByNodeType: Record<string, number>; unmappedExamples: string[] }
  // P6
  p6: { checked: number; targetBindsToNonContainer: number; targetBindsToNothing: number; examples: string[]; wrongKindExamples: string[] }
  // P7
  p7: { checked: number; ownerDeclaresNoSuchMember: number; ownerUnknown: number; examples: string[] }
  // P8
  p8: { checked: number; targetDeclaredInsideAContainer: number; targetNotDeclaredInFile: number; examples: string[] }
  // P9
  p9: { callSites: number; callsEdges: number; fieldSites: number; usesFieldEdges: number; bareReadSites: number; usesBareEdges: number; structInitSites: number; instantiatesEdges: number; declaredTypeSites: number; referencesDeclaredTypeEdges: number }
}

const zero = (): P3 => ({
  filesParsed: 0, parseFailures: 0, filesWithParseErrMarker: [], fallbackFiles: 0,
  p1: { errorLeafUses: 0, filesWithP1: 0, notAnErrorMember: 0, examples: [], kindHistogram: {} },
  p2: { destructuringDecls: 0, nonFirstSlots: 0, collidingSlots: 0, publishedFileScopeRead: 0, localReadAfterBinding: 0, examples: [] },
  p3: { methodCalls: 0, receivers: 0, receiversNamingFileScopeValue: 0, lostReads: 0, lostReadsOnAliasReceivers: 0, examples: [] },
  p4: { checked: 0, globalSourceInsideNamedScope: 0, globalSourceInsideLocalScope: 0, namedSourceOutsideItself: 0, examples: [] },
  p5: { symbols: 0, mappedToNode: 0, unmapped: 0, zeroStartIndex: 0, startIndexCollisions: 0, kindByNodeType: {}, unmappedExamples: [] },
  p6: { checked: 0, targetBindsToNonContainer: 0, targetBindsToNothing: 0, examples: [], wrongKindExamples: [] },
  p7: { checked: 0, ownerDeclaresNoSuchMember: 0, ownerUnknown: 0, examples: [] },
  p8: { checked: 0, targetDeclaredInsideAContainer: 0, targetNotDeclaredInFile: 0, examples: [] },
  p9: { callSites: 0, callsEdges: 0, fieldSites: 0, usesFieldEdges: 0, bareReadSites: 0, usesBareEdges: 0, structInitSites: 0, instantiatesEdges: 0, declaredTypeSites: 0, referencesDeclaredTypeEdges: 0 },
})
const T = zero()

const addExample = (arr: string[], s: string, cap = 12): void => { if (arr.length < cap) arr.push(s) }

// The file-scope VALUE names the bare-read pass resolves against: a Constant,
// Variable, Function or EnumMember with no owner. Mirrors the published rule,
// because the probe's QUESTION is "did the analyzer publish the edge it should
// have published", and that question is only meaningful against the rule the
// analyzer states.
const fileValueNames = (symbols: any[]): Set<string> => {
  const out = new Set<string>()
  for (const s of symbols) {
    if (!s.ownerName && ["constant", "variable", "function", "enum_member"].includes(String(s.kind))) out.add(String(s.name))
  }
  return out
}
const CONTAINER_KINDS = new Set(["struct", "enum", "union", "type"])

/** The whole per-file probe, as a function of (relKey, source, symbols,
 *  relationships), so the SAME code runs on the corpus and on the synthetic
 *  end-to-end controls below. A control that exercises a different code path
 *  than the measurement certifies nothing about the measurement. */
const probeFile = (relKey: string, src: string, symbols: any[], rels: any[]): void => {
  const tree = parser.parse(src)
const root = tree.rootNode
const fileValues = fileValueNames(symbols)
/** name -> what the file-scope declaration of that name binds. */
const fileScopeDeclKind = new Map<string, "import" | "alias" | "value">()
const lineOf = (n: Node): number => n.startPosition.row + 1
const lineStarts = (() => {
  const out = [0]
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) out.push(i + 1)
  return out
})()
const bytesOfLine = (ln: number): [number, number] => {
  const a = lineStarts[ln - 1] ?? 0
  const b = ln < lineStarts.length ? lineStarts[ln] : src.length
  return [a, b]
}
const lines = src.split("\n")

const uses = rels.filter((r) => String(r.type) === "uses")
const calls = rels.filter((r) => String(r.type) === "calls")
const contains = rels.filter((r) => String(r.type) === "contains")
const exports = rels.filter((r) => String(r.type) === "exports")
const instants = rels.filter((r) => String(r.type) === "instantiates")
const refs = rels.filter((r) => String(r.type) === "references")
const usesTargets = new Set(uses.map((r) => String(r.target)))

// tree facts collected in one walk
const scopes = namedScopes(root)
const byStart = indexByStart(root)
const startSeen = new Set<number>()
const containersByName = new Map<string, Node[]>()
const errorMemberNames = new Set<string>()
const symbolKindsByName = new Map<string, Set<string>>()
for (const s of symbols) {
  const n = String(s.name)
  const set = symbolKindsByName.get(n) ?? new Set<string>()
  set.add(String(s.kind))
  symbolKindsByName.set(n, set)
}
let errorLeafNodes: Node[] = []
let destructureDecls: Node[] = []
let callSites = 0
let fieldSites = 0
let bareReadSites = 0
let structInitSites = 0
let declaredTypeSites = 0
const receivers: { name: string; node: Node }[] = []

const walk = (n: Node): void => {
  const t = n.type
  if (t === "variable_declaration" && hasBindingKeyword(n)) {
    const id = firstIdentifierChild(n)
    if (id) {
      const kind = declRhsKind(n)
      fileScopeDeclKind.set(id.text, kind)
      // A module alias is a binding, not a value read: `std.mem.copy(…)` reads
      // `copy`. Counting it as a file-scope VALUE makes every method call in the
      // corpus look like a lost read — 107 of 146 rows in the first draft.
      if (kind === "import") fileValues.delete(id.text)
    }
  }
  if (t === "variable_declaration" && hasBindingKeyword(n)) {
    if (bindingSlots(n).length >= 2) destructureDecls.push(n)
  }
  if (t === "struct_declaration" || t === "enum_declaration" || t === "union_declaration" ||
      t === "opaque_declaration" || t === "error_set_declaration") {
    const nm = containerBoundName(n)
    if (nm) {
      const arr = containersByName.get(nm) ?? []
      arr.push(n)
      containersByName.set(nm, arr)
    }
    if (t === "error_set_declaration") for (const m of directMembers(n)) errorMemberNames.add(m)
  }
  if (t === "error_type") {
    const last = n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null
    if (last && last.type === "identifier") errorLeafNodes.push(last)
  }
  if (t === "call_expression") {
    const callee = n.namedChildCount > 0 ? n.namedChild(0) : null
    if (callee) {
      if (callee.type === "identifier") {
        if (callee.text !== "usingnamespace" && !callee.text.startsWith("@")) callSites++
      } else if (callee.type === "field_expression") {
        callSites++
        const base = chainBaseIdentifier(callee)
        if (base) receivers.push({ name: base.text, node: base })
      }
    }
  }
  if (t === "field_expression") {
    const last = n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null
    if (last && last.type === "identifier") fieldSites++
  }
  if (t === "identifier") {
    const p = n.parent
    if (p && p.type !== "field_expression" && p.type !== "variable_declaration" &&
        p.type !== "function_declaration" && p.type !== "test_declaration" &&
        p.type !== "container_field" && p.type !== "error_set_declaration" &&
        p.type !== "parameter") bareReadSites++
  }
  if (t === "struct_initializer") structInitSites++
  const tf = n.childForFieldName?.("type")
  if (tf && (t === "container_field" || t === "variable_declaration" || t === "function_declaration")) {
    if (tf.type !== "builtin_type") declaredTypeSites++
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
}
walk(root)

// ── P1: an `error.X` read attributed to a symbol that is not an error member
if (errorLeafNodes.length > 0) {
  const errNames = new Set(errorLeafNodes.map((n) => n.text))
  const cand = uses.filter((r) => String(r.metadata?.relationshipType) === "identifier_usage" &&
    errNames.has(String(r.target)) && fileValues.has(String(r.target)))
  T.p1.errorLeafUses += cand.length
  if (cand.length > 0) T.p1.filesWithP1++
  for (const r of cand) {
    const kinds = symbolKindsByName.get(String(r.target)) ?? new Set<string>()
    for (const k of kinds) T.p1.kindHistogram[k] = (T.p1.kindHistogram[k] ?? 0) + 1
    if (!errorMemberNames.has(String(r.target)) && kinds.size > 0) {
      T.p1.notAnErrorMember++
      addExample(T.p1.examples, `uses ${r.source} -> ${r.target} @ ${relKey}:${r.line_number ?? "?"} [kinds: ${[...kinds].join("/")}]`)
    }
  }
}

// ── P2: a destructuring declaration binds ONE slot; the rest read as file scope
for (const d of destructureDecls) {
  T.p2.destructuringDecls++
  const ids: Node[] = bindingSlots(d)
  // the FIRST identifier is the slot the analyzer binds; the rest are shadowed slots
  const enclosing = scopes.find((s) => d.startIndex >= s.start && d.endIndex <= s.end)
  for (let i = 1; i < ids.length; i++) {
    T.p2.nonFirstSlots++
    const nm = ids[i].text
    if (!fileValues.has(nm)) continue
    T.p2.collidingSlots++
    const wantSrc = enclosing ? enclosing.name : "(global)"
    const published = uses.some((r) => String(r.metadata?.relationshipType) === "identifier_usage" &&
      String(r.target) === nm && String(r.source) === wantSrc)
    if (published) {
      T.p2.publishedFileScopeRead++
      // Is there a bare read of the name inside the same named scope, after
      // the binding? That is what makes the published edge wrong rather than
      // merely ambiguous: the scope demonstrably reads the LOCAL, and the
      // edge says it read the file-scope declaration.
      let after = false
      const w2 = (n: Node): void => {
        if (after) return
        // `isDefiningIdentifier`, not a parent-type filter: in tree-sitter-zig an
        // ASSIGNMENT is a `variable_declaration`, so `_ = c` puts the read under
        // exactly the node type a naive filter uses to skip declarations — and
        // that filter discards the read this probe exists to find.
        if (n.startIndex > d.endIndex && n.type === "identifier" && n.text === nm &&
            !isDefiningIdentifier(n) && n.parent?.type !== "field_expression") {
          const inScope = enclosing ? (n.startIndex >= enclosing.start && n.endIndex <= enclosing.end) : true
          if (inScope) after = true
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) w2(c) }
      }
      w2(root)
      if (after) {
        T.p2.localReadAfterBinding++
        addExample(T.p2.examples, `uses ${wantSrc} -> ${nm} @ ${relKey}:${lineOf(d)} [destructure binds only slot 1; slot ${i + 1} read after]`)
      }
    }
  }
}

// ── P3: the receiver of a method call is a bare read the suppressor eats
T.p3.methodCalls += receivers.length
for (const rcv of receivers) {
  T.p3.receivers++
  if (!fileValues.has(rcv.name)) continue
  T.p3.receiversNamingFileScopeValue++
  if (usesTargets.has(rcv.name)) continue
  const bindKind = fileScopeDeclKind.get(rcv.name) ?? "value"
  if (bindKind === "alias") {
    // `const cmath = math.complex;` then `cmath.cosh(p)`. A qualified-path
    // alias is indistinguishable from a value by name, so the loss is
    // AMBIGUOUS and is counted apart rather than charged to the analyzer.
    T.p3.lostReadsOnAliasReceivers++
    addExample(T.p3.examples, `[ambiguous] no uses -> ${rcv.name} @ ${relKey}:${lineOf(rcv.node)} (receiver of a method call; the binding is a qualified-path alias)`)
    continue
  }
  T.p3.lostReads++
  addExample(T.p3.examples, `lost uses -> ${rcv.name} @ ${relKey}:${lineOf(rcv.node)} (receiver of a method call; the binding is a value)`)
}

// ── P4: the source disagrees with the named scope the line sits in
for (const r of [...calls, ...uses, ...instants]) {
  const src2 = String(r.source ?? "")
  const ln = Number(r.line_number ?? 0)
  if (ln <= 0) continue
  const [a, b] = bytesOfLine(ln)
  if (src2 === "(global)") {
    T.p4.checked++
    // `(global)` is the marker this lane uses for work outside any named
    // scope. A call or read whose line sits inside one is attributed to a
    // scope the analyzer declined to publish — which is Z59's documented
    // fallback only when the enclosing scope is UNPUBLISHED, and a wrong
    // attribution in every other case. A5/A10 measured the name-keyed form
    // of the same question; this is the position-keyed form.
    const enclosing = scopes.filter((s) => a < s.end && b > s.start)
    if (enclosing.length > 0) {
      if (enclosing.some((s) => s.fileScope)) {
        T.p4.globalSourceInsideNamedScope++
        addExample(T.p4.examples, `calls/uses (global) -> ${r.target} @ ${relKey}:${ln} [inside FILE-SCOPE scope ${enclosing.filter((s) => s.fileScope).map((s) => s.name).join("/")}]`)
      } else {
        T.p4.globalSourceInsideLocalScope++
        addExample(T.p4.examples, `calls/uses (global) -> ${r.target} @ ${relKey}:${ln} [inside UNPUBLISHED local scope ${enclosing.map((s) => s.name).join("/")} — Z59 fallback]`)
      }
    }
  } else if (!MARKERS.has(src2)) {
    T.p4.checked++
    const inside = lineInsideNamedScope(a, b, scopes, src2)
    if (inside === false) {
      T.p4.namedSourceOutsideItself++
      addExample(T.p4.examples, `calls/uses ${src2} -> ${r.target} @ ${relKey}:${ln} [line is outside every scope named ${src2}]`)
    }
  }
}

// ── P5: does a symbol's KIND match the grammar node it was read from
for (const s of symbols) {
  T.p5.symbols++
  // The PRODUCTION shape is flat: pool-worker hands back `startIndex` on the
  // symbol, not the `range: {…}` object the TypeScript interface declares.
  // Reading `s.range.startIndex` unmaps 100% of symbols and the probe reports
  // "0 of N mapped" for a corpus it mapped perfectly.
  const si = Number(s.startIndex ?? s.range?.startIndex ?? -1)
  if (si < 0) { T.p5.unmapped++; continue }
  // A symbol whose production `startIndex` is 0 maps onto the FILE ROOT, so its
  // (kind, node-type) pair is uninformative — the root is not a declaration form.
  // These are the IMPORT BINDINGS: shared machinery rewrites their range to
  // startIndex 0 / startLine 1 / endLine 1 with UNDEFINED columns, verified
  // directly on `zig/lib/std/c.zig` (`constant "std"`, `constant "builtin"`).
  // Counted apart rather than left to masquerade as a declaration mapping.
  if (si === 0) T.p5.zeroStartIndex++
  if (startSeen.has(si)) T.p5.startIndexCollisions++
  startSeen.add(si)
  const node = byStart.get(si)
  if (!node) {
    T.p5.unmapped++
    addExample(T.p5.unmappedExamples, `${s.kind} ${s.name} @ ${relKey}:${s.startLine ?? s.range?.startLine} (no tree node at byte ${si})`)
    continue
  }
  T.p5.mappedToNode++
  const k = `${s.kind} <- ${node.type}`
  T.p5.kindByNodeType[k] = (T.p5.kindByNodeType[k] ?? 0) + 1
}

// ── P6: does an `instantiates` target bind to the kind the edge claims
//
// The two forms have DIFFERENT correct targets and asking one question of both
// convicts the analyzer on every generic application: `Once(u8)` instantiates
// the GENERIC FUNCTION `Once`, whose published kind is `function`, not a
// container. 6 of 7 rows in the first draft were exactly that. So the probe
// splits on the edge's own reason code — `isGenericTypeApplication` wants a
// function, `isConstructorApplication` wants a container.
for (const r of instants) {
  T.p6.checked++
  const generic = r.metadata?.isGenericTypeApplication === true
  const kinds = symbolKindsByName.get(String(r.target))
  if (!kinds || kinds.size === 0) {
    T.p6.targetBindsToNothing++
    addExample(T.p6.examples, `instantiates ${r.source} -> ${r.target} @ ${relKey}:${r.line_number ?? "?"} [binds to nothing published]`)
    continue
  }
  const ok = generic ? [...kinds].some((k) => k === "function" || k === "method") : [...kinds].some((k) => CONTAINER_KINDS.has(k))
  if (!ok) {
    T.p6.targetBindsToNonContainer++
    // Its OWN bucket. The unbound arm is 60x larger and shares the cap, so the
    // rarer rows land past it and become unnameable — which is how 10 rows were
    // counted with zero examples until the buckets were split.
    addExample(T.p6.wrongKindExamples, `instantiates ${r.source} -> ${r.target} @ ${relKey}:${r.line_number ?? "?"} [${generic ? "generic application" : "construction"}; kinds: ${[...kinds].join("/")}]`)
  }
}

// ── P7: does the tree say the owner declares the member
for (const r of contains) {
  T.p7.checked++
  const owner = String(r.source ?? "")
  const member = String(r.target ?? "")
  const cs = containersByName.get(owner)
  if (!cs || cs.length === 0) { T.p7.ownerUnknown++; continue }
  const anyDeclares = cs.some((c) => directMembers(c).has(member))
  if (!anyDeclares) {
    T.p7.ownerDeclaresNoSuchMember++
    addExample(T.p7.examples, `contains ${owner} -> ${member} @ ${relKey}:${r.line_number ?? "?"} [no container named ${owner} declares ${member}]`)
  }
}

// ── P8: is an `exports` target declared at file scope
for (const r of exports) {
  T.p8.checked++
  const nm = String(r.target ?? "")
  const ln = Number(r.line_number ?? 0)
  // Match the DECLARATION the edge names, by its OWN line: `emitZigExportEdges`
  // takes the line from the exported entity's own range. Asking "does ANY symbol
  // of this name carry an ownerName" instead convicts the analyzer on every
  // name collision — `zig/lib/std/debug/SelfInfo/Windows.zig` exports a
  // FILE-SCOPE `init` at line 5 and also contains
  // `const UnwindContext = struct { pub fn init(…) }` at line 74.
  const atLine = ln > 0 ? symbols.filter((s) => String(s.name) === nm && Number(s.startLine ?? -1) === ln) : []
  if (atLine.length === 0) {
    T.p8.targetNotDeclaredInFile++
    addExample(T.p8.examples, `exports (file) -> ${nm} @ ${relKey}:${ln} [no published symbol at that line]`)
    continue
  }
  if (atLine.some((s) => s.ownerName)) {
    T.p8.targetDeclaredInsideAContainer++
    addExample(T.p8.examples, `exports (file) -> ${nm} @ ${relKey}:${ln} [the declaration at that line carries ownerName ${atLine[0].ownerName}]`)
  }
}

// ── P9: tree sites vs published edges (the deduplication key is source->leaf)
T.p9.callSites += callSites
T.p9.callsEdges += calls.length
T.p9.fieldSites += fieldSites
T.p9.usesFieldEdges += uses.filter((r) => String(r.metadata?.relationshipType) === "zig_field_access").length
T.p9.bareReadSites += bareReadSites
T.p9.usesBareEdges += uses.filter((r) => String(r.metadata?.relationshipType) === "identifier_usage").length
T.p9.structInitSites += structInitSites
T.p9.instantiatesEdges += instants.length
T.p9.declaredTypeSites += declaredTypeSites
T.p9.referencesDeclaredTypeEdges += refs.filter((r) => String(r.metadata?.relationshipType) === "declared_type").length

  try { tree.delete() } catch {}
}

/** A snapshot/delta pair so a control can be asserted without polluting the
 *  corpus tally. */
const snapshot = (): any => JSON.parse(JSON.stringify(T))
const since = (before: any): any => {
  const d: any = {}
  for (const k of ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]) {
    d[k] = {}
    for (const kk of Object.keys((T as any)[k])) {
      if (typeof (T as any)[k][kk] === "number") d[k][kk] = (T as any)[k][kk] - (before[k][kk] ?? 0)
    }
  }
  return d
}

// ────────────────────────────────────────────────── the corpus driver
let fileIndex = 0
for (const f of draw) {
  let res: any
  try {
    res = await parseFile(f.abs, f.dir)
  } catch {
    T.parseFailures++
    continue
  }
  T.filesParsed++
  if (res?.fallback === true) {
    T.fallbackFiles++
    addExample(T.filesWithParseErrMarker, `${relKey} [parseFile returned fallback: true — regex extraction, not the analyzer]`, 24)
  }
  const symbols: any[] = res?.symbols ?? []
  const rels: any[] = res?.relationships ?? []
  if (symbols.length === 0 && rels.length === 0) continue
  probeFile(key(f), readFileSync(f.abs, "utf8"), symbols, rels)
  if (fileIndex % 250 === 0) process.stderr.write(`  …${fileIndex}/${draw.length}\n`)
  fileIndex++
}

/** The corpus tally, frozen BEFORE the controls run. The controls call the same
 *  `probeFile` over synthetic files, so without this the published counts would
 *  include 9 synthetic files — which is exactly what happened in the draft that
 *  reported "P5 289 mapped" and then 319. */
const CORPUS_TALLY = snapshot()

// ────────────────────────────────────────────────── END-TO-END CONTROLS
//
// The pure-predicate controls above certify the walkers. These certify the
// PROBES: each runs `probeFile` — the same function, over the same production
// `parseFile` output — on a synthetic file whose right answer is known, and
// asserts both directions. Without them a probe whose DENOMINATOR is zero is
// indistinguishable from a probe that cannot see, and P1's denominator was
// zero on a 40-file draw.
/** PER-PROCESS. A shared control directory is a race: eight concurrent shards
 *  all write `.p3-controls/<name>.zig`, and the first shard to finish runs
 *  `rm -rf` on it while the others are still reading their own fixtures out of
 *  it — which is how the first 8-shard pass-3 run died with
 *  `ENOENT … .p3-controls/p4-file-scope.zig` after 250 of 479 files. */
const CTRL_DIR = path.join(ROOT, `validation/m14/fixtures/zig/.p3-controls-${process.pid}`)
const runControl = async (name: string, src: string): Promise<any> => {
  execFileSync("mkdir", ["-p", CTRL_DIR])
  const abs = path.join(CTRL_DIR, `${name}.zig`)
  writeFileSync(abs, src)
  const res: any = await parseFile(abs, CTRL_DIR)
  const before = snapshot()
  probeFile(`control/${name}.zig`, src, res?.symbols ?? [], res?.relationships ?? [])
  return since(before)
}

// P1 — a CONSTANT and an error-set member share a spelling. The `error.X` read
// must not be charged to the constant. POSITIVE: only the constant exists.
{
  const d = await runControl("p1-constant-only", CTRL_ERROR_LEAF)
  check("P1-an-error-leaf-named-like-a-constant-is-charged-to-the-constant", d.p1.notAnErrorMember >= 1,
    `notAnErrorMember=${d.p1.notAnErrorMember} (want >=1)`)
  const d2 = await runControl("p1-error-member", CTRL_ERROR_MEMBER)
  check("P1-an-error-leaf-named-like-an-error-member-is-not-charged", d2.p1.notAnErrorMember === 0,
    `notAnErrorMember=${d2.p1.notAnErrorMember} (want 0)`)
}
// P2 — a destructuring declaration shadows a file-scope constant of the same
// name in its SECOND slot, and the analyzer binds only the first.
{
  const d = await runControl("p2-destructure", CTRL_DESTRUCTURE)
  check("P2-a-shadowed-destructuring-slot-is-published-as-a-file-scope-read", d.p2.localReadAfterBinding >= 1,
    `localReadAfterBinding=${d.p2.localReadAfterBinding} (want >=1) delta=${JSON.stringify(d.p2)}`)
  const d2 = await runControl("p2-plain", CTRL_PLAIN)
  check("P2-a-plain-declaration-shadows-nothing", d2.p2.localReadAfterBinding === 0,
    `localReadAfterBinding=${d2.p2.localReadAfterBinding} (want 0)`)
}
// P3 — a file-scope VALUE used as a method receiver publishes no `uses`, while
// an import alias receiver is not a read at all and must not be charged.
{
  const d = await runControl("p3-value-receiver", CTRL_METHOD)
  check("P3-a-value-receiver-of-a-method-call-publishes-no-uses", d.p3.lostReads >= 1,
    `lostReads=${d.p3.lostReads} (want >=1)`)
  const d2 = await runControl("p3-import-receiver", `const std = @import("std");
fn f() void { std.mem.copy(u8, a, b); }
`)
  check("P3-an-import-alias-receiver-is-not-charged", d2.p3.lostReads === 0 && d2.p3.lostReadsOnAliasReceivers === 0,
    `lostReads=${d2.p3.lostReads} alias=${d2.p3.lostReadsOnAliasReceivers} (want 0/0)`)
}
// P4 — a call inside a NAMED FILE-SCOPE function is not `(global)`; a call
// inside a `fn` that is a member of a local container IS (Z59).
{
  const d = await runControl("p4-file-scope", `fn alpha() void { helper(); }
`)
  check("P4-a-call-in-a-file-scope-function-is-attributed-to-it", d.p4.globalSourceInsideNamedScope === 0,
    `globalSourceInsideNamedScope=${d.p4.globalSourceInsideNamedScope} (want 0)`)
  const d2 = await runControl("p4-local-member", `fn outer() void {
  const L = struct { fn inner() void { helper(); } };
}
`)
  check("P4-a-call-in-a-local-container-member-falls-back-to-global", d2.p4.globalSourceInsideNamedScope === 0,
    `globalSourceInsideNamedScope=${d2.p4.globalSourceInsideNamedScope} (want 0 — the Z59 fallback is not a defect)`)
}
// P6 — a construction names a container; a generic application names the
// generic FUNCTION. Both must pass.
{
  const d = await runControl("p6-both-forms", `const S = struct { x: u32 };
fn make(comptime T: type) T { return T{}; }
fn f() void {
  var a = S{};
  _ = a;
  const b = make(S);
  _ = b;
}
`)
  check("P6-construction-and-generic-application-both-bind-to-the-right-kind", d.p6.targetBindsToNonContainer === 0,
    `targetBindsToNonContainer=${d.p6.targetBindsToNonContainer} (want 0)`)
}
// P7 — a container really does own its members, including every member of an
// error set.
{
  const d = await runControl("p7-owners", `const E = error{ Alpha, Beta };
const S = struct { x: u32, fn m() void {} };
`)
  check("P7-a-container-declares-what-the-edge-claims", d.p7.ownerDeclaresNoSuchMember === 0,
    `ownerDeclaresNoSuchMember=${d.p7.ownerDeclaresNoSuchMember} (want 0)`)
}
// P8 — a `pub` at file scope is an export; a member `pub` is not.
{
  const d = await runControl("p8-exports", `pub const A = 1;
const S = struct { pub fn m() void {} };
`)
  check("P8-only-a-file-scope-pub-is-an-exports-edge", d.p8.targetDeclaredInsideAContainer === 0,
    `targetDeclaredInsideAContainer=${d.p8.targetDeclaredInsideAContainer} (want 0)`)
}
// P5 — every published symbol's range maps back to the node it was read from.
{
  const d = await runControl("p5-symbols", `const S = struct { x: u32 };
pub fn f(a: u32) u32 { return a; }
test "t" { _ = f(1); }
`)
  check("P5-every-published-symbol-maps-to-a-tree-node", d.p5.unmapped === 0 && d.p5.mappedToNode > 0,
    `mapped=${d.p5.mappedToNode} unmapped=${d.p5.unmapped} (want >0 / 0)`)
}

/** Discard the controls' contribution to every published number. */
Object.assign(T, CORPUS_TALLY)
{
  // `_ = c` READS c (an assignment is a `variable_declaration` in this grammar);
  // `const c = 1` DEFINES it; `c = 2` WRITES it. All three are the same node
  // type, which is why the rule needs the keyword and the first-child test.
  const r = parseCtrl("fn f() void {\n  const c = 1;\n  c = 2;\n  _ = c;\n}\n")
  const got: Record<string, boolean> = {}
  const w = (n: Node): void => {
    if (n.type === "identifier" && n.text === "c") got[`@${n.startPosition.row + 1}`] = isDefiningIdentifier(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) w(c) }
  }
  w(r)
  check("P2-defining-occurrence-rule-both-ways",
    got["@2"] === false && got["@3"] === true && got["@4"] === false,
    `const-c=${got["@2"]} assign-c=${got["@3"]} read-c=${got["@4"]} (want false/true/false)`)
}

const failedControls2 = controls.filter((c) => !c.ok)
console.log(`controls: ${controls.length - failedControls2.length} ok, ${failedControls2.length} FAILING`)
for (const c of failedControls2) console.log(`  CONTROL FAILED: ${c.name} — ${c.detail}`)
try { execFileSync("rm", ["-rf", CTRL_DIR]) } catch {}

const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0)

const report = {
  instrument: "validation/m14/fixtures/zig/pass3-adversarial.ts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  treePath: "second parse of the same bytes through wasm/tree-sitter-zig.wasm",
  seed: SEED,
  sample: SAMPLE,
  filesFrom: FILES_FROM || null,
  drawHash: `sha256:${drawHash}`,
  corpusFilesAdmitted: all.length,
  controls: { total: controls.length, ok: controls.length - failedControls2.length, failing: failedControls2.length, detail: controls },
  ...T,
  rates: {
    p1NotAnErrorMemberPct: pct(T.p1.notAnErrorMember, T.p1.errorLeafUses),
    p2CollidingSlotsPct: pct(T.p2.collidingSlots, T.p2.nonFirstSlots),
    p3LostReadsPct: pct(T.p3.lostReads, T.p3.receiversNamingFileScopeValue),
    p4MismatchPct: pct(T.p4.globalSourceInsideNamedScope + T.p4.namedSourceOutsideItself, T.p4.checked),
    p5UnmappedPct: pct(T.p5.unmapped, T.p5.symbols),
    p6NonContainerPct: pct(T.p6.targetBindsToNonContainer, T.p6.checked),
    p7WrongOwnerPct: pct(T.p7.ownerDeclaresNoSuchMember, T.p7.checked),
    p8InsideContainerPct: pct(T.p8.targetDeclaredInsideAContainer, T.p8.checked),
    p9SitesPerCallEdge: T.p9.callsEdges > 0 ? Math.round((T.p9.callSites / T.p9.callsEdges) * 100) / 100 : 0,
    p9SitesPerUsesFieldEdge: T.p9.usesFieldEdges > 0 ? Math.round((T.p9.fieldSites / T.p9.usesFieldEdges) * 100) / 100 : 0,
    p9SitesPerDeclaredTypeEdge: T.p9.referencesDeclaredTypeEdges > 0 ? Math.round((T.p9.declaredTypeSites / T.p9.referencesDeclaredTypeEdges) * 100) / 100 : 0,
  },
}

const text = JSON.stringify(report, null, 2)
if (OUT) { writeFileSync(path.resolve(ROOT, OUT), text + "\n"); console.log(`wrote ${OUT}`) }
if (RAW) { writeFileSync(path.resolve(ROOT, RAW), JSON.stringify({ drawHash, drawFiles: draw.map(key), ...T, rates: report.rates }) + "\n"); console.log(`wrote raw ${RAW}`) }

console.log(`zig pass-3 adversarial — ${T.filesParsed} files, draw sha256:${drawHash.slice(0, 8)}`)
console.log(`   parseFile FALLBACK files ${T.fallbackFiles}${T.fallbackFiles > 0 ? "  <-- THIS SHARD DID NOT MEASURE THE ANALYZER" : ""}`)
console.log(`P1 error.X -> non-error symbol   ${T.p1.notAnErrorMember} of ${T.p1.errorLeafUses} candidate reads (${report.rates.p1NotAnErrorMemberPct}%)`)
console.log(`P2 destructure slot>1 shadowed    ${T.p2.localReadAfterBinding} of ${T.p2.nonFirstSlots} non-first slots (${T.p2.collidingSlots} colliding, ${T.p2.destructuringDecls} decls)`)
console.log(`P3 method-call receiver read lost ${T.p3.lostReads} of ${T.p3.receiversNamingFileScopeValue} (${report.rates.p3LostReadsPct}%) [+${T.p3.lostReadsOnAliasReceivers} ambiguous on alias receivers]`)
console.log(`P4 source vs enclosing scope      ${T.p4.globalSourceInsideNamedScope + T.p4.namedSourceOutsideItself} of ${T.p4.checked} checked (${report.rates.p4MismatchPct}%) [+${T.p4.globalSourceInsideLocalScope} inside an UNPUBLISHED local scope = Z59 fallback]`)
console.log(`P5 symbols mapped to a node       ${T.p5.mappedToNode} of ${T.p5.symbols} (unmapped ${T.p5.unmapped}, startIndex 0 -> file root ${T.p5.zeroStartIndex}, start collisions ${T.p5.startIndexCollisions})`)
console.log(`P6 instantiates target wrong kind  ${T.p6.targetBindsToNonContainer} of ${T.p6.checked} (unbound ${T.p6.targetBindsToNothing})`)
console.log(`P7 contains owner wrong           ${T.p7.ownerDeclaresNoSuchMember} of ${T.p7.checked} (owner unknown ${T.p7.ownerUnknown})`)
console.log(`P8 exports inside a container     ${T.p8.targetDeclaredInsideAContainer} of ${T.p8.checked} (not declared ${T.p8.targetNotDeclaredInFile})`)
console.log(`P9 sites/edge  calls ${report.rates.p9SitesPerCallEdge}  uses(field) ${report.rates.p9SitesPerUsesFieldEdge}  references(declared_type) ${report.rates.p9SitesPerDeclaredTypeEdge}`)
process.exit(failedControls2.length > 0 ? 1 : 0)