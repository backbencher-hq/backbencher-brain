/**
 * The Clean `imports` oracle — LANE-OWNED.
 *
 * ## Why this file exists at all
 *
 * `imports` is one of four Clean labels the DERIVATION check reads as un-audited: the lane
 * emits 1,891 edges through production `parseFile` and **no independent derivation behind any of
 * them**. Stored, and compared against nothing. That is the same finding julia carried until its
 * own oracles existed, and the honest cost of it is stated in the lane doc rather than hidden.
 *
 * ## The rule, from CLEAN and not from the analyzer
 *
 * An `import` statement binds NAMES from MODULES:
 *
 *   import StdEnv                              one module, no names  → the whole module
 *   import StdArray, StdBool, StdInt           three modules, no names
 *   import StdFunc, id, o                      one module + names
 *   from Text import class Text(concat,join), instance Text String, <+
 *                                              one module + names, `from` spelling
 *
 * And one edge per BOUND NAME, because that is the only thing that can be joined to a symbol in
 * another file: `<module>:<name>`. A module imported without a name list binds no single symbol,
 * so the lane writes the `<module>:*` wildcard that the TypeScript lane uses for a namespace
 * import and that the resolver documents as legitimately unresolved. That target ENCODING is a
 * graph convention, not a Clean fact, and it is restated here — the same way julia's import
 * oracle restates `root` as the file-top-level scope — so that the two sides can be compared at
 * all. The DERIVATION is the module/name decomposition below.
 *
 * ## HOW THIS DIFFERS FROM THE FUNCTION UNDER TEST
 *
 * `RealCleanAnalyzer.collectImport` walks the statement's children IN ORDER carrying a
 * `currentModule` and a `keyword` variable, and classifies each named child with a type switch
 * (`describeImportItem`). Two consequences of that shape are what this oracle is built to avoid:
 *
 *  1. A `currentModule` carried across children can only be right if no statement names two
 *     modules AND names items. Measured on the whole population: **1,328 import statements, 0 of
 *     them multi-module-with-items**, so the state machine is not currently wrong — it is
 *     UNFALSIFIED, which is a different thing. This oracle has no `currentModule` state: every
 *     item is joined to the module whose `module_name` starts textually before it, a purely
 *     POSITIONAL rule that cannot be confused by a second module.
 *  2. The type switch decides what is a name. This oracle decides what is NOT a name — a marker
 *     (`(..)`, `{field,…}`), a comment, or a module — and treats every other named child as a
 *     name, which is the language's rule (an import list is a list of names, not a list of the
 *     node types this grammar happens to use). A shape the grammar grows later is then a name by
 *     default rather than silently dropped, which is the failure mode a whitelist has.
 *
 * **A NAME LIST IS A LIST.** `class Text(concat,join,toLowerCase)` is a `class_method_name`
 * holding three identifiers and `:: Type (Var, Func, Type, Uniq, Strict)` is a
 * `constructor_subset` holding five constructors. Reading one name out of either drops the rest
 * silently; this oracle enumerates EVERY name child of both shapes, and the whole-population arm
 * is what prices that (see `docs/analyzers/clean.md`).
 *
 * ## What this oracle deliberately does NOT claim
 *
 * It does not check `ImportInfo[]` (the payload channel), the `references` row carrying
 * `isImportDependency`, or the operator-import accounting. It derives the module/name SET per
 * file and compares it against the `imports` edges.
 *
 * ## The limitation it cannot cover, declared
 *
 * It is a SECOND WALKER over the same grammar. It disagrees when either side is wrong and is
 * BLIND when a construct is absent from both — which is why the lane also carries a
 * parse-tree POSITION census for the constructs it rules out.
 */

export type CleanImportsEdge = { label: "imports"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** `Data.Error` from `module_name(module_identifier Data, module_identifier Error)`. */
export function moduleNameOf(node: any): string {
  if (!node) return ""
  let out = ""
  for (const c of kids(node)) {
    const leaf = c.type === "module_name" ? moduleNameOf(c) : String(c.text ?? "")
    if (!leaf) continue
    if (out) out += "."
    out += leaf
  }
  return out || String(node.text ?? "")
}

/**
 * Is this child a MARKER — punctuation that qualifies the name before it rather than naming
 * anything?
 *
 * Three spellings exist in the population and all three are decided from the TEXT, not from a
 * node-type list, because the grammar types the same `(..)` three different ways depending on
 * where it sits: `parenthesized_operator` after a class, empty `constructor_subset` after a
 * constructor, and `record_subset` (`{pi_fileInfo}`, `{class_ident,class_pos}`).
 */
function isMarkerText(text: string): boolean {
  const t = text.trim()
  if (t.startsWith("{")) return true
  // `{..}` does NOT stay braced in this grammar: it flattens to a bare `range_operator` whose
  // text is `..` (measured: 59 sites, and every one is a record-subset marker — Clean writes `..`
  // in an import list only to open a subset). A run of dots is therefore a marker, not a name.
  if (t.length > 0) {
    let allDots = true
    for (const ch of t) if (ch !== ".") { allDots = false; break }
    if (allDots) return true
  }
  if (t.startsWith("(") && t.endsWith(")")) {
    const inner = t.slice(1, -1).trim()
    // `(..)` — the open subset. A run of dots and nothing else.
    if (inner.length > 0) {
      let allDots = true
      for (const ch of inner) if (ch !== ".") { allDots = false; break }
      if (allDots) return true
    }
  }
  return false
}

/**
 * The names ONE import item contributes, in source order.
 *
 * A name list (`(concat,join,toLowerCase)`, `(Var, Func, Type)`) contributes ALL of its names: the
 * parenthesised form is a list, and the list is what the statement binds. A single name —
 * `identifier`, `constructor`, an operator, `(Ok)` — contributes itself with the parentheses of an
 * operator spelling removed, because `import StdOverloaded, (==)` binds `==` and not `(==)` … and
 * yet Clean's class declaration spells an operator class parenthesised, so the BARE spelling is
 * the one that matches an exported name. Both spellings are recorded by the lane as `className`
 * metadata; the edge target is the bare name.
 */
function namesOfItem(child: any): string[] {
  const text = String(child.text ?? "").trim()
  if (!text) return []
  if (isMarkerText(text)) return []
  // A comment can be a named child of a statement. It is never a name; no type list is consulted,
  // because the check is "does this text look like a name at all".
  if (child.type === "line_comment" || child.type === "block_comment") return []
  const out: string[] = []
  const collect = (n: any): void => {
    // Leaves only: a container's own text is the list, and the LIST is not a name.
    if ((n.namedChildCount ?? 0) === 0) {
      const t = String(n.text ?? "").trim()
      if (t && !isMarkerText(t)) out.push(unparen(t))
      return
    }
    for (const c of kids(n)) collect(c)
  }
  if (child.type === "parenthesized_operator") {
    // `(==)` / `(:!)` — ONE operator, parenthesised for fixity, not a list. The marker form
    // `(..)` was already refused above, so anything left here is a NAME.
    const inner = text.replace(/^\(/, "").replace(/\)$/, "").trim()
    if (inner) return [inner]
  }
  if (child.type === "backtick_operator") {
    // `` `on` `` is Clean's INFIX spelling of the operator `on`: the binding the statement makes
    // is `on`, and the backticks are how the source writes it in a list. Publishing the backticks
    // would name a symbol no module exports.
    const inner = text.replace(/^`/, "").replace(/`$/, "").trim()
    if (inner) return [inner]
  }
  // An instance import (`instance Functor ((->) r)`) binds the CLASS, and everything after it is
  // the instance's TARGET TYPE — a type expression, whose inner names are not bound by this
  // statement at all. Measured shape: an `instance` keyword (anonymous), a `constructor` for the
  // class, then the target. The class comes through as an ordinary name above; the target is
  // skipped here.
  if (child.type === "type_paren" || child.type === "type_application" || child.type === "type_variable") return []
  collect(child)
  return out
}

function unparen(t: string): string {
  const s = t.trim()
  if (s.startsWith("(") && s.endsWith(")") && s.length > 2 && !s.slice(1, -1).includes(",")) {
    return s.slice(1, -1).trim()
  }
  return s
}

/**
 * `imports` truth for one tree.
 *
 * Returns one edge per (scope, `<module>:<name>`) pair, deduped. Deduping is not decoration: a
 * graph edge set cannot hold the same edge twice, and Clean's own corpus writes `import StdClass,
 * StdClass` (a re-import of the same module in one statement) and repeats a class with its method
 * list. One bound name is one dependency.
 */
export function deriveCleanImportsTruth(root: any): CleanImportsEdge[] {
  const edges: CleanImportsEdge[] = []
  const seen = new Set<string>()
  let scope = "root"

  const visit = (n: any): void => {
    if (n.type === "module_declaration") {
      const named = n.childForFieldName?.("name")
      const name = named ? moduleNameOf(named) : ""
      if (name) scope = name
      // A module header opens a scope for the rest of the walk. Its own children carry no imports.
      for (const c of kids(n)) if (c.type !== "module_name") visit(c)
      return
    }
    if (n.type === "import_declaration") {
      // Modules in source order, with their start offsets, so an item can be joined to the module
      // written before it by POSITION rather than by a carried variable.
      const modules: { name: string; start: number }[] = []
      const aliasStarts = new Set<number>()
      for (let i = 0; i < n.childCount; i++) {
        if (n.fieldNameForChild(i) !== "alias") continue
        const a = n.child(i)
        if (a) aliasStarts.add(a.startIndex)
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c || !c.isNamed) continue
        if (c.type !== "module_name") continue
        // An ALIAS names a local binding, not a module: `import qualified Data.Foldable as
        // Foldable` imports ONE module under a shorter name. Counting the alias as a module
        // invents an edge to a module the statement never names — measured, this oracle did
        // exactly that (CloogleServer.icl) until the alias field was excluded, and the analyzer
        // was right.
        if (aliasStarts.has(c.startIndex)) continue
        const name = moduleNameOf(c)
        if (name) modules.push({ name, start: c.startIndex })
      }
      const items: { names: string[]; start: number }[] = []
      for (const c of kids(n)) {
        if (c.type === "module_name") continue
        const names = namesOfItem(c)
        if (names.length) items.push({ names, start: c.startIndex })
      }
      const moduleBefore = (start: number): string => {
        let best = modules.length ? modules[0].name : ""
        for (const m of modules) if (m.start <= start) best = m.name
        return best
      }
      const bound = new Set<string>()
      for (const item of items) {
        const mod = moduleBefore(item.start)
        if (!mod) continue
        for (const name of item.names) {
          const key = `${scope}|${mod}:${name}`
          if (seen.has(key)) continue
          seen.add(key)
          bound.add(mod)
          edges.push({ label: "imports", from: scope, target: `${mod}:${name}` })
        }
      }
      // A module imported WITHOUT a name list binds no single symbol: the whole module enters the
      // namespace, and the lane records that as the `<module>:*` wildcard.
      for (const m of modules) {
        if (bound.has(m.name)) continue
        const key = `${scope}|${m.name}:*`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ label: "imports", from: scope, target: `${m.name}:*` })
      }
      return
    }
    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return edges
}
