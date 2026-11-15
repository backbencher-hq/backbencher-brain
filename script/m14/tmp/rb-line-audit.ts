/**
 * RUBY lane — M60 LINE CONTRACT, exact and per label.
 *
 * WHY A NEW INSTRUMENT. The lane's line gate (`script/m59/oracle-callsite.ts`,
 * M59.A7) is deliberately a NECESSARY condition and says so in its own header:
 * for an edge claiming line L, source line L must contain the target's name as a
 * token — "a pass is reported as 'consistent', never 'correct'". On 3,000 files
 * it reads 0 INCONSISTENT over 252,292 relationships, 20,240 of them NOT
 * CHECKABLE. That is real, and it is not the M60 claim.
 *
 * The M60 claim is stronger and per label: the line on an edge is the line of
 * the node that BEARS the name the edge names. "The line contains the name" is
 * satisfied by a line that DECLARES a name rather than one that READS or CALLS
 * it — and the rust lane proved that gap is not theoretical, finding 279 such
 * violations in its own analyzer with the same necessary-condition gate reading
 * 0.
 *
 * So this derives, from the TREE ALONE, every naming site each label could
 * legitimately point at, and asks per emitted edge whether (target, line) is one
 * of them. The expected line is never read back from the analyzer, so an analyzer
 * bug cannot excuse itself.
 *
 *   calls        a `call`'s `method` field, or a `command`/`command_call`'s name
 *   instantiates the receiver of `X.new`, or the `new` itself when receiverless
 *   extends      a `class`'s `superclass` node
 *   implements   the constant argument of `include`/`extend`/`prepend`
 *   uses         an `instance_variable` in READ position, or a bare value read
 *   references   the require/autoload path STRING node
 *   contains     the member's own DECLARATION line — a different question from
 *                "does the token appear", and the one M60 actually asks
 *   overrides    the overriding method's DECLARATION line
 *
 * CLI: npx tsx script/m14/tmp/rb-line-audit.ts [--limit=N] [--show=N] [--file=<abs>] [--label=NAME]
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? "/home/sano/ishaq/bb_tests/repositories"
const LIMIT = Number(arg("limit") ?? 1200)
const SHOW = Number(arg("show") ?? 6)
const ONE = arg("file")
const LABEL = arg("label")

const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }
const line = (n: any) => n.startPosition.row + 1
const leaf = (t: string) => t.split("::").filter(Boolean).pop() ?? t
const stripQuotes = (t: string) => t.replace(/^['"]|['"]$/g, "")

function walk(dir: string, out: string[] = []): string[] {
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!skip.has(e.name)) walk(p, out) }
    else if (e.name.endsWith(".rb")) out.push(p)
  }
  return out
}

/** Rails macros that DEFINE a method, so the macro's own line is that method's
 *  declaration line. These are the same macros the `uses` family is published
 *  from, seen from the containment side: `belongs_to :account` defines the
 *  accessors `account` / `account=`, `scope :cached, -> {}` defines `cached`,
 *  `attr_reader :config` defines `config`. The analyzer's `contains` edge for
 *  each names that generated method and points at the macro line, which is
 *  correct — there is no `def` site to point at, because there is no `def`.
 *
 *  Only macros that DEFINE are listed. `before_validation`, `validates`,
 *  `after_save` and friends take a symbol naming a method that must ALREADY
 *  exist, so they declare nothing and their argument is not a declaration site;
 *  including them would let an edge name any line that mentions a callback. */
const METHOD_DEFINING_MACROS = new Set([
  "attr_accessor", "attr_reader", "attr_writer",
  "scope",
  "belongs_to", "has_one", "has_many", "has_and_belongs_to_many",
  "attribute", "has_secure_password", "has_rich_text",
  "has_one_attached", "has_many_attached",
  // `define_method(:bar) { … }` inside `class << self` DEFINES the method; the
  // last `contains` edge with no declaration site was exactly this.
  "define_method", "define_singleton_method",
])

/** Rails association macros whose argument is published as a `uses` edge. */
const ASSOCIATION_MACROS = new Set([
  "belongs_to", "has_one", "has_many", "has_and_belongs_to_many",
  "has_secure_password", "has_rich_text", "has_one_attached", "has_many_attached",
])

/** A bare `identifier` that is a receiverless method call rather than a name in
 *  some other role. Each exclusion is a node type that names something else. */
function isBareCallPosition(n: any, isWrite: (x: any) => boolean): boolean {
  const p = n.parent
  if (!p) return false
  if (p.type === "method" || p.type === "singleton_method") {
    const nf = p.childForFieldName?.("name")
    if (nf && nf.id === n.id) return false // a DEFINITION names the method
  }
  if (p.type === "method_parameters" || p.type === "block_parameters" || p.type === "parameters") return false
  if (p.type === "hash_key_symbol") return false
  // A `pair` is NOT excluded, and the reason is the last 3 violations at 1,200
  // files. Ruby has TWO hash-syntaxes and they differ in kind:
  //
  //   { x: 1 }        colon form  -> key is a `hash_key_symbol`  (a LABEL, not a call)
  //   { x => 1 }      rocket form -> key is a bare `identifier`   (a real CALL)
  //
  // `{ locking_column => 1 }` calls `locking_column`; Ruby evaluates the rocket
  // key as an expression. So excluding a `pair`'s key wholesale erased three
  // correct `calls` edges (`optimistic.rb:223`, `contact.rb:10`,
  // `search_service.rb:75`) and reported them as wrong-line violations. The
  // colon form is already excluded by the `hash_key_symbol` rule above, so the
  // `pair` rule is simply removed rather than replaced.
  if (p.type === "left_assignment_list") return false
  if (isWrite(n)) return false
  return true
}

/** `self.class` — a call whose receiver is `self` and whose method is `class`. */
function isSelfClass(n: any): boolean {
  return n?.type === "call" && n.childForFieldName?.("receiver")?.type === "self" &&
    n.childForFieldName?.("method")?.text === "class"
}

/** `Class.new(…)` / `Struct.new(…)` with or without a block — the two factory
 *  forms Ruby uses to name a class through an assignment. */
function isClassFactory(n: any): boolean {
  if (n?.type !== "call") return false
  const m = n.childForFieldName?.("method")
  if (m?.text !== "new") return false
  const rcv = n.childForFieldName?.("receiver")
  return rcv?.type === "constant" && (rcv.text === "Class" || rcv.text === "Struct")
}

type Sites = Map<string, Set<string>>
const add = (m: Sites, t: string, l: number) => { const k = `${t}|${l}`; if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add("") }
/** (target, line) -> the set of labels that may legitimately name it there. */
const put = (m: Sites, label: string, t: string, l: number) => {
  if (!t) return
  const k = `${t}|${l}`
  if (!m.has(k)) m.set(k, new Set())
  m.get(k)!.add(label)
}

function collect(root: any) {
  const sites: Sites = new Map()
  const isWrite = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    if (p.type === "left_assignment_list") return true
    if (p.type !== "assignment" && p.type !== "operator_assignment") return false
    const lhs = p.childForFieldName?.("left")
    return !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
  }

  // Nearest enclosing class/module, so a RECEIVERLESS `new` can be keyed by the
  // class it constructs. The analyzer resolves it the same way (`enclosingClass`
  // in deriveRubyEdges), and the first version of this audit keyed the bare site
  // as the name "new" — so every receiverless `new` inside a class read as a
  // violation, reported as the analyzer's gap rather than the audit's.
  const st: Array<{ n: any; cls: string | undefined }> = [{ n: root, cls: undefined }]
  while (st.length) {
    const { n, cls: enclosing } = st.pop()!

    if (n.type === "call") {
      const m = n.childForFieldName?.("method")
      const rcv = n.childForFieldName?.("receiver")
      if (m) {
        const name = m.text
        if (name === "new") {
          // `X.new` — the RECEIVER names the class, so the receiver's line is the
          // name-bearing line; a bare `new` is named by the `new` node itself.
          if (rcv && (rcv.type === "constant" || rcv.type === "scope_resolution")) put(sites, "instantiates", leaf(rcv.text), line(rcv))
          // `self.new` and `self.class.new` resolve to the ENCLOSING class, not to
          // a `calls:new` on the `self` node. Measured, and it is the analyzer's
          // documented contract: "expression receivers — they read as receiverless,
          // so `self.new` / `self.class.new` inside a class resolve to the ENCLOSING
          // class (instantiates, mirroring the analyzer's owner fallback)".
          // Treating `self` as an ordinary receiver left 3 of the last 6 violations
          // (deep_mergeable_test.rb:14, serializer_with_fallback_test.rb:62).
          else if (rcv && (rcv.type === "self" || isSelfClass(rcv))) {
            if (enclosing) put(sites, "instantiates", leaf(enclosing), line(rcv))
            else put(sites, "calls", "new", line(rcv))
          }
          else if (rcv) put(sites, "calls", "new", line(rcv))
          else if (enclosing) put(sites, "instantiates", leaf(enclosing), line(m))
        } else {
          put(sites, "calls", name, line(m))
          // A receiver is itself a value the edge's `uses` may name: `x.foo`
          // reads `x`.
          if (rcv) visitReceiver(rcv, sites)
        }
      }
    }
    if (n.type === "command" || n.type === "command_call") {
      // bare `foo bar` / `obj.foo bar` — the first NAMED child is the method.
      const m = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "constant" || c.type === "scope_resolution")
      if (m) {
        const nm = m.text
        if (/^[A-Z]/.test(nm)) put(sites, "instantiates", leaf(nm), line(m))
        else put(sites, "calls", nm, line(m))
      }
    }
    if (n.type === "class") {
      // The `superclass` FIELD's own text is `"< ApplicationController"` — the
      // grammar puts the operator inside the field node. Taking `sup.text` and
      // leafing it therefore yields `< ApplicationController`, which matches no
      // name and made all 121 `extends` violations an audit artefact. The named
      // CHILD is the type node, and that is what names the base.
      const sup = n.childForFieldName?.("superclass")
      const supName = sup?.namedChild(0) ?? (sup && sup.type === "constant" ? sup : null)
      if (supName && (supName.type === "constant" || supName.type === "scope_resolution")) {
        put(sites, "extends", leaf(supName.text), line(supName))
      }
    }
    if (n.type === "instance_variable" && !isWrite(n)) {
      put(sites, "uses", n.text, line(n))
    }
    // A bare IDENTIFIER in expression position is a receiverless method call —
    // the analyzer's documented `bareCall` rule, and its own output labels it
    // `{"bareCall": true}`. In the grammar a bare argument is a plain
    // `identifier` node, NOT a `call` node, so enumerating only `call` left 274
    // `calls` edges with "no naming site in the file" — the largest single
    // bucket of apparent violations, and entirely the audit's gap.
    //
    // Excluded, because each names something OTHER than a call: a def's name, a
    // parameter or block parameter (a local, which the analyzer does not publish
    // at all), a hash/label key, and a write target.
    if (n.type === "identifier" && isBareCallPosition(n, isWrite)) {
      put(sites, "calls", n.text, line(n))
    }
    // `params[:id]` is an `element_reference` whose `object` is a bare
    // identifier, and the analyzer publishes it as a `calls` edge — measured, not
    // assumed: `x[:k]` with an unknown `x` gives `calls:params`, and with `x` a
    // local parameter it gives nothing.
    if (n.type === "element_reference") {
      const obj = n.childForFieldName?.("object")
      if (obj && (obj.type === "identifier" || obj.type === "call")) put(sites, "calls", obj.text, line(obj))
    }
    // `alias :new, :old` DECLARES the new name, and the analyzer publishes that
    // name as a `calls` edge on the alias line — the last 25 violations, all one
    // shape. `alias` carries a `name` FIELD for the new name and an `alias`
    // field for the old; `alias_method :new, :old` is an ordinary call whose
    // FIRST symbol argument is the new name. The name-bearing node is that
    // symbol, so the line is correct and only the audit was silent on it.
    if (n.type === "alias") {
      const nm = n.childForFieldName?.("name")
      if (nm) put(sites, "calls", stripQuotes(nm.text).replace(/^:/, ""), line(nm))
    }
    if (n.type === "call" && n.childForFieldName?.("method")?.text === "alias_method") {
      const a = n.childForFieldName?.("arguments")
      const first = a?.namedChild(0)
      if (first && (first.type === "simple_symbol" || first.type === "symbol")) {
        put(sites, "calls", first.text.replace(/^:/, ""), line(first))
      }
    }
    if (n.type === "string") {
      const p = n.parent
      const gp = p?.parent
      if (p?.type === "argument_list" && gp?.type === "call") {
        const meth = gp.childForFieldName?.("method")?.text
        // `autoload :Base, "abstract_controller/base"` names the PATH on the
        // string node too, and it is a 2-argument call. 11 `references` edges
        // read as audit gaps until `autoload` was added to the family.
        if (meth === "require" || meth === "require_relative" || meth === "load" || meth === "autoload") put(sites, "references", stripQuotes(n.text), line(n))
      }
    }
    let nextCls = enclosing
    if (n.type === "class" || n.type === "module") {
      const nm = n.childForFieldName?.("name")
      if (nm?.text) nextCls = nm.text
    }
    // `Autocorrection = Struct.new(:a, :b) do … new(…) … end` — the block belongs
    // to a class the CONSTANT names, not to the module that lexically encloses it.
    // Only `class`/`module` nodes set the name, so a receiverless `new` inside
    // such a block resolved to the outer module and matched no naming site: 5 of
    // the last 6 violations, all one construct.
    if (n.type === "assignment") {
      const l = n.childForFieldName?.("left")
      const r = n.childForFieldName?.("right")
      if (l?.type === "constant" && r && isClassFactory(r)) nextCls = l.text
    }
    for (const c of kids(n)) st.push({ n: c, cls: nextCls })
  }

  // `include Foo` / `prepend Foo` / `extend Foo` — a bare command whose
  // ARGUMENTS are a constant. `extend` publishes `extends` and the other two
  // publish `implements`; the first version filed all three as `implements`, so
  // 36 correct `extends` edges (`extend ActiveSupport::Concern`) read as
  // violations with the line "names it as implements".
  const MIXIN_LABEL: Record<string, string> = { include: "implements", prepend: "implements", extend: "extends" }
  const st2: any[] = [root]
  while (st2.length) {
    const n = st2.pop()
    if (n.type === "call" || n.type === "command") {
      const m = n.childForFieldName?.("method")?.text
      const lbl = m ? MIXIN_LABEL[m] : undefined
      if (lbl) {
        const a = n.childForFieldName?.("arguments")
        if (a) {
          const st3: any[] = [a]
          while (st3.length) {
            const x = st3.pop()
            if (x.type === "constant" || x.type === "scope_resolution") put(sites, lbl, leaf(x.text), line(x))
            for (const c of kids(x)) st3.push(c)
          }
        }
      }
      // Rails association macros publish `uses` to the ASSOCIATION NAME, whose
      // name-bearing node is the `symbol` argument (`belongs_to :account` ->
      // `uses -> account`). 48 `uses` edges read as audit gaps until this was
      // enumerated; they are the SIG-B population from the differential, seen
      // from the line contract's side.
      if (m && ASSOCIATION_MACROS.has(m)) {
        const a = n.childForFieldName?.("arguments")
        if (a) {
          const st3: any[] = [a]
          while (st3.length) {
            const x = st3.pop()
            // The node is `simple_symbol`, not `symbol`: `belongs_to :account`
            // parses to argument_list > simple_symbol. Matching `"symbol"` found
            // nothing and left 48 `uses` edges as audit gaps.
            // Rails accepts a bare string too — `belongs_to "author"` is valid and
            // is published as `uses -> author`, so the argument may be a
            // `simple_symbol`, a `symbol`, or a `string`.
            if (x.type === "simple_symbol" || x.type === "symbol") put(sites, "uses", x.text.replace(/^:/, ""), line(x))
            else if (x.type === "string") put(sites, "uses", stripQuotes(x.text), line(x))
            for (const c of kids(x)) st3.push(c)
          }
        }
      }
    }
    for (const c of kids(n)) st2.push(c)
  }
  return sites
}

/** A receiver expression names a value; `x.foo` reads `x`, `Foo.bar` reads `Foo`. */
function visitReceiver(rcv: any, sites: Sites) {
  if (rcv.type === "identifier" || rcv.type === "constant") put(sites, "uses", rcv.text, line(rcv))
  else if (rcv.type === "scope_resolution") {
    const nm = rcv.childForFieldName?.("name")
    if (nm) put(sites, "uses", nm.text, line(nm))
  } else if (rcv.type === "self") { /* self is not a project symbol */ }
  else if (rcv.type === "call") {
    const m = rcv.childForFieldName?.("method")
    if (m) put(sites, "uses", m.text, line(m))
    const r2 = rcv.childForFieldName?.("receiver")
    if (r2) visitReceiver(r2, sites)
  }
}

/** DECLARATION lines taken from the TREE, not from the analyzer.
 *
 *  This is the whole point of the instrument, and the first version got it
 *  exactly backwards. `contains` and `overrides` name a MEMBER, so their contract
 *  is the member's declaration line — and the first version took that line from
 *  `res.symbols`, the ANALYZER'S OWN OUTPUT. Shifting `nodeToRange`'s
 *  `startLine` by one moved the edge line and the expected line together, and
 *  the audit reported 0 violations on 2,205 `contains` and 880 `overrides`
 *  edges. A mutation that changes both sides of a comparison cannot be seen by
 *  that comparison: it was auditing the analyzer against itself, which is the
 *  "comparing a fabrication against a fabrication" trap the rust lane named, in
 *  the audit built to avoid it.
 *
 *  A declaration is a `method`, `singleton_method`, `class` or `module` node, and
 *  its line is that node's own. */
function treeDeclSites(root: any): Map<string, number[]> {
  const m = new Map<string, number[]>()
  const put = (k: string, l: number) => { const a = m.get(k) ?? []; a.push(l); m.set(k, a) }
  const st: Array<{ n: any; cls: string | undefined }> = [{ n: root, cls: undefined }]
  while (st.length) {
    const { n, cls } = st.pop()!
    // A CONSTANT is declared by an assignment whose left is a `constant` node,
    // not by a `class`/`module`/`method` node at all: `KEYWORDS_LIMIT = 15` is
    // `assignment [left=KEYWORDS_LIMIT] > constant`. Enumerating only named
    // definition nodes therefore found no declaration for every constant, and
    // 299 of the 304 `contains` violations were constants.
    if (n.type === "assignment") {
      const l = n.childForFieldName?.("left")
      if (l && l.type === "constant") {
        const name = leaf(l.text)
        put(name, line(l))
        if (cls) put(`${leaf(cls)}.${name}`, line(l))
      }
    }
    if (n.type === "call" || n.type === "command") {
      const mth = n.childForFieldName?.("method")?.text
      if (mth && METHOD_DEFINING_MACROS.has(mth)) {
        const a = n.childForFieldName?.("arguments")
        if (a) {
          const st2: any[] = [a]
          while (st2.length) {
            const x = st2.pop()
            // Rails accepts the method name as a bare STRING as well as a symbol:
            // `belongs_to "author"` is valid and defines `author` / `author=`.
            // Symbols-only left the last 2 `contains` edges with no declaration.
            if (x.type === "simple_symbol" || x.type === "symbol" || x.type === "string") {
              const name = x.type === "string" ? stripQuotes(x.text) : x.text.replace(/^:/, "")
              const owner = cls ? leaf(cls) : undefined
              put(name, line(x))
              if (owner) put(`${owner}.${name}`, line(x))
            }
            // `attribute :a, :b` takes several; only symbols are method names.
            for (const c of kids(x)) st2.push(c)
          }
        }
      }
    }
    if (n.type === "method" || n.type === "singleton_method" || n.type === "class" || n.type === "module") {
      const nm = n.childForFieldName?.("name")
      if (nm?.text) {
        const name = leaf(nm.text)
        put(name, line(nm))
        // owner-qualified, for a target published as `Owner.member`
        const owner = cls ? leaf(cls) : undefined
        if (owner) put(`${owner}.${name}`, line(nm))
      }
    }
    let nextCls = cls
    if (n.type === "class" || n.type === "module") {
      const nm = n.childForFieldName?.("name")
      if (nm?.text) nextCls = nm.text
    }
    for (const c of kids(n)) st.push({ n: c, cls: nextCls })
  }
  return m
}

/** The DECLARATION line of every symbol the analyzer reports, indexed under BOTH
 *  its bare name and its owner-qualified name. An `overrides`/`contains` edge
 *  names a MEMBER, and the analyzer publishes that target owner-qualified
 *  (`ApplicationController.set_referrer_policy_header`) while a declaration is
 *  indexed by bare name — so an unqualified index matched nothing and all 880
 *  `overrides` edges read as violations. That was the audit's gap, not the
 *  analyzer's. */
function declSites(syms: any[]): Map<string, number[]> {
  const m = new Map<string, number[]>()
  const put = (k: string, l: number) => { const a = m.get(k) ?? []; a.push(l); m.set(k, a) }
  for (const s of syms) {
    const n = String(s.name)
    if (!n) continue
    const l = s.startLine ?? s.range?.startLine
    if (typeof l !== "number") continue
    put(n, l)
    if (s.ownerName) put(`${s.ownerName}.${n}`, l)
  }
  return m
}

/** A member edge's target, reduced to the name that is actually declared. */
function memberName(target: string): string {
  const i = Math.max(target.lastIndexOf("."), target.lastIndexOf("::"))
  return i >= 0 ? target.slice(i + (target.lastIndexOf("::") > target.lastIndexOf(".") ? 2 : 1)) : target
}

/**
 * The audit reports 0 violations over 101,017 relationships, which is exactly the
 * kind of result that must be distrusted from a fresh instrument. These cases
 * prove it still DISCRIMINATES: for each snippet the correct (target, line) must
 * be a naming site, and a line either side of it must NOT be. A gate that cannot
 * fail is a claim; this is the mutation test, kept in the instrument so a later
 * edit that quietly widens a rule is caught immediately rather than discovered
 * when a real defect goes unreported.
 *
 * The two mutations that shaped this audit, both run against the real analyzer
 * and both caught, are recorded in the review: shifting `nodeLine` produced
 * 15,254 violations, and shifting `nodeToRange` produced 3,079 — the second only
 * after the expected lines were moved off the analyzer's own symbol output, since
 * before that it moved both sides of the comparison together and reported 0.
 */
async function selfTest(parser: Parser): Promise<{ passed: number; failed: string[] }> {
  const failed: string[] = []
  let passed = 0
  const check = (name: string, cond: boolean) => { if (cond) passed++; else failed.push(name) }

  const has = (sites: Sites, label: string, target: string, l: number) =>
    (sites.get(`${target}|${l}`)?.has(label)) ?? false

  // 1. calls — a bare identifier argument, a receiverless call, a rocket hash key
  {
    const src = "class C\n  def go\n    helper(1)\n    x.merge(a: b)\n    y = c => d\n  end\nend\n"
    const sites = collect(parser.parse(src).rootNode!)
    check("calls: receiverless call names the call line", has(sites, "calls", "helper", 3))
    check("calls: not the line above", !has(sites, "calls", "helper", 2))
    check("calls: not the line below", !has(sites, "calls", "helper", 4))
    check("calls: a pair VALUE is a call", has(sites, "calls", "b", 4))
    check("calls: a colon key is not", !has(sites, "calls", "a", 4))
  }
  // 2. rocket-form hash key IS a call (the last 3 real violations)
  {
    const sites = collect(parser.parse("class C\n  def go\n    { k => 1 }\n  end\nend\n").rootNode!)
    check("calls: a rocket-form key is a call", has(sites, "calls", "k", 3))
  }
  // 3. extends reads the superclass CHILD, not the field text (`< Base`)
  {
    const sites = collect(parser.parse("class A < Base\nend\n").rootNode!)
    check("extends: names the base, not `< Base`", has(sites, "extends", "Base", 1))
    check("extends: never the operator-prefixed text", !has(sites, "extends", "< Base", 1))
  }
  // 4. extend -> extends, include/prepend -> implements
  {
    const sites = collect(parser.parse("class A\n  include I\n  extend E\n  prepend P\nend\n").rootNode!)
    check("mixin: include is implements", has(sites, "implements", "I", 2))
    check("mixin: prepend is implements", has(sites, "implements", "P", 4))
    check("mixin: extend is extends", has(sites, "extends", "E", 3))
    check("mixin: extend is not implements", !has(sites, "implements", "E", 3))
  }
  // 5. receiverless `new(…)` is named by the ENCLOSING class — and BARE `new` is
  //    a different thing. Measured on the grammar: `new(1)` is a `call` node and
  //    the analyzer publishes `instantiates:Widget`; bare `new` is a plain
  //    `identifier`, so it takes the bare-identifier path and publishes
  //    `calls:new`. The first version of this case asserted `instantiates` for
  //    the BARE form, so the audit was right and the test was wrong — which is
  //    the only reason it is written down.
  {
    const paren = collect(parser.parse("class Widget\n  def go\n    new(1)\n  end\nend\n").rootNode!)
    check("instantiates: receiverless new(...) names the enclosing class", has(paren, "instantiates", "Widget", 3))
    check("instantiates: not the literal `new`", !has(paren, "instantiates", "new", 3))
    const bare = collect(parser.parse("class Widget\n  def go\n    new\n  end\nend\n").rootNode!)
    check("calls: BARE new is a bare-identifier call, not an instantiation", has(bare, "calls", "new", 3))
    check("instantiates: bare new is not an instantiation", !has(bare, "instantiates", "Widget", 3))
  }
  // 6. a write target is not a use; a read is
  {
    const plain = collect(parser.parse("class C\n  def go\n    @a = 1\n    @a\n  end\nend\n").rootNode!)
    check("uses: a read is a use", has(plain, "uses", "@a", 4))
    check("uses: a write is not a use", !has(plain, "uses", "@a", 3))
    const multi = collect(parser.parse("class C\n  def go\n    @a, @b = 1, 2\n  end\nend\n").rootNode!)
    check("uses: a multi-assign target is not a use", !has(multi, "uses", "@a", 3) && !has(multi, "uses", "@b", 3))
  }
  // 7. references covers the whole require family including autoload
  {
    const sites = collect(parser.parse('require "a/b"\nautoload :X, "c/d"\nload "e"\n').rootNode!)
    check("references: require", has(sites, "references", "a/b", 1))
    check("references: autoload", has(sites, "references", "c/d", 2))
    check("references: load", has(sites, "references", "e", 3))
  }
  // 8. alias publishes the NEW name at the alias line
  {
    const sites = collect(parser.parse("class C\n  alias :new1 :old1\n  alias_method :n2, :o2\nend\n").rootNode!)
    check("calls: alias names the new name", has(sites, "calls", "new1", 2))
    check("calls: alias does not name the old one", !has(sites, "calls", "old1", 2))
    check("calls: alias_method names the new name", has(sites, "calls", "n2", 3))
  }
  // 9. declarations come from the TREE: constant, macro, define_method
  {
    const src = "module M\n  K = 1\n  scope :s, -> {}\n  define_method(:d) {}\n  def self.m; end\nend\n"
    const d = treeDeclSites(parser.parse(src).rootNode!)
    check("decl: a constant is declared by its assignment", (d.get("K") ?? []).includes(2))
    check("decl: a scope macro declares the method", (d.get("s") ?? []).includes(3))
    check("decl: define_method declares the method", (d.get("d") ?? []).includes(4))
    check("decl: a singleton method is owner-qualified", (d.get("M.m") ?? []).includes(5))
  }
  // 10. a name must not be a naming site for a label it cannot bear
  {
    const sites = collect(parser.parse("class A\n  include I\nend\n").rootNode!)
    check("implements: include is not a calls site", !has(sites, "calls", "I", 2))
    check("calls: a constant alone is not a calls site", !has(sites, "calls", "A", 1))
  }
  return { passed, failed }
}

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  if (process.argv.includes("--self-test")) {
    const r = await selfTest(parser)
    console.log(`rb-line-audit self-test: ${r.passed} passed, ${r.failed.length} failed`)
    for (const f of r.failed) console.log(`  FAIL ${f}`)
    process.exit(r.failed.length === 0 ? 0 : 1)
  }

  let files = walk(CORPUS).sort()
  const corpusTotal = files.length
  if (ONE) files = [path.resolve(ONE)]
  else if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }

  const totals: Record<string, { n: number; ok: number; bad: number; off: number; wrongLine: number }> = {}
  const samples: Record<string, any[]> = {}
  const bump = (label: string, kind: "ok" | "off" | "wrongLine", c: any) => {
    const r = totals[label] ?? (totals[label] = { n: 0, ok: 0, bad: 0, off: 0, wrongLine: 0 })
    r.n++
    if (kind === "ok") r.ok++
    else { r.bad++; if (kind === "off") r.off++; else r.wrongLine++ }
    // Only VIOLATIONS are worth printing. The first version stored every edge and
    // then filtered out the passes, so the first SHOW samples were almost all
    // `ok` and the section printed nothing at all — a report that silently shows
    // no evidence for 528 violations.
    if (kind !== "ok") {
      const a = samples[label] ?? (samples[label] = [])
      if (a.length < SHOW) a.push({ ...c, kind })
    }
  }

  let filesOk = 0
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    filesOk++

    const sites = collect(tree.rootNode)
    // Tree-derived, so a defect in the analyzer's own symbol lines cannot excuse
    // an edge line. `declSites` (analyzer-derived) is kept only for the
    // notCheckable bookkeeping and is deliberately NOT the expected value.
    const decls = treeDeclSites(tree.rootNode)
    const rel = path.relative(CORPUS, f)

    for (const e of res.relationships ?? []) {
      const label = String(e.type ?? "")
      if (LABEL && label !== LABEL) continue
      const target = String(e.target ?? "")
      const ln = e.line_number ?? 0
      if (!target) continue

      // `contains` and `overrides` name a MEMBER, so the contract is the
      // member's DECLARATION line — a different question from "does this line
      // contain the name", and the one M60 asks.
      if (label === "contains" || label === "overrides") {
        // `contains` names the MEMBER, so its declaration line is the contract.
        // `overrides` names the BASE it replaces — the edge reads
        // `from=NoNilParamEncoder.handle_array -> to=ParamEncoder.handle_array` —
        // and the line that bears the name is the OVERRIDING declaration, the one
        // in the subclass. Checking it against the base's declaration (line 74
        // rather than 81) was a wrong contract, not a defect: it reported 2
        // correct edges as violations and would have sent a fix at the analyzer.
        const named = label === "overrides" ? String(e.source ?? "") : target
        const ds = decls.get(named) ?? decls.get(memberName(named))
        if (!ds || ds.length === 0) { bump(label, "off", { file: rel, target: named, line: ln, why: "no declaration line for the named member" }); continue }
        if (ds.includes(ln)) bump(label, "ok", { file: rel, target: named, line: ln })
        else bump(label, "wrongLine", { file: rel, target: named, line: ln, why: `declared at ${ds.slice(0, 4).join(",")}` })
        continue
      }

      const labels = sites.get(`${target}|${ln}`)
      if (!labels) {
        // Is the name on SOME line at all? If yes, the edge points at the wrong
        // line. If no, this site is not one the audit enumerates — a gap in the
        // audit, which must be reported as such and not as a violation.
        const elsewhere = [...sites.keys()].filter((k) => k.startsWith(`${target}|`)).map((k) => Number(k.split("|")[1]))
        if (elsewhere.length) bump(label, "wrongLine", { file: rel, target, line: ln, why: `name occurs at line(s) ${elsewhere.slice(0, 4).join(",")}` })
        else bump(label, "off", { file: rel, target, line: ln, why: "no naming site for this name in the file — AUDIT GAP" })
        continue
      }
      if (labels.has(label)) bump(label, "ok", { file: rel, target, line: ln })
      else bump(label, "wrongLine", { file: rel, target, line: ln, why: `line names it as ${[...labels].join("/")}` })
    }
  }

  console.log("=".repeat(96))
  console.log("RUBY — M60 LINE CONTRACT, EXACT, PER LABEL")
  console.log("=".repeat(96))
  console.log(`corpus ${corpusTotal} .rb files, ${files.length} parsed, ${filesOk} analyzed`)
  console.log(`expected line derived from the TREE, never read back from the analyzer\n`)
  console.log("label          edges      ok  VIOLATIONS   wrong-line   audit-gap")
  let tn = 0, tb = 0
  for (const [l, r] of Object.entries(totals).sort((a, b) => b[1].bad - a[1].bad)) {
    tn += r.n; tb += r.bad
    console.log(`  ${l.padEnd(13)}${String(r.n).padStart(6)}${String(r.ok).padStart(9)}${String(r.bad).padStart(11)}${String(r.wrongLine).padStart(13)}${String(r.off).padStart(11)}`)
  }
  console.log(`  ${"TOTAL".padEnd(13)}${String(tn).padStart(6)}${String(tn - tb).padStart(9)}${String(tb).padStart(11)}`)

  for (const [l, arr] of Object.entries(samples)) {
    if (!arr.length) continue
    console.log(`\n${l}:`)
    for (const s of arr) console.log(`  [${s.kind}] ${s.file}:${s.line}  ${s.target}  — ${s.why}`)
  }

  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-line-audit.json"), JSON.stringify({
    at: new Date().toISOString(), corpus: CORPUS, corpusTotal, filesParsed: files.length,
    totals, samples,
  }, null, 2))
  console.log("\nevidence: validation/m60/results/ruby-line-audit.json")
}

main()
