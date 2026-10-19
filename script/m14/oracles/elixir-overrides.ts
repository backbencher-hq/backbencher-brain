/**
 * ELIXIR LANE — `overrides` truth oracle (task-25 round 2, D4).
 *
 * Elixir HAS override constructs; the analyzer publishes three surfaces and the truth mirrors
 * each from the grammar, not from the analyzer:
 *
 *   A. IN-FILE `defoverridable` REDEFINITION. A declaration, then `defoverridable name: arity`
 *      (or a bare name list), then a SECOND declaration of the same identity. Source is
 *      `Module.name/arity`, target the bare `name` — both endpoints name the same function and the
 *      redefinition is the evidence (the analyzer's recordOverride shape, measured, not inferred).
 *   B. USE-OF-PROVIDER. `use Provider` in a consumer module, where Provider (declared in THIS file)
 *      marks members `defoverridable`: the consumer's matching member overrides
 *      `Provider.member`. Source `Consumer.member/arity`, target `Provider.member`.
 *   C. `@impl` ANNOTATION. `@impl Contract` names the contract explicitly; `@impl true` resolves
 *      only when the module has exactly ONE `@behaviour` candidate (or one candidate declares the
 *      module's own `@callback` name). Ambiguity stays SILENT — the analyzer's rule.
 *
 * Cross-file provider bodies are out of scope BY CONSTRUCTION (a per-file truth walker cannot see
 * another file's `defoverridable` body); the analyzer's same-file subset is mirrored exactly, and
 * the residual is named wherever the truth is wired.
 */

type OracleEdge = { label: string; from: string; target: string }

const kids = (n: any): any[] => (n?.namedChildren ?? [])
const findChild = (n: any, pred: (c: any) => boolean): any | null => {
  for (const c of kids(n)) if (c && pred(c)) return c
  return null
}
const firstOfType = (n: any, ...types: string[]): any | null => findChild(n, (c) => types.includes(c.type))
const DEF_FORMS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
const isUpper = (s: string): boolean => s.length > 0 && s[0] >= "A" && s[0] <= "Z"

/** Arity of a definition head: the arguments count of the signature call (all params as written). */
function headArity(head: any): number {
  if (!head) return 0
  if (head.type === "identifier") return 0
  const args = findChild(head, (c) => c.type === "arguments")
  if (!args) return 0
  let n = 0
  for (const c of kids(args)) if (c && c.type !== "comment") n++
  return n
}
/** The signature call of a def (unwraps the arguments node and a `when` guard). */
function defSignature(defCall: any): any {
  let sig: any = undefined
  for (const c of kids(defCall)) if (c.type !== "identifier" && c.type !== "do_block") { sig = c; break }
  if (!sig) return undefined
  if (sig.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
  if (!sig) return undefined
  if (sig.type === "binary_operator") {
    const named = kids(sig)
    const left = named[0]
    return left && (left.type === "call" || left.type === "identifier") ? left : undefined
  }
  // A zero-arity head is a BARE IDENTIFIER (`def a, do: 1`), not a signature call; returning
  // undefined for it made every zero-arity declaration anonymous.
  return sig.type === "call" || sig.type === "identifier" ? sig : undefined
}
function defNameOf(defCall: any): string {
  const sig = defSignature(defCall)
  if (!sig) return ""
  // `def a, do: 1` / `def b do … end` unwrap to a bare IDENTIFIER (no signature call);
  // the earlier call-only read made every zero-arity declaration anonymous and surface A
  // (defoverridable redefinition) silently derived nothing for them.
  if (sig.type === "identifier") return String(sig.text)
  const id = findChild(sig, (c) => c.type === "identifier")
  return id ? String(id.text) : ""
}
/** `defoverridable name: arity, …` → ["name/arity", …]. */
function overridableNamed(defCall: any): string[] {
  const out: string[] = []
  for (const c of kids(defCall)) {
    if (c.type !== "arguments") continue
    for (const g of kids(c)) {
      const pairs = g.type === "keywords" ? kids(g) : []
      for (const p of pairs) {
        if (p.type !== "pair") continue
        const kw = firstOfType(p, "keyword")
        if (!kw) continue
        const name = String(kw.text).split(":")[0]
        const val = kids(p).filter((x: any) => x !== kw).pop()
        const arity = val ? Number(String(val.text)) : NaN
        if (name && Number.isFinite(arity)) out.push(`${name}/${arity}`)
      }
    }
  }
  return out
}
/** `defoverridable Some.Module` whole-module form. */
function overridableModules(defCall: any): string[] {
  const out: string[] = []
  for (const c of kids(defCall)) {
    if (c.type !== "arguments") continue
    for (const g of kids(c)) {
      const al = g.type === "alias" ? g : firstOfType(g, "alias")
      if (al) out.push(String(al.text))
    }
  }
  return out
}
/** An attribute name from a `@name …` unary_operator. */
function attrName(n: any): string {
  const value = n.child(1)
  if (!value) return ""
  if (value.type === "call") {
    const id = findChild(value, (c) => c.type === "identifier")
    return id ? String(id.text) : ""
  }
  return ""
}
function attrArgs(n: any): any {
  const value = n.child(1)
  return value && value.type === "call" ? findChild(value, (c) => c.type === "arguments") : null
}

export function deriveElixirOverridesTruth(root: any): OracleEdge[] {
  const out: OracleEdge[] = []
  const seen = new Set<string>()
  const pushRow = (from: string, target: string) => {
    if (!from || !target || from === target) return
    const k = `${from}\u0000${target}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "overrides", from, target })
  }

  // ---- collected facts ----
  const lastDecl = new Map<string, number>()                 // `Module.name/arity` -> line
  const marksNamed = new Map<string, Map<string, number>>()  // module -> name/arity -> line
  const marksModules = new Map<string, string[]>()           // module -> [provider module names]
  const declarations: { module: string; name: string; arity: number; line: number }[] = []
  const uses: { consumer: string; provider: string }[] = []
  const behaviours = new Map<string, Set<string>>()          // module -> behaviour module names
  const callbacks = new Map<string, Set<string>>()           // contract/module -> callback names
  let pendingImpl: { module: string; contracts: string[] } | null = null
  // defimpl implements the protocol by construction: the contract is the protocol, not a @behaviour.
  let implContract: string | null = null

  const moduleStack: string[] = []
  const currentModule = (): string => (moduleStack.length > 0 ? moduleStack[moduleStack.length - 1] : "")

  const walk = (n: any, quoted = false): void => {
    if (!n) return
    const t = String(n.type)
    if (t === "call") {
      const name = findChild(n, (c) => c.type === "identifier")?.text ?? ""
      // quote blocks are DATA: `defoverridable`/`def` inside a __using__ template describes the
      // USING module, which is not this file (the analyzer's isInQuotedCode). unquote re-enters code.
      if (name === "quote" || name === "unquote" || name === "unquote_splicing") {
        const next = name === "quote"
        for (const c of kids(n)) walk(c, next)
        return
      }
      if (name === "defimpl") {
        const args = findChild(n, (c) => c.type === "arguments")
        const first = args ? kids(args)[0] : null
        const protocol = first?.type === "alias" ? String(first.text) : ""
        let forAlias = ""
        for (const c of kids(args ?? n)) {
          if (!c || c.type !== "pair") continue
          const kw = firstOfType(c, "keyword")
          if (!kw || !String(kw.text).startsWith("for:")) continue
          const v = kids(c).filter((x: any) => x !== kw).pop()
          const al = v ? (v.type === "alias" ? v : firstOfType(v, "alias")) : null
          if (al) forAlias = String(al.text)
        }
        const implName = forAlias || protocol
        if (implName) {
          moduleStack.push(implName)
          const prev = implContract
          implContract = protocol || prev
          for (const c of kids(n)) walk(c, quoted)
          implContract = prev
          moduleStack.pop()
        } else {
          for (const c of kids(n)) walk(c, quoted)
        }
        return
      }
      if (name === "defmodule" || name === "defprotocol") {
        const args = findChild(n, (c) => c.type === "arguments")
        const nm = args ? String(kids(args)[0]?.text ?? "") : ""
        const parent = currentModule()
        const full = nm.length === 0 ? null : (parent && !nm.includes(".") ? `${parent}.${nm}` : nm)
        moduleStack.push(full ?? parent ?? "")
        for (const c of kids(n)) walk(c, quoted)
        moduleStack.pop()
        return
      }
      if (DEF_FORMS.has(name)) {
        const mod = currentModule()
        const dn = defNameOf(n)
        const sig = defSignature(n)
        const arity = sig ? headArity(sig) : 0
        const line = n.startPosition.row + 1
        if (mod && dn && !quoted) {
          const key = `${mod}.${dn}/${arity}`
          // surface A: this declaration is a redefinition of a marked identity
          const m = marksNamed.get(mod)
          if (m && m.has(`${dn}/${arity}`)) {
            const prior = lastDecl.get(key)
            if (prior !== undefined && prior < line) pushRow(key, dn)
          }
          // surface C: an @impl annotation binds this declaration
          if (pendingImpl && pendingImpl.module === mod) {
            let contract = ""
            if (pendingImpl.contracts.length === 1) contract = pendingImpl.contracts[0]!
            else {
              const declared = callbacks.get(mod) ?? new Set<string>()
              if (declared.has(dn)) {
                const owners = pendingImpl.contracts.filter((b) => (callbacks.get(b) ?? new Set()).has(dn))
                if (owners.length === 1) contract = owners[0]!
              }
            }
            if (contract) pushRow(key, `${contract}.${dn}`)
            pendingImpl = null
          }
          lastDecl.set(key, line)
          declarations.push({ module: mod, name: dn, arity, line })
        }
        // walk the body only (the head is a declaration; its defaults are not code shots)
        for (const c of kids(n)) {
          const isArgs = c.type === "arguments"
          if (isArgs) continue
          walk(c, quoted)
        }
        return
      }
      if (name === "defoverridable") {
        const mod = currentModule()
        if (mod && !quoted) {
          const named = overridableNamed(n)
          if (named.length > 0) {
            const m = marksNamed.get(mod) ?? new Map<string, number>()
            for (const k of named) m.set(k, n.startPosition.row + 1)
            marksNamed.set(mod, m)
          }
          const mods = overridableModules(n)
          if (mods.length > 0) {
            const arr = marksModules.get(mod) ?? []
            arr.push(...mods)
            marksModules.set(mod, arr)
          }
        }
        return
      }
      if (name === "use") {
        const mod = currentModule()
        const args = findChild(n, (c) => c.type === "arguments")
        const first = args ? kids(args)[0] : null
        if (mod && first && !quoted) {
          const provider = first.type === "atom" ? String(first.text) : String(first.text)
          if (provider) uses.push({ consumer: mod, provider })
        }
        return
      }
    }
    if (t === "unary_operator" && String(n.child(0)?.text ?? "") === "@") {
      // An ATTRIBUTE inside a quote block is DATA describing the USING module, not this file's
      // module: `quote do @behaviour DynamicSupervisor end` must not make DynamicSupervisor a
      // second candidate behaviour of itself (it did — every @impl true in the file then stayed
      // silent from ambiguity; 29 analyzer rows went UNEXPLAINED).
      if (quoted) return
      const a = attrName(n)
      if (a === "behaviour" || a === "behavior") {
        const mod = currentModule()
        const args = attrArgs(n)
        const al = args ? firstOfType(args, "alias") : null
        const at = args ? firstOfType(args, "atom") : null
        if (mod && (al || at)) {
          const name = al ? String(al.text) : String(at!.text).replace(/^:/, "")
          const set = behaviours.get(mod) ?? new Set<string>()
          set.add(name); behaviours.set(mod, set)
        }
        return
      }
      if (a === "callback" || a === "macrocallback") {
        const mod = currentModule()
        const args = attrArgs(n)
        const sig = args ? firstOfType(args, "call") : null
        const id = sig ? findChild(sig, (c) => c.type === "identifier") : null
        if (mod && id) {
          const set = callbacks.get(mod) ?? new Set<string>()
          set.add(String(id.text)); callbacks.set(mod, set)
          const cbs = callbacks.get(mod)!
          callbacks.set(mod, cbs)
        }
        return
      }
      if (a === "impl") {
        const mod = currentModule()
        const args = attrArgs(n)
        const first = args ? kids(args)[0] : null
        const explicit = first?.type === "alias" ? [String(first.text)] : []
        const fromScope = implContract ? [implContract] : []
        const contracts = explicit.length > 0 ? explicit : (fromScope.length > 0 ? fromScope : [...(behaviours.get(mod) ?? [])])
        if (mod) pendingImpl = { module: mod, contracts }
        return
      }
      // declaration attributes are not code; other attributes' values are compile-time code
      const declAttrs = new Set(["moduledoc", "doc", "spec", "type", "typep", "opaque", "optional_callbacks", "derive", "deprecated"])
      const isDecl = declAttrs.has(a)
      for (const c of kids(n)) walk(c, quoted || isDecl)
      return
    }
    for (const c of kids(n)) walk(c, quoted)
  }
  walk(root)

  // ---- surface B: use-of-provider, both modules in THIS file ----
  for (const u of uses) {
    const named = marksNamed.get(u.provider) ?? new Map<string, number>()
    const mods = marksModules.get(u.provider) ?? []
    if (named.size === 0 && mods.length === 0) continue
    for (const d of declarations) {
      if (d.module !== u.consumer) continue
      const q = `${d.name}/${d.arity}`
      let provider = ""
      if (named.has(q) || named.has(d.name)) provider = u.provider
      else {
        for (const pm of mods) {
          if (declarations.some((x) => x.module === pm && x.name === d.name)) { provider = pm; break }
        }
      }
      if (provider) pushRow(`${u.consumer}.${q}`, `${provider}.${d.name}`)
    }
  }

  return out
}
