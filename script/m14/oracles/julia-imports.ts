/**
 * The Julia `imports` oracle — LANE-OWNED.
 *
 * Beside the other julia oracles rather than in `differential.ts`, for the reason that shared file's
 * own header records: it is edited by several lanes at once, and every line a lane keeps out of a
 * shared file is a line that cannot conflict.
 *
 * ## Why this oracle exists
 *
 * `imports` was one of this lane's two DERIVATION findings. The lane RULED the type non-applicable
 * on 2026-10-03, overturned that ruling two commits later on a corpus measurement, and has emitted
 * 2,804 edges since — with **no independent derivation behind any of them**. That is the state the
 * honesty contract's L0 exists for: stored, and audited against nothing.
 *
 * ## The rule, from JULIA and not from the analyzer
 *
 * `import` and `using` differ in what they bring into the current namespace — `import A: f` brings
 * the NAME `f`, `using A: f` also brings `A`'s exported names — and the two are not interchangeable
 * for the graph's purposes, which is why the analyzer records `importForm` on every edge. What both
 * forms agree on is the thing an `imports` edge asserts: **one module path enters the current
 * namespace.** So the rule is:
 *
 *   Every MODULE PATH named by an `import_statement` or `using_statement` is one edge, sourced at the
 *   scope the statement appears in.
 *
 * A statement's module paths are its comma-separated entries, and julia's grammar gives each entry a
 * shape:
 *
 *   `using A` / `import A.B.C`     bare path           → `identifier` | `scoped_identifier` | `import_path`
 *   `using A, B`                   two bare paths      → two of the above as SIBLINGS
 *   `using A: x, y`                 path + name list    → `selected_import`, module is its child 0
 *   `using ..A: >, getindex`        relative path       → `selected_import` whose child 0 is an `import_path`
 *   `import A as B`                 renamed import      → `import_alias`, module is its child 0
 *
 * Every one of those five shapes is measured over the corpus, with counts, by
 * `validation/m14/fixtures/julia/import-export-shapes.ts`. The oracle does not assume them; it
 * classifies each child independently and the header records which shapes the corpus exercises.
 *
 * ## HOW THIS DIFFERS FROM THE FUNCTION UNDER TEST, in the specific way that matters
 *
 * `RealJuliaAnalyzer.importTargets()` walks the statement's named children IN ORDER carrying a
 * `pending` variable, and one of its branches is: *"a bare identifier when something is already
 * pending, with no items yet, and a different name — that is an ITEM of the pending target."*
 *
 * That branch cannot tell a second module from an item of the first. `using Test, DataFrames` names
 * TWO modules and the shape census counts 32 two-path statements in a 400-file draw alone, so this is
 * not a corner: it is the second most common multi-path import in julia.
 *
 * This oracle has NO state. Every named child of the statement is classified on its own, and the
 * question asked of each is "is this child a module path or is it a name inside a path's list?" —
 * answerable from the child's own position in ITS parent, with no knowledge of siblings. Two siblings
 * of the same type therefore cannot be confused for one another, which is the entire defect class.
 *
 * The independence is structural rather than cosmetic: no shared key set, no shared guard list, no
 * shared resolver, and no call into `importTargets()` or any helper of it. The one thing both sides
 * share is JULIA's own rule that `import A as B` imports `A`, because that is the language and not
 * this codebase.
 *
 * ## What this oracle deliberately does NOT claim
 *
 * **It does not check `ImportInfo[]`, and it does not check the `references` row** carrying
 * `isImport: true` that the analyzer writes from the same walk. It derives the module SET per file
 * and compares it against the `imports` EDGES. The payload channel has its own instrument — the
 * construct-versus-edge reconciliation in `validation/m14/fixtures/julia/census.ts` — and a claim that
 * one instrument covered both would be a claim about a measurement nobody made.
 *
 * ## The limitation this oracle cannot cover, declared rather than implied
 *
 * It is a SECOND WALKER OVER THE SAME GRAMMAR. It can disagree with the analyzer when either is wrong;
 * it is BLIND when a construct is absent from both, which is precisely how a wrong verdict survives a
 * differential that agreed throughout. Only measuring the language finds those, and that is
 * `validation/m14/fixtures/julia/census.ts`'s instrument B.
 */

export type JuliaImportsEdge = { label: "imports"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** The node kinds julia's grammar uses for a bare module path. Measured; see the shape census. */
const PATH_NODES = new Set(["identifier", "scoped_identifier", "import_path"])

/**
 * The module a path-shaped node names, as the string the graph resolves against.
 *
 * `import_path` covers the RELATIVE forms (`..A`, `.A`) and is taken whole — the leading dots are
 * part of the path and a consumer distinguishing `using .Foo` from `using ..Foo` needs them.
 * `scoped_identifier` is taken whole too: `using Base.GMP.MPZ` names the module `Base.GMP.MPZ`, and
 * the LAST segment alone would be `MPZ`, which is not a module this statement imports.
 */
function pathText(n: any): string {
  return String(n.text ?? "").trim()
}

/**
 * The enclosing scope, for the edge SOURCE.
 *
 * Julia evaluates `using`/`import` at module top level or file top level, never inside a function
 * body, so the only scope that can enclose one is a module — and the file's own top level, which the
 * graph addresses as `root`. Both sides use that convention and it is a graph convention rather than a
 * derivation: it is restated here so the oracle can name a source, not so the two can agree on one.
 */
function enclosingModuleName(n: any): string {
  let cur = n.parent ?? null
  for (let i = 0; i < 24 && cur; i++) {
    if (cur.type === "module_definition" || cur.type === "module" || cur.type === "baremodule") {
      const first = kids(cur)[0]
      const name = first ? String(first.text ?? "").trim() : ""
      if (name) return name
    }
    cur = cur.parent ?? null
  }
  return "root"
}

/**
 * The module named by ONE entry of an import statement, or null if the entry names no module.
 *
 * Stateless by construction: everything it needs is in `child` and `child`'s own children.
 */
function moduleOfEntry(child: any): string | null {
  if (child.type === "selected_import") {
    // `using A: x, y` — the module is the FIRST child whatever its own type, because everything
    // after it is the name list. `using ..A: >, getindex` puts an `import_path` there, so the
    // child's type is not a discriminator and its POSITION is.
    const inner = kids(child)
    if (!inner.length) return null
    const t = pathText(inner[0])
    return t.length ? t : null
  }
  if (child.type === "import_alias") {
    // `import A as B` — child 0 is the module being imported, child 1 the local name it is bound to.
    // The edge asserts the MODULE, because `as` renames the binding and does not change what is
    // being depended on.
    const inner = kids(child)
    if (!inner.length) return null
    const t = pathText(inner[0])
    return t.length ? t : null
  }
  if (PATH_NODES.has(child.type)) {
    const t = pathText(child)
    return t.length ? t : null
  }
  // A `line_comment` is a NAMED child of these statements — 66 of them in a 400-file draw — and a
  // comment is not a module. Nothing in this function has to know that, because a type that is not
  // a path falls through to null; it is recorded because it is the shape a text-level reading of
  // `using A # note` gets wrong.
  return null
}

/**
 * `imports` truth for one tree.
 *
 * Returns one edge per (scope, module) pair, deduped: `using A, A` names one module twice and a
 * graph edge set cannot hold the same edge twice, so a duplicate is not a second dependency. The
 * dedup key is scope-and-module rather than per-statement, so the same module imported by two
 * statements in one scope is one edge — which is what the analyzer's relationship layer also does,
 * by a mechanism that is not shared here.
 */
export function deriveJuliaImportsTruth(root: any): JuliaImportsEdge[] {
  const edges: JuliaImportsEdge[] = []
  const seen = new Set<string>()
  const scopeCache = new Map<number, string>()

  const scopeOf = (n: any): string => {
    const cached = scopeCache.get(n.id)
    if (cached !== undefined) return cached
    const s = enclosingModuleName(n)
    scopeCache.set(n.id, s)
    return s
  }

  const visit = (n: any): void => {
    if (n.type === "import_statement" || n.type === "using_statement") {
      const from = scopeOf(n)
      for (const child of kids(n)) {
        const mod = moduleOfEntry(child)
        if (!mod) continue
        const key = `${from}|${mod}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ label: "imports", from, target: mod })
      }
    }
    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return edges
}