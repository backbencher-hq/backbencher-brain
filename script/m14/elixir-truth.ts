/**
 * elixir-truth — a lane-owned oracle for `script/m14/rel-type-coverage-gate.ts`.
 *
 * ## Why this file exists
 *
 * `validation/m60/rel-type-coverage-baseline.json` records elixir as one of the
 * 100 DERIVATION findings: *"emits `contains` but the differential audits
 * ["calls","extends","implements","instantiates","overrides","references"] — the
 * type is stored and compared against nothing"*. `contains` is 9,843 of 65,766
 * corpus edges (15.0%), and after this wave `exports`/`uses`/`imports`/
 * `overrides` joined the unaudited set — 4,840 more.
 *
 * The gate reads a lane's audited set from `script/m14/<lang>-truth.ts` when that
 * export exists, preferring it over the shared `differential.ts` filter because
 * it is derived from the emitter itself (ruby is the precedent). The label list
 * below is therefore a CLAIM, and the runner that proves it is
 * `script/m14/tmp/elixir4/oracle-agreement.ts`.
 *
 * ## What an oracle over the SAME grammar can and cannot prove
 *
 * This is a second walker over the same pinned `tree-sitter-elixir` wasm, so a
 * grammar bug shared by both paths is invisible to it, exactly as
 * `docs/analyzers/ONTOLOGY-WORKSTREAM.md` §Part 1 Q3 says. It CAN prove that the
 * analyzer's EDGE RULES agree with a re-derivation from the node shapes, and it
 * is the only thing in the lane that does.
 *
 * ## The rules, written from the pinned grammar's shapes
 *
 * The noise-elimination contract that makes the two sides agree (each rule is
 * mirrored in `docs/analyzers/real-elixir-analyzer.md`):
 *   - quoted code (`quote do ... end`) is DATA: no symbols, no edges.
 *   - a def signature head is not a call; a bodiless `def` is a declaration.
 *   - Kernel builtins and special forms are never calls.
 *   - a member read (`x.y` with no argument list) is not a call.
 *   - a directive's module name is its FIRST ARGUMENT'S OWN name, never the
 *     clause text; a computed name emits nothing.
 *   - an unqualified call resolves only when the enclosing module declares it.
 */
import type { Node } from "web-tree-sitter"

/**
 * The labels this oracle can emit. Read by `script/m60/rel-type-coverage-gate.ts`
 * through a narrow textual pattern (`export const [A-Z_]*ORACLE_LABELS = [...]`),
 * so the shape is load-bearing: a plain array of quoted strings, nothing else.
 * `extends` is deliberately absent — Elixir has no inheritance construct and the
 * measurement that rules it is in the analyzer doc; see the note in
 * `script/m14/tmp/elixir4/construct-probe.ts`.
 */
export const ELIXIR_ORACLE_LABELS: ReadonlyArray<ElixirTruthEdge["label"]> = [
  "calls", "contains", "exports", "implements", "imports", "instantiates", "overrides", "references", "uses",
]

export interface ElixirTruthEdge {
  label: "calls" | "contains" | "exports" | "implements" | "imports" | "instantiates" | "overrides" | "references" | "uses"
  /** The edge's source, as the analyzer spells it (scope-arity for a call site). */
  from: string
  target: string
  line: number
}

// Elixir special forms / control flow: call-shaped in this grammar, never a call.
const SPECIAL = new Set(["if", "unless", "case", "cond", "receive", "with", "for", "try", "rescue", "catch", "after", "else", "quote", "unquote", "super", "raise", "throw", "exit", "fn", "do", "match"])
// Kernel auto-imports: available everywhere, pure call-graph noise (FP family).
const KERNEL = new Set(["length", "hd", "tl", "elem", "put_elem", "map_size", "tuple_size", "byte_size", "bit_size", "div", "rem", "abs", "round", "trunc", "ceil", "floor", "min", "max", "is_atom", "is_binary", "is_bitstring", "is_boolean", "is_float", "is_function", "is_integer", "is_list", "is_map", "is_map_key", "is_number", "is_pid", "is_port", "is_reference", "is_tuple", "is_nil", "is_struct", "is_exception", "map_get", "to_string", "inspect", "apply", "self", "send", "send_after", "spawn", "spawn_link", "spawn_monitor", "make_ref", "node", "put_in", "get_in", "update_in", "get_and_update_in", "pop_in", "struct", "struct!", "binary_part", "binding", "tap", "then", "dbg", "tuple_to_list", "list_to_tuple", "atom_to_binary", "binary_to_atom", "term_to_binary", "binary_to_term", "process_flag", "sleep", "yield", "match?", "function_exported?", "macro_exported?", "reraise"])
const DEFS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
const DIRECTIVES = new Set(["use", "import", "alias", "require"])
const PUBLIC_DEFS = new Set(["def", "defmacro", "defguard", "defdelegate"])
const PRIVATE_DEFS = new Set(["defp", "defmacrop", "defguardp"])
// Attributes whose VALUE is a declaration, never executable module code.
const DECL_ATTRS = new Set(["moduledoc", "doc", "spec", "type", "typep", "opaque", "callback", "macrocallback", "optional_callbacks", "behaviour", "behavior", "derive", "deprecated"])

function isQuote(n: Node): boolean {
  let cur: Node | null = n.parent
  while (cur) {
    if (cur.type === "call" && cur.child(0)?.text === "quote") return true
    if (cur.type === "do_block" && cur.parent?.type === "call" && cur.parent.child(0)?.text === "quote") return true
    cur = cur.parent
  }
  return false
}

/** A def-shaped head: `arguments` of a def/protocol/impl/struct, or its first child. */
function inDefHead(n: Node): boolean {
  let cur: Node | null = n.parent
  while (cur) {
    if (cur.type === "do_block") return false
    if (cur.type === "call") {
      const t = cur.child(0)?.text ?? ""
      if (DEFS.has(t) || t === "defprotocol" || t === "defimpl" || t === "defstruct" || t === "defexception" || t === "defmodule") {
        const args = cur.namedChildCount > 1 ? cur.namedChild(1) : undefined
        if (args && (args === n.parent || (n.parent && args.startIndex <= n.startIndex && n.endIndex <= args.endIndex))) return true
      }
    }
    cur = cur.parent
  }
  return false
}

function declAttrAt(n: Node): string | undefined {
  let cur: Node | null = n.parent
  while (cur) {
    if (cur.type === "unary_operator" && cur.child(0)?.text === "@") {
      const v = cur.child(1)
      if (!v) return undefined
      if (v.type !== "call") return undefined
      return v.child(0)?.text ?? undefined
    }
    cur = cur.parent
  }
  return undefined
}

function firstNamed(n: Node): Node | undefined {
  return n.namedChildCount > 0 ? n.namedChild(0) : undefined
}

function findDeep(n: Node, pred: (c: Node) => boolean): Node | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    if (pred(c)) return c
    const r = findDeep(c, pred)
    if (r) return r
  }
  return null
}

function findShallow(n: Node, pred: (c: Node) => boolean): Node | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && pred(c)) return c
  }
  return null
}

/**
 * The module name of a `defmodule`/`defprotocol`, or "" when it is not
 * statically readable. An ATOM is a real name (`defmodule :purge_test`); a
 * quoted atom is a name only when every `.`-separated segment starts uppercase
 * (`:"Elixir.Foo"` yes, `:"foo/bar"` no); a computed name is unreadable.
 */
function moduleName(args: Node | undefined): string {
  if (!args) return ""
  const first = firstNamed(args)
  if (!first) return ""
  if (first.type === "alias" || first.type === "identifier" || first.type === "atom") return first.text
  let c = ""
  if (first.type === "quoted_atom") c = findShallow(first, (x) => x.type === "quoted_content")?.text ?? ""
  else if (first.type === "dot") {
    const l = first.childForFieldName("left")
    const r = first.childForFieldName("right")
    if (!l || !r) return ""
    if (l.type === "identifier" && l.text === "__MODULE__") return ""
    c = `${l.text}.${r.text}`
  }
  const t = c.trim()
  if (!t) return ""
  let start = 0
  while (start <= t.length) {
    let end = t.indexOf(".", start)
    if (end === -1) end = t.length
    const seg = t.slice(start, end)
    if (!seg) return ""
    const ch = seg.charAt(0)
    if (ch !== ch.toUpperCase() || ch === ch.toLowerCase()) return ""
    start = end + 1
  }
  return t
}

/** A directive's module name: its FIRST ARGUMENT'S OWN name, never the clause text. */
function directiveName(args: Node | undefined): string {
  if (!args) return ""
  const first = firstNamed(args)
  if (!first) return ""
  if (first.type === "alias" || first.type === "identifier" || first.type === "atom") return first.text
  if (first.type === "dot") {
    // `alias __MODULE__.Foo` / `alias Foo.{Bar, Baz}`: the group form expands per member.
    const l = first.childForFieldName("left")
    const r = first.childForFieldName("right")
    if (l && r && r.type !== "tuple") return `${l.text}.${r.text}`
  }
  return ""
}

/** A def head's (name, arity), read off the signature call. */
function defSignature(args: Node | undefined): { name: string; arity: number } | undefined {
  if (!args || args.type === "keywords") return undefined
  const sig = firstNamed(args)
  if (!sig) return undefined
  if (sig.type === "block") {
    const op = findDeep(sig, (x) => x.type === "operator_identifier")
    if (!op) return undefined
    return { name: op.text, arity: 1 }
  }
  if (sig.type === "unary_operator") {
    for (let i = 0; i < sig.childCount; i++) {
      const c = sig.child(i)
      if (c && !c.isNamed) return { name: c.text, arity: 1 }
    }
    return undefined
  }
  if (sig.type === "call") {
    // `def unquote(name)(x)` names its function at runtime; there is no static
    // name, so the oracle publishes no edge for it — the same rule the analyzer
    // applies by marking the symbol and withholding the edge.
    if (sig.child(0)?.text === "unquote") return undefined
    const a = sig.namedChildCount > 1 ? sig.namedChild(1) : undefined
    return { name: String(sig.child(0)?.text ?? ""), arity: a && a.type === "arguments" ? a.namedChildCount : 0 }
  }
  if (sig.type === "identifier") return { name: sig.text, arity: 0 }
  return undefined
}

export function deriveElixirTruthEdges(root: Node): ElixirTruthEdge[] {
  const out: ElixirTruthEdge[] = []
  const seen = new Set<string>()
  const push = (label: ElixirTruthEdge["label"], from: string, target: string, line: number) => {
    if (!from || !target) return
    if (label !== "calls" && from === target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label, from, target, line })
  }
  const line = (n: Node): number => n.startPosition.row + 1

  interface Frame { module: string; fnScope: string | undefined; kind: "module" | "protocol" | "impl" | "fn"; firstDecl: Map<string, number>; overridable: Map<string, number>; aritylessMarked: Set<string> }
  const stack: Frame[] = []
  const top = (): Frame | undefined => stack[stack.length - 1]
  const moduleOf = (): string | undefined => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind !== "fn") return stack[i].module; return undefined }
  const declaredIn = (module: string, name: string): boolean => declaredNames.has(`${module}\u0000${name}`)
  const declaredNames = new Set<string>()
  /** Node ids of declaration subtrees the walk must not descend into (an
   *  unnameable `defmodule`/`defprotocol`/`defimpl`). Populated by the declaration
   *  pass and honoured by both edge passes. */
  const skipIds = new Set<number>()
  const aliasMap = new Map<string, string>()
  const resolveAlias = (name: string): string => {
    if (!name) return name
    const parts = name.split(".")
    const root = parts[0]
    const hit = root ? aliasMap.get(root) : undefined
    if (!hit) return name
    parts[0] = hit
    return parts.join(".")
  }

  // ---- pass 1: declarations (names per module, `defoverridable` marks, aliases)
  const declPass = (n: Node, module: string | undefined) => {
    if (isQuote(n)) return
    if (n.type === "call") {
      const t = String(n.child(0)?.text ?? "")
      if (t === "defmodule" || t === "defprotocol") {
        const nm = moduleName(n.namedChildCount > 1 ? n.namedChild(1) : undefined)
        if (!nm) { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) skipIds.add(c.id) } return }
        const full = module ? (nm.startsWith("Elixir.") || nm === module || nm.startsWith(module + ".") ? nm : `${module}.${nm}`) : nm
        stack.push({ module: full, fnScope: undefined, kind: t === "defprotocol" ? "protocol" : "module", firstDecl: new Map(), overridable: new Map(), aritylessMarked: new Set() })
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) declPass(c, full) }
        stack.pop()
        return
      }
      if (t === "defimpl") {
        const nm = moduleName(n.namedChildCount > 1 ? n.namedChild(1) : undefined)
        if (!nm) { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) skipIds.add(c.id) } return }
        const full = module ? `${module}.impl` : "impl"
        stack.push({ module: full, fnScope: undefined, kind: "impl", firstDecl: new Map(), overridable: new Map(), aritylessMarked: new Set() })
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) declPass(c, full) }
        stack.pop()
        return
      }
      if (t === "defoverridable") {
        const fr = top()
        if (!fr) { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) declPass(c, module) } return }
        const args = n.namedChildCount > 1 ? n.namedChild(1) : undefined
        const inner = args ? firstNamed(args) : undefined
        if (!inner) return
        if (inner.type === "alias") { fr.overridable.set(`module\u0000${inner.text}`, line(n)); return }
        const groups: Node[] = inner.type === "keywords" ? [inner] : inner.type === "list" ? Array.from({ length: inner.namedChildCount }, (_, i) => inner.namedChild(i)).filter((x): x is Node => !!x && x.type === "keywords") : []
        for (const g of groups) for (let i = 0; i < g.namedChildCount; i++) {
          const p = g.namedChild(i)
          if (!p || p.type !== "pair") continue
          const kw = findShallow(p, (x) => x.type === "keyword" || x.type === "quoted_keyword")
          if (!kw) continue
          const ci = kw.text.indexOf(":")
          const nm = ci >= 0 ? kw.text.slice(0, ci) : kw.text
          if (!nm) continue
          let arity = -1
          for (let j = 0; j < p.namedChildCount; j++) { const v = p.namedChild(j); if (v?.type === "integer") { arity = parseInt(v.text, 10); break } }
          if (arity >= 0) fr.overridable.set(`${nm}/${arity}`, line(n))
          else fr.aritylessMarked.add(nm)
        }
        return
      }
      if (DEFS.has(t)) {
        const sig = defSignature(n.namedChildCount > 1 ? n.namedChild(1) : undefined)
        const fr = top()
        if (sig && fr) {
          declaredNames.add(`${fr.module}\u0000${sig.name}`)
          if (!fr.firstDecl.has(`${sig.name}/${sig.arity}`)) fr.firstDecl.set(`${sig.name}/${sig.arity}`, line(n))
          // ELX4 overrides: the mark must come AFTER the declaration.
          const prior = fr.firstDecl.get(`${sig.name}/${sig.arity}`)!
          if (prior < line(n)) {
            if (fr.overridable.has(`${sig.name}/${sig.arity}`) || fr.aritylessMarked.has(sig.name)) {
              push("overrides", `${fr.module}.${sig.name}`, sig.name, line(n))
            }
          }
          if (sig.name === "Unknown") return
          if (fr.kind !== "fn") push("contains", fr.module, sig.name, line(n))
          if (PUBLIC_DEFS.has(t) && fr.kind !== "fn") push("exports", fr.module, sig.name, line(n))
          // The call scope: module-qualified name + arity (W24 #17).
          stack.push({ module: fr.module, fnScope: `${fr.module}.${sig.name}/${sig.arity}`, kind: "fn", firstDecl: new Map(), overridable: new Map(), aritylessMarked: new Set() })
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type !== "identifier") declPass(c, fr.module) }
          stack.pop()
          return
        }
      }
      if (t === "defstruct" || t === "defexception") {
        const fr = top()
        if (fr && fr.kind !== "fn" && !inDefHead(n)) push("contains", fr.module, fr.module, line(n))
        const args = n.namedChildCount > 1 ? n.namedChild(1) : undefined
        if (args && fr) {
          const inner = firstNamed(args)
          const kids: Node[] = inner ? Array.from({ length: inner.namedChildCount }, (_, i) => inner.namedChild(i)).filter((x): x is Node => !!x) : []
          const groups = kids.filter((x) => x.type === "keywords")
          for (const g of groups) for (let i = 0; i < g.namedChildCount; i++) {
            const p = g.namedChild(i)
            if (!p || p.type !== "pair") continue
            const kw = findShallow(p, (x) => x.type === "keyword" || x.type === "quoted_keyword")
            if (!kw) continue
            const ci = kw.text.indexOf(":")
            const nm = ci >= 0 ? kw.text.slice(0, ci) : kw.text
            if (nm) push("contains", fr.module, nm, line(p))
          }
          // The BARE form: `defexception [:file, :line]`, `defstruct [:a, :b]`.
          for (const el of kids) {
            if (el.type === "list") for (let i = 0; i < el.namedChildCount; i++) {
              const at = el.namedChild(i)
              if (at?.type === "atom") { const nm = at.text.startsWith(":") ? at.text.slice(1) : at.text; if (nm) push("contains", fr.module, nm, line(at)) }
            }
          }
        }
      }
      if (t === "defmodule" || t === "defprotocol" || t === "defimpl") { /* handled above */ }
    }
    if (n.type === "unary_operator" && n.child(0)?.text === "@") {
      const inner = n.child(1)
      const attr = inner?.type === "call" ? inner.child(0)?.text : inner?.type === "identifier" ? inner.text : undefined
      if (attr === "callback" || attr === "macrocallback") {
        const cb = findDeep(n, (x) => x.type === "call" && x.child(0)?.type === "identifier")
        const fr = top()
        if (cb && fr) {
          const sig = defSignature(cb.namedChildCount > 1 ? cb.namedChild(1) : undefined)
          if (sig) {
            declaredNames.add(`${fr.module}\u0000${sig.name}`)
            if (!fr.firstDecl.has(`${sig.name}/${sig.arity}`)) fr.firstDecl.set(`${sig.name}/${sig.arity}`, line(n))
            push("contains", fr.module, sig.name, line(n))
            push("exports", fr.module, sig.name, line(n))
          }
        }
      }
      if (attr === "behaviour" || attr === "behavior") {
        // `@behaviour GenServer` names an `alias`; `@behaviour :some_atom` an `atom`.
        const named = findDeep(n, (x) => x.type === "alias" || x.type === "atom")
        const fr = top()
        if (named && fr) push("implements", fr.module, resolveAlias(named.type === "atom" ? named.text.replace(/^:/, "") : named.text), line(named))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) declPass(c, module) }
  }
  declPass(root, undefined)

  // ---- pass 2: directives, calls, struct literals
  // Re-walk with the module/fn scopes the declaration pass established.
  const deferredAlias: string[] = []
  const edgePass = (n: Node, module: string | undefined, fnScope: string | undefined) => {
    if (skipIds.has(n.id)) return
    if (isQuote(n)) return
    let nextModule = module
    let nextFn = fnScope
    if (n.type === "call") {
      const t = String(n.child(0)?.text ?? "")
      if (t === "defmodule" || t === "defprotocol" || t === "defimpl") {
        const nm = moduleName(n.namedChildCount > 1 ? n.namedChild(1) : undefined)
        if (nm && t !== "defimpl") {
          nextModule = module ? (nm.startsWith("Elixir.") || nm === module || nm.startsWith(module + ".") ? nm : `${module}.${nm}`) : nm
          nextFn = undefined
          // EX-L5: the implied last-segment alias registers on scope EXIT, not on
          // entry — inside `defmodule Registry.Supervisor`, `use Supervisor` names
          // the EXTERNAL Supervisor, which is why that edge exists at all. Register
          // it only after the module's own subtree has been walked.
          deferredAlias.push(nextModule)
        }
      } else if (DEFS.has(t)) {
        const sig = defSignature(n.namedChildCount > 1 ? n.namedChild(1) : undefined)
        if (sig && module) { nextFn = `${module}.${sig.name}/${sig.arity}`; if (sig.name === "Unknown") return }
      }
    }
    emitFor(n, module, fnScope)
    // The mark is taken BEFORE descending, so the implied alias goes live only
    // after THIS node's own subtree — including a nested module's body, where the
    // alias must not be live yet (EX-L5).
    const aliasMark = deferredAlias.length
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) edgePass(c, nextModule, nextFn) }
    while (deferredAlias.length > aliasMark) {
      const m = deferredAlias.pop()!
      const seg = m.split(".").pop()
      if (seg && !aliasMap.has(seg)) aliasMap.set(seg, m)
    }
  }
  const emitFor = (n: Node, module: string | undefined, fnScope: string | undefined) => {
    // Directives and calls are attributed to the scope they are written in.
    if (n.type !== "call") return
    const t = String(n.child(0)?.text ?? "")
    const attr = declAttrAt(n)
    const src = fnScope ?? module ?? "Global"
    if (DIRECTIVES.has(t)) {
      if ((!attr || !DECL_ATTRS.has(attr)) && !inDefHead(n)) {
        const args = n.namedChildCount > 1 ? n.namedChild(1) : undefined
        const nm = directiveName(args)
        if (nm && module) {
          const dep = resolveAlias(nm)
          push("references", module, dep, line(n))
          if (t === "use") push("uses", module, dep, line(n))
          if (t === "import") push("imports", module, dep, line(n))
        }
      }
      return
    }
    if (t === "defimpl" && !inDefHead(n)) {
      const args = n.namedChildCount > 1 ? n.namedChild(1) : undefined
      const proto = moduleName(args)
      const kw = args ? findShallow(args, (x) => x.type === "keywords") : null
      let forAlias = ""
      if (kw) for (let i = 0; i < kw.namedChildCount; i++) {
        const p = kw.namedChild(i)
        if (p?.type !== "pair") continue
        const k = findShallow(p, (x) => x.type === "keyword")
        const kci = k?.text.indexOf(":") ?? -1
        if (!k || kci < 0 || k.text.slice(0, kci) !== "for") continue
        forAlias = Array.from({ length: p.namedChildCount }, (_, j) => p.namedChild(j)).find((x) => x?.type === "alias")?.text ?? ""
      }
      if (proto && module && forAlias) { push("implements", module, proto, line(n)); push("implements", resolveAlias(forAlias), proto, line(n)) }
      return
    }
    if ((t === "struct" || t === "struct!" || t === "raise" || t === "reraise") && !(attr && DECL_ATTRS.has(attr)) && !inDefHead(n)) {
      const args = n.namedChildCount > 1 ? n.namedChild(1) : undefined
      const first = args ? firstNamed(args) : undefined
      if (first?.type === "alias") push("instantiates", src, resolveAlias(first.text), line(first))
      return
    }
    if (t === "defmodule" || t === "defprotocol") return
    if (SPECIAL.has(t) || KERNEL.has(t) || DEFS.has(t)) return
    if (inDefHead(n) || (attr && DECL_ATTRS.has(attr))) return
    const targetNode = findShallow(n, (x) => x.type === "identifier" || x.type === "dot")
    if (!targetNode) return
    const raw = targetNode.text
    if (raw.indexOf("{") !== -1 || raw.indexOf("}") !== -1 || raw.indexOf("(") !== -1) return
    if (raw.indexOf(".") !== -1) {
      const rootSeg = raw.split(".")[0]
      const ch = rootSeg.charAt(0)
      if (ch !== ch.toUpperCase() || ch === ch.toLowerCase()) return
      const resolved = resolveAlias(raw)
      if (resolved.startsWith("Kernel.")) return
      if (SPECIAL.has(resolved.split(".").pop() ?? "")) return
      push("calls", src, resolved, line(targetNode))
      return
    }
    if (!module) return
    if (declaredIn(module, raw)) push("calls", src, raw, line(targetNode))
    else push("calls", src, resolveAlias(raw), line(targetNode))
  }
  edgePass(root, undefined, undefined)
  return out
}