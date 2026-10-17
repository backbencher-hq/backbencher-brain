/**
 * lua truth oracle — LANE-OWNED MODULE (2026-10-17).
 *
 * The differential's shared file is under concurrent edit by several owners, so this oracle lives
 * here (the `json.ts` / `sql-truth.ts` precedent) and the Lead wires it: one `import`, one
 * `if (lang === "lua")` block, one allowlist line. Nothing in this file is imported by any other
 * oracle, and it is pure (reads a tree-sitter root, returns edges).
 *
 * DERIVED: contains, calls, imports, exports, extends, overrides — the structural bulk.
 * REFUSED, with the reason: `uses` and `references` would require reproducing the analyzer's
 * read-class exclusion set (LUA-40/41: receiver-vs-field, declaration targets, parameters, table
 * keys) and `instantiates` its class-factory recognition. A second, un-audited copy of those
 * rules is an oracle that agrees with the analyzer by construction, which is worse than a scoped
 * one; the sql lane's staged delivery (missing=97/unexplained=0 on contains+references) is the
 * measured precedent for shipping the bulk first.
 *
 * NAMING MIRRORS THE ANALYZER'S WRITTEN PATHS because the matcher keys on `label|target`:
 *   source of a call = the enclosing named declaration path as written (`util.f`), else `global`
 *   call target      = the callee's LEAF (`table.insert` -> `insert`; `self:other` -> `other`)
 *   import target    = the module string exactly as written (`require("a.b")` -> `a.b`)
 *   export target    = a field name in the CHUNK-LEVEL `return { ... }` table
 *   extends          = `setmetatable(Src, Mt)` with both sides nameable and unequal
 *   overrides        = a written declaration path declared MORE THAN ONCE in the file
 *
 * Allowlist contract (the file's own recorded failure mode): the harness filters the ANALYZER side
 * by the compared-label set, so a derived-but-unlisted label reads as MISSING and a listed-but-
 * un-derived label reads as UNEXPLAINED. The allowlist must be EXACTLY:
 *   ["contains", "calls", "imports", "exports", "extends", "overrides"]
 */
/**
 * lua truth oracle (2026-10-17) — DErived from the PARSE TREE, never from the analyzer.
 *
 * SCOPE, declared: derives `contains`, `calls`, `imports`, `exports`, `extends`, `overrides`.
 * REFUSED, with the reason: `uses` and `references` would require reproducing the analyzer's
 * read-class exclusion set (LUA-40/41: receiver-vs-field, declaration targets, parameters,
 * table keys) and `instantiates` its class-factory recognition — a second un-audited copy of
 * those rules is an oracle that agrees with the analyzer by construction. They stay un-derived
 * and their analyzer edges are honestly UNEXPLAINED until a later iteration earns them.
 *
 * NAMING MIRRORS THE ANALYZER'S WRITTEN PATHS because the matcher keys on `label|target`:
 *   source of a call/use = the enclosing named declaration path as written (`util.f`), else `global`
 *   call target          = the callee's LEAF (`table.insert` -> `insert`; `self:other` -> `other`)
 *   import target        = the module string exactly as written (`require("a.b")` -> `a.b`)
 *   export target        = a field name in the CHUNK-LEVEL `return { ... }` table
 *   extends              = `setmetatable(Src, Mt)` with both sides nameable and unequal
 *   overrides            = a written declaration path declared MORE THAN ONCE in the file
 */
export function deriveLuaTruth(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    from = String(from ?? "").trim(); target = String(target ?? "").trim()
    if (!from || !target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k); edges.push({ label, from, target })
  }
  const stringValue = (n: any): string => {
    const t = n?.text ?? ""
    if (t.startsWith('"') || t.startsWith("'")) return t.slice(1, -1)
    if (t.startsWith("[[")) return t.slice(2, -2)
    return ""
  }
  const leaf = (n: any): string => {
    if (!n) return ""
    if (n.type === "identifier") return n.text
    if (n.type === "string") return stringValue(n)
    if (n.type === "dot_index_expression" || n.type === "method_index_expression" || n.type === "bracket_index_expression") {
      const last = n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null
      return leaf(last)
    }
    return ""
  }
  const writtenPath = (n: any): string => {
    if (!n) return ""
    if (n.type === "identifier") return n.text
    if (n.type === "dot_index_expression" || n.type === "method_index_expression") {
      const base = writtenPath(n.namedChild(0))
      const m = leaf(n)
      return base && m ? `${base}.${m}` : m
    }
    return ""
  }
  const declSites: { path: string; line: number }[] = []
  const callStack: string[] = []
  const sourceName = () => (callStack.length > 0 ? callStack[callStack.length - 1] : "global")

  const children = (n: any): any[] => {
    const out: any[] = []
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
    return out
  }
  const walk = (n: any): void => {
    if (!n) return
    // named declaration: `function a.b.f(...)` / `function f(...)`
    if (n.type === "function_declaration") {
      const nameNode = n.namedChild(0)
      const path = writtenPath(nameNode)
      const rest = children(n).slice(1)
      if (path) {
        const parts = path.split(".")
        const member = parts[parts.length - 1]
        const owner = parts.slice(0, -1).join(".")
        if (owner) push("contains", owner, member)
        declSites.push({ path, line: n.startPosition.row + 1 })
        callStack.push(path)
        for (const c of rest) walk(c)
        callStack.pop()
      } else {
        for (const c of rest) walk(c)
      }
      return
    }
    // assignment: `a.b = function ...` gives containment + a callable; `a.b = value` gives containment.
    if (n.type === "assignment_statement") {
      const lhs = n.namedChild(0)
      const targets: string[] = []
      if (lhs?.type === "variable_list") for (const v of children(lhs)) targets.push(writtenPath(v))
      else targets.push(writtenPath(lhs))
      const rhs = n.namedChild(1)
      const sources = rhs ? (rhs.type === "expression_list" ? children(rhs) : [rhs]) : []
      for (let i = 0; i < sources.length; i++) {
        const tgt = targets[i] ?? ""
        const src = sources[i]
        if (!tgt || !src) { if (src) walk(src); continue }
        const parts = tgt.split(".")
        if (parts.length >= 2) push("contains", parts.slice(0, -1).join("."), parts[parts.length - 1])
        if (src.type === "function_definition") {
          declSites.push({ path: tgt, line: n.startPosition.row + 1 })
          callStack.push(tgt)
          walk(src)
          callStack.pop()
        } else {
          walk(src)
        }
      }
      return
    }
    // chunk-level `return { name = ... }` -> exports
    if (n.type === "return_statement") {
      const exprs = n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null
      const list = exprs?.type === "expression_list" ? children(exprs) : exprs ? [exprs] : []
      for (const ex of list) {
        if (ex?.type !== "table_constructor") continue
        for (const f of children(ex)) {
          if (f.type !== "field") continue
          const key = f.namedChild(0)
          let nm = ""
          if (key?.type === "identifier") nm = key.text
          else if (key?.type === "string") nm = stringValue(key)
          if (nm) push("exports", "global", nm)
        }
      }
      return
    }
    // call: callee leaf + enclosing source; require/module are imports, not calls (analyzer parity)
    if (n.type === "function_call") {
      const fnNode = n.namedChild(0)
      const argsNode = n.namedChild(1)
      const argList = argsNode?.type === "arguments" ? children(argsNode) : []
      const calleeLeaf = leaf(fnNode)
      const source = sourceName()
      if (calleeLeaf === "require" || calleeLeaf === "module") {
        const mod = stringValue(argList[0])
        if (mod) push("imports", source, mod)
        for (const a of argList) walk(a)
        return
      }
      if (calleeLeaf === "pcall" || calleeLeaf === "xpcall") {
        if (leaf(argList[0]) === "require") {
          const mod = stringValue(argList[1])
          if (mod) push("imports", source, mod)
        }
      }
      if (calleeLeaf) push("calls", source, calleeLeaf)
      if (calleeLeaf === "setmetatable" && argList.length >= 2) {
        const src = leaf(argList[0])
        const mt = leaf(argList[1])
        const targetIsTable = argList[0]?.type === "table_constructor"
        if (src && mt && src !== mt && !targetIsTable) push("extends", src, mt)
      }
      for (const a of argList) walk(a)
      // the callee expression can itself contain calls (e.g. `f()()`) — walk it too
      walk(fnNode)
      return
    }
    for (const c of children(n)) walk(c)
  }
  walk(root)
  // overrides: a written declaration path declared more than once (the analyzer's redefinition rule)
  const byPath = new Map<string, number>()
  for (const d of declSites) byPath.set(d.path, (byPath.get(d.path) ?? 0) + 1)
  for (const [p, count] of byPath) {
    if (count < 2) continue
    const parts = p.split(".")
    const member = parts.pop() as string
    const owner = parts.join(".")
    push("overrides", owner || "global", member)
  }
  return edges
}
