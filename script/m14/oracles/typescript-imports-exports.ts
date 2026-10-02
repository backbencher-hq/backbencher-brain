/**
 * The `imports` / `exports` oracle — an independent derivation of what a
 * TypeScript/JavaScript module declares about its dependencies and its public
 * surface.
 *
 * ## Why this file exists
 *
 * `deriveTypeScriptEdges` derives `calls`, `uses`, `references` and `contains`.
 * It derives NO `imports` and NO `exports`, so those two labels had truth
 * nowhere: vue alone emits 2,789 `imports` rows and 2 `exports` rows that were
 * stored and compared against nothing. Every one of them could be wrong — an
 * invented module, a dropped dependency, a wrong local name — and the gate
 * would have read green, because MISSING=0/unexplained=0 asks whether every
 * emitted edge is EXPLAINABLE, not whether it is TRUE.
 *
 * ## The rule, stated once
 *
 * A module's DEPENDENCY is the module specifier a binding came from. The target
 * is `<specifier>:<name>`, and the name is what an INJECTOR asks the module for:
 *
 *   import def, { a, b as c } from "m"   ->  m:def, m:a, m:b
 *   import * as ns from "m"              ->  m:*
 *   import "m"                          ->  m:*        (no name was asked for)
 *   const x = require("m")              ->  m:*
 *   const { a } = await import("m")      ->  m:*
 *
 * An ALIAS is not part of the name, because the alias is what THIS file calls
 * it and the name is what the exporting module calls it. `import { b as c } from
 * "m"` asks `m` for `b`, so the row is `m:b`; dropping the alias is what lets the
 * two files join.
 *
 * A whole-module dependency — a namespace import, a side-effect-only import, a
 * `require`, a dynamic `import()` — has no single name, and `*` is the shape the
 * analyzers already publish for one. The wildcard is the one target that names
 * no symbol in the exporting file, and that is honest: nothing was asked for by
 * name.
 *
 * ## Independence
 *
 * Written from the tree, sharing no helper, name table or classification set
 * with `real-typescript-analyzer.ts`. It does NOT import the analyzer's
 * `extractImportItemsWithNodes` or `stringContent`: an oracle that calls the
 * thing it audits cannot disagree with it, and a green gate that is a tautology
 * is worse than no gate. Agreement is the evidence; disagreement is the finding.
 */

export interface ImportsExportsRow {
  label: "imports" | "exports"
  from: string
  target: string
}

/** String content of a `string` / `template_string` node, unescaped. */
function stringContent(node: any): string | undefined {
  if (!node) return undefined
  const text = String(node.text ?? "")
  if (text.length < 2) return undefined
  const quote = text[0]
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined
  const inner = text.slice(1, -1)
  // Only the escapes that change WHICH module or name is named. `\n` in a path is
  // not a thing, and decoding it would invent a module that no specifier names.
  return inner.replace(/\\(.)/g, (_m, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c))
}

/** The first `string` child of a node, which is where a specifier lives. */
function specifierOf(node: any): any {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const n = stack.pop()!
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (!c) continue
      if (c.type === "string") return c
      if (c.type === "template_string") {
        // A template specifier with no substitution IS a literal path; one with a
        // substitution is computed, and `m:${x}` names nothing anybody can join.
        const hasSub = c.namedChildren?.some((x: any) => x && x.type !== "string")
        if (!hasSub) return c
        return null
      }
      stack.push(c)
    }
  }
  return null
}

/** The named bindings an `import` clause asks the module for. */
function importItems(importNode: any): string[] {
  const out: string[] = []
  const visitClause = (clause: any): void => {
    for (let i = 0; i < clause.namedChildCount; i++) {
      const c = clause.namedChild(i)
      if (!c) continue
      if (c.type === "identifier") {
        out.push(c.text)
      } else if (c.type === "namespace_import") {
        // A namespace import asks for the module itself, not a member.
        out.push("*")
      } else if (c.type === "named_imports") {
        for (let k = 0; k < c.namedChildCount; k++) {
          const spec = c.namedChild(k)
          if (!spec || spec.type !== "import_specifier") continue
          const name = spec.childForFieldName("name")
          if (name) out.push(name.text)
        }
      }
    }
  }
  for (let i = 0; i < importNode.namedChildCount; i++) {
    const child = importNode.namedChild(i)
    if (!child) continue
    if (child.type === "import_clause") visitClause(child)
    else if (child.type === "identifier") out.push(child.text)
    else if (child.type === "namespace_import") out.push("*")
    else if (child.type === "named_imports") visitClause(importNode)
  }
  return out
}

/**
 * What one module imports, from the tree.
 *
 * `moduleLeaf` is this file's own name — the basename without its extension —
 * because that is what an `imports` row is SOURCED at: the dependency belongs to
 * the file that writes it, and two files with the same leaf in different
 * directories are already indistinguishable in this graph.
 */
export function deriveImportsTruth(root: any, moduleLeaf: string): ImportsExportsRow[] {
  const out: ImportsExportsRow[] = []
  const seen = new Set<string>()
  const add = (target: string): void => {
    const key = `${moduleLeaf}->${target}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: "imports", from: moduleLeaf, target })
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!

    if (n.type === "import_statement") {
      const spec = specifierOf(n)
      const modulePath = stringContent(spec)
      if (modulePath) {
        // `import x = require("m")` binds through a clause the analyzer treats as a
        // whole-module dependency, and so does a namespace import.
        const requireClause = n.namedChildren?.find((c: any) => c && c.type === "import_require_clause")
        const items = requireClause ? [] : importItems(n)
        if (items.length === 0) add(`${modulePath}:*`)
        else for (const item of items) add(`${modulePath}:${item === "*" ? "*" : item}`)
      }
    }

    if (n.type === "call_expression") {
      const callee = n.childForFieldName("function") ?? n.childForFieldName("callee")
      const isDynamic = !!callee && (callee.text === "import" || callee.type === "import")
      const isRequire = !!callee && callee.type === "identifier" && callee.text === "require"
      if (isDynamic || isRequire) {
        const args = n.childForFieldName("arguments")
        const first = args && args.namedChildCount > 0 ? args.namedChild(0) : null
        const modulePath = first && (first.type === "string" || first.type === "template_string")
          ? stringContent(first)
          : undefined
        if (modulePath) add(`${modulePath}:*`)
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * What one module EXPORTS, from the tree.
 *
 * An `exports` row names what an importer may ask this module for, so the target
 * is the name as the EXPORTING file spells it. An alias is included here, the
 * opposite of the import rule and for the opposite reason: `export { a as b }`
 * publishes `b`, because `b` is the name a consumer writes. Stripping it would
 * make the row name something no consumer can ask for.
 *
 * An ANONYMOUS default (`export default 42`, `export default function () {}`)
 * has no binding name, so `default` names no symbol in this or any other file and
 * the graph edge is skipped — the module's having a default is a fact, and it is
 * stored as such, but `module -> default` is an edge nothing can join. A NAMED
 * default (`export default foo`) is not skipped: `foo` is a real binding.
 */
export function deriveExportsTruth(root: any, moduleLeaf: string): ImportsExportsRow[] {
  const out: ImportsExportsRow[] = []
  const seen = new Set<string>()
  const add = (target: string): void => {
    if (!target) return
    const key = `${moduleLeaf}->${target}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: "exports", from: moduleLeaf, target })
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "export_statement") {
      const isDefault = !!n.childForFieldName?.("default") || String(n.text ?? "").startsWith("export default")
      let foundNamed = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        if (child.type === "export_clause") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const spec = child.namedChild(j)
            if (!spec || spec.type !== "export_specifier") continue
            const name = spec.childForFieldName("name")
            const alias = spec.childForFieldName("alias")
            if (name) { foundNamed = true; add(alias ? alias.text : name.text) }
          }
        } else if (child.type === "namespace_export") {
          const nameNode = child.namedChild(child.namedChildCount - 1)
          if (nameNode) { foundNamed = true; add(nameNode.text) }
        } else if (
          child.type === "function_declaration" || child.type === "class_declaration" ||
          child.type === "interface_declaration" || child.type === "type_alias_declaration" ||
          child.type === "enum_declaration"
        ) {
          const nameNode = child.childForFieldName("name")
          if (nameNode) { foundNamed = true; add(nameNode.text) }
        } else if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const d = child.namedChild(j)
            if (d && d.type === "variable_declarator") {
              const nameNode = d.childForFieldName("name")
              if (nameNode && nameNode.type === "identifier") { foundNamed = true; add(nameNode.text) }
            }
          }
        } else if (child.type === "identifier" && isDefault) {
          foundNamed = true
          add(child.text)
        }
      }
      // `export default <expression>` names no binding, so there is NOTHING to add
      // — and that is the whole point of tracking `foundNamed`. Emitting `default`
      // here would be an edge whose target no symbol in any file carries, which is
      // the failure the graph cannot represent, not a fact it cannot show.
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** Both labels for one module, in the order a caller will compare them. */
export function deriveImportsExportsTruth(root: any, moduleLeaf: string): ImportsExportsRow[] {
  return [...deriveImportsTruth(root, moduleLeaf), ...deriveExportsTruth(root, moduleLeaf)]
}
