// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — removes the import bindings a `delete` made dead in the
//   file it deleted the symbol from.
// WHICH TOOL IT SERVES — bb_edit (mutability write, requiresIndex true,
//   modes: write, update, insert, delete, refactor, batch); this module runs on
//   the `delete` path only.
// WHY IT IS SHAPED THIS WAY — deleting a symbol can orphan an import, and an
//   unused import is harmless while a WRONGLY removed one breaks the file. So the
//   prune is AST-only, TypeScript/JavaScript only: the tree-sitter tree names the
//   import statements and the identifier occurrences decide usage, so a binding
//   that is still used anywhere in live code is kept, and a language whose import
//   syntax this module cannot parse structurally is left untouched rather than
//   edited by pattern. An earlier version carried a regex table for thirty
//   languages; it matched a FRAGMENT of a statement and searched for the module's
//   last path segment, so `import qualified Data.Map as M` lost only its first
//   token, `from mod import a, b` was deleted while `b` was still used, and an
//   aliased Groovy/Python import used by a surviving function disappeared. All of
//   that was reported as a successful edit. Silent breakage is worse than a
//   leftover import, which is why the scope is deliberately narrow.
// WHERE ITS EVIDENCE LIVES — script/verify-edit.ts (prune positives + negatives),
//   validation/tools/bb_edit/AUDIT.md (findings F1/F2), gates: see that file.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/edit/edit-engine.ts
//   (delete branch), docs/BB_EDIT.md, script/tool-docs/curation/bb_edit.ts.
// CONTRACTS IT MUST NOT BREAK — never remove an import whose binding is still
//   referenced; never edit a file whose import syntax is not TS/JS; return the
//   input unchanged on any parse failure (a prune is an improvement, never a
//   requirement).
// ─────────────────────────────────────────────────────────────────────────────

import { ASTEngine } from "./engine"
import { extractIdentifierOccurrences } from "./safety-primitives"

/** Languages whose import syntax this module prunes structurally. */
const PRUNABLE_LANGUAGES: readonly string[] = Object.freeze(["typescript", "javascript", "tsx", "jsx"])

/** One binding introduced by an import statement. */
interface ImportBinding {
  /** The local name the file uses for the imported value. */
  localName: string
  /** The specifier's own byte range (removed when only this binding is dead). */
  start: number
  end: number
  /** Named import specifiers can be removed one at a time; default/namespace
   *  bindings only go with the whole statement. */
  kind: "named" | "default" | "namespace"
}

interface ImportStatement {
  start: number
  end: number
  bindings: ImportBinding[]
}

/** What the delete path must DECLARE about import cleanup, whatever it did. */
export interface ImportPruneReport {
  /** True only when this module read the file's imports and rewrote them. */
  attempted: boolean
  /** The grammar/extension the file was identified as, or null when unknown. */
  language: string | null
  /** Local names of the bindings this prune removed (empty when none). */
  removedBindings: string[]
  /** Why pruning was not attempted, when it was not. */
  reason?: string
  /** The rewritten file (identical to the input when nothing was removed).
   *  Internal to the delete path: the public result omits it. */
  content?: string
}

export class ImportPruner {
  /**
   * Remove import bindings that the `delete` made unreferenced, and report what
   * was and was not attempted so the delete result can declare it.
   *
   * A file this module cannot parse, or whose language is outside
   * PRUNABLE_LANGUAGES, is returned EXACTLY as given: a leftover import never
   * breaks a build, and an import removed on a guess does. When pruning is not
   * attempted the report says so and names the language; the edit is correct
   * either way, and the caller is never left to assume cleanup happened.
   */
  static async pruneWithReport(fileContent: string, filePath: string): Promise<ImportPruneReport> {
    const language = ASTEngine.detectLanguage(filePath)
    if (!language) {
      return { attempted: false, language: null, removedBindings: [], reason: "the file's language is not recognised, so no import syntax could be read", content: fileContent }
    }
    if (!PRUNABLE_LANGUAGES.includes(language)) {
      return {
        attempted: false,
        language,
        removedBindings: [],
        reason: `import pruning is implemented for TypeScript/JavaScript only; ${language} imports were left unchanged rather than pattern-matched`,
        content: fileContent,
      }
    }
    let tree: any = null
    try {
      const parsed = await ASTEngine.parseTree(filePath, fileContent)
      tree = parsed.tree
      const occurrences = extractIdentifierOccurrences(tree, fileContent)
      const statements = ImportPruner.importStatements(tree)
      if (statements.length === 0) {
        return { attempted: true, language, removedBindings: [], content: fileContent }
      }
      const isInsideImport = (index: number): boolean => statements.some((s) => index >= s.start && index < s.end)
      const usedOutsideImports = new Set(occurrences.filter((o) => !isInsideImport(o.startIndex)).map((o) => o.text))
      const removedBindings = ImportPruner.unusedBindings(statements, usedOutsideImports)
      return { attempted: true, language, removedBindings, content: ImportPruner.rewrite(fileContent, statements, usedOutsideImports) }
    } catch (error: any) {
      return {
        attempted: false,
        language,
        removedBindings: [],
        reason: `the file could not be parsed for import pruning (${error?.message ?? String(error)}), so its imports were left unchanged`,
        content: fileContent,
      }
    } finally {
      try {
        if (tree && typeof tree.delete === "function") tree.delete()
      } catch {
        /* the grammar's tree is released best-effort */
      }
    }
  }

  /** Remove import bindings that the `delete` made unreferenced. */
  static async prune(fileContent: string, filePath: string): Promise<string> {
    return (await ImportPruner.pruneWithReport(fileContent, filePath)).content ?? fileContent
  }

  /** Local names of the bindings no live occurrence refers to. */
  private static unusedBindings(statements: ImportStatement[], used: Set<string>): string[] {
    const out: string[] = []
    for (const statement of statements) {
      for (const binding of statement.bindings) if (!used.has(binding.localName)) out.push(binding.localName)
    }
    return out
  }

  /** Every top-level import statement with its bindings, in source order. */
  private static importStatements(tree: any): ImportStatement[] {
    const out: ImportStatement[] = []
    const children = tree?.rootNode?.children ?? []
    for (const node of children) {
      if (node?.type !== "import_statement") continue
      const clause = (node.children ?? []).find((c: any) => c.type === "import_clause")
      const bindings: ImportBinding[] = []
      if (clause) {
        for (const child of clause.children ?? []) {
          if (child.type === "identifier") {
            bindings.push({ localName: child.text, start: child.startIndex, end: child.endIndex, kind: "default" })
          } else if (child.type === "named_imports") {
            for (const spec of child.children ?? []) {
              if (spec.type !== "import_specifier") continue
              // `import { a as b }` — the local name is the alias when present,
              // because that is what the rest of the file refers to.
              const identifiers = (spec.children ?? []).filter((c: any) => c.type === "identifier")
              const local = identifiers.length > 1 ? identifiers[identifiers.length - 1] : identifiers[0]
              if (!local) continue
              bindings.push({ localName: local.text, start: spec.startIndex, end: spec.endIndex, kind: "named" })
            }
          } else if (child.type === "namespace_import") {
            const id = (child.children ?? []).find((c: any) => c.type === "identifier")
            if (id) bindings.push({ localName: id.text, start: child.startIndex, end: child.endIndex, kind: "namespace" })
          }
        }
      }
      out.push({ start: node.startIndex, end: node.endIndex, bindings })
    }
    return out
  }

  /** Apply statement/specifier removals bottom-up so byte offsets stay valid. */
  private static rewrite(content: string, statements: ImportStatement[], used: Set<string>): string {
    const removals: Array<{ start: number; end: number }> = []
    for (const statement of statements) {
      if (statement.bindings.length === 0) continue
      const unused = statement.bindings.filter((binding) => !used.has(binding.localName))
      if (unused.length === 0) continue
      if (unused.length === statement.bindings.length) {
        removals.push({ start: statement.start, end: ImportPruner.throughTrailingNewline(content, statement.end) })
        continue
      }
      // Partial: only named specifiers can leave without stranding punctuation;
      // a used default/namespace binding keeps its statement.
      for (const binding of unused) {
        if (binding.kind !== "named") continue
        const range = ImportPruner.specifierRemoval(content, binding.start, binding.end)
        if (range) removals.push(range)
      }
    }
    let result = content
    for (const range of removals.sort((a, b) => b.start - a.start)) {
      result = result.slice(0, range.start) + result.slice(range.end)
    }
    return result
  }

  /** End offset widened over a trailing newline so a removed statement leaves no blank line. */
  private static throughTrailingNewline(content: string, end: number): number {
    let cursor = end
    if (content[cursor] === "\r") cursor++
    if (content[cursor] === "\n") cursor++
    return cursor
  }

  /** The range to delete for one named specifier, eating one adjacent comma. */
  private static specifierRemoval(content: string, start: number, end: number): { start: number; end: number } | null {
    let from = start
    const to = end
    let cursor = to
    while (cursor < content.length && (content[cursor] === " " || content[cursor] === "\t")) cursor++
    if (content[cursor] === ",") {
      cursor++
      while (cursor < content.length && (content[cursor] === " " || content[cursor] === "\t")) cursor++
      return { start: from, end: cursor }
    }
    let back = from
    while (back > 0 && (content[back - 1] === " " || content[back - 1] === "\t")) back--
    if (back > 0 && content[back - 1] === ",") {
      back--
      while (back > 0 && (content[back - 1] === " " || content[back - 1] === "\t")) back--
      return { start: back, end: to }
    }
    return null
  }
}
