/**
 * LUA EXTENDED-TYPE CONSTRUCT CENSUS — the instrument that decides the four
 * extended relationship types by measurement, not by assertion.
 *
 * The lane must either IMPLEMENT each of `decorates`, `renders`, `mixes_in` and
 * `part_of` on the whole admitted population, or RULE it with a count, a population
 * and an instrument-counted falsifier. A ruling is the last resort, so the census
 * measures the near misses FIRST and reports them beside the deciding number: a
 * ruling whose falsifier names a construct nothing counts is a sentence, not a
 * falsifier (the csharp lane's lesson), and a zero over an empty population is the
 * opposite of what it appears to say (the cpp probe's lesson).
 *
 * One traversal produces all four counts, because they share the same population
 * and the same parser — splitting them into four instruments would let four
 * different populations be compared under one name.
 *
 * WHAT EACH TYPE MEANS, from src/ast/types.ts (the vocabulary's own contract):
 *
 *   decorates  a decorator is APPLIED TO a declaration by the runtime; the edge is
 *              decorated-declaration -> decorator. Lua has no annotation syntax; the
 *              `---@` forms are COMMENTS consumed by editors, never applied at run
 *              time. The runtime-application idiom `X = f(X)` is measured because it
 *              IS the shape a Lua decorator library would have — the count says
 *              whether any site applies a function to a DECLARATION (a top-level
 *              binding of a declared function/class), not merely to a value.
 *
 *   renders    a component RENDERS another component; the edge is rendering-symbol ->
 *              rendered COMPONENT SYMBOL. A render call whose argument is a string
 *              template or a callback is not this relation: no component symbol is
 *              named. The census counts render-named calls and the subset whose
 *              argument names a class-like symbol — the contract's positive test —
 *              and counts the lapis `html(function() ... end)` host, which composes
 *              widgets from a CALLBACK and is the near miss that fails the test.
 *
 *   mixes_in   a class COMPOSES a member-set into its supertype chain; the edge is
 *              class -> mixin. Lua has no `with`/`include` keyword, but lapis
 *              (a real corpus repo) implements the convention as a method call:
 *              `Widget:include(other_cls)` copies `other_cls.__base`'s members into
 *              the widget's mixin class. The discriminator is STRUCTURAL: a method
 *              call whose field is `include`, whose RECEIVER is a class-like
 *              declaration in the file, and whose first argument is an identifier
 *              naming a class-like symbol. A name filter alone would count the 152
 *              English-prose `include` occurrences already measured.
 *
 *   part_of    a library unit INCLUDES a part file that shares its single scope.
 *              Lua's unit of code is a CHUNK and every loader (`require`, `dofile`,
 *              `loadfile`, `load`, `loadstring`, `module`) evaluates into a NEW
 *              chunk; nothing splices a file's declarations into the including
 *              file's scope. The census counts every loader site (the population
 *              the ruling is stated over) and reads the served grammar inventory
 *              for a production that would make a file's declarations children of
 *              the including chunk — the falsifier, counted from the grammar's own
 *              node-type names.
 *
 * Usage: npx tsx script/m60/lua-extended-census.ts [--out <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const OUT = path.resolve(ROOT, arg("--out", "validation/m14/measurements/lua-extended-census.json")!)
const GRAMMAR_INVENTORY = path.resolve(ROOT, "validation/m14/measurements/lua-grammar-nodes.json")

// ─────────────────────────────────────────────────────── corpus (the draw every lua instrument uses)
// The admitted set is the git-tracked set, not the disk. Files over the 1 MiB
// admission cap are skipped and COUNTED, so the population this census states is
// the population it read.
const files: Array<{ dir: string; abs: string; text: string; label: string }> = []
let overCap = 0
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 1024 * 1024) { overCap++; continue }
    } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    files.push({ dir, abs, text, label: `${e}/${rel}` })
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

// ─────────────────────────────────────────────────────── per-file facts, mirrored from the analyzer
// The class-like test is the analyzer's OWN notion, reproduced here rather than
// invented: names it binds to a table constructor, receivers of a `function X.f()`
// declaration, and bindings of the two class-factory conventions the corpus writes
// (`class(...)` and `Y:extend()`). A census with a different notion of "class-like"
// than the analyzer would measure a different program.
interface FileFacts {
  /** names bound to a table constructor or written as a function receiver */
  tables: Set<string>
  /** names bound to a class-factory result: `local X = class(...)`, `X = Y:extend()` */
  classes: Set<string>
  /** names this file declares as functions (`function f()`, `local function f()`) */
  functions: Set<string>
  /** names of declared functions whose body RETURNS a function definition — the
   * structural signature of a wrapper factory, and therefore the only structural
   * evidence a site is a decorator application rather than a value transform. */
  wrapperFactories: Set<string>
}

function isClassLike(name: string, f: FileFacts): boolean {
  return name.length > 0 && (f.tables.has(name) || f.classes.has(name))
}

/** Does this function's own body RETURN a function definition? That is the
 * structural signature of a wrapper factory (`function cache(f) ... return
 * function(x) ... end end`), and it is what separates a decorator application from
 * an ordinary value transform at a `X = f(X)` site. */
function returnsFunction(fn: any): boolean {
  let found = false
  const body = fn.childForFieldName("body")
  if (!body) return false
  const visit = (n: any): void => {
    if (found) return
    if (n.type === "return_statement") {
      const values = n.namedChild(0)
      const first = values?.type === "expression_list" ? values.namedChild(0) : values
      if (first && (first.type === "function_definition" || first.type === "function_declaration")) { found = true; return }
    }
    // do not descend into nested function bodies: a wrapper RETURNS one, and a
    // deeper return is that inner function's, not the factory's
    if (n.type === "function_definition" || n.type === "function_declaration") return
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
  }
  for (let i = 0; i < body.namedChildCount; i++) { const c = body.namedChild(i); if (c) visit(c) }
  return found
}

function collectFacts(root: any): FileFacts {
  const facts: FileFacts = { tables: new Set(), classes: new Set(), functions: new Set(), wrapperFactories: new Set() }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    // `function X.foo()` / `function X:foo()` -> X is a class-like container.
    if (n.type === "function_declaration") {
      const nm = n.childForFieldName("name")
      if (nm?.type === "identifier") facts.functions.add(nm.text)
      if (nm && (nm.type === "dot_index_expression" || nm.type === "method_index_expression")) {
        const recv = nm.namedChild(0)
        if (recv?.type === "identifier") facts.tables.add(recv.text)
      }
      if (nm?.type === "identifier" && returnsFunction(n)) facts.wrapperFactories.add(nm.text)
    }
    // `local function f()` binds a function definition node.
    if (n.type === "function_definition") {
      // no name field on a definition; the enclosing declaration carries it
    }
    if (n.type === "variable_declaration") {
      const inner = n.namedChild(0)
      const list = inner?.type === "assignment_statement" ? inner.namedChild(0) : undefined
      const values = inner?.type === "assignment_statement" ? inner.namedChild(1) : undefined
      const first = values?.namedChild(0)
      if (list?.type === "variable_list" && first) {
        // `local X = {}` table constructor
        if (first.type === "table_constructor") {
          for (let i = 0; i < list.namedChildCount; i++) {
            const id = list.namedChild(i)
            if (id?.type === "identifier") facts.tables.add(id.text)
          }
        }
        // `local X = class(...)` / `local X = Y:extend()` / `local X = Y.extend(...)`
        const callee = first.type === "function_call" ? first.childForFieldName("name") : undefined
        const classFactory = callee?.type === "identifier" && (callee.text === "class" || callee.text === "classic")
        const extendCall = callee && (callee.type === "method_index_expression" || callee.type === "dot_index_expression")
          && callee.namedChild(callee.namedChildCount - 1)?.text === "extend"
        if (classFactory || extendCall) {
          for (let i = 0; i < list.namedChildCount; i++) {
            const id = list.namedChild(i)
            if (id?.type === "identifier") facts.classes.add(id.text)
          }
        }
      }
    }
    // `X = {}` / `X = class(...)` / `X = Y:extend()` assignment (same shapes, no local)
    if (n.type === "assignment_statement") {
      const list = n.namedChild(0)
      const values = n.namedChild(1)
      const first = values?.namedChild(0)
      if (list?.type === "variable_list" && first) {
        if (first.type === "table_constructor") {
          for (let i = 0; i < list.namedChildCount; i++) {
            const id = list.namedChild(i)
            if (id?.type === "identifier") facts.tables.add(id.text)
          }
        }
        const callee = first.type === "function_call" ? first.childForFieldName("name") : undefined
        const classFactory = callee?.type === "identifier" && (callee.text === "class" || callee.text === "classic")
        const extendCall = callee && (callee.type === "method_index_expression" || callee.type === "dot_index_expression")
          && callee.namedChild(callee.namedChildCount - 1)?.text === "extend"
        if (classFactory || extendCall) {
          for (let i = 0; i < list.namedChildCount; i++) {
            const id = list.namedChild(i)
            if (id?.type === "identifier") facts.classes.add(id.text)
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return facts
}

/** The first `identifier` argument of a `function_call`, or undefined. Explicit
 * arguments only: the implicit `self` of a `:` call is not in the `arguments`
 * node, so `X:include(Y)` yields Y as argument 0. */
function firstIdentifierArgument(call: any): string | undefined {
  const args = call.childForFieldName("arguments")
  if (!args) return undefined
  const a = args.namedChild(0)
  return a?.type === "identifier" ? a.text : undefined
}

/** The callee field text of a member call (`X.f` / `X:f`), or undefined when the
 * callee is a bare identifier or an expression. */
function memberField(call: any): { field: string; receiver: string | undefined } | undefined {
  const callee = call.childForFieldName("name")
  if (!callee) return undefined
  if (callee.type !== "dot_index_expression" && callee.type !== "method_index_expression") return undefined
  const field = callee.namedChild(callee.namedChildCount - 1)
  const receiver = callee.namedChild(0)
  if (!field?.text) return undefined
  return { field: field.text, receiver: receiver?.type === "identifier" ? receiver.text : undefined }
}

// ─────────────────────────────────────────────────────── the four counts
const loaderNames = new Set(["require", "dofile", "loadfile", "load", "loadstring", "module"])
let loaderSites = 0
const loaderByName = new Map<string, number>()
const loaderFiles = new Set<string>()

interface MixinSite { file: string; line: number; receiver: string; argument: string }
const includeMethodCalls: Array<{ file: string; line: number; receiver?: string; argShape: string; receiverClassLike: boolean; argClassLike: boolean }> = []
const mixinSites: MixinSite[] = []

interface DecoratorSite { file: string; line: number; lhs: string; callee: string; form: string; topLevel: boolean }
let annotationCommentNodes = 0
/** Lua 5.4's ONLY declaration-attribute production: `local x <const>` / `<close>`.
 * The served grammar carries the `attribute` node type, so the decorates ruling is
 * stated over a production the instrument can count — the csharp lesson: a
 * falsifier that names a construct nothing counts is a sentence, not a falsifier. */
let attributeNodes = 0
const attributeNames = new Map<string, number>()
const attributeSites: Array<{ file: string; line: number; name: string }> = []
let selfApplicationAll = 0
const selfApplicationSites: DecoratorSite[] = []
const selfApplicationOnDeclaration: DecoratorSite[] = []
/** THE CONTRACT'S POSITIVE TEST, measured: a top-level `X = f(X)` where X is a
 * declared function AND f is a declared function whose body returns a function (a
 * wrapper factory). This is the Lua spelling of Python's `@f def X`, and it is the
 * count the decorates ruling must survive. */
const decoratorApplicationSites: DecoratorSite[] = []
const selfApplicationOnDeclarationTopLevel: DecoratorSite[] = []
let functionDepth = 0
let topLevelSelfApplication = 0

interface RenderSite { file: string; line: number; callee: string; argShape: string }
let renderCalls = 0
const renderComponentSites: RenderSite[] = []
const renderNearMiss: RenderSite[] = []
let htmlHostSites = 0

for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const facts = collectFacts(t.rootNode)

  const walk = (n: any, depth: number): void => {
    // decorates near miss: a comment whose content is an editor annotation. The
    // grammar produces a `comment` node; an annotation inside one is a comment,
    // never a production, which is the fact the ruling rests on.
    if (n.type === "comment") {
      const text: string = n.text ?? ""
      const content = text.startsWith("---") ? text.slice(3) : text.startsWith("--") ? text.slice(2) : text
      if (content.startsWith("@") || content.startsWith(" @")) annotationCommentNodes++
    }
    // decorates: Lua's own attribute production. It names a KEYWORD (`const` or
    // `close`), not a decorator symbol, and its meaning is compile-time — there is
    // no runtime application and nothing for an edge target to name.
    if (n.type === "attribute") {
      attributeNodes++
      const text: string = (n.text ?? "").trim()
      const name = text.startsWith("<") && text.endsWith(">") ? text.slice(1, -1) : text
      attributeNames.set(name, (attributeNames.get(name) ?? 0) + 1)
      if (attributeSites.length < 40) {
        attributeSites.push({ file: f.label, line: (n.startPosition?.row ?? 0) + 1, name })
      }
    }
    if (n.type === "function_declaration" || n.type === "function_definition") {
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, depth + 1) }
      return
    }
    if (n.type === "function_call") {
      const callee = n.childForFieldName("name")
      // part_of population: every loader call site. A loader's FIRST argument names
      // what it loads; all of them evaluate into a new chunk.
      if (callee?.type === "identifier" && loaderNames.has(callee.text)) {
        loaderSites++
        loaderByName.set(callee.text, (loaderByName.get(callee.text) ?? 0) + 1)
        loaderFiles.add(f.label)
      }
      const member = memberField(n)
      if (member) {
        // mixes_in: a method call whose FIELD is exactly `include`. The structural
        // discriminator is tested here; the raw count is reported beside it so the
        // gap between "any include call" and "a mixin composition" is visible.
        if (member.field === "include") {
          const arg = firstIdentifierArgument(n)
          const receiverClassLike = member.receiver ? isClassLike(member.receiver, facts) : false
          const argClassLike = arg ? isClassLike(arg, facts) : false
          includeMethodCalls.push({
            file: f.label,
            line: (n.startPosition?.row ?? 0) + 1,
            receiver: member.receiver,
            argShape: arg ?? (n.childForFieldName("arguments")?.namedChild(0)?.type ?? "absent"),
            receiverClassLike,
            argClassLike,
          })
          if (member.receiver && arg && receiverClassLike && argClassLike) {
            mixinSites.push({ file: f.label, line: (n.startPosition?.row ?? 0) + 1, receiver: member.receiver, argument: arg })
          }
        }
        // renders: a call whose field is exactly `render` (or a render_* name — the
        // latter is reported apart because a name filter is not the discriminator).
        if (member.field === "render" || member.field.startsWith("render_")) {
          renderCalls++
          const arg = firstIdentifierArgument(n)
          const argIsComponent = arg ? isClassLike(arg, facts) : false
          const site = {
            file: f.label,
            line: (n.startPosition?.row ?? 0) + 1,
            callee: member.field,
            argShape: arg ?? (n.childForFieldName("arguments")?.namedChild(0)?.type ?? "absent"),
          }
          if (argIsComponent) renderComponentSites.push(site)
          else if (renderNearMiss.length < 40) renderNearMiss.push(site)
        }
        // the lapis render host: `html(function() ... end)` composes a widget from a
        // CALLBACK — the near miss that fails "names a COMPONENT SYMBOL".
        if (member.field === "html") {
          const args = n.childForFieldName("arguments")
          const a0 = args?.namedChild(0)
          if (a0 && (a0.type === "function_definition" || a0.type === "function_declaration")) htmlHostSites++
        }
      }
      // bare `include(...)` / `render(...)`: a plain function, not a method — counted
      // so the fixture-forbid rows for ordinary helpers are grounded in a number.
      if (callee?.type === "identifier" && (callee.text === "include" || callee.text === "render")) {
        if (callee.text === "include") {
          includeMethodCalls.push({
            file: f.label,
            line: (n.startPosition?.row ?? 0) + 1,
            receiver: undefined,
            argShape: firstIdentifierArgument(n) ?? (n.childForFieldName("arguments")?.namedChild(0)?.type ?? "absent"),
            receiverClassLike: false,
            argClassLike: false,
          })
        } else {
          renderCalls++
          const arg = firstIdentifierArgument(n)
          const argIsComponent = arg ? isClassLike(arg, facts) : false
          const site = {
            file: f.label,
            line: (n.startPosition?.row ?? 0) + 1,
            callee: callee.text,
            argShape: arg ?? (n.childForFieldName("arguments")?.namedChild(0)?.type ?? "absent"),
          }
          if (argIsComponent) renderComponentSites.push(site)
          else if (renderNearMiss.length < 40) renderNearMiss.push(site)
        }
      }
    }
    // decorates: the runtime-application idiom `X = f(X)` — an ASSIGNMENT (or local
    // declaration) whose first value is a call taking the SAME NAME as its first
    // target. This is the shape a Python decorator desugars to; in Lua it is almost
    // always a value rebinding, so the count is split by whether X names a
    // DECLARATION in this file (the contract's positive test) and by function depth.
    if (n.type === "variable_declaration" || n.type === "assignment_statement") {
      const inner = n.type === "variable_declaration" ? n.namedChild(0) : n
      const list = inner?.type === "assignment_statement" ? inner.namedChild(0) : undefined
      const values = inner?.type === "assignment_statement" ? inner.namedChild(1) : undefined
      const call = values?.namedChild(0)
      const lhs = list?.type === "variable_list" ? list.namedChild(0) : undefined
      if (lhs?.type === "identifier" && call?.type === "function_call") {
        const arg = firstIdentifierArgument(call)
        if (arg && arg === lhs.text) {
          selfApplicationAll++
          const callee = call.childForFieldName("name")
          const calleeName = callee?.type === "identifier"
            ? callee.text
            : callee && (callee.type === "dot_index_expression" || callee.type === "method_index_expression")
              ? callee.namedChild(callee.namedChildCount - 1)?.text ?? "?"
              : "?"
          const site: DecoratorSite = {
            file: f.label,
            line: (n.startPosition?.row ?? 0) + 1,
            lhs: lhs.text,
            callee: calleeName,
            form: n.type === "variable_declaration" ? "local" : "assign",
            topLevel: depth === 0,
          }
          selfApplicationSites.push(site)
          // THE CONTRACT'S POSITIVE TEST is narrower than "the name is declared
          // somewhere in this file": a decorator is applied to a DECLARATION at
          // creation time, and in Lua that means a FILE-SCOPE binding (`local X =
          // f(X)` before the chunk's statements run) or a top-level function/class
          // being wrapped. An in-function `value = sub(value)` is a VALUE rebinding
          // whose name happens to coincide with a table binding elsewhere in the
          // file, so the per-file name test alone would overcount (measured: 186
          // coarse hits). The top-level split is reported beside it.
          if (facts.functions.has(lhs.text) || isClassLike(lhs.text, facts)) {
            selfApplicationOnDeclaration.push(site)
            if (site.topLevel) selfApplicationOnDeclarationTopLevel.push(site)
          }
          if (site.topLevel && facts.functions.has(lhs.text) && facts.wrapperFactories.has(calleeName)) {
            decoratorApplicationSites.push(site)
          }
          if (depth === 0) topLevelSelfApplication++
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, depth) }
  }
  walk(t.rootNode, functionDepth)
  t.delete?.()
}

// ─────────────────────────────────────────────────────── the grammar half
// The falsifier for part_of and renders is a production the served grammar would
// have to carry. Read from the SERVED build's own node-type names — the tracked
// artifact the syntax gate points every lane at — never from a grammar repo path.
let grammar: any = null
try { grammar = JSON.parse(readFileSync(GRAMMAR_INVENTORY, "utf8")) } catch { grammar = null }
const namedTypeNames: string[] = grammar?.namedTypeNames ?? []
const uniqueNamedTypes = [...new Set(namedTypeNames)].sort()
/** A production name that would express "a file's text is spliced into this
 * chunk": any name carrying include / import_text / part / splice. Equality-free
 * substring test on the NODE-TYPE NAME LIST, never on source text. */
const includeProductionCandidates = uniqueNamedTypes.filter((t) =>
  t.includes("include") || t.includes("splice") || t.includes("part") || t.includes("embed"),
)
/** A production name that would express a component/template render construct. */
const renderProductionCandidates = uniqueNamedTypes.filter((t) =>
  t.includes("component") || t.includes("template") || t.includes("render") || t.includes("element") || t.includes("tag"),
)
/** A production name that would express an annotation applied to a declaration. */
const decoratorProductionCandidates = uniqueNamedTypes.filter((t) =>
  t.includes("decorat") || t.includes("annotation") || t.includes("attribute") || t.includes("pragma"),
)
/** A production name that would express a mixin/with/include composition. */
const mixinProductionCandidates = uniqueNamedTypes.filter((t) =>
  t.includes("mixin") || t.includes("with_clause") || t.includes("trait"),
)

const report = {
  schemaVersion: 1,
  kind: "lua_extended_census",
  at: new Date().toISOString(),
  commit: (() => { try { return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  corpus: {
    root: CR,
    filesParsed: files.length,
    skippedOver1MiB: overCap,
    rule: "git-tracked *.lua under the corpus root, sorted, no cap; the admitted set is the tracked set",
  },
  grammar: {
    wasm: "wasm/tree-sitter-lua.wasm",
    inventoryArtifact: "validation/m14/measurements/lua-grammar-nodes.json",
    servedDigest: grammar?.servedDigest ?? null,
    totalIds: grammar?.totalIds ?? null,
    namedTypeSlots: namedTypeNames.length,
    uniqueNamedTypes: uniqueNamedTypes.length,
    includeProductionCandidates,
    renderProductionCandidates,
    decoratorProductionCandidates,
    mixinProductionCandidates,
  },
  part_of: {
    question: "does any Lua construct make a loaded file's declarations children of the including chunk (a single shared scope)?",
    loaderSites,
    loaderByName: Object.fromEntries(loaderByName),
    loaderFiles: loaderFiles.size,
    loaderSemantics:
      "every loader in this list evaluates its argument in a NEW chunk (Lua 5.4 manual: require loads a module chunk; dofile/loadfile load and run a file chunk; load/loadstring compile a chunk) — none splices text or declarations into the caller's scope.",
    includeProductionCandidates,
    rulingBasis:
      includeProductionCandidates.length === 0
        ? "the served grammar carries no include/splice/part/embed production, and every loader site evaluates into a new chunk"
        : "the served grammar carries a candidate production — this is the falsifier, and it fires",
  },
  mixes_in: {
    question: "does any corpus construct compose a member-set into a class's supertype chain and name both sides in the file?",
    includeMethodCalls: includeMethodCalls.length,
    includeBareCalls: includeMethodCalls.filter((c) => !c.receiver).length,
    includeCallSites: includeMethodCalls.slice(0, 60),
    structuralMixinSites: mixinSites.length,
    structuralMixinSiteList: mixinSites,
    discriminator:
      "method call whose field is exactly `include`, whose RECEIVER is a class-like declaration in the file (table constructor binding, function receiver, class/classic factory binding, or Y:extend() binding), and whose first explicit argument is an identifier naming a class-like symbol. Never a name filter: the receiver/argument role test is what separates the lapis Widget:include convention from the 152 prose occurrences of the word.",
    mixinProductionCandidates,
  },
  decorates: {
    question: "does any construct APPLY a decorator to a declaration at run time?",
    annotationCommentNodes,
    annotationNote:
      "the `---@` / `--@` forms are the grammar's `comment` nodes — editor documentation — never a declaration production and never applied at run time",
    attributeNodes,
    attributeNames: Object.fromEntries(attributeNames),
    attributeSites: attributeSites.slice(0, 40),
    attributeNote:
      "Lua 5.4's `local x <const>` / `<close>` is the language's ONLY declaration attribute. The served grammar carries the `attribute` production (so this ruling is stated over a counted construct), but the attribute names a KEYWORD — `const`/`close` — not a decorator SYMBOL, and its meaning is enforced at compile time: nothing is applied at run time and nothing is available as an edge target.",
    selfApplicationAll,
    selfApplicationTopLevel: topLevelSelfApplication,
    selfApplicationOnDeclaration: selfApplicationOnDeclaration.length,
    selfApplicationOnDeclarationTopLevel: selfApplicationOnDeclarationTopLevel.length,
    decoratorApplicationSites: decoratorApplicationSites.length,
    decoratorApplicationSiteList: decoratorApplicationSites,
    selfApplicationDeclarationSites: selfApplicationOnDeclaration.slice(0, 40),
    selfApplicationDeclarationTopLevelSites: selfApplicationOnDeclarationTopLevel,
    selfApplicationSample: selfApplicationSites.slice(0, 40),
    discriminator:
      "`X = f(X)` where X names a function or class-like DECLARATION in the same file is the runtime-application shape a decorator would need; a rebinding of a VALUE (`path = sub(path, ...)`) is not decoration of a declaration.",
    decoratorProductionCandidates,
  },
  renders: {
    question: "does any construct name a COMPONENT SYMBOL being rendered by another component?",
    renderCalls,
    renderComponentSites: renderComponentSites.length,
    renderComponentSiteList: renderComponentSites,
    renderNearMiss: renderNearMiss.length,
    renderNearMissSample: renderNearMiss,
    htmlHostSites,
    htmlHostNote:
      "lapis `html(function() ... end)` composes a widget from a CALLBACK. It is the near miss: the rendered thing is a function literal, not a named component symbol, so it fails the contract's positive test. Counted so the ruling names a construct an instrument counts.",
    renderProductionCandidates,
  },
  overturnConditions: {
    part_of: "a node type whose parse tree makes the included file's declarations children of the including chunk (a textual/include/literal-include production) — counted in `grammar.includeProductionCandidates`, currently 0",
    mixes_in: "a structural include call site outside the measured set, or a Lua dialect build carrying a mixin/with production (counted in `grammar.mixinProductionCandidates`)",
    decorates: "a site counted by `decoratorApplicationSites` (top-level X = f(X) where X is a declared function and f is a declared function returning a function) that is NOT a decorator application — i.e. the discriminator's own positive population would have to be empty for the ruling to hold; or an ATTRIBUTE naming a decorator VALUE rather than const/close; or a grammar build carrying a decorator/annotation production",
    renders: "a render call whose argument names a class-like component symbol (counted by `renderComponentSites`, currently 0), or a grammar build carrying a component/template production",
  },
}

writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(`lua extended census — ${files.length} files parsed, ${overCap} skipped over 1 MiB`)
console.log(`grammar: ${uniqueNamedTypes.length} unique named types, digest ${grammar?.servedDigest ?? "?"}`)
console.log(`  include/splice/part productions: ${includeProductionCandidates.length}  render/component productions: ${renderProductionCandidates.length}`)
console.log(`  decorator/annotation productions: ${decoratorProductionCandidates.length}  mixin/with productions: ${mixinProductionCandidates.length}`)
console.log(`part_of: loader sites ${loaderSites} in ${loaderFiles.size} files, by name ${JSON.stringify(Object.fromEntries(loaderByName))}`)
console.log(`mixes_in: include method calls ${includeMethodCalls.length} (bare ${includeMethodCalls.filter((c) => !c.receiver).length}), structural mixin sites ${mixinSites.length}`)
for (const s of mixinSites.slice(0, 10)) console.log(`  ${s.file}:${s.line}  ${s.receiver}:include(${s.argument})`)
console.log(`decorates: annotation comment nodes ${annotationCommentNodes}, self-application ${selfApplicationAll} (top-level ${topLevelSelfApplication}, on a declaration ${selfApplicationOnDeclaration.length})`)
for (const s of selfApplicationOnDeclaration.slice(0, 10)) console.log(`  ${s.file}:${s.line}  ${s.lhs} = ${s.callee}(${s.lhs})`)
console.log(`renders: render calls ${renderCalls}, naming a component ${renderComponentSites.length}, html(function) host sites ${htmlHostSites}`)
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
