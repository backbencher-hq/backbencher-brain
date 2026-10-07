// SVELTE LABELLING AUDIT — question 4 of the six: is each edge carrying the RIGHT type,
// rather than a neighbour of it?
//
// WHY THIS IS A SEPARATE INSTRUMENT. Questions 2 (fires), 5 (resolved) and 6 (confident)
// are answered by svelte-census.mts, and question 3 (an oracle agrees) by the differential
// — but the differential cannot see a MISLABELLING. Both sides read the same grammar, and
// if the analyzer publishes `uses` where the truth is `references`, the oracle published by
// the same reading publishes `uses` too, and they agree perfectly on a wrong answer. That
// is the shared-premise failure the workstream doc records for `overrides` in Bash, and the
// one svelte's own R7 fix hit: the F5 oracle mirrored the handler rule VERBATIM, so both
// sides accepted `on:click={null}` and both emitted `calls -> null`.
//
// So labelling is checked here by ASYMMETRY: an edge whose shape is characteristic of one
// type but labelled as another. The rules below are derived from the TYPE DEFINITIONS in
// the workstream doc and from each type's own emitter, not from a list of expected outputs.
//
//   contains   must have a SOURCE that is a container: a component, a class, or a symbol
//              with an owner. A `contains` whose target is not declared inside its source's
//              scope is a mislabelled `uses`.
//   uses       must have a SOURCE that is a READER (component or function), and it must NOT
//              be an import specifier — `uses X -> mod:item` duplicates the `imports` edge
//              the same fact already carries.
//   calls      must have a TARGET that is callable-shaped: not a type, not a literal, not a
//              dotted module path.
//   instantiates must have a TARGET that is a COMPONENT TAG — not a builtin, not a type.
//   exports    must have a SOURCE that OWNS the target, not a reader.
//   imports    must have a TARGET spelled `module:item` or a bare module.
//
// Every rule below is a NECESSARY condition published by the type's own emitter, so a hit
// is a real asymmetry and a miss is not a proof of correctness — stated, because an
// all-clear from a necessary-condition check is weaker than it looks.
//
// NO REGEX (master rule 1). String equality, Set membership, index arithmetic.
//
//   bun script/m14/svelte-labelling-audit.mts
//   ONLY=svelte bun script/m14/svelte-labelling-audit.mts

import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const ONLY = process.env.ONLY || ""
const MAXBYTES = 512 * 1024
const SAMPLE = Number(process.env.SAMPLE || 4)

function svelteFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 20) return
  let ents: any[]
  try {
    ents = readdirSync(dir, { withFileTypes: true }) as any[]
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      svelteFiles(p, out, depth + 1)
    } else if (e.name.endsWith(".svelte")) out.push(p)
  }
}

const files: string[] = []
const repoDirs: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  if (ONLY && !e.includes(ONLY)) continue
  const dir = join(CORPUS, e)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  repoDirs.push(dir)
  svelteFiles(dir, files)
}
files.sort()

const eng: any = await import(`${REPO}/src/ast/engine.ts`)

/** Builtin HTML tags — the same set the analyzer filters, re-derived here rather than
 *  imported, because importing the emitter's own set would test it against itself. */
const HTML_BUILTIN = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
  "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col",
  "colgroup", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl",
  "dt", "em", "embed", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img",
  "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu",
  "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p",
  "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "search",
  "section", "select", "slot", "small", "source", "span", "strong", "style", "sub",
  "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
])

/** JS builtins and the DOM constructors a Svelte component calls. A call to one of these
 *  is a real call declared by no file and bound by no import — without this row every
 *  `Boolean(x)` and `new DataTransfer()` in the corpus reads as a mislabelling. Only
 *  UPPERCASE-initial names are listed, because that is the set rule L3 examines; a
 *  lowercase global like `parseInt` never reaches the test.
 *
 *  DOM constructors are here because the browser provides them exactly the way it provides
 *  `Boolean` — host globals, not file-declared bindings. Verified against
 *  svelte/tests/runtime-browser/samples/binding-files/main.svelte:7,16, which calls
 *  `new DataTransfer()` twice. */
const JS_GLOBALS = new Set([
  // ECMAScript
  "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean",
  "DataView", "Date", "Error", "EvalError", "FinalizationRegistry", "Float32Array",
  "Float64Array", "Function", "Int16Array", "Int32Array", "Int8Array", "Intl",
  "Map", "Math", "Number", "Object", "Promise", "Proxy", "RangeError",
  "ReferenceError", "Reflect", "RegExp", "Set", "SharedArrayBuffer", "String",
  "Symbol", "SyntaxError", "TypeError", "URIError", "Uint16Array", "Uint32Array",
  "Uint8Array", "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet",
  // DOM — the ones a Svelte component's template and script actually reach
  "AbortController", "AbortSignal", "Animation", "Attr", "Audio", "Blob", "CanvasRenderingContext2D",
  "CharacterData", "ClipboardEvent", "CloseEvent", "Comment", "CustomEvent", "DataTransfer",
  "Document", "DocumentFragment", "DOMParser", "Element", "ErrorEvent", "Event", "EventSource",
  "EventTarget", "File", "FileList", "FileReader", "FocusEvent", "FormData", "HTMLElement",
  "HTMLButtonElement", "HTMLDivElement", "HTMLFormElement", "HTMLInputElement", "HTMLLIElement",
  "HTMLImageElement", "HTMLElement", "KeyboardEvent", "MessageChannel", "MessagePort",
  "MouseEvent", "MutationObserver", "Node", "NodeFilter", "NodeList", "Notification",
  "PointerEvent", "Range", "Request", "Response", "ResizeObserver", "ShadowRoot", "Text",
  "TextEncoder", "TextNode", "TouchEvent", "TransitionEvent", "UIEvent", "URL", "URLSearchParams",
  "WebSocket", "WheelEvent", "Window", "XMLHttpRequest",
])

/** SymbolKinds that are CONTAINERS by construction — a declaration with a body that can
 *  therefore own members. Derived from the SymbolKind vocabulary rather than listed per
 *  corpus case, which is what makes the `contains` rule survive the next corpus.
 *
 *  `namespace` and `constant` are here because both turned out to be containers in this
 *  corpus and neither was on the first list: `namespace SomeNamespace { export type Foo }`
 *  at runtime-runes/samples/typescript/main.svelte:43-45, and
 *  `const nested = { get fallback_value() {...} }` at
 *  runtime-runes/samples/props-default-value-lazy-accessors/main.svelte:5-10, which yields
 *  `contains nested -> fallback_value @6`. Both kinds were added to the vocabulary by lanes
 *  other than this one, which is exactly why a hand-list kept missing them. */
const CONTAINER_KINDS = new Set(["class", "interface", "type", "namespace", "constant", "enum"])

type Finding = { kind: string; file: string; edge: string; why: string }
const findings: Finding[] = []
const perRule = new Map<string, number>()
function hit(kind: string, file: string, edge: string, why: string): void {
  perRule.set(kind, (perRule.get(kind) ?? 0) + 1)
  if (findings.filter((f) => f.kind === kind).length < SAMPLE) {
    findings.push({ kind, file, edge, why })
  }
}


// -----------------------------------------------------------------------------
// CALIBRATION — every rule above must be shown to FIRE, before any of its zeros is read.
//
// A labelling audit that reports 0 over 47,713 edges is indistinguishable from a labelling
// audit whose predicates can never match. That is not a hypothetical: the FIRST version of
// this instrument reported 2,296 "findings", and when the rules were corrected to stop
// rejecting correct edges the count fell to 0 — at which point nothing in the output
// distinguishes "the analyzer is correctly labelled" from "I disabled the checks while
// fixing them". The mutants I wrote to answer that were useless in the other direction:
// they removed exclusions, which can only LOWER a count that was already 0.
//
// So the rules run here over hand-built inputs that are wrong ON PURPOSE, through the same
// code path, and each must fire. A rule that stays silent on its own counter-example is
// reported as DEAD rather than passing silently.
console.log("CALIBRATION — each rule against a deliberately-wrong edge, through the same predicates")
console.log("-".repeat(100))

type Sym = { name: string; kind: string; ownerName?: string; parameters?: Array<{ name: string }>; metadata?: any }

/** The same context the corpus walk builds, from a hand-written symbol table. */
function makeCtx(syms: Sym[], imports: string[], componentName: string) {
  const declared = new Set<string>()
  const ownerNames = new Set<string>()
  const typeNames = new Set<string>()
  const snippetNames = new Set<string>()
  const containerNames = new Set<string>()
  const parameterNames = new Set<string>()
  const importBindings = new Set<string>()
  for (const im of imports) if (im !== "*") importBindings.add(im)
  for (const s of syms) {
    const n = s.name
    if (!n) continue
    declared.add(n)
    if (s.kind === "type" || s.kind === "interface") typeNames.add(n)
    if (CONTAINER_KINDS.has(s.kind)) containerNames.add(n)
    if (s.metadata?.isSnippet === true) snippetNames.add(n)
    if (s.ownerName) ownerNames.add(s.ownerName)
    for (const prm of s.parameters ?? []) if (prm.name) parameterNames.add(prm.name)
  }
  return { declared, ownerNames, typeNames, snippetNames, containerNames, parameterNames, importBindings, componentName }
}

/** Each rule as a PURE predicate over (ctx, src, tgt, metadata). Extracted from the corpus
 *  walk so the calibration below exercises the identical logic, not a paraphrase of it. */
const RULES_PURE: Record<string, (ctx: ReturnType<typeof makeCtx>, src: string, tgt: string, md: any) => string | null> = {
  L1: (c, src) => {
    const isComponent = src === c.componentName
    if (!isComponent && !c.typeNames.has(src) && !c.ownerNames.has(src) && !c.containerNames.has(src))
      return `source "${src}" owns nothing, is not the component, and is not a type`
    return null
  },
  L2: (c, _src, tgt) => {
    const i = tgt.lastIndexOf(":")
    if (i <= 0) return null
    const mod = tgt.slice(0, i)
    const item = tgt.slice(i + 1)
    if (mod.includes("/") || mod.includes(".") || c.importBindings.has(item)) return `target is spelled module:item ("${mod}" / "${item}")`
    return null
  },
  L3: (c, _src, tgt) => {
    const leaf = tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
    const first = leaf.split(".")[0]
    if (!(first.length > 0 && first[0] === first[0].toUpperCase() && first.length > 1)) return null
    if ((c.typeNames.has(tgt) || c.typeNames.has(leaf)) && !c.snippetNames.has(tgt) && !c.snippetNames.has(leaf)) return `target "${tgt}" is a type`
    if (JS_GLOBALS.has(tgt) || JS_GLOBALS.has(leaf)) return null
    if (c.snippetNames.has(tgt) || c.snippetNames.has(leaf)) return null
    if (first[0] === "$") return null
    if (leaf.startsWith("(")) return null
    if (leaf.startsWith("#")) return null
    const callable = ["class", "function"].includes(c.kindOf?.(tgt) ?? "") || c.snippetNames.has(tgt)
    if (!callable && !c.importBindings.has(tgt) && !c.parameterNames.has(tgt)) return `target "${tgt}" is not callable`
    return null
  },
  /** A `calls` into a TYPE name. Separate from L3 because it is the one case where the
   *  target IS declared in the file and is still not callable — so it cannot be reached by
   *  the "is it declared?" arm of L3 and needs its own predicate. */
  L3c: (c, _src, tgt) => {
    const leaf = tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
    // A name can be BOTH a type alias and a snippet in one file, and this corpus has one:
    // collapsible-file-tree.svelte declares `type FileTreeItem = {...}` at line 9 AND
    // `{#snippet FileTreeItem({ item })}` at line 88, then `{@render FileTreeItem(
    // { item })}` at line 81 calls the SNIPPET. The snippet wins because that is the
    // construct at the call site, and the collision is real rather than a corpus typo.
    if ((c.typeNames.has(tgt) || c.typeNames.has(leaf)) && !c.snippetNames.has(tgt) && !c.snippetNames.has(leaf))
      return `target "${tgt}" is declared as a type/interface in this file and is not a snippet`
    return null
  },
  L3b: (_c, _src, tgt) => (tgt.includes("/") && !tgt.includes(".") ? `target "${tgt}" is a module path` : null),
  L4: (_c, _src, tgt) => (HTML_BUILTIN.has(tgt) ? `target "${tgt}" is a builtin HTML element` : null),
  L4b: (_c, _src, tgt) => (tgt.startsWith("svelte:") ? `target "${tgt}" is a svelte: primitive` : null),
  L5: (c, src, _tgt, md) => {
    const isComponent = src === c.componentName
    const isModuleBlock = md?.isModuleBlock === true || md?.context === "module" || md?.module === true
    if (!isComponent && !isModuleBlock && !c.ownerNames.has(src)) return `source "${src}" owns nothing`
    return null
  },
  L6: (_c, _src, tgt) => (tgt.lastIndexOf(":") < 0 ? `target "${tgt}" carries no module:item separator` : null),
  L6b: (_c, _src, tgt) => {
    // `i > 0` is WRONG here and the calibration caught it: for the bare `*` spelling the
    // colon is at index 0, so `lastIndexOf` returns 0 and `i > 0` rejects exactly the input
    // this rule exists to catch. The condition is that the MODULE half is empty, not that
    // the separator sits somewhere past position zero.
    const i = tgt.lastIndexOf(":")
    if (i < 0) return null
    if (tgt.slice(i + 1) === "*" && tgt.slice(0, i).length === 0) return `target "${tgt}" is a bare "*" with no module`
    return null
  },
  L6c: (_c, _src, tgt) => {
    const i = tgt.lastIndexOf(":")
    return i > 0 && tgt.slice(i + 1).length === 0 ? `target "${tgt}" has an empty item name` : null
  },
}

type CalCase = { rule: string; label: string; syms: Sym[]; imports?: string[]; src: string; tgt: string; md?: any; expect: boolean }
const CAL: CalCase[] = [
  // Each of these is a WRONG edge, and each must be caught.
  { rule: "L1", label: "contains from a plain local that owns nothing", syms: [{ name: "Card", kind: "property", ownerName: "my-card" }], src: "someLocal", tgt: "Card", expect: true },
  { rule: "L2", label: "uses restating an import as module:item", syms: [{ name: "Card", kind: "property", ownerName: "c" }], imports: ["Card"], src: "c", tgt: "lib/x.js:Card", expect: true },
  { rule: "L3", label: "calls an undeclared PascalCase callee", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "NeverDeclared", expect: true },
  { rule: "L3b", label: "calls a module path", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "some/module", expect: true },
  { rule: "L3c", label: "calls a type alias", syms: [{ name: "Shape", kind: "type" }, { name: "c", kind: "class" }], src: "c", tgt: "Shape", expect: true },
  { rule: "L4", label: "instantiates a builtin HTML tag", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "div", expect: true },
  { rule: "L4b", label: "instantiates a svelte: primitive", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "svelte:component", expect: true },
  { rule: "L5", label: "exports from a reader, not an owner", syms: [{ name: "Card", kind: "property", ownerName: "c" }], src: "plainLocal", tgt: "Card", expect: true },
  { rule: "L6", label: "imports with no module:item separator", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "Card", expect: true },
  { rule: "L6b", label: "imports as a bare * with no module", syms: [{ name: "c", kind: "class" }], src: "c", tgt: ":*", expect: true },
  { rule: "L6c", label: "imports with an empty item name", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "lib/x.js:", expect: true },
  // And each of these is a CORRECT edge, which must NOT be caught — a rule that fires on
  // correct output is the failure mode this instrument already hit seven times.
  { rule: "L1", label: "contains from the component", syms: [{ name: "title", kind: "property", ownerName: "my-card" }], src: "my-card", tgt: "title", expect: false },
  { rule: "L1", label: "contains from a class", syms: [{ name: "x", kind: "property", ownerName: "X" }], src: "X", tgt: "x", expect: false },
  { rule: "L1", label: "contains from a namespace", syms: [{ name: "Foo", kind: "type", ownerName: "SomeNamespace" }], src: "SomeNamespace", tgt: "Foo", expect: false },
  { rule: "L2", label: "uses a bare local of the same name", syms: [{ name: "title", kind: "property", ownerName: "c" }], imports: ["Card"], src: "c", tgt: "title", expect: false },
  { rule: "L3", label: "calls a JS global", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "Boolean", expect: false },
  { rule: "L3", label: "calls a snippet via @render", syms: [{ name: "Row", kind: "method", metadata: { isSnippet: true } }, { name: "c", kind: "class" }], src: "c", tgt: "Row", expect: false },
  { rule: "L3", label: "calls a $ store value", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "$store", expect: false },
  { rule: "L3", label: "calls a function parameter", syms: [{ name: "Wrapper", kind: "function", parameters: [{ name: "Component" }] }], src: "Wrapper", tgt: "Component", expect: false },
  { rule: "L3", label: "calls a declared class", syms: [{ name: "Chart", kind: "class" }, { name: "c", kind: "class" }], src: "c", tgt: "Chart", expect: false },
  { rule: "L3c", label: "calls a snippet that shares a type alias's name", syms: [{ name: "FileTreeItem", kind: "type" }, { name: "FileTreeItem", kind: "method", metadata: { isSnippet: true } }], src: "c", tgt: "FileTreeItem", expect: false },
  { rule: "L4", label: "instantiates a component", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "Card", expect: false },
  { rule: "L5", label: "exports from the component", syms: [{ name: "title", kind: "property", ownerName: "my-card" }], src: "my-card", tgt: "title", expect: false },
  { rule: "L5", label: "exports from a module block", syms: [{ name: "ctx", kind: "constant" }], src: "someLocal", tgt: "ctx", md: { context: "module" }, expect: false },
  { rule: "L6", label: "imports a namespace, spelled mod:*", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "lib/x.js:*", expect: false },
  { rule: "L6", label: "imports a named binding", syms: [{ name: "c", kind: "class" }], src: "c", tgt: "lib/x.js:Card", expect: false },
]

let calFail = 0
for (const t of CAL) {
  // The L3 predicate consults kindOf; attach it from the symbol table.
  const ctx = makeCtx(t.syms, t.imports ?? [], "my-card") as any
  ctx.kindOf = (n: string) => t.syms.find((s) => s.name === n)?.kind ?? ""
  const got = RULES_PURE[t.rule](ctx, t.src, t.tgt, t.md ?? {})
  const fired = got !== null
  const ok = fired === t.expect
  if (!ok) calFail++
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${t.rule.padEnd(4)} ${(t.expect ? "wrong edge" : "correct edge").padEnd(14)} ${t.label}` +
    (ok ? "" : `
          expected ${t.expect ? "a hit" : "no hit"}; got ${fired ? `"${got}"` : "no hit"}`),
  )
}
console.log(`  ${calFail === 0 ? "all" : calFail} calibration case(s) ${calFail === 0 ? "behaved as specified" : "FAILED"}`)
console.log("")
if (calFail > 0) {
  console.error("CALIBRATION FAILED — a rule that cannot recognise its own counter-example proves nothing about the corpus.")
  process.exit(1)
}

let parsed = 0, edges = 0
const perType = new Map<string, number>()

for (const abs of files) {
  let content: string
  try {
    if (statSync(abs).size > MAXBYTES) continue
    content = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  if (content.length === 0) continue
  let res: any
  try {
    res = await eng.parseFile(abs, content)
  } catch {
    continue
  }
  parsed++

  const syms = res?.symbols ?? []
  const rels = res?.relationships ?? []
  // The file stem, by SUFFIX CHECK rather than a pattern. The analyzer names the component
  // from the stem (docs/analyzers/real-svelte-analyzer.md: "Svelte SFCs are not
  // type-analyzed"), so the two must derive it identically or every L1/L5 rule below would
  // compare against a name that can never match.
  const base = abs.slice(abs.lastIndexOf("/") + 1)
  const componentName = base.endsWith(".svelte") ? base.slice(0, base.length - ".svelte".length) : base

  // Declared-in-this-file bindings, for the resolution rules.
  const declared = new Set<string>()
  const owned = new Set<string>()
  const ownerOf = new Map<string, string>()
  // Names that OWN at least one other symbol. Built forward while walking the symbol list.
  // Reading the owner relation BACKWARDS (looking up the edge's SOURCE in the member->owner
  // map) asks "who owns this class?", which no member ever answers — see rule L1(c).
  const ownerNames = new Set<string>()
  // Names that are TYPES or other non-callable declarations. A `calls` edge whose target
  // is one of these is a genuine mislabelling; without this row the L3 rule below fires
  // on every TypeScript `type` alias, which is not what L3 is for. Collected from the
  // emitted symbols, so the rule stays derived rather than hand-listed.
  const typeNames = new Set<string>()
  // Names reachable as a MEMBER of some declared type/interface, so a `contains` from a
  // type alias to its members is membership in a real scope. Verified by hand on
  // block-viewer.svelte:12-20, `type BlockViewerContextType = { item; view; activeFile;
  // resizablePaneRef; ... }` and the analyzer publishes `contains
  // BlockViewerContextType -> item` and four siblings. That is correct.
  const typeMemberNames = new Set<string>()
  const containerNames = new Set<string>()
  // PARAMETERS are callable names. `function Wrapper(Component) { return Component(...args) }`
  // at runtime-runes/samples/create-context-programmatic/main.svelte:12-16 makes the
  // parameter `Component` the callee at line 15, and that is correct — a higher-order
  // function's parameter is the most ordinary callable there is. The analyzer records
  // parameters on the symbol, never as symbols of their own, so a top-level-declaration
  // test cannot see them. That was the last of this rule's misses, and it is the only one
  // that needed the parameters channel rather than a new kind or a new set.
  const parameterNames = new Set<string>()
  for (const s2 of syms) {
    for (const prm of (s2.parameters ?? []) as any[]) {
      const pn = String(prm?.name ?? "")
      if (pn) parameterNames.add(pn)
    }
  }
  // `{#snippet name(...)}` — Svelte compiles these to functions and `{@render name()}`
  // invokes them, so `calls X -> name` is a real call. The analyzer publishes them as
  // Method symbols with metadata.isSnippet.
  const snippetNames = new Set<string>()
  for (const s of syms) {
    const n = String(s.name ?? "")
    if (!n) continue
    declared.add(n)
    const k = String(s.kind ?? "")
    if (k === "type" || k === "interface") typeNames.add(n)
    if (CONTAINER_KINDS.has(k)) containerNames.add(n)
    if ((s.metadata ?? {}).isSnippet === true) snippetNames.add(n)
    const o = String(s.ownerName ?? s.owner ?? "")
    if (o) {
      owned.add(n)
      ownerOf.set(n, o)
      ownerNames.add(o)
      // `contains <type> <member>` is legitimate membership in the type's own body.
      if (typeNames.has(o)) typeMemberNames.add(n)
    }
  }
  const importBindings = new Set<string>()
  for (const im of res?.imports ?? []) for (const it of im.items ?? []) if (it && it !== "*") importBindings.add(String(it))

  for (const r of rels) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (!t) continue
    edges++
    perType.set(t, (perType.get(t) ?? 0) + 1)
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    const md = (r.metadata ?? {}) as any
    const line = r.line_number
    const edge = `${t} ${src} -> ${tgt} @${line}`

    // DISPATCH. Every rule below is a PURE PREDICATE in `RULES_PURE`, and the corpus walk
    // and the CALIBRATION block above both go through this one table. That is deliberate:
    // the first version inlined the rules in the walk and wrote a paraphrase of them for
    // the calibration, so the calibration could pass while the walk disagreed. One table,
    // one implementation, and the counter-examples above are the proof that each predicate
    // can actually fire.
    //
    // The narrative of what each rule MEANS and the corpus files that corrected it is kept
    // beside the predicates in `RULES_PURE` rather than here.
    const kindOf = (n: string): string => {
      for (const s3 of syms) if (String(s3.name ?? "") === n) return String(s3.kind ?? "")
      return ""
    }
    const ctx = {
      declared, ownerNames, typeNames, snippetNames, containerNames, parameterNames,
      importBindings, componentName, kindOf,
    }
    const applicable: Record<string, string[]> = {
      contains: ["L1"],
      uses: ["L2"],
      calls: ["L3", "L3b", "L3c"],
      instantiates: ["L4", "L4b"],
      exports: ["L5"],
      imports: ["L6", "L6b", "L6c"],
    }
    for (const rule of applicable[t] ?? []) {
      const why = RULES_PURE[rule](ctx as any, src, tgt, md)
      if (why) hit(rule, abs, edge, why)
    }
  }
}

console.log("svelte labelling audit — question 4: is each edge carrying the RIGHT type?")
console.log(`POPULATION (derived by readdir over ${CORPUS}): ${files.length} .svelte files across ${repoDirs.length} repos${ONLY ? `, filtered to "${ONLY}"` : ""}`)
console.log(`parsed ${parsed}   edges examined ${edges}`)
console.log(`per type: ${[...perType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join("  ")}`)
console.log("")
console.log("ASYMMETRY RULES — each a NECESSARY condition published by the type's own emitter")
console.log("-".repeat(100))
const RULES: Array<[string, string]> = [
  ["L1", "contains source must be a container (component, class, TYPE, or an owner)"],
  ["L2", "uses must not restate an `imports` edge as module:item"],
  ["L3", "calls target must be callable-shaped (JS globals and snippets excluded)"],
  ["L3b", "calls target must not be a module path"],
  ["L3c", "calls target must not be a type/interface"],
  ["L4", "instantiates target must not be a builtin HTML tag"],
  ["L4b", "instantiates target must not be a svelte: primitive"],
  ["L5", "exports source must be an owner, not a reader"],
  ["L6", "imports target must be spelled module:item"],
  ["L6b", "imports must not be a bare `*` with no module"],
  ["L6c", "imports must not carry an empty item name"],
]
for (const [id, text] of RULES) {
  const n = perRule.get(id) ?? 0
  console.log(`  ${id.padEnd(5)} ${String(n).padStart(6)}  ${text}`)
}
const totalHits = [...perRule.values()].reduce((a, b) => a + b, 0)
console.log(`  ${"TOTAL".padEnd(5)} ${String(totalHits).padStart(6)}`)
console.log("")

if (findings.length > 0) {
  console.log(`SAMPLES (up to ${SAMPLE} per rule, each with the file so it can be checked by hand)`)
  for (const f of findings) {
    console.log(`  [${f.kind}] ${f.file}`)
    console.log(`      ${f.edge}`)
    console.log(`      why: ${f.why}`)
  }
  console.log("")
}
console.log("SCOPE, because an all-clear from necessary conditions is weaker than it reads:")
console.log("  Every rule above is a NECESSARY condition the type's own emitter publishes, so a")
console.log("  hit is a real asymmetry. A MISS is not proof of correct labelling: these rules")
console.log("  detect an edge wearing a neighbour's shape, not an edge that is internally")
console.log("  consistent and still means the wrong thing. The second class needs the oracle —")
console.log("  and the oracle is a second reader of the SAME grammar, which is why it cannot")
console.log("  see a shared misreading either. Both limits are the workstream's declared ones.")
console.log("")
console.log(`RESULT: ${totalHits} asymmetry hits over ${edges} edges in ${parsed} files.`)