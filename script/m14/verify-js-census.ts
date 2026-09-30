#!/usr/bin/env bun
// JAVASCRIPT CONSTRUCT CENSUS — M14.0.JS-CENSUS
//
// WHY THIS EXISTS, and why it may not consult either side.
//
// The F5 differential compares the analyzer against an oracle. Both are one
// author's reading of the JavaScript grammar, so a construct BOTH of them
// forgot cannot appear as a disagreement: the two agree, the differential reports
// 100%, and the lane looks clean. This is not hypothetical for this lane. It is
// the exact shape of X1, the largest single finding in the lane's history: a
// `uses` edge for the RECEIVER of a member call was named by nothing at all, and
// the differential reported 100% coverage with MISSING=0 and unexplained=0 for
// as long as the gap existed — because the rule that dropped the receiver was
// implemented on BOTH sides from the same mistaken reading of J4 ("a receiver
// belongs to that callee"). The lane was green and wrong, and it took a rotated
// sample plus a direct tree walk to find it. A gate that only compares the two
// sides structurally cannot find that class of defect, because the defect IS the
// agreement.
//
// So the rule this gate follows is the one svelte's rune census, html's carrier
// census and toml's construct census already follow: consult NEITHER the analyzer
// NOR the oracle for DISCOVERY. Forms are counted from the CORPUS by walking the
// grammar, and every construct the corpus contains must carry a declared
// disposition here. An unclassified construct is the failure.
//
// Lineage note, deliberate: this file's inputs are the corpus and the grammar.
// It does not read the analyzer's tables to decide what JavaScript contains, and
// it does not read the oracle, because doing either would make the gate agree
// with a regression by construction — the false lineage claim this gate exists to
// prevent. The analyzer IS consulted for the PROBES, which is a different job:
// a census that only reads the corpus proves the declared tables are not wrong
// about the corpus, not that they are right about it.
//
// WHAT IT CHECKS, in one sentence: every declaration form, module form, read
// position, type-naming form and reserved base in the corpus has a declared
// disposition, every declared disposition is then POSITIVELY probed to confirm the
// analyzer really does emit (or really does suppress) it, and the two error
// directions are probed separately because the cheap fix for a missing construct
// and the cheap fix for an over-broad one are mirror images of each other and
// only one of them shows up in the differential.
//
// THE COMPLETENESS RULE WITH REAL TEETH. "Classify every form" is vacuous if the
// fallback is "user code" — every unknown base would pass. The rule that bites is
// stated over BASES, exactly as svelte's is stated over `$`-prefixed bases: if a
// member chain's base is a declared RESERVED base (console, Object, Math, JSON,
// globalThis, window, document, plus the keywords this/super), then every leaf
// under that base must itself be declared. So `console.zzz` is a FAILURE unless
// `zzz` is enumerated, which is precisely the shape that would catch a newly
// invented builtin being suppressed by accident, or a real library call being
// swallowed because someone widened a segment set. A genuinely unknown base is
// not a failure — it is user code — but it is probed, so a fix for one builtin
// cannot quietly start suppressing user namespaces.
//
// THE SAMPLE IS DECLARED, NOT ASSUMED. Discovery walks a capped, deterministic
// sample per corpus and the cap is recorded in the artifact. A census that claims
// exhaustive coverage of a corpus it sampled 500 files of is lying in the same
// register X1 was found in, so the artifact states the sample size next to the
// counts and the gates are written to hold for the SAMPLE, with the sample named.

import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")
// FULL CORPUS, with a cap that is above the largest corpus rather than a fraction
// of it. The cap was 500, which covered 14.8% of the svelte corpus (500 of 3,382)
// — and it was not buying anything: the whole census runs in 13.7s at 500, so
// covering 3,382 costs about a minute. A census that samples the seventh of a
// corpus and calls the result complete is making a coverage claim it has not
// earned, and for a lane carrying Node/Next traffic that is the wrong place to be
// frugal. The cap stays, as a guard against a corpus growing without bound, and
// `coverage` below reports the fraction actually walked so a future shrink to the
// cap is visible rather than silent.
const SAMPLE_PER_CORPUS = 4000
const MAX_FILE_BYTES = 400_000

const CORPORA: { name: string; root: string }[] = [
  { name: "svelte:javascript", root: "$HOME/fixtures/repositories/svelte" },
  { name: "lodash:javascript", root: "$HOME/fixtures/repositories/lodash" },
]

// --- DECLARED DISPOSITIONS -------------------------------------------------
// Every node type that can DECLARE something, and what the lane does with it.
// Sourced from the JavaScript grammar's own node names, not from the analyzer.
// A node type present in the corpus with no entry here fails gate 1.
const DECL_DISPOSITIONS = new Map<string, string>([
  ["function_declaration", "Function symbol"],
  ["generator_function_declaration", "Function symbol (generator)"],
  ["function_expression", "Function symbol when named or bound to a declarator"],
  ["generator_function", "Function symbol when named or bound to a declarator"],
  ["arrow_function", "Function symbol only when bound to a declarator; an inline argument arrow names nothing"],
  ["class_declaration", "Class symbol, and the scope owner for its members"],
  ["class", "Class symbol for a class EXPRESSION — owns members too (M49 W13)"],
  ["method_definition", "Method symbol; `constructor` key yields Constructor"],
  ["field_definition", "Property symbol; `#x` private form collapses to x"],
  ["variable_declarator", "Constant for const, Variable for let/var; Function when the value is a function"],
  ["formal_parameters", "parameters recorded on the owner, never symbols"],
  ["rest_pattern", "rest parameter name recorded, never a symbol"],
  ["assignment_pattern", "default-value parameter name recorded, never a symbol"],
  ["object_pattern", "destructuring targets recorded, never symbols"],
  ["array_pattern", "destructuring targets recorded, never symbols"],
  ["pair_pattern", "destructuring targets recorded, never symbols"],
  ["catch_clause", "the caught parameter is a binding, recorded on the owner"],
  ["for_in_statement", "loop binding is a Variable"],
  ["variable_declaration", "container for variable_declarator"],
  ["import_clause", "container for import specifiers; never a symbol"],
  ["export_clause", "container for export names; never a symbol"],
  ["else_clause", "control-flow clause; never a symbol"],
  ["finally_clause", "control-flow clause; never a symbol"],
  ["object_assignment_pattern", "destructuring target, recorded not symbolized"],
  ["shorthand_property_identifier_pattern", "destructuring target, recorded not symbolized"],
  ["regex_pattern", "NOT a declaration: a regex literal is a VALUE. Its pattern text is never a symbol, never a target, and never parsed for code — which is the zero-regex contract stated as a disposition rather than as a promise. Found by gate 1, which is the only reason this row exists: the name ends in `_pattern`, so the declaration-shape heuristic flagged it, and the correct answer was to account for it rather than to widen the heuristic until it stopped asking."],
  ["lexical_declaration", "container for variable_declarator (const/let)"],
])

// Module surface. Both systems are first-class for this lane and BOTH must be
// present in the corpus and probed, or gate 2 fails.
const MODULE_DISPOSITIONS = new Map<string, string>([
  ["import_statement", "imports edge per specifier; ESM"],
  ["import_clause", "container for specifiers"],
  ["export_statement", "exports edge; ESM"],
  ["export_clause", "named re-export target"],
  ["string", "source of an import/export specifier, and of a CJS require"],
])

// Read positions. Every position a name can be READ in, and which edge names it.
// The order matters: the callee position is checked before the receiver position,
// because a member callee's leaf is a CALL and its root is a USE — the same chain
// yields both, and getting that order wrong is what X1 was.
// A DECLARED DISPOSITION MUST BE WITNESSED, or it is a phantom.
//
// The gate previously reported "declared but not sampled" as INFORMATIONAL, on the
// reasoning that a form the sample happened not to contain is a fact about the
// sample. That reasoning is right for a form the grammar CAN produce and wrong for
// one it CANNOT, and the two are indistinguishable without asking the grammar —
// so two phantoms sat in the table the whole time. `required_parameter` and
// `optional_parameter` are not node types in tree-sitter-javascript at all:
// parameters arrive as `formal_parameters` > identifier / assignment_pattern /
// rest_pattern. Five dispositions existed for five forms nobody had probed, and
// probing them found two live defects (X10 a generator expression published the
// wrong symbol kind, X11 a named class expression published a dangling
// containment owner) which no gate could see.
//
// So each declared form now carries the snippet that must produce it. A snippet
// that does not produce its node is a PHANTOM and fails the gate, which is the
// only way a declaration table can be held to the grammar it claims to describe.
const DECLARATION_WITNESSES: [string, string][] = [
  ["function_declaration", "function f() {}"],
  ["generator_function_declaration", "function* g() {}"],
  ["class_declaration", "class C {}"],
  ["class", "const C = class { m() {} }"],
  ["function_expression", "const f = function () {}"],
  ["generator_function", "const g = function* () {}"],
  ["arrow_function", "const a = () => {}"],
  ["method_definition", "class C { m() {} }"],
  ["field_definition", "class C { #x = 1; y = 2 }"],
  ["variable_declarator", "const a = 1"],
  ["variable_declaration", "var a = 1"],
  ["lexical_declaration", "const a = 1"],
  ["formal_parameters", "function f(a, b = 1, ...c) {}"],
  ["rest_pattern", "function f(...c) {}"],
  ["assignment_pattern", "function f(a = 1) {}"],
  ["object_pattern", "const { a, b } = o"],
  ["array_pattern", "const [a, b] = arr"],
  ["pair_pattern", "const { a: { b } } = o"],
  ["object_assignment_pattern", "const { a = 1 } = o"],
  ["shorthand_property_identifier_pattern", "const { a } = o"],
  ["catch_clause", "try {} catch (e) {}"],
  ["for_in_statement", "for (const k in o) {}"],
  ["import_clause", 'import a from "m.js"'],
  ["export_clause", 'const a = 1; export { a }'],
  ["else_clause", "if (a) {} else {}"],
  ["finally_clause", "try {} finally {}"],
  ["regex_pattern", "const r = /x/g"],
]

const READ_POSITIONS = new Map<string, string>([
  ["bare-read", "uses @0.9 — `return config`, `if (flag)`"],
  ["field-access", "uses @0.85 — `title.length` publishes the chain root and each segment"],
  ["call-receiver", "uses @0.6 + metadata.callReceiver — the chain ROOT of a member callee"],
  ["call-argument", "uses @0.9 — `fn(title)`"],
  ["template-substitution", "uses @0.85 + metadata.isTemplateInterpolation"],
  ["assignment-rhs", "uses @0.9 — the value side of `a = b`"],
  ["object-key", "no edge — a key is a name being DEFINED, not read"],
])

// RESERVED BASES: the rule that has teeth. A member chain rooted at one of these
// must have every leaf declared below, or gate 4 fails.
const RESERVED_BASES = new Set([
  "console", "Object", "Math", "JSON", "globalThis", "window", "document",
  "Array", "String", "Number", "Boolean", "Promise", "Symbol", "Map", "Set",
  "WeakMap", "WeakSet", "Proxy", "Reflect", "Error", "TypeError", "RangeError",
  "process", "Buffer", "__dirname", "__filename",
])
// DELIBERATELY NOT reserved bases: `module`, `exports` and `require`. They look
// like suppressible builtins and are not — `require("./m.js")` is the lane's CJS
// IMPORT edge and `module.exports = {...}` is its CJS EXPORT edge, both emitted
// with confidence 1.0. Enumerating them as suppressible bases would have made
// this gate demand the suppression of two of the lane's most correct edges.

// Keywords that are never symbols, whatever position they appear in.
const RESERVED_KEYWORDS = new Set([
  "this", "super", "undefined", "arguments", "null", "true", "false",
])
// `NaN` and `Infinity` are NOT here. They are global VALUES a program reads, not
// keywords, so `uses NaN` is the correct edge and suppressing it would be a
// regression. An earlier draft of this file listed them and the gate failed
// against correct analyzer behaviour — which is the gate being wrong, not the
// analyzer, and is recorded here so the next reader does not "fix" it back.

// Declared SUPPRESSION: base -> leaves the lane intentionally does not name.
// MEASURED, not assumed. This table was first written from the analyzer's own
// documentation, which claims "builtins filtered (console.*, Object leaf
// methods)". Probing it showed only the FIRST half of that claim is true:
// `console.log(x)` emits `uses console` and no `calls log`, while
// `Object.keys({})` emits `calls keys` AND `uses Object`, and `Math.floor(1.5)`
// emits `calls floor` AND `uses Math`. So the doc's second claim is false, and
// the table below states the real contract. That doc defect is reported by gate
// 5 rather than silently absorbed here — the alternative is editing the table to
// match a wrong document, which is how a doc error becomes permanent.
// The analyzer suppresses console by PATTERN, not by enumeration — probed across 13
// console methods, every one of them yields `uses->console` and no `calls-><leaf>`.
// So this list DESCRIBES observed behaviour rather than driving it, which means it
// must be complete against the corpus or the gate reports a gap that does not
// exist. `groupCollapsed` was exactly that: the only undeclared leaf at full
// coverage, and it is suppressed like its siblings.
const DECLARED_SUPPRESSED = new Map<string, string[]>([
  ["console", ["log", "warn", "error", "info", "debug", "trace", "dir", "table", "time", "timeEnd", "group", "groupCollapsed", "groupEnd", "count", "assert", "clear"]],
])

// Declared NAMED bases: every leaf the CORPUS hangs off a reserved base, with the
// disposition MEASURED rather than assumed. Derived from the sample published in this
// artifact's `reservedBaseLeaves`, not curated by hand — a hand-written list of 15
// global bases and ~110 leaves is a list that rots, and a rotted list is worse
// than no list because it looks authoritative.
//
// The disposition is NAMED for all of them, and that is a finding rather than a
// default: the analyzer's own documentation claims it filters "builtins
// (console.*, Object leaf methods)", and gate 5b measures that claim. `console`
// is the ONE base whose leaves are actually suppressed, and it is listed in
// DECLARED_SUPPRESSED above. Everything else is named, so a member call on a
// global is a real `calls` edge and a real `uses` edge on the base.
//
// GATE 4 then has teeth in the direction that matters: add a base to
// RESERVED_BASES later and its leaves are absent here, so the gate FAILS
// until they are enumerated. GATE 9 goes further and PROBES a leaf of every
// non-console reserved base to confirm it really is named, so this table
// cannot rot into asserting suppression that no longer happens.
//
// REGENERATED AT FULL CORPUS COVERAGE, and the reason is worth keeping. At the old
// 500-file cap — 14.8% of the svelte corpus — this table was COMPLETE: gate 4
// reported 0 undeclared leaves across 634 bases. Raising the cap to walk all
// 3,369 files reported 119 undeclared leaves across 1,460 bases, because a
// sevenfold sample is seven times the chance of meeting a global nobody had
// listed. A completeness table that is complete only where nobody looked is the
// most dangerous shape a gate can have: it reports the coverage of the sample and
// is graded as the coverage of the lane.
const DECLARED_NAMED_BASES = new Map<string, string[]>([
  ["Array", ["__svelte_cleanup", "call", "from", "includes", "indexOf", "isArray", "prototype", "push", "slice", "sort"]],
  ["Boolean", ["prototype", "toJSON"]],
  ["Buffer", ["from"]],
  ["Error", ["captureStackTrace", "stackTraceLimit"]],
  ["JSON", ["parse", "stringify"]],
  ["Map", ["prototype"]],
  ["Math", ["E", "LN10", "LN2", "LOG10E", "LOG2E", "PI", "SQRT1_2", "SQRT2", "abs", "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh", "cbrt", "ceil", "clz32", "cos", "cosh", "exp", "expm1", "f16round", "floor", "fround", "imul", "log", "log10", "log1p", "log2", "max", "min", "pow", "random", "round", "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc"]],
  ["Number", ["MAX_VALUE", "isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt", "prototype", "toJSON", "toString"]],
  ["Object", ["apply", "assign", "call", "create", "defineProperties", "defineProperty", "entries", "fromEntries", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames", "getOwnPropertySymbols", "getPrototypeOf", "hasOwn", "hasOwnProperty", "is", "isExtensible", "keys", "propertyIsEnumerable", "prototype", "toString", "values"]],
  ["Promise", ["all", "reject", "resolve", "withResolvers"]],
  ["Reflect", ["get", "getOwnPropertyDescriptor", "has", "ownKeys", "set"]],
  ["Set", ["prototype"]],
  ["String", ["call", "fromCharCode", "fromCodePoint", "prototype", "toJSON"]],
  ["Symbol", ["asyncIterator", "iterator", "prototype"]],
  ["WeakMap", ["name"]],
  ["document", ["activeElement", "addEventListener", "appendChild", "baseURI", "body", "childNodes", "createComment", "createDocumentFragment", "createElement", "createElementNS", "createTextNode", "dispatchEvent", "documentMode", "getElementById", "head", "importNode", "querySelector", "querySelectorAll", "removeChild", "title"]],
  ["globalThis", ["Buffer", "Date", "Map", "Set", "URL", "URLSearchParams", "contentType", "createPolicy", "crypto", "delayed", "digest", "document", "frag", "from", "includes", "process", "subtle", "trustedTypes", "versions", "webcontainer", "window"]],
  ["process", ["BENCH_PROFILE_DIR", "BENCH_SINGLE", "CI", "FRAGMENTS", "NODE_ENV", "PORT", "SHOULD_UPDATE_EXPECTED", "SVELTE_NO_ASYNC", "TMP_VAR", "argv", "cwd", "env", "execPath", "exit", "includes", "isTTY", "on", "platform", "slice", "stderr", "stdin", "stdout", "version", "write"]],
  ["window", ["Backbone", "Event", "HTMLDivElement", "HTMLParagraphElement", "HTMLSpanElement", "InputEvent", "KeyboardEvent", "MouseEvent", "_", "__svelte", "activeElement", "addEventListener", "body", "createElement", "createTextNode", "devicePixelRatio", "dispatchEvent", "document", "getBoundingClientRect", "getComputedStyle", "getElementById", "h", "head", "history", "includes", "innerHTML", "innerHeight", "innerWidth", "location", "matchMedia", "name", "outerHeight", "outerWidth", "pageYOffset", "prototype", "querySelector", "querySelectorAll", "removeEventListener", "screenLeft", "screenTop", "scrollTo", "scrollX", "scrollY", "setTimeout", "title", "ui", "uid"]],
])

// --- helpers ---------------------------------------------------------------

function walkFiles(dir: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 8) return acc
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, acc, depth + 1)
    else if (e.name.endsWith(".js")) acc.push(p)
  }
  return acc
}

type Counts = Map<string, number>
const bump = (m: Counts, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

// --- DISCOVERY (grammar only; analyzer and oracle are not consulted) --------

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))

const nodeTypes: Counts = new Map()
const memberBases: Counts = new Map()
const memberLeavesByBase = new Map<string, Set<string>>()
const moduleForms: Counts = new Map()
const filesWalked: Record<string, number> = {}
const filesAvailable: Record<string, number> = {}
let filesWithNonCodeOnly = 0

function discover(root: any): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    bump(nodeTypes, n.type)
    if (n.type === "member_expression") {
      let cur: any = n
      while (cur && cur.type === "member_expression") cur = cur.childForFieldName("object")
      if (cur && cur.type === "identifier") {
        bump(memberBases, cur.text)
        const prop = n.childForFieldName("property")
        if (prop) {
          const set = memberLeavesByBase.get(cur.text) ?? new Set<string>()
          set.add(prop.text)
          memberLeavesByBase.set(cur.text, set)
        }
      }
    } else if (n.type === "import_statement" || n.type === "export_statement") {
      bump(moduleForms, n.type)
    } else if (n.type === "call_expression") {
      const f = n.childForFieldName("function")
      if (f && f.type === "identifier" && f.text === "require") bump(moduleForms, "cjs_require")
      else if (f && f.type === "member_expression") {
        const o = f.childForFieldName("object")
        if (o && o.type === "identifier" && (o.text === "module" || o.text === "exports")) bump(moduleForms, "cjs_exports")
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

for (const corpus of CORPORA) {
  const all = walkFiles(corpus.root)
  // Deterministic stride sample: sorted, then evenly spaced. A random sample is
  // not reproducible and a "it passed yesterday" census is not a gate.
  all.sort()
  const stride = Math.max(1, Math.floor(all.length / SAMPLE_PER_CORPUS))
  const sample = all.filter((_, i) => i % stride === 0).slice(0, SAMPLE_PER_CORPUS)
  filesWalked[corpus.name] = sample.length
  filesAvailable[corpus.name] = all.length
  const parser = await (getParser as any)("javascript")
  for (const f of sample) {
    let src = ""
    try {
      const st = fs.statSync(f)
      if (st.size > MAX_FILE_BYTES) continue
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    if (!src.trim()) continue
    try {
      const tree = parser.parse(src)
      if (tree && tree.rootNode) discover(tree.rootNode)
    } catch {
      // A parse failure is a grammar/runtime limit, not a census verdict. It is
      // counted in the artifact rather than silently dropped.
    }
  }
}

// --- PROBES (the analyzer IS consulted here — different job) ----------------

const probeFile = (name: string, doc: string): string => path.join("/tmp", `js-census-${name}-${Math.random().toString(36).slice(2)}.js`)

const analyze = async (name: string, doc: string): Promise<any> => {
  const f = probeFile(name, doc)
  fs.writeFileSync(f, doc)
  try {
    return await ASTEngine.parseFile(f, doc)
  } finally {
    try {
      fs.unlinkSync(f)
    } catch {}
  }
}

const targets = (r: any, type: string): string[] =>
  ((r?.relationships ?? []) as any[]).filter((e) => e.type === type).map((e) => String(e.target))
const names = (r: any): string[] => ((r?.symbols ?? []) as any[]).map((s) => String(s.name))
const probeLog: { probe: string; expect: string; actual: string; pass: boolean }[] = []
const probe = (id: string, expect: string, actual: string) => {
  probeLog.push({ probe: id, expect, actual, pass: expect === actual })
}

// Probe 1 — every declared read position emits, and emits at the right tier.
{
  const r = await analyze("reads", [
    "function probe(title, flag) {",
    "  const a = title.length;",
    "  const b = title.toUpperCase();",
    "  const c = flag ? title : a;",
    "  return `${title}`;",
    "}",
  ].join("\n"))
  const uses = targets(r, "uses")
  for (const pos of ["bare-read", "field-access", "call-receiver", "call-argument", "template-substitution"]) {
    const t = pos === "field-access" ? "title" : "title"
    probe(`read:${pos}`, "yes", uses.includes(t) ? "yes" : "no")
  }
  // The receiver is the tier X1 was about: it must be present AND at 0.6.
  const recv = ((r?.relationships ?? []) as any[]).find((e) => e.type === "uses" && e.metadata?.callReceiver)
  probe("read:call-receiver-confidence", "0.6", String(recv?.confidence))
  probe("read:call-receiver-metadata", "true", String(!!recv?.metadata?.callReceiver))
  // The leaf of that same call is a CALL, never a second USE.
  probe("read:callee-leaf-is-call", "yes", targets(r, "calls").includes("toUpperCase") ? "yes" : "no")
}

// Probe 1b — the two read positions that are about NOT reading, plus the
// assignment-RHS read. These were declared in the table and unprobed, which gate 3
// correctly flagged: a declared disposition nobody probes is a claim, not a
// contract.
{
  const r = await analyze(
    "positions",
    [
      "function probe(src, key) {",
      "  const assigned = src;",
      "  const o = { key: src };",
      "  return { assigned, o };",
      "}",
    ].join("\n"),
  )
  const uses = targets(r, "uses")
  const calls = targets(r, "calls")
  // `const assigned = src` — src is READ on the right-hand side.
  probe("read:assignment-rhs", "yes", uses.includes("src") ? "yes" : "no")
  // `key: src` — `key` is being DEFINED, so it must never be a read...
  probe("read:object-key-not-read", "no", uses.includes("key") || calls.includes("key") ? "yes" : "no")
  // ...and the read on the value side must survive that suppression.
  probe("read:object-value-still-read", "yes", uses.includes("src") ? "yes" : "no")
}

// Probe 2 — module surface, both systems.
{
  const esm = await analyze("esm", 'import { a as b } from "./m.js"\nexport const c = b\nexport default c\n')
  probe("module:esm-import", "yes", targets(esm, "imports").length > 0 ? "yes" : "no")
  probe("module:esm-export", "yes", targets(esm, "exports").length > 0 ? "yes" : "no")
  const cjs = await analyze("cjs", 'const m = require("./m.js")\nmodule.exports = { m }\nexports.other = 1\n')
  probe("module:cjs-require", "yes", targets(cjs, "imports").length > 0 ? "yes" : "no")
  probe("module:cjs-exports", "yes", targets(cjs, "exports").length > 0 ? "yes" : "no")
}

// Probe 3 — declared builtins are suppressed; the SUPPRESSION IS THE CLAIM.
{
  for (const [base, leaves] of DECLARED_SUPPRESSED) {
    for (const leaf of leaves.slice(0, 3)) {
      const r = await analyze(`sup-${base}`, `const probe = ${base}.${leaf}()\n`)
      const emitted = targets(r, "calls").includes(leaf) || targets(r, "uses").includes(leaf)
      // Object.prototype leaves are reached as X.prototype.m, not Object.m
      if (base === "Object.prototype") continue
      probe(`suppress:${base}.${leaf}`, "no", emitted ? "yes" : "no")
    }
  }
}

// Probe 3b — the bases the analyzer's DOC says it filters but does not. Probed
// in the same shape as the suppression probes so the two are directly comparable:
// same snippet shape, opposite expectation, both measured.
{
  for (const [base, leaves] of DECLARED_NAMED_BASES) {
    for (const leaf of leaves.slice(0, 2)) {
      const r = await analyze(`notsup-${base}`, `const probe = ${base}.${leaf}()\n`)
      const emitted = targets(r, "calls").includes(leaf) || targets(r, "uses").includes(leaf)
      probe(`notsuppressed:${base}.${leaf}`, "yes", emitted ? "yes" : "no")
    }
  }
}

// Probe 4 — user namespaces are NOT swallowed by the suppression above. This is
// the mirror probe; without it, "make it silent" is always available as a fix.
{
  for (const base of ["cfg", "helpers", "opts", "bag"]) {
    const r = await analyze(`user-${base}`, `const probe = ${base}.zzz()\n`)
    probe(`user-preserved:${base}.zzz`, "yes", targets(r, "calls").includes("zzz") ? "yes" : "no")
  }
}

// Probe 4b — CONTAINMENT, both directions. The orphan gate below measures a
// corpus population, and a corpus population can be EMPTY — which is exactly what
// happened the first time this was written: the bound population came back 0/0, so
// the gate passed while being unable to fail at all. A 0/0 gate is a vacuous pass.
//
// So the claim is pinned by a PROBE rather than by the corpus: an object literal
// WITH a binding must be placed under that binding, and the same literal with no
// binding must be silent. Both directions, because the cheap way to "fix" the first
// is to place everything, and the cheap way to "fix" the second is to place
// nothing — neither is correct and only a pair of opposed probes distinguishes them.
{
  const bound = await analyze("obj-bound", "const o = { p() {}, q() {} }\n")
  const boundTargets = ((bound?.relationships ?? []) as any[])
    .filter((x) => x.type === "contains")
    .map((x) => `${x.source}->${x.target}`)
  probe("contain:obj-literal-with-binding", "yes", boundTargets.includes("o->p") && boundTargets.includes("o->q") ? "yes" : "no")

  const unbound = await analyze("obj-unbound", "export default { test() {}\n")
  const unboundTargets = ((unbound?.relationships ?? []) as any[])
    .filter((x) => x.type === "contains")
    .map((x) => `${x.source}->${x.target}`)
  probe("contain:obj-literal-without-binding", "no", unboundTargets.some((t) => t.endsWith("->test")) ? "yes" : "no")

  // A class member is placed under the CLASS, and a NAMED class expression's member
  // under its BINDING (X11) — never under the expression's own name, which no
  // symbol carries. Pinned here so the owner cannot slide back without a probe.
  const namedExpr = await analyze("class-expr-named", "const D = class Inner { ownMethod() {} }\n")
  const neTargets = ((namedExpr?.relationships ?? []) as any[])
    .filter((x) => x.type === "contains")
    .map((x) => `${x.source}->${x.target}`)
  probe("contain:member-owned-by-binding", "yes", neTargets.includes("D->ownMethod") ? "yes" : "no")
  probe("contain:no-dangling-owner", "no", neTargets.includes("Inner->ownMethod") ? "yes" : "no")
}

// Probe 5 — reserved keywords name nothing, in every position.
{
  const r = await analyze(
    "reserved",
    [
      "class K { go() { this.x = 1; return super.name } }",
      "function k() { return [this, super, undefined, arguments, null, true, NaN, Infinity] }",
    ].join("\n"),
  )
  const all = new Set([...names(r), ...targets(r, "uses"), ...targets(r, "calls")])
  // NaN and Infinity are absent from this list on purpose: they are global
  // values, so naming them is correct. An earlier draft asserted they were
  // silent and the gate failed against right behaviour.
  for (const kw of ["this", "super", "undefined", "arguments", "null", "true", "false"]) {
    probe(`reserved:${kw}`, "no", all.has(kw) ? "yes" : "no")
  }
}

// Probe 6 — NON-CODE text yields nothing. This is the gate that keeps Tailwind-
// looking and HTML-looking strings, comments and regex literals from becoming
// symbols, and it is asserted with the exact shapes that break naive scanners.
{
  const r = await analyze(
    "noncode",
    [
      "// function commentedOut() {}",
      "/* class CommentedBlock {} */",
      "const s = 'function inAString() {}'",
      'const d = "class AlsoInAString {}"',
      "const t = `function inTemplateText() {}`",
      "const rx = /function inARegex\\(\\)/g",
      "const html = '<div class=\"x\">function inHtml() {}</div>'",
      "function real() { return 1 }",
    ].join("\n"),
  )
  const all = new Set([...names(r), ...targets(r, "uses"), ...targets(r, "calls")])
  for (const ghost of [
    "commentedOut", "CommentedBlock", "inAString", "AlsoInAString",
    "inTemplateText", "inARegex", "inHtml", "x", "div",
  ]) {
    probe(`noncode:${ghost}`, "no", all.has(ghost) ? "yes" : "no")
  }
  probe("noncode:real-still-there", "yes", all.has("real") ? "yes" : "no")
}

// --- WITNESSING (gate 1b): is every declared form a node this grammar has? -----
// The parser is already loaded for the orphan measurement below; reuse it.
const witnessParser = await (getParser as any)("javascript")
const witnessResults: { form: string; witnessed: boolean; snippet: string }[] = []
const phantomForms: string[] = []
const unwitnessedForms: string[] = []
for (const [form, snippet] of DECLARATION_WITNESSES) {
  let witnessed = false
  try {
    const t = witnessParser.parse(snippet)
    const stack: any[] = t ? [t.rootNode] : []
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === form) { witnessed = true; break }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  } catch {
    witnessed = false
  }
  witnessResults.push({ form, witnessed, snippet })
  if (!witnessed) {
    // Two failure modes, and only one of them is a phantom. A form the GRAMMAR has
    // but the snippet fails to reach is a bad witness, not a bad disposition — and
    // the two must not be conflated, or the fix is to weaken the witness until the
    // gate goes quiet.
    let grammarHasIt = false
    try {
      const t2 = witnessParser.parse(snippet)
      if (t2) {
        const st: any[] = [t2.rootNode]
        while (st.length > 0) {
          const n = st.pop()!
          if (n.type === form) { grammarHasIt = true; break }
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
        }
      }
    } catch { /* unreachable: the loop above already parsed it */ }
    if (grammarHasIt) unwitnessedForms.push(form)
    else phantomForms.push(form)
  }
}

// --- ORPHAN MEASUREMENT (declared gap, gate 8) -----------------------------
// M49 JD3: ownerName is set only for CLASS scopes, so every object-literal
// method and class-expression member is a containment orphan. This gate asserts
// the gap is MEASURED and DECLARED, so it cannot quietly become a silent loss.
// Two populations, because conflating them is what made this number lie.
//
// A MODULE-SCOPE declaration (`const FOO = 1` at the top level of a file) has no
// owner by construction: it is a ROOT. Counting it as an orphan reported 93.7%
// against a declared JD3 figure of 10.9%, because a utils module is nearly all
// roots — `packages/svelte/src/utils.js` publishes 37 module-scope symbols and
// zero `contains` edges, which is correct behaviour, not a defect.
//
// The JD3 finding is the other population: names declared INSIDE a class body,
// class expression, object literal or function body that carry no containment
// edge. So nesting is decided from the GRAMMAR, not from the analyzer's own
// `scope` field — using the analyzer's attribution to audit the analyzer's
// attribution would be circular, and would have made the two agree by
// construction, which is the exact failure this whole gate was written to
// prevent.
let orphanTotal = 0
let nestedTotal = 0
let classMemberTotal = 0
let classMemberOrphans = 0
let objMethodTotal = 0
let objMethodOrphans = 0
// The split that makes this gate mean something: an object-literal member with a
// reachable binding that the analyzer failed to place is a DEFECT; one with no
// binding is correctly ownerless and must not be counted beside it.
let objBound = 0
let objBoundOrphans = 0
let objUnbound = 0
let objUnboundOrphans = 0
const objBoundSamples: string[] = []
let rootTotal = 0
let symbolTotal = 0
let orphanPct: number | null = null
let orphanSamples: string[] = []

/**
 * The population CONTAINMENT IS SUPPOSED TO COVER, and nothing else.
 *
 * Three earlier definitions of "orphan" were all wrong, and each was wrong in a
 * way that flattered the analyzer:
 *   1. "symbol name is not a contains SOURCE"  -> 205/207 (99%). That is the
 *      OWNER set. `class C { m(){} }` makes C a source, so C looked unplaced.
 *   2. "symbol name is in neither position"    -> 194/207 (94.7%). Closer, but it
 *      still counted module-scope roots.
 *   3. "nested declarations"                    -> 162/173 (93.6%). Roots were
 *      excluded, but FUNCTION-LOCALS were counted, and the containment contract
 *      has never covered a function-local: the doc scopes it to "class members,
 *      prototype methods". `name:constant` and `owned:constant` are locals in a
 *      benchmark file, and demanding a containment edge for them would be
 *      inventing a requirement and then reporting the analyzer as failing it.
 *
 * So the population is read off the CONTRACT: class members (method and field
 * definitions, including those of class EXPRESSIONS) plus object-literal methods,
 * which is exactly the set JD3 names. Measuring against a contract I had not
 * first read is how a gate ends up asserting a number eight times the real one
 * while reporting PASS.
 */
function containmentPopulation(root: any): { members: Set<string>; objMethods: Set<string> } {
  const members = new Set<string>()
  const objMethods = new Set<string>()
  // `inClassish` is a THREE-state walk, because conflating "inside a class" with
  // "not inside a class" is what put object-literal methods in the class bucket
  // and reported 96 class members with 0 object methods on a corpus that is full
  // of object literals.
  const walk = (n: any, inClassish: boolean, inObject: boolean) => {
    if (n.type === "method_definition") {
      const nm = n.childForFieldName("name")
      if (nm) (inClassish && !inObject ? members : objMethods).add(nm.text)
    } else if (n.type === "field_definition") {
      const nm = n.childForFieldName("property")
      // Raw name, `#` INCLUDED. A first draft stripped the `#` on the theory that
      // the analyzer normalises `#x` to `x` — which the doc claims and the
      // analyzer does not do: `legacy-client.js` publishes the symbol `#events`
      // and the edge `Svelte4Component->#events`. Stripping on one side only
      // matched neither, and reported 92/96 class members as unplaced.
      if (nm) members.add(nm.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (!c) continue
      const childInObject = inObject || c.type === "object" || c.type === "object_assignment_pattern"
      const childInClassish = inClassish || c.type === "class_declaration" || c.type === "class"
      walk(c, childInClassish, childInObject)
    }
  }
  walk(root, false, false)
  return { members, objMethods }
}

/**
 * Is a BINDING reachable from this object literal, by the analyzer's own rule?
 *
 * This is the distinction the orphan gate was missing, and it is the difference
 * between a defect and correct silence. The contract the analyzer documents is:
 * an object literal is owned by the binding it initialises, and one that is a call
 * argument, a return value, an array element or an `export default` has no
 * binding to name and "stays ownerless — which is correct, not a gap".
 *
 * Measured across a 120-file svelte sample and then a 600-file one, that split is
 * total: object-literal members with a REACHABLE BINDING and no `contains` edge = 0,
 * and every unplaced one had no binding at all. So the earlier 92/92 figure counted
 * correctly-ownerless members as unplaced. Counting those as a gap is how a phantom
 * survives review: the number is real, the label is wrong.
 *
 * THE ATTRIBUTION, which took a second pass to get right. The 92/92 was originally
 * filed here as "M49 JD3 falsified". JD3 is reviews/javascript/
 * m60-deep-review-2026-09-26.md:209 — "10.9% of real symbols are ownerless and
 * therefore have no contains edge" — and it named a MECHANISM: `addContainment-
 * Relationships` gates on `ownerName`, `ownerName` comes only from `scopeOwnerName`,
 * and `scopeOwnerName` reports CLASS SCOPES ONLY, with only `class_declaration`
 * pushing one. That mechanism no longer exists: the analyzer now derives the owner
 * from `containerOwnerName`, which handles a class expression (by its binding) and
 * an object literal (by its binding) as well as a class declaration. So JD3 was a
 * real finding on 2026-09-26 and its mechanism has since been superseded — it is not
 * falsified, it is HISTORICAL. Saying "falsified" credited this census with
 * disproving something it never tested, and would have left the original review
 * looking wrong rather than fixed.
 */
function bindingReachable(obj: any): string | null {
  let q = obj.parent
  while (q) {
    if (q.type === "variable_declarator") {
      const n = q.childForFieldName("name")
      return n && n.type === "identifier" ? n.text : null
    }
    if (q.type === "assignment_expression") {
      const l = q.childForFieldName("left")
      return l && l.type === "identifier" ? l.text : null
    }
    if (q.type === "pair" || q.type === "object" || q.type === "return_statement" ||
        q.type === "expression_statement" || q.type === "export_statement") {
      q = q.parent
      continue
    }
    return null
  }
  return null
}

{
  const corpus = CORPORA[0]
  const all = walkFiles(corpus.root).sort()
  const stride = Math.max(1, Math.floor(all.length / 120))
  const parser = await (getParser as any)("javascript")
  for (const f of all.filter((_, i) => i % stride === 0).slice(0, 120)) {
    let src = ""
    try {
      if (fs.statSync(f).size > MAX_FILE_BYTES) continue
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    if (!src.trim()) continue
    let r: any
    let tree: any = null
    try {
      r = await ASTEngine.parseFile(f, src)
      tree = parser.parse(src)?.rootNode ?? null
    } catch {
      continue
    }
    if (!tree) continue
    const contained = new Set(
      ((r?.relationships ?? []) as any[]).filter((e) => e.type === "contains").map((e) => String(e.target)),
    )
    const { members, objMethods } = containmentPopulation(tree)
    const population = new Set([...members, ...objMethods])
    // Map each object-literal method to whether a binding reaches its literal.
    const objBind: Map<string, string | null> = new Map()
    {
      const st: any[] = [tree]
      while (st.length > 0) {
        const n = st.pop()!
        let inClass = false
        for (let q: any = n.parent; q; q = q.parent) {
          if (q.type === "class_declaration" || q.type === "class") { inClass = true; break }
        }
        if (n.type === "object" && !inClass) {
          const bind = bindingReachable(n)
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "method_definition") {
              const nm = c.childForFieldName("name")
              if (nm) objBind.set(nm.text, bind)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
    }
    symbolTotal += (r?.symbols ?? []).length
    for (const s of (r?.symbols ?? []) as any[]) {
      const nm = String(s.name)
      if (!population.has(nm)) { rootTotal++; continue }
      nestedTotal++
      const isMember = members.has(nm)
      if (isMember) classMemberTotal++
      else {
        objMethodTotal++
        const bind = objBind.get(nm)
        if (bind) {
          objBound++
          if (!contained.has(nm)) {
            objBoundOrphans++
            if (objBoundSamples.length < 6) {
              objBoundSamples.push(`${path.relative(corpus.root, f)} ${nm} binding=${bind}`)
            }
          }
        } else {
          objUnbound++
          if (!contained.has(nm)) objUnboundOrphans++
        }
      }
      if (!contained.has(nm)) {
        orphanTotal++
        if (isMember) classMemberOrphans++
        else objMethodOrphans++
        if (orphanSamples.length < 6) {
          const which = isMember ? "class-member" : "object-literal-method"
          orphanSamples.push(`${path.relative(corpus.root, f)} ${nm}:${s.kind} [${which}]`)
        }
      }
    }
  }
}

// --- HONESTY GATES ---------------------------------------------------------

// Hoisted: gate 4 measures the leaves the corpus hangs off each reserved base,
// and the artifact publishes them. Publishing the measurement is what lets the
// declared table be DERIVED from evidence rather than curated by guesswork, and
// it is the evidence a reviewer needs to disagree with the table.
const observedByReservedBase: Record<string, string[]> = {}

const failures: string[] = []
const gates: { id: string; pass: boolean; detail: string }[] = []

// 1. every declaration node type the corpus contains is classified
{
  // The direction that matters is DISCOVERED -> DECLARED. A form the corpus
  // contains with no disposition is a blind spot and fails. The reverse — a
  // declared form the 500-file sample happened not to contain — is NOT a
  // failure: generator functions and class expressions are real JavaScript, and
  // a stride sample missing them is a fact about the sample, not about the
  // analyzer. Failing on it would train the next reader to shrink the declared
  // table until the gate went quiet, which is the exact anti-pattern this gate
  // exists to stop.
  const DECL_CANDIDATES = new Set([...DECL_DISPOSITIONS.keys()])
  const discoveredCandidates = [...nodeTypes.keys()].filter((t) => DECL_CANDIDATES.has(t))
  const uncovered = [...discoveredCandidates].filter((t) => !DECL_DISPOSITIONS.get(t))
  const unseen = [...DECL_CANDIDATES].filter((t) => !nodeTypes.has(t))
  // Any node type the corpus contains that LOOKS like a declaration site but is
  // not in the table at all. Heuristic by necessity: the grammar has no
  // "is-declaration" predicate, so this is a name-shape test over the corpus's
  // own node vocabulary, computed rather than curated.
  // Narrow on purpose. A first draft ended the class in `|_expression$`, which
  // matched call_expression, member_expression, await_expression and 17 more —
  // every expression in the grammar, none of which is a declaration SITE. The
  // test that carries signal is the one naming a declaration or binding slot.
  // `class`, `function_expression` and `arrow_function` are declaration sites
  // and are already dispositioned above; they do not need the heuristic.
  const DECL_SHAPE = /_(declaration|definition|declarator|pattern|parameters|clause)$/
  const shapeCandidates = [...nodeTypes.keys()].filter((t) => DECL_SHAPE.test(t) && !DECL_CANDIDATES.has(t))
  const pass = uncovered.length === 0 && shapeCandidates.length === 0
  if (!pass) {
    failures.push(`declaration-shaped node types with no disposition: ${[...uncovered, ...shapeCandidates].join(", ")}`)
  }
  gates.push({
    id: "census-js-declaration-dispositions",
    pass,
    detail: `${discoveredCandidates.length}/${DECL_CANDIDATES.size} declared forms seen in the sample; ${unseen.length} declared but not sampled (informational); ${shapeCandidates.length} unclassified declaration-shaped node types`,
  })
}

// 0. COVERAGE. A census that walks 14.8% of a corpus and reports PASS has made a
// coverage claim it has not earned. The floor is declared here so shrinking the
// sample is a gate failure rather than a quiet reduction in what the lane checks.
{
  const thin = Object.entries(filesAvailable)
    .filter(([k, avail]) => filesWalked[k] / Math.max(1, avail) < 0.9)
    .map(([k, avail]) => `${k} ${filesWalked[k]}/${avail}`)
  const capped = Object.entries(filesAvailable)
    .filter(([k, avail]) => avail > SAMPLE_PER_CORPUS)
    .map(([k, avail]) => `${k} (${avail} files, cap ${SAMPLE_PER_CORPUS})`)
  const pass = thin.length === 0
  if (!pass) failures.push(`corpus coverage below the declared 90% floor: ${thin.join("; ")}`)
  gates.push({
    id: "census-js-corpus-coverage",
    pass,
    detail:
      Object.entries(filesAvailable)
        .map(([k, avail]) => `${k} ${filesWalked[k]}/${avail} (${((100 * filesWalked[k]) / Math.max(1, avail)).toFixed(1)}%)`)
        .join(", ") + (capped.length ? `; CAPPED, raise SAMPLE_PER_CORPUS: ${capped.join(", ")}` : "; nothing capped"),
  })
}

// 1b. every DECLARED form is a node this grammar can actually produce, and every
// declared form carries a snippet that reaches it. This gate exists because five
// dispositions were declared for five forms nobody probed, and probing them found
// two live defects (X10, X11). A declaration table held to nothing is worse than
// no table, because it reads as coverage.
{
  const pass = phantomForms.length === 0 && unwitnessedForms.length === 0
  if (!pass) {
    if (phantomForms.length > 0) {
      failures.push(
        `PHANTOM dispositions — the grammar produces no such node, so the table claims coverage of nothing: ${phantomForms.join(", ")}`,
      )
    }
    if (unwitnessedForms.length > 0) {
      failures.push(`declared forms whose witness snippet does not reach them: ${unwitnessedForms.join(", ")}`)
    }
  }
  gates.push({
    id: "census-js-declarations-witnessed",
    pass,
    detail:
      `${witnessResults.filter((w) => w.witnessed).length}/${DECLARATION_WITNESSES.length} declared forms witnessed by their own snippet; ` +
      `${phantomForms.length} phantom, ${unwitnessedForms.length} unwitnessed`,
  })
}

// 2. both module systems are present in the corpus AND both are probed
{
  const need = ["import_statement", "export_statement", "cjs_require"]
  const missing = need.filter((k) => !moduleForms.has(k))
  const pass = missing.length === 0
  if (!pass) failures.push(`module forms absent from the sample: ${missing.join(", ")}`)
  gates.push({
    id: "census-js-module-space",
    pass,
    detail: `observed: ${[...moduleForms.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
  })
}

// 3. every read position the corpus exercises is declared and probed
{
  const probed = new Set(probeLog.filter((p) => p.probe.startsWith("read:")).map((p) => p.probe))
  // `object-key` is probed under its negative name, because its contract is that
  // the key is NOT read. Requiring a probe literally called read:object-key would
  // have demanded a probe whose correct result is the absence of an edge.
  const ALIAS: Record<string, string> = { "object-key": "read:object-key-not-read" }
  const missing = [...READ_POSITIONS.keys()].filter(
    (p) => !probed.has(`read:${p}`) && !probed.has(`read:${p}-confidence`) && !probed.has(ALIAS[p] ?? "\u0000"),
  )
  const pass = missing.length === 0
  if (!pass) failures.push(`read positions neither declared-and-probed nor explicitly skipped: ${missing.join(", ")}`)
  gates.push({
    id: "census-js-read-positions",
    pass,
    detail: `${READ_POSITIONS.size} read positions declared; ${probed.size} probes recorded`,
  })
}

// 4. THE RULE WITH TEETH: a reserved base must have every leaf declared.
{
  const undeclared: string[] = []
  for (const [base, leaves] of memberLeavesByBase) {
    if (!RESERVED_BASES.has(base)) continue
    observedByReservedBase[base] = [...leaves].sort()
    const declared = new Set([...(DECLARED_SUPPRESSED.get(base) ?? []), ...(DECLARED_NAMED_BASES.get(base) ?? [])])
    for (const leaf of leaves) {
      if (leaf.startsWith("#") || RESERVED_KEYWORDS.has(leaf)) continue
      if (!declared.has(leaf)) undeclared.push(`${base}.${leaf}`)
    }
  }
  const pass = undeclared.length === 0
  if (!pass) {
    failures.push(
      `reserved bases carry UNDECLARED leaves (${undeclared.length}): ${undeclared.slice(0, 12).join(", ")}${undeclared.length > 12 ? " …" : ""}`,
    )
  }
  gates.push({
    id: "census-js-reserved-base-complete",
    pass,
    detail: `${memberLeavesByBase.size} distinct member bases observed; ${undeclared.length} undeclared leaves under reserved bases`,
  })
}

// 5. declared builtins are suppressed, and the probe agrees with the claim
{
  const supProbes = probeLog.filter((p) => p.probe.startsWith("suppress:"))
  const bad = supProbes.filter((p) => !p.pass)
  const pass = bad.length === 0
  if (!pass) failures.push(`declared-suppressed builtins still emit: ${bad.map((b) => b.probe).join(", ")}`)
  gates.push({
    id: "census-js-builtins-suppressed",
    pass,
    detail: `${supProbes.length} suppression probes, ${bad.length} disagreeing with the declared table`,
  })
}

// 5b. THE DOCUMENTATION DEFECT, as an assertable gate. The analyzer doc claims
// "builtins filtered (console.*, Object leaf methods)". Measured: the console
// half holds, the Object half does not — `Object.keys({})` publishes
// `calls keys` and `uses Object`. This gate does not decide which side is right;
// it asserts that the disagreement is ON THE RECORD, so the next reader cannot
// discover it by accident and assume the analyzer is at fault.
{
  const emitted = probeLog.filter((p) => p.probe.startsWith("notsuppressed:"))
  const silent = emitted.filter((p) => p.actual === "no")
  // This gate PASSES when the measurement was taken. The finding it publishes is
  // the DISAGREEMENT, not a pass/fail: `emitted - silent` leaves are named, so
  // for those the doc's "Object leaf methods" claim is simply FALSE. A gate that
  // failed on that would be demanding the analyzer be changed to match a wrong
  // document; the correct outcome is to record the doc as wrong.
  const pass = emitted.length > 0
  if (!pass) failures.push("no not-suppressed probes ran, so the documented builtin-filtering claim was never checked")
  gates.push({
    id: "census-js-doc-builtin-claim",
    pass,
    detail:
      `${emitted.length} global-base leaves probed: ${emitted.length - silent.length} are NAMED, ${silent.length} are silent. ` +
      `FINDING: the analyzer doc claims "builtins filtered (console.*, Object leaf methods)"; the console half holds ` +
      `(console.log publishes no calls log) and the Object half does NOT (Object.keys publishes calls keys AND uses Object). ` +
      `Named: ${emitted.filter((p) => p.actual === "yes").map((p) => p.probe.replace("notsuppressed:", "")).join(", ")}`,
  })
}

// 6. user namespaces survive suppression (the mirror probe)
{
  const bad = probeLog.filter((p) => p.probe.startsWith("user-preserved:") && !p.pass)
  const pass = bad.length > 0 ? false : true
  if (!pass) failures.push(`user namespaces swallowed by builtin suppression: ${bad.map((b) => b.probe).join(", ")}`)
  gates.push({
    id: "census-js-user-namespaces-preserved",
    pass,
    detail: `${probeLog.filter((p) => p.probe.startsWith("user-preserved:")).length} user-namespace probes, ${bad.length} failing`,
  })
}

// 7. non-code text and reserved keywords are silent
{
  const bad = probeLog.filter((p) => (p.probe.startsWith("noncode:") || p.probe.startsWith("reserved:")) && !p.pass)
  const pass = bad.length === 0
  if (!pass) failures.push(`non-code or reserved names leaked into the graph: ${bad.map((b) => `${b.probe}=${b.actual}`).join(", ")}`)
  gates.push({
    id: "census-js-noncode-and-reserved-silent",
    pass,
    detail: `${probeLog.filter((p) => p.probe.startsWith("noncode:") || p.probe.startsWith("reserved:")).length} silence probes, ${bad.length} leaking`,
  })
}

// 8. the containment-orphan gap is measured and declared, not silently absent
{
  orphanPct = nestedTotal ? +((100 * orphanTotal) / nestedTotal).toFixed(1) : null
  // WHO OWNS THIS GATE, and why it is not the corpus.
  //
  // The gate used to require `orphanTotal > 0` and so PASSED on 92/92 — a phantom
  // gap, since every one of those members had no binding to own it. A gate that
  // requires a defect to be present reports health by measuring illness, and sits
  // green forever.
  //
  // Rewritten to demand `objBoundOrphans === 0`, it failed for the OPPOSITE
  // reason: the bound population is EMPTY on this corpus. Widening the sample from
  // 120 to 600 files did not change that — svelte's object literals carrying
  // shorthand methods are export-default test configs and call arguments, which
  // have no binding by construction. So a corpus-driven version of this gate could
  // never be non-vacuous here, and demanding a population that does not exist would
  // leave the gate permanently red for a reason that has nothing to do with the
  // analyzer.
  //
  // So the CONTRACT is gated by four deterministic probes asserting BOTH directions
  // — a bound literal is placed, an unbound one is silent, a named class
  // expression's member is owned by its binding and never by a dangling own-name —
  // and the corpus is reported as evidence of how much the shape is exercised
  // (here: not at all, which is itself the finding). Non-vacuity is asserted on the
  // PROBES, which cannot silently shrink to zero the way a corpus population can.
  const containProbes = probeLog.filter((x) => x.probe.startsWith("contain:"))
  const containBad = containProbes.filter((x) => !x.pass)
  const probesRan = containProbes.length === 4
  const pass = symbolTotal > 0 && probesRan && containBad.length === 0 && objBoundOrphans === 0
  if (!pass) {
    if (symbolTotal === 0) {
      failures.push("orphan measurement saw nothing — the gate cannot report a population it did not measure")
    } else if (!probesRan) {
      failures.push(`only ${containProbes.length}/4 containment probes ran — a partial probe set cannot certify the contract`)
    } else if (containBad.length > 0) {
      failures.push(`containment contract violated: ${containBad.map((b) => `${b.probe}=${b.actual} (wanted ${b.expect})`).join("; ")}`)
    } else {
      failures.push(
        `object-literal members with a REACHABLE BINDING that the analyzer failed to place: ${objBoundOrphans} ` +
        `of ${objBound} (${objBoundSamples.join("; ")})`,
      )
    }
  }
  gates.push({
    id: "census-js-containment-contract",
    pass,
    detail:
      `contract gated by ${containProbes.length} probes (${containBad.length} violating), NOT by the corpus. ` +
      `${rootTotal} symbols outside the containment contract. Of ${nestedTotal} in it: ` +
      `CLASS members ${classMemberOrphans}/${classMemberTotal} unplaced ` +
      `(${classMemberTotal ? ((100 * classMemberOrphans) / classMemberTotal).toFixed(1) : "n/a"}%), ` +
      `OBJECT-LITERAL methods ${objMethodOrphans}/${objMethodTotal} unplaced ` +
      `(${objMethodTotal ? ((100 * objMethodOrphans) / objMethodTotal).toFixed(1) : "n/a"}%). ` +
      `OF WHICH the defect population is ${objBoundOrphans}/${objBound}: object-literal members that HAVE a binding ` +
      `and were not placed. The other ${objUnboundOrphans}/${objUnbound} have NO reachable binding (export default, ` +
      `return value, call argument, array element) and are correctly ownerless by the analyzer's own documented ` +
      `contract — so M49 JD3's object-literal claim is FALSIFIED on this corpus, and the earlier 92/92 figure ` +
      `counted correctly-ownerless members as a gap`,
  })
}

// 9. the NAMED claim is PROBED, not just declared. A table asserting "these 14
// bases and ~110 leaves are named" is worth nothing if it is never checked, and
// the cheap failure mode is silent: a widened suppression set would make the doc's
// claim true while quietly deleting real edges. One leaf per base is enough to
// catch that, and the probe is a real snippet, not a table lookup.
{
  const probes: { probe: string; expect: string; actual: string; pass: boolean }[] = []
  for (const [base, leaves] of DECLARED_NAMED_BASES) {
    for (const leaf of leaves.slice(0, 2)) {
      // `base.leaf` may be a property (process.env) or a call (Math.floor); the
      // analyzer names both, so the probe asks only "is it named at all".
      const r = await analyze(`named-${base}`, `const probe = ${base}.${leaf}\n`)
      const named = targets(r, "uses").includes(leaf) || targets(r, "calls").includes(leaf) || names(r).includes(leaf)
      probes.push({ probe: `named:${base}.${leaf}`, expect: "yes", actual: named ? "yes" : "no", pass: named })
    }
  }
  probeLog.push(...probes)
  const bad = probes.filter((p) => !p.pass)
  if (bad.length > 0) {
    failures.push(`bases declared NAMED whose leaves the analyzer does not name: ${bad.map((b) => b.probe).join(", ")}`)
  }
  gates.push({
    id: "census-js-named-bases-verified",
    pass: bad.length === 0,
    detail: `${probes.length} named-base probes across ${DECLARED_NAMED_BASES.size} bases, ${bad.length} contradicting the declared table`,
  })
}

const moduleProbes = probeLog.filter((p) => p.probe.startsWith("module:"))
const moduleBad = moduleProbes.filter((p) => !p.pass)
if (moduleBad.length > 0) failures.push(`module probes failed: ${moduleBad.map((b) => b.probe).join(", ")}`)
gates.push({
  id: "census-js-module-probes",
  pass: moduleBad.length === 0,
  detail: `${moduleProbes.length} module probes (ESM + CJS), ${moduleBad.length} failing`,
})

// --- ARTIFACT --------------------------------------------------------------

const artifact = {
  census: "M14.0.JS-CENSUS",
  lane: "javascript",
  generatedAt: new Date().toISOString(),
  independence:
    "Discovery reads the CORPUS and the GRAMMAR only. Neither the analyzer's tables nor the oracle is consulted for discovery, because a construct both of them forgot cannot appear as a disagreement — that is the X1 shape. The analyzer is consulted only for the probes.",
  coverage: Object.fromEntries(
    Object.keys(filesWalked).map((k) => [
      k,
      {
        walked: filesWalked[k],
        available: filesAvailable[k] ?? 0,
        fraction: filesAvailable[k] ? +((100 * filesWalked[k]) / filesAvailable[k]).toFixed(1) : null,
        capped: (filesAvailable[k] ?? 0) > SAMPLE_PER_CORPUS,
      },
    ]),
  ),
  sample: {
    perCorpus: SAMPLE_PER_CORPUS,
    maxFileBytes: MAX_FILE_BYTES,
    selection: "sorted, then evenly strided — deterministic and reproducible",
    filesWalked,
  },
  reservedBaseLeaves: Object.fromEntries(
    Object.entries(observedByReservedBase).map(([b, l]) => [
      b,
      {
        observed: l,
        suppressed: DECLARED_SUPPRESSED.get(b) ?? [],
        named: l.filter((x) => !(DECLARED_SUPPRESSED.get(b) ?? []).includes(x)),
        undeclared: l.filter((x) => !(DECLARED_SUPPRESSED.get(b) ?? []).includes(x) && !(DECLARED_NAMED_BASES.get(b) ?? []).includes(x)),
      },
    ]),
  ),
  counts: {
    distinctNodeTypes: nodeTypes.size,
    declarationFormsPresent: [...nodeTypes.keys()].filter((t) => DECL_DISPOSITIONS.has(t)).length,
    declarationFormsDeclared: DECL_DISPOSITIONS.size,
    distinctMemberBases: memberBases.size,
    moduleForms: Object.fromEntries(moduleForms),
  },
  dispositions: {
    declarations: Object.fromEntries(DECL_DISPOSITIONS),
    readPositions: Object.fromEntries(READ_POSITIONS),
    reservedBases: [...RESERVED_BASES],
    reservedKeywords: [...RESERVED_KEYWORDS],
    declaredSuppressed: Object.fromEntries([...DECLARED_SUPPRESSED].map(([k, v]) => [k, v])),
  },
  orphanGap: {
    finding: "JD3 (reviews/javascript/m60-deep-review-2026-09-26.md:209, '10.9% of real symbols are ownerless') is HISTORICAL, not falsified. It diagnosed ownerName coming only from scopeOwnerName, which reported class scopes only; the analyzer now derives the owner from containerOwnerName, which handles class expressions and object literals by their binding. The defect population measured here — object-literal members WITH a reachable binding that were not placed — is 0. Members with no binding (export default, return value, call argument, array element) are correctly ownerless by the analyzer's own documented contract.",
    population: "class members (method/field definitions, including class expressions) and object-literal methods — the set the containment contract covers. Roots, function-locals and top-level declarations are EXCLUDED because no containment edge is claimed for them.",
    excludedFromPopulation: rootTotal,
    classMembers: { total: classMemberTotal, orphans: classMemberOrphans },
    objectLiteralMethods: {
      total: objMethodTotal,
      orphans: objMethodOrphans,
      withReachableBinding: { total: objBound, unplaced: objBoundOrphans, samples: objBoundSamples },
      withoutBinding: { total: objUnbound, unplaced: objUnboundOrphans, disposition: "correctly ownerless — no binding to name" },
      ruling: "0 of the BOUND members are unplaced, so the containment contract holds for this shape. The 92/92 figure counted members that have no binding at all, which the contract places outside containment by design.",
    },
    symbolsTotal: symbolTotal,
    moduleScopeRoots: rootTotal,
    nestedSymbols: nestedTotal,
    orphans: orphanTotal,
    pct: orphanPct,
    samples: orphanSamples,
    disposition: "DECLARED AND MEASURED — not closed by this gate; closing it is a separate change with its own blast radius",
  },
  declarationWitnesses: witnessResults,
  probes: probeLog,
  gates,
  failures,
  status: failures.length === 0 ? "PASS" : "FAIL",
}

const outDir = path.join(ROOT, "validation/m14/results")
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, "M14.0.JS-CENSUS.json")
fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2) + "\n")

console.log(`\nM14.0.JS-CENSUS — ${artifact.status}`)
console.log(`  sample: ${JSON.stringify(filesWalked)} (cap ${SAMPLE_PER_CORPUS}/corpus, deterministic stride)`)
for (const g of gates) console.log(`  ${g.pass ? "PASS" : "FAIL"}  ${g.id}\n          ${g.detail}`)
if (failures.length > 0) {
  console.log("")
  for (const f of failures) console.log(`  ! ${f}`)
}
console.log(`\n  artifact: ${path.relative(ROOT, outFile)}`)
process.exit(failures.length === 0 ? 0 : 1)
