/**
 * The Kotlin `exports` oracle — LANE-OWNED.
 *
 * `exports` was the one production relationship type the Kotlin analyzer never
 * emitted: `firing-check-v2` measured 0 `exports` relationships in 8,664 corpus
 * edges at NFILES=200 while the neighbouring `exports[]` array carried 690
 * entries in 185 of 200 files. The array existed; the graph edge did not. This
 * file is the independent half of closing that.
 *
 * It lives in `oracles/` rather than in `differential.ts` for the reason the
 * TypeScript oracle's header records: that shared file is edited by several
 * lanes at once. Wiring it in later is one import and one registration, and the
 * master owns that file.
 *
 * ## Independence
 *
 * The rule below is written from Kotlin's visibility contract. It shares NO
 * code, NO table and NO resolver with `RealKotlinAnalyzer` — not
 * `determineVisibility`, not the `exports[]` filter, not `stripKotlinQuoting`.
 * Quoting is re-implemented here as its own character scan, and the "is this
 * top level" test is a parent walk rather than the analyzer's `ownerName`. That
 * is the only property that makes a MATCH mean something: an oracle derived from
 * the analyzer cannot disagree with it.
 *
 * THE LIMIT THIS ORACLE CANNOT CARRY (stated because the harness must not be
 * asked to carry it): both this file and the analyzer walk the SAME
 * tree-sitter-kotlin grammar. A bug in the grammar — a `visibility_modifier`
 * that did not exist, a `source_file` that did not exist — would be invisible to
 * a comparison. What the comparison CAN see is every rule disagreement, every
 * filter difference, every canonicalisation difference and every missing node
 * type, and it sees them per file over a real corpus. It is L3 evidence with that
 * scope attached, not a proof about the grammar.
 *
 * ## The rule
 *
 * Kotlin has no `export` keyword. Its module-exposure construct is VISIBILITY:
 * a declaration is part of the module's published surface unless it is
 * `internal` (visible inside the module only, by Kotlin's own definition),
 * `private` (visible inside the file/class only) or `protected` (class members
 * only). `public` is the DEFAULT — an unqualified top-level declaration is
 * exported — so the export test is a NEGATIVE one, and a rule that only ever
 * fired on an explicit `public` keyword would miss most of the corpus. This is
 * the specific reason the handover's guess ("Kotlin has no export keyword,
 * likely RULED") was wrong, and the census that refutes it is
 * `script/m14/kotlin-ontology-census.ts`: 91 non-public top-level declarations
 * in a 200-file sample of fixtures/repositories/kotlin, i.e. the discriminator
 * is real corpus surface at 13.6% of the top-level population, not a construct
 * that never occurs.
 *
 * FILE SCOPE. Only a TOP-LEVEL declaration is exported. A member of a class is
 * reached as `Outer.member`, which is what a `contains` edge already says, and
 * its `public` is the member's own `visibility` — the exact ruling zig's oracle
 * records for `pub` inside a container. The test is structural: walk the parent
 * chain, and a `class_body` / `enum_class_body` before the `source_file` means
 * nested. It needs no symbol table, so it cannot disagree with the extractor
 * about who owns what; where it and the extractor disagree, the disagreement IS
 * the finding.
 *
 * `.kts` SCRIPT FILES. A script's `source_file` body is a statement list, not a
 * declaration list, and a top-level `call_expression` in one is not an
 * declaration at all. The rule reads only declaration node types, so script
 * statements are simply not in the export set — which is correct: a Gradle
 * `build.gradle.kts` script exports nothing to another module, it configures a
 * build.
 *
 * ONE CONSTRUCT DELIBERATELY NOT GIVEN AN EDGE CLASS: `@JsExport`, Kotlin/JS's
 * annotation for publishing a declaration to JavaScript. Measured on the corpus
 * it occurs 2 times in 1 file. One occurrence is a data point, not a surface, so
 * it stays reachable as ordinary symbol metadata (`decorators`) and gets no edge
 * of its own. If a Kotlin/JS-heavy corpus ever shows it at scale, that is the
 * measurement that would earn it one.
 */

/** The node types the grammar uses for a declaration that can be exported.
 *  Enumerated from the corpus, not remembered: `script/m14/kotlin-top-level-census.ts`
 *  measured `source_file`'s named-child distribution at NFILES=200 and found
 *  exactly these five carrying a name and a visibility — function_declaration
 *  290, class_declaration 277, property_declaration 85, object_declaration 19,
 *  type_alias 10. `file_annotation` is top level but declares nothing; a bare
 *  `infix_expression` / `call_expression` at source_file level is a `.kts`
 *  script statement. */
const DECLARATIONS = new Set([
  "class_declaration",
  "object_declaration",
  "function_declaration",
  "property_declaration",
  "type_alias",
])

/** Bodies that make a declaration a MEMBER rather than a top-level export. */
const BODIES = new Set(["class_body", "enum_class_body"])

/** Visibility keywords that remove a declaration from the module surface.
 *  `public` is absent on purpose: it is the default, so "no modifier" and
 *  "`public`" must take the same branch or the two spellings disagree. */
const NOT_EXPORTED = new Set(["private", "internal", "protected"])

const NAME_NODES = new Set(["simple_identifier", "type_identifier", "identifier"])

/** Kotlin quoting: a backtick-quoted name is a name that cannot be spelled
 *  plainly, and the backticks are syntax rather than part of the name.
 *  Character scan, no regex — the analyzer has its own copy of this rule and
 *  the two must not share it, or a change to one silently changes the other. */
export function stripKotlinBackticks(text: string): string {
  if (text.indexOf("`") === -1) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 96) {
      const close = text.indexOf("`", i + 1)
      if (close === -1) { out += text.slice(i); break }
      out += text.slice(i + 1, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

/** The declared name of a declaration node, or undefined when the grammar
 *  gives it none. For an extension function `fun String.shout()` the receiver is
 *  a `receiver_type` / `user_type` node, which is not in NAME_NODES, so the
 *  walk past it lands on the function's own `simple_identifier`. */
function declaredName(n: any): string | undefined {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && NAME_NODES.has(c.type)) {
      const t = stripKotlinBackticks(String(c.text ?? "")).trim()
      if (t) return t
    }
  }
  return undefined
}

/** The visibility written on the declaration, or "public" when none is.
 *  Only `visibility_modifier` is consulted. The modifier CLASSES
 *  (`class_modifier`, `member_modifier`, …) hold `sealed`, `data`, `open`,
 *  `const`, `override` and friends; probe-verified on
 *  `internal class A / private class B / class C / public class D`: all four
 *  spellings put the keyword in a `visibility_modifier` and nowhere else, so
 *  reading the class would conflate `data` with `private`. */
function declaredVisibility(n: any): string {
  const stack: any[] = [n]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x && x.type === "visibility_modifier") {
      const t = String(x.text ?? "").trim()
      if (t === "private" || t === "internal" || t === "protected" || t === "public") return t
    }
    if (!x) continue
    for (let i = 0; i < x.namedChildCount; i++) {
      const c = x.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return "public"
}

/** True when the declaration sits directly in the file's declaration scope:
 *  no class body between it and the `source_file`. */
function atFileScope(n: any): boolean {
  let cur = n.parent
  while (cur) {
    if (BODIES.has(cur.type)) return false
    if (cur.type === "source_file") return true
    cur = cur.parent
  }
  // A declaration with no source_file above it is inside a recovery subtree; the
  // corpus has 76 top-level ERROR nodes at NFILES=200 and a declaration inside
  // one has not been shown to be file scope.
  return false
}

export interface KotlinExportsTruthRow {
  label: "exports"
  /** The exporting entity. A Kotlin `package` is a HEADER, not a declaration,
   *  so it has no symbol and an edge from it could never resolve; the
   *  compilation unit is the file. Same spelling and the same argument as zig's
   *  Z33 ruling, kept as a literal so the two lanes can be told apart at a
   *  glance rather than merged by a consumer. */
  from: "(file)"
  target: string
  line: number
  visibility: string
  declarationKind: string
}

export function deriveKotlinExportsTruth(root: any): KotlinExportsTruthRow[] {
  const out: KotlinExportsTruthRow[] = []
  const seen = new Set<string>()
  const walk = (n: any): void => {
    if (DECLARATIONS.has(n.type) && atFileScope(n)) {
      const vis = declaredVisibility(n)
      const name = declaredName(n)
      if (name && !NOT_EXPORTED.has(vis)) {
        const line = (n.startPosition?.row ?? 0) + 1
        const k = `${name}|${line}`
        if (!seen.has(k)) {
          seen.add(k)
          out.push({ label: "exports", from: "(file)", target: name, line, visibility: vis, declarationKind: n.type })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(root)
  return out
}