/**
 * ELIXIR LANE — GAP-FILL TRUTH derivations (task-25 D4, lane-owned oracle module).
 *
 * The existing elixir truth (`deriveElixirEdges` in differential.ts) derives calls / implements /
 * instantiates / references. Measured at the current HEAD, it leaves four gaps (see
 * validation/m14/verification/ELIXIR-CENSUS.md §6):
 *
 *   1. `imports` — EMITTED by the analyzer (`import Mod` directive, 377 whole-population edges) and
 *      compared against NOTHING. This module derives it independently from the same grammar.
 *   2. `instantiates` — the analyzer's ruled `raise Mod` / `reraise Mod` / `struct(Mod, …)` spellings
 *      (ELIXIR_FIX2-C2, EX-A9) are missing from the truth, so those analyzer edges land in
 *      UNEXPLAINED (11 on the elixir draw, 10 on phoenix). Derived here for the CALL-shaped forms;
 *      the `%Mod{}` map form is already the existing derivation's half.
 *   3. `calls` — remote calls whose module is an erlang ATOM (`:erlang.make_tuple`,
 *      `:elixir_tokenizer.tokenize`) are missing from the truth (2 + 4 UNEXPLAINED rows). Derived
 *      here; the rest of the calls surface stays with the existing derivation.
 *   4. `overrides` / `exports` / `uses` — deferred to oracle round 2 with their contracts read out
 *      in the wiring request; they are NOT claimed here.
 *
 * INDEPENDENCE: a separate walker over the same tree, sharing no helper with the analyzer. It can
 * refute the analyzer; it cannot confirm it. Alias resolution is mirrored because the ANALYZER
 * publishes resolved module names (the published contract), not because the code is copied: the
 * alias directive semantics (last-segment key, `as:` rename, multi-alias expansion) are Elixir's,
 * and are read here from the grammar's own `alias` / `dot` nodes.
 *
 * The shape returned is the differential's `{label, from, target}` — the consumer adapts via
 * {source, target, type} exactly as the existing elixir hook does.
 */

type OracleEdge = { label: string; from: string; target: string }

const kids = (n: any): any[] => (n?.namedChildren ?? [])
const field = (n: any, f: string): any | null => (typeof n?.childForFieldName === "function" ? n.childForFieldName(f) : null)
const findChild = (n: any, pred: (c: any) => boolean): any | null => {
  for (const c of kids(n)) if (c && pred(c)) return c
  return null
}
const firstOfType = (n: any, ...types: string[]): any | null => findChild(n, (c) => types.includes(c.type))

/** Elixir keyword-pair helpers: `import Foo, only: [...]` / `alias Foo.Bar, as: Baz`. */
function keywordArg(args: any, key: string): any | null {
  if (!args) return null
  for (const c of kids(args)) {
    if (!c) continue
    if (c.type === "pair" || c.type === "keyword") {
      const k = firstOfType(c, "keyword", "quoted_keyword", "atom", "identifier")
      if (k && String(k.text).replace(/^:+/, "") === key) {
        const v = kids(c).filter((x: any) => x !== k)
        return v.length > 0 ? v[v.length - 1] : null
      }
    }
  }
  return null
}

const isUpper = (s: string): boolean => s.length > 0 && s[0] >= "A" && s[0] <= "Z"
/** The attributes whose VALUE is a declaration, not a call site (the analyzer's
 *  DECLARATION_ATTRIBUTES): a docstring is text, a typespec's `%Duration{}` is a TYPE reference,
 *  @behaviour/@derive/@deprecated are compile-time contracts. Every OTHER attribute value is
 *  compile-time CODE and the analyzer publishes the calls/instantiations inside it (EX-A17). */
const DECLARATION_ATTRIBUTES = new Set([
  "moduledoc", "doc", "spec", "type", "typep", "opaque", "callback", "macrocallback",
  "optional_callbacks", "behaviour", "behavior", "derive", "deprecated",
])
/** The attribute name of a `@name value` unary_operator node. */
const attrNameOf = (n: any): string => {
  const value = n.child(1)
  if (!value) return ""
  if (value.type === "call") {
    const id = findChild(value, (c: any) => c.type === "identifier")
    return id ? String(id.text) : ""
  }
  return ""
}

/** A `, do: body` PAIR ends the declaration head: the body is code (the analyzer's isDoPair
 *  relaxation). The grammar nests this pair inside the def's arguments node, so a blanket
 *  "arguments are the head" walk would silence every single-line definition body. */
const isDoPairNode = (c: any): boolean => {
  if (!c) return false
  // `def f(...), do: body` nests the pair inside a KEYWORDS node of the arguments child;
  // `defmodule X, do: …` can nest it directly. Either spelling ends the declaration head.
  if (c.type === "keywords") return kids(c).some((k: any) => isDoPairNode(k))
  if (c.type !== "pair") return false
  const kw = findChild(c, (x: any) => x.type === "keyword")
  const t = kw ? String(kw.text) : ""
  return t === "do" || t.startsWith("do:")
}

/** `quote do … end` is DATA; `unquote` inside it executes. The nearest boundary wins (mirrors the
 *  analyzer's own upward walk). Module-level helpers so every derivation shares one rule. */
const callHeadName = (n: any): string => {
  const nameNode = findChild(n, (c: any) => c.type === "identifier")
  return nameNode ? String(nameNode.text) : ""
}
const enterQuoteBoundary = (n: any): boolean => callHeadName(n) === "quote"
const enterUnquoteBoundary = (n: any): boolean => {
  const nm = callHeadName(n)
  return nm === "unquote" || nm === "unquote_splicing"
}

/** Walk state: module stack + lexical alias frames (Elixir aliases are lexical to the module). */
type Frame = { module: string | null; aliases: Map<string, string> }

function resolveAliasName(text: string, frames: Frame[]): string {
  if (!text) return text
  const parts = text.split(".")
  const top = frames[frames.length - 1]
  const root = parts[0]
  if (top && isUpper(root) && top.aliases.has(root)) {
    parts[0] = top.aliases.get(root)!
    return parts.join(".")
  }
  return text
}
function currentModule(frames: Frame[]): string | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const m = frames[i].module
    if (m && m.length > 0) return m
  }
  return null
}
/**
 * The published SOURCE of an edge inside a function: the analyzer's function scope name is
 * `Module.fun/arity` (measured from the analyzer output: `Kernel.LexicalTracker.references/1`),
 * so the oracle must mirror that spelling rather than a bare function name. Module-level code
 * publishes the module (or `Global` at file scope).
 */
function definitionScope(frames: { module: string | null; defName: string | null; defArity?: number }[]): string {
  for (let i = frames.length - 1; i >= 0; i--) {
    const d = frames[i].defName
    if (d && d.length > 0) {
      const mod = currentModule(frames as any)
      const arity = frames[i].defArity ?? 0
      return `${mod ? `${mod}.` : ""}${d}/${arity}`
    }
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const m = frames[i].module
    if (m && m.length > 0) return m
  }
  return "Global"
}

/** Arity of a definition head: `def f(a, b \\ 1)` publishes two arities; the analyzer's function
 *  scope name uses the head's parameter count as written (all parameters, defaults included). */
function headArity(head: any): number {
  if (!head) return 0
  if (head.type === "identifier") return 0
  const args = findChild(head, (c) => c.type === "arguments")
  if (!args) return 0
  let n = 0
  for (const c of kids(args)) if (c && c.type !== "comment") n++
  return n
}

const DEF_PUBLIC = new Set(["def", "defmacro", "defguard", "defdelegate"])
const DEF_ANY = new Set(["def", "defp", "defmacro", "defmacrop", "defguard", "defguardp", "defdelegate"])

/**
 * `imports` truth: an `import Mod` directive's dependency target, alias-resolved, sourced at the
 * enclosing module (never a self-import). This is the label the analyzer emits at confidence 1.0
 * (structural) and the gate reads for the module-dependency surface.
 */
export function deriveElixirImportsTruth(root: any): OracleEdge[] {
  const out: OracleEdge[] = []
  const seen = new Set<string>()
  type F = { module: string | null; aliases: Map<string, string>; defName: string | null; defArity?: number; quoted?: boolean; inert?: boolean; attrInert?: boolean; headInert?: boolean }
  const frames: F[] = [{ module: null, aliases: new Map(), defName: null, quoted: false }]
  const isQuoted = (): boolean => frames[frames.length - 1].quoted === true
  const isInert = (): boolean => frames[frames.length - 1].inert === true
  /** `quote do … end` is DATA; `unquote` inside it executes. The nearest boundary wins (the
   *  analyzer's isInQuotedCode walks upward and stops at the first quote/unquote). */
  const enterQuoteBoundary = (n: any): boolean => {
    const nameNode = findChild(n, (c: any) => c.type === "identifier")
    return nameNode ? String(nameNode.text) === "quote" : false
  }
  const enterUnquoteBoundary = (n: any): boolean => {
    const nameNode = findChild(n, (c: any) => c.type === "identifier")
    return nameNode ? (String(nameNode.text) === "unquote" || String(nameNode.text) === "unquote_splicing") : false
  }
  const pushRow = (from: string, target: string) => {
    if (!target || from === target) return
    const k = `${from}\u0000${target}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "imports", from, target })
  }
  const walk = (n: any): void => {
    if (!n) return
    const t = String(n.type)
    // A MODULE ATTRIBUTE VALUE is a declaration, not an evaluation (`@spec`, `@opaque`,
    // `@type`, `@doc`…): the analyzer's isInDeclarationAttributeValue guard keeps calls inside it
    // out of the graph, so the truth must not derive them.
    if (t === "unary_operator" && String(n.child(0)?.text ?? "") === "@") {
      // An attribute VALUE is a declaration for raise/struct construction and for directives,
      // but a CALL inside it is evaluated at compile time and the analyzer publishes it — so the
      // flags are distinct rather than one blanket inert.
      frames.push({ ...frames[frames.length - 1], inert: true, attrInert: true })
      for (const c of kids(n)) walk(c)
      frames.pop()
      return
    }
    if (t === "call") {
      const nameNode = findChild(n, (c) => c.type === "identifier")
      const target = nameNode ? String(nameNode.text) : ""
      if (enterQuoteBoundary(n) || enterUnquoteBoundary(n)) {
        frames.push({ ...frames[frames.length - 1], quoted: enterQuoteBoundary(n) })
        for (const c of kids(n)) walk(c)
        frames.pop()
        return
      }
      if (target === "defmodule" || target === "defprotocol" || target === "defimpl") {
        const args = findChild(n, (c) => c.type === "arguments")
        let modName = ""
        const nameArg = args ? kids(args)[0] : null
        if (nameArg) {
          if (nameArg.type === "alias") modName = resolveAliasName(String(nameArg.text), frames as any)
          else if (nameArg.type === "atom") modName = String(nameArg.text).replace(/^:/, "")
          else if (nameArg.type === "identifier") modName = String(nameArg.text)
        }
        const parent = currentModule(frames as any)
        const full = modName.length === 0 ? "" : (parent && !modName.includes(".") ? `${parent}.${modName}` : modName)
        // entering a module: fresh alias frame; the module aliases its own last segment
        const aliases = new Map<string, string>()
        if (full.length > 0) {
          const last = full.split(".").pop()!
          if (isUpper(last)) aliases.set(last, full)
        }
        frames.push({ ...frames[frames.length - 1], module: full.length > 0 ? full : (parent ?? null), aliases, defName: null })
        for (const c of kids(n)) walk(c)
        frames.pop()
        return
      }
      if (DEF_ANY.has(target)) {
        const args = findChild(n, (c) => c.type === "arguments")
        const head = args ? kids(args)[0] : null
        let defName: string | null = null
        if (head && head.type === "identifier") defName = String(head.text)
        else if (head && head.type === "call") {
          const inner = findChild(head, (c) => c.type === "identifier")
          if (inner) defName = String(inner.text)
        }
        frames.push({ ...frames[frames.length - 1], module: currentModule(frames as any), aliases: new Map(frames[frames.length - 1].aliases), defName, defArity: headArity(head) })
        for (const c of kids(n)) walk(c)
        frames.pop()
        return
      }
      if (target === "import") {
        if (isQuoted() || isInert()) return
        const args = findChild(n, (c) => c.type === "arguments")
        const modArg = args ? kids(args)[0] : null
        if (modArg && (modArg.type === "alias" || modArg.type === "atom" || modArg.type === "dot")) {
          const raw = String(modArg.text)
          const resolved = resolveAliasName(raw, frames as any)
          pushRow(definitionScope(frames as any), resolved)
        }
        return // do not descend into import arguments (only the module matters)
      }
      if (target === "alias" || target === "require") {
        if (isQuoted() || isInert()) return
        // alias directive: record lexical alias bindings for later resolution
        const args = findChild(n, (c) => c.type === "arguments")
        const modArg = args ? kids(args)[0] : null
        const top = frames[frames.length - 1]
        if (modArg && (modArg.type === "alias" || modArg.type === "atom" || modArg.type === "dot")) {
          const raw = String(modArg.text)
          const resolved = resolveAliasName(raw, frames as any)
          const asNode = keywordArg(args, "as")
          const bound = asNode ? String(asNode.text) : (raw.split(".").pop() ?? "")
          if (bound && isUpper(bound)) top.aliases.set(bound, resolved)
        }
        for (const c of kids(n)) walk(c)
        return
      }
    }
    for (const c of kids(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * `instantiates` GAP truth: the CALL-shaped construction spellings the analyzer publishes
 * (struct/2, struct!/2, raise/1..2, reraise/2 with a statically named module first argument, and
 * `__MODULE__`). `%Mod{}` map literals stay with the existing derivation. Self-construction is
 * suppressed exactly as the analyzer's ELXD13/ELXD12 guards do.
 */
export function deriveElixirCallInstantiationTruth(root: any): OracleEdge[] {
  const out: OracleEdge[] = []
  const seen = new Set<string>()
  type F = { module: string | null; defName: string | null; defArity?: number; aliases: Map<string, string>; quoted?: boolean; inert?: boolean; attrInert?: boolean; headInert?: boolean }
  const frames: F[] = [{ module: null, defName: null, aliases: new Map(), quoted: false }]
  const isQuoted = (): boolean => frames[frames.length - 1].quoted === true
  const isInert = (): boolean => frames[frames.length - 1].inert === true
  const quoteBoundaryOf = (n: any): "quote" | "unquote" | null => {
    const nameNode = findChild(n, (c: any) => c.type === "identifier")
    const nm = nameNode ? String(nameNode.text) : ""
    return nm === "quote" ? "quote" : (nm === "unquote" || nm === "unquote_splicing" ? "unquote" : null)
  }
  const pushRow = (from: string, target: string) => {
    if (!target || from === target) return
    const k = `${from}\u0000${target}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "instantiates", from, target })
  }
  const walk = (n: any): void => {
    if (!n) return
    const t = String(n.type)
    // A MODULE ATTRIBUTE VALUE is a declaration, not an evaluation (`@spec`, `@opaque`,
    // `@type`, `@doc`…): the analyzer's isInDeclarationAttributeValue guard keeps calls inside it
    // out of the graph, so the truth must not derive them.
    if (t === "unary_operator" && String(n.child(0)?.text ?? "") === "@") {
      // EX-A17: a NON-declaration attribute value is compile-time CODE — the analyzer publishes
      // the calls/instantiations inside it; only the DECLARATION attributes keep their silence.
      const decl = DECLARATION_ATTRIBUTES.has(attrNameOf(n))
      frames.push({ ...frames[frames.length - 1], inert: decl, attrInert: decl })
      for (const c of kids(n)) walk(c)
      frames.pop()
      return
    }
    if (t === "call") {
      const nameNode = findChild(n, (c) => c.type === "identifier")
      const target = nameNode ? String(nameNode.text) : ""
      if (enterQuoteBoundary(n) || enterUnquoteBoundary(n)) {
        frames.push({ ...frames[frames.length - 1], quoted: enterQuoteBoundary(n) })
        for (const c of kids(n)) walk(c)
        frames.pop()
        return
      }
      if (target === "defmodule" || target === "defprotocol" || target === "defimpl") {
        const args = findChild(n, (c) => c.type === "arguments")
        const nameArg = args ? kids(args)[0] : null
        let modName = ""
        if (nameArg) {
          if (nameArg.type === "alias") modName = resolveAliasName(String(nameArg.text), frames as any)
          else if (nameArg.type === "atom") modName = String(nameArg.text).replace(/^:/, "")
          else if (nameArg.type === "identifier") modName = String(nameArg.text)
        }
        const parent = currentModule(frames as any)
        const full = modName.length === 0 ? null : (parent && !modName.includes(".") ? `${parent}.${modName}` : modName)
        frames.push({ ...frames[frames.length - 1], module: full ?? parent, defName: null, aliases: new Map(frames[frames.length - 1].aliases) })
        for (const c of kids(n)) walk(c)
        frames.pop()
        return
      }
      if (DEF_ANY.has(target)) {
        const args = findChild(n, (c) => c.type === "arguments")
        const head = args ? kids(args)[0] : null
        let defName: string | null = null
        if (head && head.type === "identifier") defName = String(head.text)
        else if (head && head.type === "call") {
          const inner = findChild(head, (c) => c.type === "identifier")
          if (inner) defName = String(inner.text)
        }
        frames.push({ ...frames[frames.length - 1], module: currentModule(frames as any), defName, defArity: headArity(head), aliases: new Map(frames[frames.length - 1].aliases) })
        for (const c of kids(n)) {
          // the HEAD is a declaration, not an evaluation (the analyzer's isDefHead guard) — but a
          // `, do: body` pair inside the arguments node is CODE (isDoPair), so descend per child.
          const isHeadArgs = c && c.type === "arguments"
          if (isHeadArgs) {
            for (const hc of kids(c)) {
              if (isDoPairNode(hc)) walk(hc)
              else { frames.push({ ...frames[frames.length - 1], inert: true, headInert: true }); walk(hc); frames.pop() }
            }
          } else walk(c)
        }
        frames.pop()
        return
      }
      if (target === "struct" || target === "struct!" || target === "raise" || target === "reraise") {
        if (isQuoted() || isInert()) return
        const args = findChild(n, (c) => c.type === "arguments")
        const first = args ? kids(args)[0] : null
        let constructed: string | null = null
        if (first && first.type === "alias") constructed = resolveAliasName(String(first.text), frames as any)
        else if (first && first.type === "identifier" && String(first.text) === "__MODULE__") {
          constructed = currentModule(frames as any)
        }
        if (constructed) pushRow(definitionScope(frames as any), constructed)
      }
      if (target === "alias" || target === "import" || target === "require") {
        const args = findChild(n, (c) => c.type === "arguments")
        const modArg = args ? kids(args)[0] : null
        const top = frames[frames.length - 1]
        if (target === "alias" && modArg && (modArg.type === "alias" || modArg.type === "atom")) {
          const raw = String(modArg.text)
          const resolved = resolveAliasName(raw, frames as any)
          const asNode = keywordArg(args, "as")
          const bound = asNode ? String(asNode.text) : (raw.split(".").pop() ?? "")
          if (bound && isUpper(bound)) top.aliases.set(bound, resolved)
        }
      }
    }
    for (const c of kids(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * `calls` GAP truth: remote calls whose callee root is an erlang ATOM (`:erlang.make_tuple`) —
 * the erlang-module form the existing derivation misses. Target is the alias-resolved callee as
 * written (`:erlang.make_tuple`), because that is what the analyzer publishes for the remote form.
 */
export function deriveElixirAtomRemoteCallsTruth(root: any): OracleEdge[] {
  const out: OracleEdge[] = []
  const seen = new Set<string>()
  type F = { module: string | null; defName: string | null; defArity?: number; aliases: Map<string, string>; quoted?: boolean; inert?: boolean; attrInert?: boolean; headInert?: boolean }
  const frames: F[] = [{ module: null, defName: null, aliases: new Map(), quoted: false }]
  const isQuoted = (): boolean => frames[frames.length - 1].quoted === true
  const isInert = (): boolean => frames[frames.length - 1].inert === true
  const quoteBoundaryOf = (n: any): "quote" | "unquote" | null => {
    const nameNode = findChild(n, (c: any) => c.type === "identifier")
    const nm = nameNode ? String(nameNode.text) : ""
    return nm === "quote" ? "quote" : (nm === "unquote" || nm === "unquote_splicing" ? "unquote" : null)
  }
  const walk = (n: any): void => {
    if (!n) return
    const t = String(n.type)
    // A MODULE ATTRIBUTE VALUE is a declaration, not an evaluation (`@spec`, `@opaque`,
    // `@type`, `@doc`…): the analyzer's isInDeclarationAttributeValue guard keeps calls inside it
    // out of the graph, so the truth must not derive them.
    if (t === "unary_operator" && String(n.child(0)?.text ?? "") === "@") {
      // EX-A17: a NON-declaration attribute value is compile-time CODE — the analyzer publishes
      // the calls/instantiations inside it; only the DECLARATION attributes keep their silence.
      const decl = DECLARATION_ATTRIBUTES.has(attrNameOf(n))
      frames.push({ ...frames[frames.length - 1], inert: decl, attrInert: decl })
      for (const c of kids(n)) walk(c)
      frames.pop()
      return
    }
    if (t === "call") {
      const nameNode = findChild(n, (c) => c.type === "identifier")
      const target = nameNode ? String(nameNode.text) : ""
      if (enterQuoteBoundary(n) || enterUnquoteBoundary(n)) {
        frames.push({ ...frames[frames.length - 1], quoted: enterQuoteBoundary(n) })
        for (const c of kids(n)) walk(c)
        frames.pop()
        return
      }
      if (target === "defmodule" || target === "defprotocol" || target === "defimpl") {
        const args = findChild(n, (c) => c.type === "arguments")
        const nameArg = args ? kids(args)[0] : null
        let modName = ""
        if (nameArg) {
          if (nameArg.type === "alias") modName = resolveAliasName(String(nameArg.text), frames as any)
          else if (nameArg.type === "atom") modName = String(nameArg.text).replace(/^:/, "")
          else if (nameArg.type === "identifier") modName = String(nameArg.text)
        }
        const parent = currentModule(frames as any)
        const full = modName.length === 0 ? null : (parent && !modName.includes(".") ? `${parent}.${modName}` : modName)
        frames.push({ ...frames[frames.length - 1], module: full ?? parent, defName: null, aliases: new Map(frames[frames.length - 1].aliases) })
        for (const c of kids(n)) walk(c)
        frames.pop()
        return
      }
      if (DEF_ANY.has(target)) {
        const args = findChild(n, (c) => c.type === "arguments")
        const head = args ? kids(args)[0] : null
        let defName: string | null = null
        if (head && head.type === "identifier") defName = String(head.text)
        else if (head && head.type === "call") {
          const inner = findChild(head, (c) => c.type === "identifier")
          if (inner) defName = String(inner.text)
        }
        frames.push({ ...frames[frames.length - 1], module: currentModule(frames as any), defName, defArity: headArity(head), aliases: new Map(frames[frames.length - 1].aliases) })
        for (const c of kids(n)) {
          // the HEAD is a declaration, not an evaluation (the analyzer's isDefHead guard) — but a
          // `, do: body` pair inside the arguments node is CODE (isDoPair), so descend per child.
          const isHeadArgs = c && c.type === "arguments"
          if (isHeadArgs) {
            for (const hc of kids(c)) {
              if (isDoPairNode(hc)) walk(hc)
              else { frames.push({ ...frames[frames.length - 1], inert: true, headInert: true }); walk(hc); frames.pop() }
            }
          } else walk(c)
        }
        frames.pop()
        return
      }
      // A remote call with an ATOM module: `:erlang.make_tuple(...)` / `:lists.flatten(...)`.
      if (t === "call") {
        const callee = findChild(n, (c) => c.type === "dot")
        if (callee) {
          const left = field(callee, "left")
          const right = field(callee, "right")
          if (left && left.type === "atom" && right && !isQuoted() && !isInert()) {
            const remote = `${String(left.text)}.${String(right.text)}`
            const k = `${definitionScope(frames as any)}\u0000${remote}`
            if (!seen.has(k)) {
              seen.add(k)
              out.push({ label: "calls", from: definitionScope(frames as any), target: remote })
            }
          }
        }
      }
      if (target === "alias" || target === "import" || target === "require") {
        const args = findChild(n, (c) => c.type === "arguments")
        const modArg = args ? kids(args)[0] : null
        const top = frames[frames.length - 1]
        if (target === "alias" && modArg && (modArg.type === "alias" || modArg.type === "atom")) {
          const raw = String(modArg.text)
          const resolved = resolveAliasName(raw, frames as any)
          const asNode = keywordArg(args, "as")
          const bound = asNode ? String(asNode.text) : (raw.split(".").pop() ?? "")
          if (bound && isUpper(bound)) top.aliases.set(bound, resolved)
        }
      }
    }
    for (const c of kids(n)) walk(c)
  }
  walk(root)
  return out
}
