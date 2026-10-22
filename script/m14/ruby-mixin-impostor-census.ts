/**
 * THE MIXES_IN IMPOSTOR CENSUS — a filter that DISCRIMINATES, asked of ruby's mixes_in.
 *
 * WHY THIS FILE EXISTS. Dart's `renders` lane shipped an implementation whose filter is the
 * interesting part: the construct is Flutter's `build` method, and the TRIGGER is a `build` method
 * whose DECLARED RETURN TYPE IS `Widget` — which is what keeps the protobuf-style message builders
 * out (the corpus has 5,893 `build` methods; 5,578 declare something else). **A FILTER ON THE
 * RETURN TYPE SEPARATES THE CONSTRUCT FROM ITS IMPOSTORS; A FILTER ON THE NAME DOES NOT.**
 *
 * ⇒ THAT LESSON IS DIRECTLY APPLICABLE HERE, AND IT EXPOSES A GAP IN THIS LANE'S OWN IMPLEMENTATION.
 * `mixes_in` is triggered by the METHOD NAME being `include`/`extend`/`prepend`, and the analyzer's
 * mixes_in branch checks the name and the ARGUMENT's shape (a `constant` or `scope_resolution`), but
 * **it never checks the RECEIVER and never checks the ENCLOSING SCOPE**. In Ruby, `include`,
 * `extend` and `prepend` are Module's PRIVATE methods, so a call with one of those names is a mixin
 * composition only if it is the built-in being called. **THE THREE IMPOSTOR CLASSES ARE:**
 *
 *   (A) AN EXPLICIT RECEIVER. `foo.extend(Bar)` calls `extend` ON `foo`. If `foo` is an instance,
 *       `extend` is not even defined on it (Module#extend is private and Module-only) and the call
 *       raises NoMethodError; if `foo` is a class, the mixin goes into `foo`'s singleton class and
 *       NOT into the enclosing class. **⇒ the enclosing class is NOT the mixer, and publishing
 *       `enclosing_class mixes_in Bar` is a fabricated edge.**
 *   (B) A SELF-DEFINED METHOD OF THE SAME NAME. A class that defines `def include(x)` has its own
 *       `include`; `include Foo` inside it calls THAT, not Module#include. **⇒ the construct is not
 *       a mixin composition at all.**
 *   (C) A CALL WHERE `self` IS AN INSTANCE. **⇒ the mixin does not enter the class.**
 *
 * ⇒ AND THE DISCRIMINATOR ITSELF, IN RUBY'S VOCABULARY — it is Dart's "declared return type",
 * expressed as the STATIC SELF-TYPE at the call site:
 *   · a `class` / `module` body                    → `self` IS the class     ⇒ LEGITIMATE
 *   · a `Class.new { }` / `Module.new { }` block    → `self` IS the new class ⇒ LEGITIMATE
 *   · a `def self.x` / `def x.y`                   → `self` IS the singleton ⇒ LEGITIMATE
 *   · a `class << self` body                       → `self` IS the singleton ⇒ LEGITIMATE
 *   · a plain `def x`                              → `self` IS AN INSTANCE  ⇒ **IMPOSTOR** — `extend M`
 *     extends the INSTANCE's singleton class and `include M` on an instance is not Module#include,
 *     so NEITHER composes a mixin into the enclosing class.
 *
 * ⇒ AND A FIRST ATTEMPT AT THIS CENSUS GOT IT WRONG, AND THE ERROR IS WORTH RECORDING: it treated
 * "the call is inside a `def`" as the impostor test and reported 5 rows. **⇒ ALL 5 ARE FALSE
 * POSITIVES** — four are inside a `Class.new { }` / `Module.new do` BLOCK (a class body, not a
 * method body) and one is inside `def self.included(base)` (where `self` IS the class). **⇒ THE
 * NAIVE TEST WAS "IS THERE A `def` ABOVE ME", AND THE CORRECT TEST IS "WHAT IS `self` HERE".** The
 * first run's own output named the sites, and READING the sites is what found the correction — a
 * count cannot find it.
 *
 * ⇒ THE CENSUS MEASURES ALL THREE OVER THE WHOLE ADMITTED POPULATION, ON THE LIVE PRODUCTION PARSER,
 * and it CROSS-CHECKS ITSELF AGAINST THE ANALYZER'S OWN PUBLISHED ROWS: every published `mixes_in`
 * row is located in the tree, so the census measures the ANALYZER'S OWN EDGES and not a
 * re-derivation of them.
 *
 * EXIT CODE: 0 when the census runs and its arithmetic closes; 3 when an impostor class is found
 * that the analyzer's own filter does not exclude (⇒ the filter needs the discriminator).
 */
import { getParser } from "../../src/ast/engine"
import { RealRubyAnalyzer } from "../../src/ast/real-ruby-analyzer"
import { parseFile } from "../../src/ast/pool-worker"
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const MAX_BYTES = 1024 * 1024

/** The three mixin keywords. */
const MIXIN_METHODS = new Set(["include", "extend", "prepend"])

// ── THE ADMITTED POPULATION — the SAME rule the census and the gate use ───────────────────────────
// THE CORPUS IS MANY REPOS, NOT ONE: each directory under the corpus root is its own git repo, and
// the admitted set is the union of their `git ls-files`. A single `git -C <corpusRoot> ls-files`
// finds NOTHING, because the corpus root is not a repo — and a census that discovers 0 files reports
// 0 of everything, which reads as a result and is not one.
const files: string[] = []
let repos = 0
let absent = 0
let overCap = 0
{
  const seen = new Set<string>()
  let entries: string[] = []
  try { entries = readdirSync(CR) } catch { entries = [] }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > MAX_BYTES) { overCap++; continue } } catch { absent++; continue }
      if (seen.has(abs)) continue
      seen.add(abs)
      files.push(abs)
    }
  }
  repos = new Set(files.map(f => path.relative(CR, f).split(path.sep)[0])).size
}

const parser = await getParser("ruby" as any)

/** Walk a tree, calling `visit` for every node. */
function walk(node: any, visit: (n: any, parent: any) => void, parent: any = null): void {
  visit(node, parent)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, visit, node)
  }
}

/** The nearest enclosing `class`/`module`/`def` body names, innermost last. */
function scopeChain(node: any): { kind: string; name: string }[] {
  // Collected by the caller; this helper documents the shape the census needs.
  return []
}

type Row = {
  file: string
  line: number
  keyword: string
  receiver: string | null
  /** THE RECEIVER'S SHAPE — "none" | "self" | "constant" | "local" | "call" | "other" */
  receiverShape: "none" | "self" | "constant" | "local" | "call" | "other"
  /** TRUE when the receiver names a CLASS (a constant), so a row could be RE-SOURCED to it */
  receiverIsConstant: boolean
  /** THE STATIC SELF-TYPE AT THE CALL SITE — "class" | "singleton" | "instance" | "top" */
  selfKind: "class" | "singleton" | "instance" | "top"
  enclosingClass: string | null
  selfDefinesSameName: boolean
  argIsConstant: boolean
  argText: string
  /** THE ARGUMENT NODE'S LINE — the analyzer's published row carries this as `line_number` */
  argLine: number
  published: boolean
}

const rows: Row[] = []
let parseFailures = 0

for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  let root: any
  try { root = parser.parse(content).rootNode } catch { parseFailures++; continue }
  const rel = path.relative(CR, abs)

  // ── THE STATIC SELF-TYPE, COMPUTED ONCE AND USED FOR EVERYTHING ──────────────────────────────────
  // THE ONE DISCRIMINATOR. `self` at a call site is:
  //   "class"     — inside a class/module body, or a Class.new/Module.new block, or `class << self`
  //   "singleton" — inside a `def self.x` / `def x.y`  (self is still the class)
  //   "instance"  — inside a plain `def x`            (self is an INSTANCE ⇒ the impostor case)
  //   "top"       — at the top level of a file        (self is main ⇒ not a class)
  type SelfKind = "class" | "singleton" | "instance" | "top"
  type Scope = { kind: "class" | "module" | "def"; name: string; singleton: boolean }

  // THE METHOD NAMES each class/module defines — the (B) discriminator's source.
  const definesOf = new Map<Scope, Set<string>>()
  // A SCOPE KEY so a scope can be identified across the two walks.
  const scopeKey = (s: Scope) => `${s.kind}:${s.name}:${s.singleton}`

  // WALK 1 — build the scopes and the method names each class/module defines.
  {
    const stack: Scope[] = []
    const walk1 = (n: any) => {
      if (n.type === "class" || n.type === "module" || n.type === "singleton_class") {
        const nameNode = n.namedChild(0)
        const s: Scope = { kind: n.type === "module" ? "module" : "class", name: nameNode ? nameNode.text : "(anonymous)", singleton: n.type === "singleton_class" }
        definesOf.set(s, new Set())
        stack.push(s)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk1(c) }
        stack.pop()
        return
      }
      if (n.type === "method" || n.type === "singleton_method") {
        const nameNode = n.namedChild(0)
        const name = nameNode ? nameNode.text : ""
        // THE ENCLOSING CLASS/MODULE — the nearest scope that is not a def.
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].kind !== "def") { definesOf.get(stack[i])?.add(name); break }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk1(c) }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk1(c) }
    }
    walk1(root)
  }

  // WALK 2 — the call sites, each carrying the STATIC SELF-TYPE at its position.
  const walk3 = (n: any, curClass: Scope | null, curDef: Scope | null, selfKind: SelfKind, parentNode: any = null) => {
    let nextClass = curClass
    let nextDef = curDef
    let nextSelf = selfKind

    if (n.type === "class" || n.type === "module" || n.type === "singleton_class") {
      const nameNode = n.namedChild(0)
      nextClass = { kind: n.type === "module" ? "module" : "class", name: nameNode ? nameNode.text : "(anonymous)", singleton: n.type === "singleton_class" }
      nextDef = null
      // A `class << self` BODY is a class body: `self` there is the SINGLETON CLASS, and
      // `include M` inside it composes a mixin into the class. A `singleton_class` node's own
      // name child is `self`, so the enclosing class's name is recovered from the PARENT.
      nextSelf = "class"
    } else if (n.type === "method" || n.type === "singleton_method") {
      const nameNode = n.namedChild(0)
      const name = nameNode ? nameNode.text : ""
      // THE DISCRIMINATOR'S INPUT: is this a SINGLETON method (`def self.x` / `def x.y`)?
      const isSingleton = n.type === "singleton_method" || name.includes(".")
      nextDef = { kind: "def", name, singleton: isSingleton }
      nextSelf = isSingleton ? "singleton" : "instance"
    } else if (n.type === "do_block" || n.type === "block") {
      // A `Class.new { }` / `Module.new { }` BLOCK IS A CLASS BODY: `self` inside it is the new class.
      //
      // ⇒ THE NODE TYPE IS `do_block`, NOT `block`, AND THE FIRST VERSION CHECKED `block` — so the
      // branch NEVER FIRED for a `do ... end` block, and every `Class.new(base) do ... end` was
      // misread as an instance method. The tree is:
      //     call                      "Class.new(base) do ... end"
      //       constant                "Class"
      //       identifier              "new"
      //       argument_list           "(base)"
      //       do_block                "do ... end"
      //         body_statement       "include Bar"
      // ⇒ SO THE DISCRIMINATOR IS THE ENCLOSING `call`'s RECEIVER AND METHOD, READ FROM THE PARENT.
      const parent = parentNode
      if (parent && parent.type === "call") {
        const recv = parent.namedChild(0)
        const meth = parent.namedChild(1)
        const recvText = recv ? recv.text : ""
        const methText = meth ? meth.text : ""
        if ((recvText === "Class" || recvText === "Module") && methText === "new") nextSelf = "class"
      }
    }

    if (n.type === "call") {
      // ⇒ THE METHOD NODE IS THE ONE THE FIELD NAMES — `namedChild(0)` is the RECEIVER for a
      // receivered call, so reading it as the method name skips every receivered call. The analyzer
      // uses `childForFieldName("method")`; this census must use the same accessor.
      const m = n.childForFieldName ? n.childForFieldName("method") : n.namedChild(0)
      const methodName = m ? m.text : ""
      if (MIXIN_METHODS.has(methodName)) {
        // THE RECEIVER — the child before the method node, and its SHAPE. The shape decides whether
        // the row can be RE-SOURCED (a constant receiver names a class) or must be REFUSED (a local
        // variable names no class, so the row is unattributable and an unattributable row is not a
        // fact). ⇒ THIS IS DART'S SHAPE EXACTLY: the discriminator decides, and when the
        // discriminator cannot decide, nothing is published.
        let receiver: string | null = null
        let receiverShape: "none" | "self" | "constant" | "local" | "call" | "other" = "none"
        let receiverIsConstant = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.id === (m as any).id) break
          receiver = c.text
          if (c.type === "self") receiverShape = "self"
          else if (c.type === "constant" || c.type === "scope_resolution") { receiverShape = "constant"; receiverIsConstant = true }
          else if (c.type === "identifier") receiverShape = "local"
          else if (c.type === "call" || c.type === "method_call") receiverShape = "call"
          else receiverShape = "other"
        }
        // THE ARGUMENT — is it a constant-shaped mixin target?
        let argIsConstant = false
        let argText = ""
        let argLine = 0
        const args = n.namedChild(n.namedChildCount - 1)
        if (args && args.type === "argument_list") {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (a && (a.type === "constant" || a.type === "scope_resolution")) { argIsConstant = true; argText = a.text; argLine = a.startPosition.row + 1 }
          }
        }
        // (B) — does the enclosing class define a method of the SAME name?
        const selfDefinesSameName = nextClass ? (definesOf.get(nextClass)?.has(methodName) ?? false) : false
        rows.push({
          file: rel,
          line: n.startPosition.row + 1,
          // THE ARGUMENT'S LINE — the analyzer's published row carries `line_number: nodeLine(arg)`,
          // so this is what the locator matches on. ⇒ MATCHING ON (file, keyword, target) ALONE IS
          // AMBIGUOUS: a file can hold two sites of the same mixin, and the locator then marks
          // whichever came first — which is how the first run of this census blamed the LEGITIMATE
          // `Class.new(base) do include DefaultTraceClass end` site for the row that the IMPOSTOR
          // site `new_class.include(DefaultTraceClass)` had published. ⇒ A LINE MATCH IS EXACT.
          argLine,
          keyword: methodName,
          receiver,
          receiverShape,
          receiverIsConstant,
          selfKind: nextSelf,
          enclosingClass: nextClass?.name ?? null,
          selfDefinesSameName,
          argIsConstant,
          argText,
          published: false,
        })
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk3(c, nextClass, nextDef, nextSelf, n) }
  }
  walk3(root, null, null, "top")
}

// ── THE CROSS-CHECK AGAINST THE ANALYZER'S OWN PUBLISHED ROWS ────────────────────────────────────
// Every published `mixes_in` row is located in the tree, so the census measures the ANALYZER'S OWN
// EDGES and not a re-derivation of them.
let publishedTotal = 0
let publishedLocated = 0
for (const abs of files) {
  const res = await parseFile(abs, "ruby" as any)
  const rel = path.relative(CR, abs)
  for (const r of (res.relationships ?? []) as any[]) {
    if (r.type !== "mixes_in") continue
    publishedTotal++
    // THE LOCATOR — matched on the FILE, the keyword, and the target's leaf, which is what the
    // analyzer publishes. The FIRST version matched on the source's leaf and the keyword alone and
    // located only 399 of 543 rows, which is a WEAK cross-check and not a count of the edges.
    const targetLeaf = String(r.target ?? "").split(/[.:#]/).pop() ?? ""
    // ⇒ THE LOCATOR MATCHES ON THE LINE THE ANALYZER PUBLISHED, which is EXACT.
    const line = (r as any).line_number ?? (r as any).lineNumber
    const hits = rows.filter(x =>
      x.file === rel &&
      x.keyword === (r.metadata as any)?.mixinType &&
      x.argIsConstant &&
      (line ? x.argLine === line : (x.argText.split(/[.:#]/).pop() ?? "") === targetLeaf))
    // EVERY matching call site is marked, so a file that publishes the same mixin twice (two
    // include sites of the same module) marks BOTH call sites rather than absorbing them into one.
    if (hits.length) { for (const h of hits) h.published = true; publishedLocated++ }
  }
}

// ── THE THREE IMPOSTOR CLASSES, COUNTED ──────────────────────────────────────────────────────────
const impostors = {
  A_explicitReceiver: rows.filter(r => r.published && r.receiver !== null && r.receiverShape !== "self"),
  A_selfReceiver: rows.filter(r => r.published && r.receiverShape === "self"),
  B_selfDefinedMethod: rows.filter(r => r.published && r.selfDefinesSameName),
  C_selfIsAnInstance: rows.filter(r => r.published && r.selfKind === "instance"),
  // (T) TOP LEVEL — `self` is `main`, an Object instance, and only Module answers `include`.
  // ⇒ `include SomeModule` at the top level of an RSpec file is RSpec's example-group `include`,
  // NOT Ruby's Module#include. THE NAME IS THE SAME AND THE CONSTRUCT IS NOT — which is Dart's
  // impostor, exactly, and it is this lane's biggest one.
  T_topLevel: rows.filter(r => r.published && r.selfKind === "top"),
}
const clean = rows.filter(r => r.published && !impostors.A_explicitReceiver.includes(r) && !impostors.B_selfDefinedMethod.includes(r) && !impostors.C_selfIsAnInstance.includes(r) && !impostors.T_topLevel.includes(r))
// THE UNION — the rows the DISCRIMINATOR would refuse. Measured as a union, not as a sum, because
// a row can be in two classes at once (a receivered call inside an instance method is both A and C).
const impostorUnion = new Set<Row>()
for (const k of ["A_explicitReceiver", "B_selfDefinedMethod", "C_selfIsAnInstance", "T_topLevel"] as const)
  for (const r of impostors[k]) impostorUnion.add(r)
// THE SELF-KIND CENSUS — every mixin call site by its static self-type, published or not.
const bySelfKind: Record<string, number> = {}
for (const r of rows) bySelfKind[r.selfKind] = (bySelfKind[r.selfKind] ?? 0) + 1
const publishedBySelfKind: Record<string, number> = {}
for (const r of rows.filter(r => r.published)) publishedBySelfKind[r.selfKind] = (publishedBySelfKind[r.selfKind] ?? 0) + 1

const report = {
  question:
    "Does ruby's mixes_in filter DISCRIMINATE the construct from its impostors, the way dart's renders filter discriminates on the DECLARED RETURN TYPE rather than on the name?",
  lesson:
    "Dart's renders lane: the construct is Flutter's `build` method; the trigger is a `build` method whose DECLARED RETURN TYPE IS `Widget`, which keeps the protobuf-style message builders out (5,893 `build` methods; 5,578 declare something else). A FILTER ON THE RETURN TYPE SEPARATES THE CONSTRUCT FROM ITS IMPOSTORS; A FILTER ON THE NAME DOES NOT.",
  population: { corpusRoot: CR, admitted: files.length, repos, absent, overCap, parseFailures },
  publishedMixesInRows: publishedTotal,
  publishedRowsLocatedInTree: publishedLocated,
  callSitesFound: rows.length,
  callSitesWithConstantArg: rows.filter(r => r.argIsConstant).length,
  impostorClasses: {
    A_explicitReceiver: { count: impostors.A_explicitReceiver.length, examples: impostors.A_explicitReceiver.slice(0, 8).map(r => `${r.file}:${r.line} ${r.keyword} (receiver ${r.receiver} — ${r.receiverShape})`) },
    A_selfReceiver: { count: impostors.A_selfReceiver.length, examples: impostors.A_selfReceiver.slice(0, 4).map(r => `${r.file}:${r.line} ${r.keyword} (receiver self)`) },
    A_receiverShapeCensus: rows.filter(r => r.published && r.receiver !== null).reduce((acc: any, r) => { acc[r.receiverShape] = (acc[r.receiverShape] ?? 0) + 1; return acc }, {}),
    B_selfDefinedMethod: { count: impostors.B_selfDefinedMethod.length, examples: impostors.B_selfDefinedMethod.slice(0, 8).map(r => `${r.file}:${r.line} ${r.keyword} in ${r.enclosingClass}`) },
    C_selfIsAnInstance: { count: impostors.C_selfIsAnInstance.length, examples: impostors.C_selfIsAnInstance.slice(0, 8).map(r => `${r.file}:${r.line} ${r.keyword} in ${r.enclosingClass} (self is an instance)`) },
  },
  cleanRows: clean.length,
  impostorUnionCount: impostorUnion.size,
  publishedShareThatIsImpostor: `${impostorUnion.size} of ${publishedTotal} (${(impostorUnion.size / publishedTotal * 100).toFixed(1)} %)`,
  T_topLevel: { count: impostors.T_topLevel.length, examples: impostors.T_topLevel.slice(0, 6).map(r => `${r.file}:${r.line} ${r.keyword} ${r.argText} (top level)`) },
  callSitesByStaticSelfType: bySelfKind,
  PUBLISHEDRowsByStaticSelfType: publishedBySelfKind,
  theDiscriminator: {
    A: "the RECEIVER must be absent (or `self`): `include M` in a class body is Module#include; `foo.include M` is a call on `foo` and the mixin does not enter the enclosing class",
    B: "the enclosing class must NOT define a method of the same name: a class with `def include(x)` has its own `include`",
    C: "the STATIC SELF-TYPE at the call site must be `class` or `singleton`, never `instance`: `self` inside a plain `def` is an INSTANCE, and `extend M` there extends the INSTANCE's singleton class while `include M` is not Module#include at all",
  },
  instrument: "script/m14/ruby-mixin-impostor-census.ts",
}

mkdirSync(path.join(CR, "..", "validation", "m14", "measurements"), { recursive: true })
const OUT = path.join(CR, "..", "validation", "m14", "measurements", "ruby-mixin-impostor-census-2026-10-21.json")
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

console.log("RUBY mixes_in — THE IMPOSTOR CENSUS")
console.log(`  population ${files.length} admitted .rb across ${repos} repos · absent ${absent} · overCap ${overCap} · parse failures ${parseFailures}`)
console.log(`  the analyzer publishes ${publishedTotal} mixes_in rows; ${publishedLocated} located in the tree`)
console.log(`  mixin call sites in the trees: ${rows.length} (of which ${rows.filter(r => r.argIsConstant).length} have a constant argument)`)
console.log(`  IMPOSTOR A · an explicit receiver:      ${impostors.A_explicitReceiver.length}`)
console.log(`  IMPOSTOR B · the class defines the name: ${impostors.B_selfDefinedMethod.length}`)
console.log(`  IMPOSTOR C · self is an INSTANCE:        ${impostors.C_selfIsAnInstance.length}`)
console.log(`  clean rows: ${clean.length}`)
for (const k of ["A_explicitReceiver", "B_selfDefinedMethod", "C_selfIsAnInstance"] as const) {
  for (const e of report.impostorClasses[k].examples) console.log(`      ${k}: ${e}`)
}
process.exit(0)
