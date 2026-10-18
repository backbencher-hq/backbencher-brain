/**
 * TYPESCRIPT `imports` / `exports` TRUTH — the lane's independent derivation, in the analyzer's
 * PUBLISHED target spelling, for the differential's compared set.
 *
 * ## Why this module exists
 *
 * The fleet differential audits a label only when the lane's truth derivation exists AND the label
 * is admitted to the compared set. TypeScript's `imports` and `exports` had no truth derivation in
 * the differential's own oracle convention (`derive<Lang><Label>Truth`), so both labels were stored
 * and compared against nothing — the DERIVATION debt the ontology gate charges. This module is the
 * missing half; the Lead wires it into `differential.ts` and admits the labels.
 *
 * ## Independence
 *
 * Written from the TREE with its own walks and its own string helper. It imports nothing from
 * `real-typescript-analyzer.ts` — an oracle that calls the thing it audits cannot disagree with it,
 * and a green gate that is a tautology is worse than no gate. It does not import the older
 * `typescript-imports-exports.ts` either, for the same reason; that file's contract predates the
 * binding spelling and the re-export emission, and it is reconciled separately.
 *
 * ## The published spelling, stated as the contract this derives
 *
 * `from` is the module LEAF of the file: `path.basename(filePath)` minus the last extension, and a
 * `.d.ts`/`.d.mts`/`.d.cts` declaration file's leaf loses the `.d` too (`env.d.ts` declares module
 * `env`) — the analyzer's `moduleLeafName()` rule, restated here as the language's own convention.
 *
 * `imports`:
 *   import def, { a, b as c } from "m"   ->  m:def, m:a, m:b          (the name ASKED FOR; an alias is local)
 *   import { a } from "./m"              ->  a                        (relative specifier: BARE item — the resolver joins it)
 *   import * as ns from "m"              ->  <leaf>\0m:*              (whole-module BINDING spelling + localBinding)
 *   import "m"                           ->  <leaf>\0m:*              (side-effect-only: nothing asked by name)
 *   import m = require("m")              ->  <leaf>\0m:*              (require clause)
 *   import("./m") / require("./m")       ->  <leaf>\0m:*              (dynamic/CommonJS dependency)
 *   export { a } from "./m"              ->  a                        (re-export IS a module dependency; name asked for)
 *   export { b as x } from "m"           ->  m:b                      (the asked-for name, never the local alias)
 *   export * from "./m"                  ->  <leaf>\0m:*              (whole module)
 *   export * as ns from "./m"            ->  <leaf>\0m:*              (whole module under a local alias)
 *   export {} from "./m"                 ->  NOTHING                  (an empty clause asserts nothing)
 *
 * `exports`:
 *   export function f(){} / class / interface / type / enum / const x   ->  f / C / I / T / E / x
 *   export { a, b as c }                ->  a, c                      (the PUBLISHED name: the alias when there is one)
 *   export { a } from "./m"             ->  a                         (the published name)
 *   export * as ns from "./m"           ->  ns
 *   export default function named(){}   ->  named                     (a NAMED default export)
 *   export default identifier           ->  identifier
 *   export default expression           ->  NOTHING                   (`default` names no symbol anywhere)
 *   export * from "./m"                 ->  NOTHING                   (`*` names no symbol — the X8/R7 class)
 */
import * as path from "node:path"

export interface TypescriptTruthRow {
  label: "imports" | "exports"
  from: string
  target: string
}

/** The module leaf of a file: basename minus extension, and a declaration file's stem loses `.d`. */
export function typescriptModuleLeaf(filePath: string): string {
  const base = path.basename(String(filePath ?? ""))
  const dot = base.lastIndexOf(".")
  let leaf = dot > 0 ? base.slice(0, dot) : base
  if (leaf.length > 2 && leaf.endsWith(".d")) leaf = leaf.slice(0, leaf.length - 2)
  return leaf
}

/** String content of a `string` node, without importing the analyzer's helper. Unambiguous
 *  specifiers are the only thing this needs: a template with a substitution names no module. */
function stringLiteral(node: any): string | undefined {
  if (!node) return undefined
  const type = String(node.type ?? "")
  if (type !== "string") return undefined
  const text = String(node.text ?? "")
  if (text.length < 2) return undefined
  const quote = text[0]
  if (quote !== '"' && quote !== "'") return undefined
  return text.slice(1, -1)
}

/** A template string with NO substitution is a literal path; with one it names no module. */
function literalModulePath(node: any): string | undefined {
  if (!node) return undefined
  if (node.type === "string") return stringLiteral(node)
  if (node.type === "template_string") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "template_substitution") return undefined
    }
    const text = String(node.text ?? "")
    return text.length >= 2 ? text.slice(1, -1) : undefined
  }
  return undefined
}

const isRelativeOrAbsolute = (specifier: string): boolean => specifier.startsWith(".") || specifier.startsWith("/")

/** The BINDING SEPARATOR the family publishes (U+0000). Spelled here rather than imported: the
 *  oracle states the spelling itself, and the contract check below proves the two agree. */
const BINDING_SEP = "\u0000"

function wholeModuleBinding(leaf: string, modulePath: string): string {
  return `${leaf}${BINDING_SEP}${modulePath}:*`
}

/** The name an import/export specifier ASKS FOR: the written name, never the local alias. */
function askedForName(spec: any): string | undefined {
  const name = spec.childForFieldName("name") ?? spec.namedChild(0)
  if (!name) return undefined
  const alias = spec.childForFieldName("alias")
  return String(alias ? name.text : name.text)
}

function firstNamedOfType(node: any, wanted: string): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === wanted) return c
  }
  return null
}

export function deriveTypeScriptImportTruth(root: any, filePath: string): TypescriptTruthRow[] {
  const leaf = typescriptModuleLeaf(filePath)
  const rows: TypescriptTruthRow[] = []
  const seen = new Set<string>()
  const add = (target: string) => {
    const key = `imports|${target}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ label: "imports", from: leaf, target })
  }
  const addItem = (modulePath: string, name: string) => {
    if (isRelativeOrAbsolute(modulePath)) add(name)
    else add(`${modulePath}:${name}`)
  }
  const addWholeModule = (modulePath: string) => add(wholeModuleBinding(leaf, modulePath))

  const walk = (node: any): void => {
    if (!node) return
    if (node.type === "import_statement") {
      // `import x = require("m")` — a require clause, and its PATH LIVES IN THE CLAUSE, not in a
      // statement-level `source` field (grammar probed: import_statement > import_require_clause >
      // string). Reading the statement source first made this shape emit nothing at all.
      const requireClause = firstNamedOfType(node, "import_require_clause")
      if (requireClause) {
        const requirePath = stringLiteral(firstNamedOfType(requireClause, "string")) ?? stringLiteral(requireClause.namedChild(0))
        if (requirePath !== undefined) addWholeModule(requirePath)
        return
      }
      const source = node.childForFieldName("source") ?? firstNamedOfType(node, "string")
      const modulePath = stringLiteral(source)
      if (modulePath === undefined) return
      const importClause = firstNamedOfType(node, "import_clause")
      if (!importClause) {
        // SIDE-EFFECT-ONLY import: a dependency with no name asked for.
        addWholeModule(modulePath)
        return
      }
      for (let i = 0; i < importClause.namedChildCount; i++) {
        const c = importClause.namedChild(i)
        if (!c) continue
        if (c.type === "identifier") {
          // default import — the LOCAL name, because a default import asks for the module's `default`
          // and the analyzer publishes the written local name for that shape.
          addItem(modulePath, c.text)
        } else if (c.type === "namespace_import") {
          addWholeModule(modulePath)
        } else if (c.type === "named_imports") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const spec = c.namedChild(k)
            if (!spec || spec.type !== "import_specifier") continue
            const name = askedForName(spec)
            if (name !== undefined) addItem(modulePath, name)
          }
        }
      }
      return
    }
    if (node.type === "call_expression") {
      const callee = node.childForFieldName("function") ?? node.namedChild(0)
      const args = node.childForFieldName("arguments")
      const arg = args && args.namedChildCount > 0 ? args.namedChild(0) : null
      const isDynamicImport = !!callee && (callee.text === "import" || callee.type === "import")
      const isRequire = !!callee && callee.type === "identifier" && callee.text === "require"
      if (isDynamicImport || isRequire) {
        const modulePath = literalModulePath(arg)
        if (modulePath !== undefined && modulePath.length > 0) addWholeModule(modulePath)
      }
      return
    }
    if (node.type === "export_statement") {
      const source = node.childForFieldName("source") ?? firstNamedOfType(node, "string")
      const modulePath = stringLiteral(source)
      if (modulePath === undefined) {
        // NOT A RE-EXPORT (`export function f(){…}`): its SUBTREE can carry dynamic imports and
        // nested export statements, so it must be walked, not skipped.
        for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i))
        return
      }
      const clause = firstNamedOfType(node, "export_clause")
      if (clause) {
        let count = 0
        for (let i = 0; i < clause.namedChildCount; i++) {
          const spec = clause.namedChild(i)
          if (!spec || spec.type !== "export_specifier") continue
          const name = askedForName(spec)
          if (name === undefined) continue
          count++
          addItem(modulePath, name)
        }
        // `export {} from "./m"` names a module but asks for nothing — no dependency row.
        return
      }
      // `export * from` / `export * as ns from` — the module itself.
      addWholeModule(modulePath)
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i))
  }
  walk(root)
  return rows
}

export function deriveTypeScriptExportTruth(root: any, filePath: string): TypescriptTruthRow[] {
  const leaf = typescriptModuleLeaf(filePath)
  const rows: TypescriptTruthRow[] = []
  const seen = new Set<string>()
  const add = (target: string) => {
    const key = `exports|${target}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ label: "exports", from: leaf, target })
  }

  const walk = (node: any): void => {
    if (!node) return
    if (node.type === "export_statement") {
      let foundNamed = false
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue
        if (child.type === "export_clause") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const spec = child.namedChild(j)
            if (!spec || spec.type !== "export_specifier") continue
            const name = spec.childForFieldName("name") ?? spec.namedChild(0)
            if (!name) continue
            const alias = spec.childForFieldName("alias")
            foundNamed = true
            // The PUBLISHED name: the alias when there is one.
            add(String(alias ? alias.text : name.text))
          }
        } else if (child.type === "namespace_export") {
          const nameNode = child.namedChild(child.namedChildCount - 1)
          if (nameNode) {
            foundNamed = true
            add(String(nameNode.text))
          }
        } else if (
          child.type === "function_declaration" ||
          child.type === "function_signature" ||
          child.type === "generator_function_declaration" ||
          child.type === "class_declaration" ||
          child.type === "abstract_class_declaration" ||
          child.type === "interface_declaration" ||
          child.type === "type_alias_declaration" ||
          child.type === "enum_declaration" ||
          child.type === "internal_module" ||
          child.type === "module"
        ) {
          const nameNode = child.childForFieldName("name") ?? child.namedChild(0)
          if (nameNode && nameNode.type !== "string") {
            foundNamed = true
            add(String(nameNode.text))
          }
        } else if (child.type === "ambient_declaration") {
          // `export declare …` — the exported name is inside the wrapper, one level down.
          const inner = child.namedChild(0)
          if (inner) {
            if (
              inner.type === "function_signature" ||
              inner.type === "function_declaration" ||
              inner.type === "class_declaration" ||
              inner.type === "abstract_class_declaration" ||
              inner.type === "interface_declaration" ||
              inner.type === "enum_declaration" ||
              inner.type === "type_alias_declaration"
            ) {
              const nameNode = inner.childForFieldName("name") ?? inner.namedChild(0)
              if (nameNode && nameNode.type !== "string") {
                foundNamed = true
                add(String(nameNode.text))
              }
            } else if (inner.type === "lexical_declaration" || inner.type === "variable_declaration") {
              for (let j = 0; j < inner.namedChildCount; j++) {
                const declarator = inner.namedChild(j)
                if (!declarator || declarator.type !== "variable_declarator") continue
                const nameNode = declarator.childForFieldName("name") ?? declarator.namedChild(0)
                if (nameNode && nameNode.type === "identifier") {
                  foundNamed = true
                  add(String(nameNode.text))
                }
              }
            }
          }
        } else if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const declarator = child.namedChild(j)
            if (!declarator || declarator.type !== "variable_declarator") continue
            const nameNode = declarator.childForFieldName("name") ?? declarator.namedChild(0)
            if (nameNode && nameNode.type === "identifier") {
              foundNamed = true
              add(String(nameNode.text))
            }
          }
        }
      }
      const isDefault = (() => {
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.text === "default") return true
        }
        return false
      })()
      if (isDefault && !foundNamed) {
        // `export default <expression>` names no symbol. A NAMED default is captured above as its
        // declaration; an `export default identifier` is captured by the caller's identifier arm.
        const ident = firstNamedOfType(node, "identifier")
        const isAnonymousExpression =
          firstNamedOfType(node, "object") !== null ||
          firstNamedOfType(node, "arrow_function") !== null ||
          firstNamedOfType(node, "number") !== null ||
          firstNamedOfType(node, "true") !== null ||
          firstNamedOfType(node, "false") !== null ||
          firstNamedOfType(node, "null") !== null ||
          firstNamedOfType(node, "new_expression") !== null ||
          firstNamedOfType(node, "call_expression") !== null ||
          firstNamedOfType(node, "array") !== null
        if (ident && !isAnonymousExpression) add(String(ident.text))
      }
      for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i))
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i))
  }
  walk(root)
  return rows
}

/** Both labels in one pass — the shape the differential's label group consumes. */
export function deriveTypeScriptImportsExportsTruth(root: any, filePath: string): TypescriptTruthRow[] {
  return [...deriveTypeScriptImportTruth(root, filePath), ...deriveTypeScriptExportTruth(root, filePath)]
}
