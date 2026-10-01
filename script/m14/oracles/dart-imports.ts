/**
 * The Dart `imports` / `exports` oracle — LANE-OWNED.
 *
 * Beside `dart-contains.ts` and `dart-overrides.ts`, for the reason those files'
 * headers record: `differential.ts` is edited by several lanes at once, and every
 * line a lane keeps out of it is a line that cannot conflict.
 *
 * ## Why this oracle exists
 *
 * `imports` (7,155) and `exports` (185) are the last Dart relationship classes
 * with no Dart-derived truth. They come from the generic family walker, and they
 * are the edges a consumer uses to answer "what does this file reach for" and
 * "what does this library publish" — the questions a dependency graph exists to
 * answer, on a codebase whose imports are 7,107 directives deep.
 *
 * ## The rule
 *
 * A file IMPORTS a URI when it names that URI in an `import`, a `part`, or a
 * `part of` directive, and EXPORTS a URI when it names it in an `export`.
 *
 * ## Four things the grammar does not tell you
 *
 * 1. **The target is a URI, and it carries a suffix that depends on the
 *    relationship.** An import target is `<uri>:*` — the `:��` is the family marker
 *    meaning "everything this module publishes". An export target is the bare
 *    `<uri>`, with no marker. Two edges from the same file to the same module
 *    therefore differ only in that suffix, and dropping it collapses an import
 *    and an export of one module into one indistinguishable row.
 * 2. **EVERY import form collapses to the same row.** `as`, `show`, `hide`,
 *    `show … as`, and `deferred as` all yield the identical `<uri>:*`. The
 *    combinators narrow what is VISIBLE, not what is depended upon, so none of
 *    them belongs in the edge. A relative URI (`../other.dart`) is kept verbatim —
 *    normalizing it would invent a module identity the file does not write.
 * 3. **The URI lives at three different depths.** `import_specification` carries
 *    the string directly; `library_export` wraps it in a `configurable_uri`; and
 *    both `part_directive` and `part_of_directive` wrap it in a `uri` node. Only
 *    `part`/`part of` are direct children of `program` — `import` and `export`
 *    arrive wrapped in `import_or_export`, and `export` has an extra
 *    `library_import`-shaped hop that `import` does not.
 * 4. **A SELF-IMPORT is still an import.** `import 'self.dart';` in the file
 *    `self.dart` publishes `imports:self->self.dart:*` rather than being dropped.
 *    That is defensible — the directive is written and the compiler honours it —
 *    and it is recorded here because "self-imports are filtered" is the kind of
 *    thing a reader assumes and this lane does not do.
 *
 * ## One class recorded as unresolved rather than ruled
 *
 * `part of 'b.dart';` publishes `imports:this->b.dart:*`. The directive names the
 * file's **PARENT** — it says "I am a part of b.dart", not "I import b.dart" — so
 * publishing it in the same class as an import states the dependency backwards.
 * 24 such rows in ProxiCall/lib, every one of them a generated `*.freezed.dart` /
 * `*.g.dart` naming its source. Whether that is a defect or a deliberate
 * uniformity choice (every module-level URI is an `imports` row, so a consumer finds
 * one edge class rather than three) is a family decision, and the oracle mirrors
 * the analyzer here rather than making the call itself.
 */

export interface TruthEdge {
  label: string
  from: string
  target: string
}

const named = (n: any): any[] => (n?.namedChildren ?? [])

/** First `string_literal` in document order, quotes stripped by text. */
function firstStringLiteral(node: any): string | null {
  if (node.type === "string_literal") return node.text.replace(/^['"]/, "").replace(/['"]$/, "")
  for (const c of named(node)) {
    const hit = firstStringLiteral(c)
    if (hit) return hit
  }
  return null
}

/** The file's own module name — the basename with its extension removed. */
function moduleName(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

export function deriveDartImportsTruth(root: any, filePath: string): TruthEdge[] {
  const source = moduleName(filePath)
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const add = (label: string, target: string): void => {
    const k = `${label}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from: source, target } as TruthEdge)
  }

  const visit = (node: any): void => {
    if (!node) return
    if (node.type === "import_specification") {
      const uri = firstStringLiteral(node)
      if (uri) add("imports", `${uri}:*`)
    } else if (node.type === "library_export") {
      const uri = firstStringLiteral(node)
      if (uri) add("exports", uri)
    } else if (node.type === "part_directive" || node.type === "part_of_directive") {
      const uri = firstStringLiteral(node)
      if (uri) add("imports", `${uri}:*`)
    }
    for (const c of named(node)) visit(c)
  }
  visit(root)

  return edges
}
