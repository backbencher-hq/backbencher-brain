/**
 * HASKELL — truth for the six relationship classes `deriveHaskellEdges` does not
 * derive.
 *
 * ## Why this file exists, with the measurement
 *
 * `script/m14/differential.ts` compares a lane on an ALLOWLIST of relationship
 * labels, and for haskell that allowlist — read by evaluating its own filter
 * expression, the way `script/m60/rel-type-coverage-gate.ts` does — is:
 *
 *     extends, implements, instantiates, overrides, calls
 *
 * `deriveHaskellEdges` derives FOUR of those five (calls, extends, implements,
 * instantiates) and emits ZERO `overrides` rows. So the lane audits five classes
 * and can actually see four, and the six classes below are emitted by the analyzer
 * and compared against nothing at all.
 *
 * MEASURED over a 1,200-file stride draw of the 14,066-file corpus
 * (`script/m14/tmp/hs-oracle-agreement.ts`, the harness's own published rule —
 * `label + normTarget(target)`, file-scoped):
 *
 *     type          oracle rows   analyzer emitted   in allowlist   MISSING  UNEXPLAINED
 *     uses                     0                630             0         —          —
 *     contains                 0             10,262             0         —          —
 *     imports                  0              3,191             0         —          —
 *     references               0                100             0         —          —
 *     exports                  0              2,831             0         —          —
 *     overrides                0                240           240         0        240
 *
 * 16,930 of the draw's 30,157 analyzer edges (56.1%) were compared against
 * nothing, and the 240 `overrides` edges — which ARE in the allowlist — read as
 * 100% fabrication because the oracle derives none. `overrides` is the exact
 * defect `script/m14/ontology-coverage-gate.ts` was built for, in the direction
 * the gate's header does not describe: not "both sides silent", but "one side
 * emits and the comparison convicts it".
 *
 * `script/m60/rel-type-coverage-gate.ts` records 2 of haskell's 5 gaps
 * (`contains`, `references`) as pre-existing debt and reports `exports`,
 * `imports` and `uses` as REGRESSIONS — because the M60-HK wave added those three
 * emissions without adding an oracle for them. This module is the oracle half of
 * that wave.
 *
 * ## IT IS INERT UNTIL `differential.ts` CALLS IT
 *
 * It deliberately does NOT export `*_ORACLE_LABELS`. `rel-type-coverage-gate.ts`
 * reads a per-lane `ORACLE_LABELS` export as "the lane's audited set" and lets it
 * OVERRIDE the shared allowlist (`readOwnOracleLabels`). Exporting it here while
 * `differential.ts` still derives four classes would make that gate report
 * haskell as auditing all ten while five are unadmitted and one is mis-admitted —
 * a false clean manufactured by the fix. The export belongs in the same commit
 * as the `differential.ts` wiring, by whoever owns that file.
 *
 * ## What is INDEPENDENT here, and what is not
 *
 * `uses`, `imports`, `exports`, `references` and `overrides` are derived from the
 * tree by this module's own rules, written from Haskell's syntax. `contains` is
 * NOT: it is a statement about OWNERSHIP, and inventing a second notion of who
 * owns what would manufacture disagreements that say nothing about either
 * implementation. So `contains` takes the analyzer's published `ownerName` as
 * GIVEN TRUTH and derives the containment ARITHMETIC and the line from it — the
 * clojure and nim precedent, stated rather than hidden. That half cannot catch an
 * ownership bug; it can catch a dropped, duplicated or mislined edge, and it says
 * so.
 */
import type { Node } from "web-tree-sitter"

export type HaskellTruthLabel =
  | "contains"
  | "uses"
  | "imports"
  | "exports"
  | "references"
  | "overrides"

/** The labels this module can derive, once `differential.ts` calls it. */
export const HASKELL_TRUTH_LABELS: ReadonlyArray<HaskellTruthLabel> = [
  "contains",
  "uses",
  "imports",
  "exports",
  "references",
  "overrides",
]

export interface HaskellTruthEdge {
  label: HaskellTruthLabel
  from: string
  target: string
}

const DECL_KEYWORDS: ReadonlySet<string> = new Set([
  "type", "data", "newtype", "class", "instance", "family", "pattern", "proc", "default", "module",
])

// ── tree readers ────────────────────────────────────────────────────────────
function named(node: Node, types: string[]): Node | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && types.includes(c.type)) return c
  }
  return null
}
function allNamed(node: Node, types: string[]): Node[] {
  const out: Node[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && types.includes(c.type)) out.push(c)
  }
  return out
}
function moduleNameOf(node: Node): string {
  let out = ""
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    const leaf = c.type === "module_id" ? moduleNameOf(c) : c.text
    if (out) out += "."
    out += leaf
  }
  return out
}
function walk(root: Node, visit: (n: Node) => boolean | void): void {
  const stack: Node[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (visit(n) === false) continue
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
}

/**
 * The name an `export` entry exports — the same four shapes the analyzer's
 * `readExportName` reads, derived here from the tree rather than shared with it.
 * `namespace + name` (`type T`), `namespace + prefix_id` (`type (&&)`,
 * `pattern (:|)`), a bare `variable` (a name, or a mis-parsed keyword whose real
 * name sits in the sibling ERROR), and a bare `name` (`U(..)`).
 */
function exportEntryName(exp: Node, exportsList: Node, index: number): string | undefined {
  const n = named(exp, ["name", "constructor"])
  if (n?.text) return n.text
  const opId = named(exp, ["prefix_id", "infix_id"])
  if (opId) {
    const op = named(opId, ["operator", "constructor_operator", "constructor", "variable"])
    if (op?.text) return op.text
  }
  const variable = named(exp, ["variable"])
  if (variable?.text) {
    if (!DECL_KEYWORDS.has(variable.text)) return variable.text
    for (let j = index + 1; j < exportsList.namedChildCount; j++) {
      const nx = exportsList.namedChild(j)
      if (!nx) continue
      if (nx.type === "export" || nx.type === "module_export") break
      if (nx.type === "ERROR") {
        const rec = named(nx, ["name", "constructor"])
        if (rec?.text) return rec.text
      }
    }
    return undefined
  }
  const text = exp.text.trim()
  if (!text) return undefined
  const p = text.indexOf("(")
  return p >= 0 ? text.slice(0, p).trim() : text
}

/** The C entity of a `foreign_import`: the LAST `entity` child, unquoted. */
function foreignEntity(node: Node): string | undefined {
  let found: Node | null = null
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c?.type === "entity") found = c
  }
  const t = found?.text ?? ""
  return t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"' ? t.slice(1, -1) : t || undefined
}

/** Type-name leaves in a type expression, skipping type VARIABLES (`a`, `f`). */
function typeNameLeaves(node: Node, skip: Node | null, out: Node[] = []): Node[] {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c || c === skip) continue
    if (c.type === "name" || c.type === "constructor") {
      if (c.text.trim() && !out.some((o) => o.text === c.text)) out.push(c)
      continue
    }
    typeNameLeaves(c, null, out)
  }
  return out
}

/** The head of an applied spine, verbatim (a qualified head keeps its dots). */
function appliedHead(node: Node): string | undefined {
  let cur: Node | null = node
  let guard = 0
  while (cur && guard++ < 64) {
    if (cur.type === "apply" || cur.type === "parens" || cur.type === "strict") {
      cur = cur.namedChildCount > 0 ? cur.namedChild(0) : null
      continue
    }
    break
  }
  return cur?.text || undefined
}

/**
 * The class name and the method names a `class` body declares.
 * `collectClassMethods`' counterpart, written from the grammar: the methods are
 * `signature -> variable` and `function`/`bind` heads under `class_declarations`.
 */
function classMethodsOf(node: Node): { name: string; methods: Set<string> } | null {
  const name = named(node, ["name"])?.text
  if (!name) return null
  const methods = new Set<string>()
  const decls = named(node, ["class_declarations"])
  for (const g of decls ? [decls] : []) {
    for (const sig of allNamed(g, ["signature"])) {
      const v = named(sig, ["variable"])
      if (v?.text) methods.add(v.text)
    }
    for (const fn of allNamed(g, ["function", "bind"])) {
      const first = fn.namedChildCount > 0 ? fn.namedChild(0) : null
      if (first?.type === "variable" && first.text) methods.add(first.text)
    }
  }
  return { name, methods }
}

/**
 * The class name and the target type of an `instance` declaration. Mirrors the
 * analyzer's `processInstance` NAME RULES because those rules are the language's
 * (an instance is named after the type it instantiates) rather than a choice this
 * module is free to make differently.
 */
function instanceOf(node: Node): { cls: string; target: string } | null {
  const cls = named(node, ["name"])?.text
  const tp = named(node, ["type_patterns"])
  let target: string | undefined
  if (tp) {
    const direct = named(tp, ["name", "constructor"])
    if (direct) target = direct.text
    else if (named(tp, ["list"])) target = "[]"
    else {
      const parens = named(tp, ["parens"])
      const ap = parens ? named(parens, ["apply"]) : null
      const first = ap && ap.namedChildCount ? ap.namedChild(0) : null
      if (first) target = appliedHead(first) ?? first.text
    }
  }
  if (!cls || !target) return null
  return { cls, target }
}

/**
 * Derive the six classes. `symbols` are the ANALYZER's published symbols for the
 * same file and are used ONLY for `contains` (see the header): every other class
 * is read from the tree alone.
 */
export function deriveHaskellSurfaceEdges(root: Node, symbols: Array<{ name?: string; ownerName?: string; scope?: string; range?: { startLine?: number } }> = []): HaskellTruthEdge[] {
  const edges: HaskellTruthEdge[] = []
  const seen = new Set<string>()
  const push = (label: HaskellTruthLabel, from: string, target: string) => {
    if (!from || !target) return
    if (label !== "calls" && from === target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  // ── the module name, from the header ──────────────────────────────────────
  let moduleName = "Main"
  const header = named(root, ["header"])
  if (header) {
    const mod = named(header, ["module"])
    const m = mod ? moduleNameOf(mod) : ""
    if (m) moduleName = m
  }

  // ── imports: every `import` node's module ─────────────────────────────────
  // Haskell's import declaration names exactly one module (with an optional
  // `qualified`/`hiding`/`as`), so the module node is the whole truth here.
  walk(root, (n) => {
    if (n.type === "import") {
      for (const c of allNamed(n, ["module", "module_id"])) {
        // An `as` alias means the module node also spells the ALIAS; the module
        // being imported is the node BEFORE it. The corpus draws both spellings,
        // and publishing the alias as a second import would double-count.
        const prev = c.previousSibling
        if (prev?.type === "as") continue
        push("imports", moduleName, moduleNameOf(c))
      }
    }
  })

  // ── exports: the header list, entry by entry ─────────────────────────────
  if (header) {
    const list = named(header, ["exports"])
    if (list) {
      for (let i = 0; i < list.namedChildCount; i++) {
        const e = list.namedChild(i)
        if (!e) continue
        if (e.type === "export") {
          const nm = exportEntryName(e, list, i)
          if (nm) push("exports", moduleName, nm)
        } else if (e.type === "module_export") {
          const mod = named(e, ["module", "module_id"])
          if (mod) push("exports", moduleName, moduleNameOf(mod))
        }
      }
    }
  }

  // ── references: FFI entities ─────────────────────────────────────────────
  walk(root, (n) => {
    if (n.type !== "foreign_import") return
    const sig = named(n, ["signature"])
    const hs = sig ? named(sig, ["variable"])?.text : undefined
    const ent = foreignEntity(n)
    if (hs && ent) push("references", hs, ent)
  })

  // ── uses: a type synonym's right-hand side ───────────────────────────────
  // The grammar's node is spelled `type_synomym` (the upstream typo is in the
  // NODE NAME). Its shape is `name` + RHS, so the name is the first `name` child
  // and everything else is the synonym's definition in terms of other types.
  walk(root, (n) => {
    if (n.type !== "type_synomym") return
    const nameNode = named(n, ["name"])
    const nm = nameNode?.text
    if (!nm) return
    for (const leaf of typeNameLeaves(n, nameNode)) {
      const t = leaf.text.trim()
      if (t && t !== nm) push("uses", nm, t)
    }
  })

  // ── overrides: an instance method against the class's declaration ─────────
  // Two independent halves, and the ORDER does not matter: the class pre-pass runs
  // over the whole file first, because Haskell permits an `instance` before its
  // `class` and a single walk would then match nothing.
  const classMethods = new Map<string, Set<string>>()
  walk(root, (n) => {
    if (n.type !== "class") return
    const cm = classMethodsOf(n)
    if (cm) classMethods.set(cm.name, cm.methods)
  })
  walk(root, (n) => {
    if (n.type !== "instance") return
    const inst = instanceOf(n)
    if (!inst) return
    const methods = classMethods.get(inst.cls)
    if (!methods || methods.size === 0) return
    const decls = named(n, ["instance_declarations"])
    const bodies = decls ? allNamed(decls, ["function", "bind"]) : []
    for (const b of [...bodies, ...allNamed(n, ["function", "bind"])]) {
      const head = b.namedChildCount > 0 ? b.namedChild(0) : null
      const mName = head?.text
      // A method the class does NOT declare is not an override. Neither is a
      // constructor-pattern or tuple head, which are patterns.
      if (!mName || !methods.has(mName)) continue
      if (head && head.type !== "variable") continue
      push("overrides", `${inst.target}.${mName}`, `${inst.cls}.${mName}`)
    }
  })

  // ── contains: the containment ARITHMETIC over the analyzer's OWNERSHIP ────
  // See the header: this half is not independent, and says so. It takes each
  // published symbol's owner as given and checks the edge that follows from it,
  // so a dropped, duplicated or self-named edge fails and an ownership bug cannot.
  for (const s of symbols) {
    const owner = s.ownerName || (s.scope && s.scope !== moduleName ? s.scope : undefined)
    if (!owner || !s.name) continue
    if (owner === moduleName && s.ownerName === moduleName) {
      // module -> member, still asserted only when the member is not an Instance:
      // an instance is named after the type it instantiates, so containing it
      // would claim the module DECLARES that type.
      if ((s as any).kind === "instance") continue
    }
    if (owner !== s.name) push("contains", owner, s.name)
  }

  return edges
}