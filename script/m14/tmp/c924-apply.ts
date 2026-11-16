// #924 name surface — the whole transform: quoting syntax is not part of a name, and a
// payload/expression/comment is not a name either.
//
// Applies 37 edits, idempotently, to any tree. Both halves are here because every one of
// them moves a string BOTH sides of the harness read (the analyzer publishes it, the oracle
// derives it), so a half-applied fix reads as a mask rather than an agreement:
//   K1..K4  kotlin Q  — stripKotlinQuoting + canonicalizePublishedNames at the publish boundary,
//                       and the same strip in the kotlin oracle
//   S1..S4  scala  Q/E — stripScalaQuoting in createSymbol; scalaTypeHeadName for the synthetic
//                       anonymous name and the `instantiates` target; `val A, B` publishes one
//                       symbol per DECLARED name
//   S5..S7  differential — scalaHeadTypeName (both scala oracle sites) and the anonymous name
//   Z1..Z10 zig   Q  — stripZigQuoting + the pass, and six reads in the zig oracles
//   HS      haskell E — haskellAppliedHeadName (instance-head type application)
//   L1..L4  elixir E — binaryPart() (a comment is not an operand), and the group form
//                       (`import A.{B, C}`) expanding per module for EVERY directive
//   L5..L8  differential — elixirBinaryPart + the same group expansion, mirrored
//
// Usage:
//   bun script/m14/tmp/c924-apply.ts [targetRoot]     # default: this repository
//   bun script/m14/tmp/c924-apply.ts --check [root]   # report only, never write
//
// Exit 1 (and a named report) if any edit is missing or ambiguous. Re-running on a
// transformed tree applies nothing and reports all four as already-applied, which is
// what makes the replica → live port auditable.
import * as fs from "node:fs"
import * as path from "node:path"

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")
const ROOT = args.find((a) => !a.startsWith("--")) ?? "<corpus-root>/mcp/backtester-brain-placeholder"

if (ROOT.includes("placeholder")) {
  console.error("target root required")
  process.exit(2)
}

type State = { find: string; replace: string; state: string }
type Edit = {
  id: string
  file: string
  what: string
  find: string
  replace: string
  // A state THIS TRANSFORM ITSELF produced (an earlier, defective version of the same edit).
  // Its anchor is strictly NARROWER than the HEAD anchor — which is a prefix that still matches
  // inside such a tree — so these are tried FIRST. This exists because one of these edits once
  // merged its statement onto a `//` line (dead code) and the live tree carried it; a transform
  // that can only apply to a pristine HEAD cannot correct its own output.
  alsoStates?: State[]
}

const KT = "src/ast/real-kotlin-analyzer.ts"
const SCALA = "src/ast/real-scala-analyzer.ts"
const ZIG = "src/ast/real-zig-analyzer.ts"
const HS = "src/ast/real-haskell-analyzer.ts"
const ELIXIR = "src/ast/real-elixir-analyzer.ts"
const DIFF = "script/m14/differential.ts"

const SCALA_STRIP = `/**
 * M60 (#924, scala half): quoting syntax is not part of an identifier's NAME.
 * \`@Test def \`object\` =\` declares the identifier \`object\`, and the corpus's
 * own references spell it WITHOUT the backticks — a published name that keeps the
 * syntax is a name no reference can spell. Same remedy as the swift half
 * (real-swift-analyzer.ts stripNameQuoting), with kotlin's semantics: the strings
 * this file publishes are also ids and qualified names ("A.\`object\`"), so every
 * COMPLETE backtick run is quoting, wherever it sits in the string; an unmatched
 * backtick is not a run and is kept verbatim. Measured before the fix on the
 * census's own samples: 104 occurrences / 52 distinct names, and 52 of those
 * names were invisible to the register's whitespace-keyed routing
 * (script/m14/tmp/c924-name-surface-probe.ts).
 */
function stripScalaQuoting(text: string): string {
  if (!text.includes("\`")) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 96) {
      const close = text.indexOf("\`", i + 1)
      if (close === -1) {
        out += text.slice(i)
        break
      }
      out += text.slice(i + 1, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

function sigHasTypeVar(sig: string): boolean {`

const STRIP_HELPER = `/**
 * M60 (#924, kotlin half): quoting syntax is not part of an identifier's NAME.
 * \`fun \`test char column read and write\`()\` declares the identifier
 * \`test char column read and write\`; the backticks are Kotlin's escape for a name
 * that cannot be spelled plainly (keywords, spaces), not part of what it is called.
 * This mirrors the swift half of the same issue (real-swift-analyzer.ts
 * stripNameQuoting); kotlin goes one step further because the strings this file
 * publishes are also PATHS ("Outer.\`object\`") and ids (dotted names), so every
 * COMPLETE backtick run is quoting, wherever it sits in the string. An unmatched
 * backtick is not a run and is kept verbatim. Measured before the fix on the
 * census's own samples: 6 occurrences / 3 distinct names
 * (script/m14/tmp/c924-name-surface-probe.ts).
 */
function stripKotlinQuoting(text: string): string {
  if (!text.includes("\`")) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 96) {
      const close = text.indexOf("\`", i + 1)
      if (close === -1) {
        out += text.slice(i)
        break
      }
      out += text.slice(i + 1, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

function kotlinSigHasTypeVar(sig: string): boolean {`

const CANON_METHOD = `  /**
   * M60 (#924, kotlin half): canonicalize the PUBLISHED name surface.
   *
   * Kotlin has no symbol factory (symbols are pushed inline by the extractors),
   * so the strip cannot be applied at construction the way swift's createSymbol
   * does it; it is applied here, at the publish boundary — after every analysis
   * pass and before exports/imports are derived from these same objects, so all
   * published spellings agree with each other (a \`contains\` target still equals
   * the symbol name it points at) and with what a reference can spell.
   *
   * Internal keys are deliberately NOT rewritten past this point: the analysis
   * resolves references in the source's own spelling (a kotlin reference to a
   * quoted name is itself quoted), so the quoted form is the correct lookup key
   * inside the analysis and the stripped form is the correct published name.
   */
  private canonicalizePublishedNames(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    // typeof, not truthiness: id/ownerName are optional on UniversalSymbol and a
    // target can be absent — the first cut of this pass called the helper with
    // undefined, the analyzer threw, and the ENGINE swapped in a basic parse
    // result, i.e. an empty analysis. Nothing published is missing, so a run
    // cannot smell that; only the probe's "census samples re-derived" guard can
    // (it read 0/33 and refused the green).
    for (const s of symbols) {
      if (typeof s.name === "string") s.name = stripKotlinQuoting(s.name)
      if (typeof s.ownerName === "string") s.ownerName = stripKotlinQuoting(s.ownerName)
      if (typeof s.id === "string") s.id = stripKotlinQuoting(s.id)
    }
    for (const r of relationships) {
      if (typeof r.source === "string") r.source = stripKotlinQuoting(r.source)
      if (typeof r.target === "string") r.target = stripKotlinQuoting(r.target)
    }
  }

  private buildKotlinCallExpression(node: Node): string {`

const ZIG_SCANNER = (name: string, doc: string) => `/**
 * ${doc}
 */
function ${name}(text: string): string {
  if (!text.includes('@"')) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 64 && text[i + 1] === '"') {
      const close = text.indexOf('"', i + 2)
      if (close === -1) {
        out += text.slice(i)
        break
      }
      out += text.slice(i + 2, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}
`

const EDITS: Edit[] = [
  {
    id: "Z1",
    file: ZIG,
    what: "stripZigQuoting() helper",
    find: `export class RealZigAnalyzer implements ASTEngine.LanguageAnalyzer {`,
    replace:
      ZIG_SCANNER(
        "stripZigQuoting",
        `M60 (#924, zig half): quoting syntax is not part of an identifier's NAME.
 * \`fn @"weird function name"() i32\` declares the identifier
 * \`weird function name\`; \`@"…"\` is zig's escape for a name that cannot be spelled
 * plainly. The grammar puts BOTH tokens inside one \`identifier\` node (a \`@"\` token
 * plus a string), so the node's text carries the sigil and the name is its CONTENT —
 * the same rule the swift and kotlin halves apply to their backticks, measured the
 * same way: before the fix the census's own samples publish \`@"zls env"\`, \`@"fn"\`
 * and \`@"weird function name"\` as a function name, a \`calls\` target and a \`uses\`
 * target (script/m14/tmp/c924-name-surface-probe.ts). An unterminated \`@"\` is
 * malformed source, not a name: it is kept verbatim.`,
      ) + `
export class RealZigAnalyzer implements ASTEngine.LanguageAnalyzer {`,
  },
  {
    id: "Z2",
    file: ZIG,
    what: "canonicalizePublishedNames() at zig's publish boundary",
    find: `  private analyzeZigBareIdentifierUses(`,
    replace: `  /**
   * M60 (#924, zig half): canonicalize the PUBLISHED name surface.
   *
   * Zig builds its symbols inline (no factory), so the strip lands here, at the
   * publish boundary — after every analysis pass, so nothing internal ever sees a
   * canonical spelling mid-walk (the bare-use inventory and the shadowing frames
   * are keyed on the SOURCE's own spellings and stay consistent with the tree),
   * and before the result leaves the analyzer.
   */
  private canonicalizePublishedNames(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
  ): void {
    for (const s of symbols) {
      if (typeof s.name === "string") s.name = stripZigQuoting(s.name)
      if (typeof s.ownerName === "string") s.ownerName = stripZigQuoting(s.ownerName)
      if (typeof s.id === "string") s.id = stripZigQuoting(s.id)
    }
    for (const r of relationships) {
      if (typeof r.source === "string") r.source = stripZigQuoting(r.source)
      if (typeof r.target === "string") r.target = stripZigQuoting(r.target)
    }
    for (const e of exports) {
      if (typeof e.name === "string") e.name = stripZigQuoting(e.name)
    }
  }

  private analyzeZigBareIdentifierUses(`,
  },
  {
    id: "Z3",
    file: ZIG,
    what: "call the canonicalization pass",
    find: `    const fileComplexity = this.zigBodyComplexity(rootNode)`,
    replace: `    // M60 (#924, zig half): the published name surface — quoting syntax is not
    // part of a name.
    this.canonicalizePublishedNames(symbols, relationships, exports)

    const fileComplexity = this.zigBodyComplexity(rootNode)`,
  },
  {
    id: "Z4",
    file: DIFF,
    what: "oracle: stripZigQuoting() helper",
    find: `export function deriveZigEdges(root: any): { label: string; from: string; target: string }[] {`,
    replace:
      ZIG_SCANNER(
        "stripZigQuoting",
        `M60 (#924, zig half): \`@"…"\` is quoting, so the published name is the content
 * of the identifier — mirrors RealZigAnalyzer.stripZigQuoting. Six reads in this
 * file need it: deriveZigEdges' callee and member leaves, and deriveZigBareUses'
 * binding, scope and target reads. The last group matters most: that oracle builds
 * its file-scope inventory from the ANALYZER's symbols (canonical after the fix)
 * while every other read comes from the tree, so without stripping the two sides
 * would spell one name two ways and the shadowing gate would read a phantom.
 * Z6's \`_\` and index comparisons are unaffected (they never compare text).`,
      ) + `
export function deriveZigEdges(root: any): { label: string; from: string; target: string }[] {`,
  },
  {
    id: "Z5",
    file: DIFF,
    what: "oracle: deriveZigEdges member leaf",
    find: `    if (last && last.type === "identifier") return last.text`,
    replace: `    if (last && last.type === "identifier") return stripZigQuoting(last.text)`,
  },
  {
    id: "Z6",
    file: DIFF,
    what: "oracle: deriveZigEdges callee leaf",
    find: `      if (callee && callee.type === "identifier") leaf = callee.text`,
    replace: `      if (callee && callee.type === "identifier") leaf = stripZigQuoting(callee.text)`,
  },
  {
    id: "Z7",
    file: DIFF,
    what: "oracle: bare-use binding read (bindIds)",
    find: `      if (m.type === "identifier" && m.text !== "_") out.add(m.text)`,
    replace: `      if (m.type === "identifier" && m.text !== "_") out.add(stripZigQuoting(m.text))`,
  },
  {
    id: "Z8",
    file: DIFF,
    what: "oracle: bare-use binding read (bindFirstIdent)",
    find: `        if (c.text !== "_") out.add(c.text)`,
    replace: `        if (c.text !== "_") out.add(stripZigQuoting(c.text))`,
  },
  {
    id: "Z9",
    file: DIFF,
    what: "oracle: bare-use scope binding read",
    find: `            if (c.text !== "_") scopes[scopes.length - 1].add(c.text)`,
    replace: `            if (c.text !== "_") scopes[scopes.length - 1].add(stripZigQuoting(c.text))`,
  },
  {
    id: "Z10",
    file: DIFF,
    what: "oracle: bare-use TARGET read",
    find: `    } else if (t === "identifier") {
      const name = n.text`,
    replace: `    } else if (t === "identifier") {
      const name = stripZigQuoting(n.text)`,
  },
  {
    id: "H1",
    file: HS,
    what: "haskellAppliedHeadName() — the type name at the head of an applied type",
    find: `  private processInstance(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {`,
    replace: `  /**
   * M60 (#924, haskell E half): the TYPE NAME at the head of an applied type.
   *
   * An instance declaration such as  instance GArbitrary (M1 i c f)  declares an
   * implementation FOR the type M1 i c f, whose name is its head type constructor
   * M1; the published symbol was the whole application (M1 i c), i.e. a payload
   * where a name belongs — measured as 2 distinct strings over 6 occurrences on the
   * census's own haskell samples (script/m14/tmp/c924-name-surface-probe.ts). Walks
   * the APPLICATION SPINE (apply / parens / strict) to the leftmost leaf and returns
   * its text verbatim (a qualified head keeps its dots). The class head already
   * takes this same left-spine descent; only the instance TARGET did not.
   */
  private haskellAppliedHeadName(node: Node | null | undefined): string | undefined {
    let cur: Node | null | undefined = node
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

  private processInstance(node: Node, ctx: HaskellContext, scopeStack: Scope[]): boolean {`,
  },
  {
    id: "H2",
    file: HS,
    what: "the instance TARGET publishes the head type name, not the application",
    find: `          const parens = this.findNamedChildByType(tpNode, ["parens"])
          if (parens) {
            const ap = this.findNamedChildByType(parens, ["apply"])
            const first = ap?.namedChildCount ? ap.namedChild(0) : null
            if (first) targetType = first.text
          }`,
    replace: `          const parens = this.findNamedChildByType(tpNode, ["parens"])
          if (parens) {
            const ap = this.findNamedChildByType(parens, ["apply"])
            const first = ap?.namedChildCount ? ap.namedChild(0) : null
            // M60 (#924, haskell E half): the TARGET TYPE's NAME, not the whole
            // application — (M1 i c f) names the type M1, and publishing M1 i c
            // put a payload where a name belongs. See haskellAppliedHeadName.
            if (first) targetType = this.haskellAppliedHeadName(first) ?? first.text
          }`,
  },
  {
    id: "K6",
    file: KT,
    what: "kotlinIdentifierPath() — the name of an expression, when it has one",
    find: `  private buildKotlinNavigationExpression(node: Node): string {`,
    replace: `  /**
   * M60 (#924, kotlin E half): the NAME of an expression, when it has one.
   *
   * The uses walk published an indexing receiver's raw TEXT, so a read of
   * \`dest.selectAll().where { dest.id eq 1 }.single()[dest.id]\` was published as
   * that whole expression — arguments, lambda body and brackets included. Every
   * one of the 27 such strings the census collected on kotlin is an indexing
   * receiver (script/m14/tmp/c924-name-surface-probe.ts). A name is the chain of
   * IDENTIFIERS along the callee/receiver spine; arguments and lambda bodies are
   * never part of it. Returns undefined when the spine carries no identifier, and
   * the caller then decides by the old text's SHAPE (see kotlinNameShapedText).
   */
  private kotlinIdentifierPath(node: Node | null | undefined): string | undefined {
    if (!node) return undefined
    switch (node.type) {
      case "simple_identifier":
      case "identifier":
      case "type_identifier":
        return stripKotlinQuoting(node.text)
      case "navigation_expression": {
        const receiver = node.namedChild(0)
        let selector = node.namedChild(node.namedChildCount - 1)
        if (!receiver || !selector) return undefined
        if (selector.type === "navigation_suffix") {
          const inner = selector.namedChild(selector.namedChildCount - 1)
          if (!inner) return undefined
          selector = inner
        }
        const rt = this.kotlinIdentifierPath(receiver)
        const st = this.kotlinIdentifierPath(selector)
        return rt && st ? \`\${rt}.\${st}\` : undefined
      }
      case "call_expression":
      case "indexing_expression":
        return this.kotlinIdentifierPath(node.namedChild(0))
      default:
        return undefined
    }
  }

  /**
   * M60 (#924, kotlin E half): is this published TEXT itself name-shaped? A name
   * carries no argument, lambda, index or separator punctuation — the same rule
   * the census's E class measures. Used only as a FALLBACK: a receiver whose spine
   * has no identifier (\`this\`, a type parameter, a quoted name) keeps its old
   * spelling rather than losing the edge, because those spellings are names and
   * the defect being fixed is an EXPRESSION published as one.
   */
  private kotlinNameShapedText(text: string): boolean {
    if (!text) return false
    if (text.includes("\\n")) return false
    for (const ch of ["(", ")", "{", "}", "[", "]", ","]) {
      if (text.includes(ch)) return false
    }
    return text.trim() === text
  }

  private buildKotlinNavigationExpression(node: Node): string {`,
  },
  {
    id: "K7",
    file: KT,
    what: "the indexing receiver publishes its identifier spine, not its text",
    find: `        if (recv && hasIndexing && !isWrite) emitUse(n, recv.text)`,
    replace: `        // M60 (#924, kotlin E half): the receiver's NAME, never its text — see
        // kotlinIdentifierPath. A receiver with no identifier on its spine keeps
        // its old spelling only when that spelling is itself name-shaped; an
        // expression-shaped target is exactly what this fix stops publishing.
        if (recv && hasIndexing && !isWrite) {
          const receiverPath = this.kotlinIdentifierPath(recv)
          if (receiverPath) emitUse(n, receiverPath)
          else if (this.kotlinNameShapedText(recv.text)) emitUse(n, recv.text)
        }`,
  },
  {
    id: "S1",
    file: SCALA,
    what: "stripScalaQuoting() helper",
    find: `function sigHasTypeVar(sig: string): boolean {`,
    replace: SCALA_STRIP,
  },
  {
    id: "S2",
    file: SCALA,
    what: "strip the name at scala's one symbol factory",
    find: `  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    extraMetadata: any = {},
  ): ASTEngine.UniversalSymbol {
    const decorators = this.collectAnnotations(node)`,
    replace: `  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    extraMetadata: any = {},
  ): ASTEngine.UniversalSymbol {
    // M60 (#924, scala half): quoting syntax is not part of a NAME — and this
    // factory is the one place every published scala name is built. id,
    // ownerName and every \`contains\` target are derived FROM this string, so
    // stripping here keeps the whole surface consistent; it cannot break
    // resolution, because the analysis resolves references against the SOURCE's
    // own spellings (a reference to a backticked name is itself backticked)
    // long before anything is published. Backticked CALLS need nothing here:
    // handleCall and the oracle both refuse a backticked callee in lockstep, so
    // no call target can carry the syntax.
    name = stripScalaQuoting(name)
    const decorators = this.collectAnnotations(node)`,
  },
  {
    id: "K1",
    file: KT,
    what: "stripKotlinQuoting() helper",
    find: `function kotlinSigHasTypeVar(sig: string): boolean {`,
    replace: STRIP_HELPER,
  },
  {
    id: "K2",
    file: KT,
    what: "canonicalizePublishedNames() at the publish boundary",
    find: `  private buildKotlinCallExpression(node: Node): string {`,
    replace: CANON_METHOD,
  },
  {
    id: "K3",
    file: KT,
    what: "call the canonicalization pass",
    find: `    // Rewrite import-reference sources from the placeholder "root" to the`,
    replace: `    // M60 (#924, kotlin half): the published name surface — quoting syntax is
    // not part of a name. Runs BEFORE exports and the import-source rewrite so
    // every published spelling is derived from the canonical one.
    this.canonicalizePublishedNames(symbols, relationships)

    // Rewrite import-reference sources from the placeholder "root" to the`,
  },
  {
    id: "K5",
    file: DIFF,
    what: "stripNameQuoting() helper in the oracle (shared by kotlin/scala/zig halves)",
    find: `export function deriveKotlinEdges(root: any): { label: string; from: string; target: string }[] {`,
    replace: `/**
 * M60 (#924): quoting syntax is not part of an identifier's NAME — a backticked
 * identifier is named by its CONTENT (kotlin/scala), exactly as the analyzer
 * strips it at its publish boundary (RealKotlinAnalyzer.stripKotlinQuoting,
 * and the swift half's stripNameQuoting). Every COMPLETE run is quoting, wherever
 * it sits in a qualified string; an unmatched backtick is not a run. The oracle
 * must publish the same spelling the analyzer does, or F5 reads the repair as a
 * mask instead of an agreement.
 */
function stripNameQuoting(text: string): string {
  if (!text.includes("\`")) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 96) {
      const close = text.indexOf("\`", i + 1)
      if (close === -1) {
        out += text.slice(i)
        break
      }
      out += text.slice(i + 1, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

export function deriveKotlinEdges(root: any): { label: string; from: string; target: string }[] {`,
  },
  {
    id: "K4",
    file: DIFF,
    what: "oracle parity: deriveKotlinEdges strips the same quoting",
    find: `export function deriveKotlinEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return`,
    replace: `export function deriveKotlinEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    // M60 (#924, kotlin half): quoting syntax is not part of the published name.
    // Mirrors RealKotlinAnalyzer.canonicalizePublishedNames; F5 compares this
    // oracle's leaf against the analyzer's, so both sides must strip together.
    target = stripNameQuoting(target)`,
    // ALSO-STATES: a state this transform itself produced. An earlier version of this very
    // edit merged the strip statement onto the TAIL OF A `//` LINE, where it is a comment —
    // dead code, shipped to the live tree, invisible to every instrument that reads the
    // analyzer (the census-surface probe does) and to the 12-file lane draws (none contained a
    // backticked callee). The 60-file draw found it as exactly ONE missing truth row:
    // `calls -> `in`` on Exposed exposed-r2dbc/.../BinaryTypeMapper.kt, where
    // `Parameters.`in`(...)` is a qualified call with a BACKTICKED selector — the analyzer had
    // begun publishing `in` while the oracle still derived the source spelling, so the repair
    // read as a mask. The anchor below corrects that state in place, because a fix that
    // requires reverting the tree it already touched is only half a fix.
    alsoStates: [
      {
        state: "dead-strip (the statement sits inside a // comment)",
        find: `    // oracle's leaf against the analyzer's, so both sides must strip together.      target = stripNameQuoting(target)`,
        replace: `    // oracle's leaf against the analyzer's, so both sides must strip together.\n    target = stripNameQuoting(target)`,
      },
    ],
  },

  // ------------------------------------------------------------------ E half, scala
  // Two mechanisms, both measured at live HEAD through the production entry on the
  // census's own files (probe --lang scala,elixir): the anonymous-class synthesis
  // (3 published rows) and `val A, B = Value` (2 rows). Both sides of the harness
  // read the SAME wrong node by child INDEX, so an analyzer-only repair would read as
  // a mask — the oracle moves in lockstep, exactly as the quoting half does.
  {
    id: "S1",
    file: SCALA,
    what: "scalaTypeHeadName() — the head TYPE NAME of a type node",
    find: `  private stripTypeArgs(s: string): string {`,
    replace: `  /**
   * M60 (#924, scala E): the HEAD TYPE NAME of a type node — never the node's source
   * text. \`new ScalaRandom[F](Applicative[F].pure(new JavaSecureRandom())) with
   * SecureRandom[F] {}\` is an instance_expression whose type is a compound_type: a
   * whole EXPRESSION (constructor arguments included) whose NAME is the head type
   * constructor. The generic_type path already collapsed to the head; this applies the
   * same collapse to every type shape, descending the head position (compound base →
   * applied constructor → generic type) and falling back to the old text behaviour only
   * when the shape is none of those. Measured: SecureRandomCompanionPlatform.scala:70,
   * node shape in script/m14/tmp/c924-scala-val-shape.ts.
   */
  private scalaTypeHeadName(typeNode: Node): string {
    let n: Node | null = typeNode
    for (let guard = 0; n && guard < 8; guard++) {
      if (n.type === "type_identifier") return n.text
      if (n.type === "compound_type") n = n.childForFieldName("base") ?? n.namedChild(0)
      else if (n.type === "applied_constructor_type") n = n.namedChild(0)
      else if (n.type === "generic_type") n = n.namedChild(0)
      else break
    }
    return this.stripTypeArgs(typeNode.text)
  }

  private stripTypeArgs(s: string): string {`,
  },
  {
    id: "S2",
    file: SCALA,
    what: "handleInstantiation publishes the head type name, not the type's source text",
    find: `    let typeName = typeNode.text
    if (typeNode.type === "generic_type") {
      typeName = this.extractSupertypes(typeNode)[0]?.name || typeNode.text
    }`,
    replace: `    // M60 (#924, scala E): the instantiated NAME is the head type — a compound_type's
    // text carries the constructor ARGUMENTS, which are syntax, not a name.
    let typeName = this.scalaTypeHeadName(typeNode)`,
  },
  {
    id: "S3",
    file: SCALA,
    what: "the synthetic anonymous-class name is canonical, never source text",
    find: `          const typeNode = node.namedChild(0)
          let superName = typeNode?.text ?? ""
          if (typeNode?.type === "generic_type") superName = typeNode.namedChild(0)?.text ?? superName
          superName = this.stripTypeArgs(superName)`,
    replace: `          const typeNode = node.namedChild(0)
          // M60 (#924, scala E): a SYNTHETIC name must be canonical — never source text.
          let superName = typeNode ? this.scalaTypeHeadName(typeNode) : ""
          superName = this.stripTypeArgs(superName)`,
  },
  {
    id: "S4",
    file: SCALA,
    what: "val A, B — one symbol per DECLARED name instead of the pattern list",
    find: `    const name = patternNode.text
    const kind = node.type === "val_definition" || node.type === "val_declaration"
      ? ASTEngine.SymbolKind.Constant
      : ASTEngine.SymbolKind.Variable
    const symbol = this.createSymbol(name, kind, node, parent, { type: node.type, isAbstract: node.type === "val_declaration" || node.type === "var_declaration" })
    symbols.push(symbol)

    if (this.isPublic(node) && !parent) {
      exports.push({
        name,
        kind: kind,
        range: symbol.range,
      })
    }`,
    replace: `    // M60 (#924, scala E): \`val A, B = Value\` declares TWO constants — the grammar
    // carries them as an \`identifiers\` node, and publishing its source text made
    // \`A, B\` one name that no reference can spell (measured: EnumerationTests.scala:3,
    // node shape in script/m14/tmp/c924-scala-val-shape.ts). Unlike the tuple_pattern
    // refused above (a run-time VALUE shape, S1.19), every child here IS a declared
    // name, so each is published as its own symbol over the definition's own range.
    const kind = node.type === "val_definition" || node.type === "val_declaration"
      ? ASTEngine.SymbolKind.Constant
      : ASTEngine.SymbolKind.Variable
    const declared: string[] = []
    if (patternNode.type === "identifiers") {
      for (let i = 0; i < patternNode.childCount; i++) {
        const child = patternNode.child(i)
        if (child && child.isNamed && child.type === "identifier") declared.push(child.text)
      }
    }
    if (declared.length === 0) declared.push(patternNode.text)
    for (const name of declared) {
      const symbol = this.createSymbol(name, kind, node, parent, { type: node.type, isAbstract: node.type === "val_declaration" || node.type === "var_declaration" })
      symbols.push(symbol)

      if (this.isPublic(node) && !parent) {
        exports.push({
          name,
          kind: kind,
          range: symbol.range,
        })
      }
    }`,
  },
  {
    id: "S5",
    file: DIFF,
    what: "oracle: scalaHeadTypeName() (mirrors RealScalaAnalyzer's helper)",
    find: `export function deriveScalaEdges(root: any): { label: string; from: string; target: string }[] {`,
    replace: `/**
 * M60 (#924, scala E): the head TYPE NAME of a scala type node — the same collapse the
 * generic_type path already performed, applied to every type shape by descending the head
 * position. Mirrors RealScalaAnalyzer.scalaTypeHeadName: this oracle publishes the
 * \`instantiates\` target the analyzer is compared against, and it synthesizes the
 * anonymous-class name, so both sides must name the same type.
 */
function scalaHeadTypeName(typeNode: any): string {
  let n: any = typeNode
  for (let guard = 0; n && guard < 8; guard++) {
    if (n.type === "type_identifier") return n.text
    if (n.type === "compound_type") n = (typeof n.childForFieldName === "function" ? n.childForFieldName("base") : null) ?? n.namedChild(0)
    else if (n.type === "applied_constructor_type") n = n.namedChild(0)
    else if (n.type === "generic_type") n = n.namedChild(0)
    else break
  }
  return String(typeNode.text).replace(/\\[[^\\[\\]]*\\]/g, "").replace(/<[^<>]*>/g, "").trim()
}

export function deriveScalaEdges(root: any): { label: string; from: string; target: string }[] {`,
  },
  {
    id: "S6",
    file: DIFF,
    what: "oracle (deriveScalaEdges): the instance_expression target is the head type name",
    find: `      // \`new X\` / \`new X(...)\` / \`new X[T](...)\` — mirror handleInstantiation:
      // generic supertypes collapse to the head, bracketed args stripped.
      const tn = n.namedChild(0)
      if (tn) {
        let name = tn.text
        if (tn.type === "generic_type" && tn.namedChildCount > 0) name = tn.namedChild(0).text`,
    replace: `      // \`new X\` / \`new X(...)\` / \`new X[T](...)\` — mirror handleInstantiation:
      // (#924: the type node's text carries the CONSTRUCTOR ARGUMENTS, so the head
      // type is read, not the text).
      const tn = n.namedChild(0)
      if (tn) {
        let name = scalaHeadTypeName(tn)`,
  },
  {
    id: "S6b",
    file: DIFF,
    what: "oracle (deriveTreeEdges): the scala instance_expression target is the head type name",
    find: `    if (t === "instance_expression") {
      const tn = n.namedChild(0)
      if (tn) {
        let name = tn.text
        if (tn.type === "generic_type" && tn.namedChildCount > 0) name = tn.namedChild(0).text
        // ScalaD-I (M37.21 #610, cats-effect SecureRandomCompanionPlatform):`,
    replace: `    if (t === "instance_expression") {
      const tn = n.namedChild(0)
      if (tn) {
        // M60 (#924, scala E): the head type NAME. The old read published the type
        // node's whole text and this comment recorded WHY that was tolerated
        // ("truth must normalize identically or the pair never matches") — the
        // normalization matched two sides spelling the same EXPRESSION.
        let name = scalaHeadTypeName(tn)`,
  },
  {
    id: "S7",
    file: DIFF,
    what: "oracle: the synthetic anonymous name is built from the head type name",
    find: `    let superName = tn.text
    if (tn.type === "generic_type" && tn.namedChildCount > 0) superName = tn.namedChild(0).text
    superName = superName.replace(/\\[[^\\[\\]]*\\]/g, "").replace(/<[^<>]*>/g, "").trim()`,
    replace: `    // M60 (#924, scala E): the synthetic name is built from the head type NAME.
    let superName = scalaHeadTypeName(tn)`,
  },

  // ------------------------------------------------------------------ E half, elixir
  // Two mechanisms (probe --lang elixir): a definition head split across lines by a
  // comment published the COMMENT as the function name, and the group form
  // \`import Module.Types.{Helpers, Descr}\` published an EXPRESSION as the module name.
  // Both are index/position reads that the oracle mirrors, so both move together.
  {
    id: "L1",
    file: ELIXIR,
    what: "binaryPart() — a binary_operator's parts read relative to its operator TOKEN",
    find: `  private processFunction(node: Node, defType: string, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {`,
    replace: `  /**
   * M60 (#924, elixir E): the parts of a binary_operator read RELATIVE TO ITS OPERATOR
   * TOKEN, never by absolute child index. A comment between a definition head and its
   * \`when\` guard is an extra node that lands at index 1, so \`child(1)\` published the
   * COMMENT as the function name (measured: list.ex:783; node shape in
   * script/m14/tmp/c924-elixir-head-shape.ts — [0]left call, [1] comment,
   * [2]operator \`when\`, [3]right guard).
   */
  private binaryPart(node: Node, part: "operator" | "left" | "right"): Node | null {
    let opIdx = -1
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && !c.isNamed) { opIdx = i; break }
    }
    if (opIdx === -1) return null
    if (part === "operator") return node.child(opIdx)
    // A COMMENT is not an operand. The measured shape of a comment-split head is
    // [left call][comment][operator when][right guard], so the nearest named child before
    // the operator IS the comment, and taking it as the head published the analyzer's
    // Unknown fallback — caught by the publication dump's --all, NOT by the census probe
    // (that file publishes the same name from its OTHER clauses, so the name was present
    // for the wrong reason). Trivia is skipped on both sides.
    const isTrivia = (c: Node) => c.type === "comment"
    if (part === "left") {
      for (let i = opIdx - 1; i >= 0; i--) {
        const c = node.child(i)
        if (c && c.isNamed && !isTrivia(c)) return c
      }
      return null
    }
    for (let i = opIdx + 1; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.isNamed && !isTrivia(c)) return c
    }
    return null
  }

  private processFunction(node: Node, defType: string, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {`,
  },
  {
    id: "L2",
    file: ELIXIR,
    what: "the when-guard head reads left/operator/right, never child(1)",
    find: `       if (sigNode.type === "binary_operator" && sigNode.childCount > 1 && sigNode.child(1)?.text === "when") {
          const guardExpr = sigNode.childCount > 2 ? sigNode.child(2) : null
          if (guardExpr) guardList.push(guardExpr.text)
          actualCall = sigNode.childCount > 0 ? sigNode.child(0) || undefined : undefined`,
    replace: `       // M60 (#924, elixir E): the operator and its operands come from binaryPart — a
       // comment between the head and its guard is why child(1) named the function
       // after a COMMENT.
       if (sigNode.type === "binary_operator" && this.binaryPart(sigNode, "operator")?.text === "when") {
          const guardExpr = this.binaryPart(sigNode, "right")
          if (guardExpr) guardList.push(guardExpr.text)
          actualCall = this.binaryPart(sigNode, "left") || undefined`,
  },
  {
    id: "L3",
    file: ELIXIR,
    what: "an operator head's name is the operator token, not whatever sits at index 1",
    find: `        } else if (actualCall.type === "binary_operator") {
            name = actualCall.childCount > 1 ? actualCall.child(1)?.text || "Unknown" : "Unknown"
            parameters.push({ name: actualCall.childCount > 0 ? actualCall.child(0)?.text || "left" : "left", type: "dynamic" })
            parameters.push({ name: actualCall.childCount > 2 ? actualCall.child(2)?.text || "right" : "right", type: "dynamic" })`,
    replace: `        } else if (actualCall.type === "binary_operator") {
            // M60 (#924, elixir E): FIELD-free, index-free reads (see binaryPart).
            name = this.binaryPart(actualCall, "operator")?.text || "Unknown"
            parameters.push({ name: this.binaryPart(actualCall, "left")?.text || "left", type: "dynamic" })
            parameters.push({ name: this.binaryPart(actualCall, "right")?.text || "right", type: "dynamic" })`,
  },
  {
    id: "L4",
    file: ELIXIR,
    what: "the group form is a dependency shape for EVERY directive, not alias only",
    find: `      let deps: { name: string; line: number }[] = [{ name: moduleName, line: argsNode.startPosition.row + 1 }]
      if (target === "alias") {`,
    replace: `      let deps: { name: string; line: number }[] = [{ name: moduleName, line: argsNode.startPosition.row + 1 }]
      // M60 (#924, elixir E): the group form is a DEPENDENCY shape, not an alias-only
      // one. \`import Module.Types.{Helpers, Descr}\` names two modules —
      // Module.Types.Helpers and Module.Types.Descr — while the brace group is an
      // EXPRESSION, and it was published verbatim as the reference target (measured:
      // module/types/pattern.ex:9). ELXD20 already ruled the shape for \`alias\` ("the
      // bare prefix alone is not a module and emits nothing"); this applies the same
      // rule to use/import/require. Alias REGISTRATION stays alias-only: a plain
      // \`import Foo.Bar\` does not create the local alias \`Bar\` in Elixir, so this edit
      // changes nothing but the published module NAMES.
      if (target !== "alias") {
          const groupDot = this.findChild(argsNode, (c) => c?.type === "dot" && !!this.findChild(c, (d) => d?.type === "tuple"))
          const groupTuple = groupDot ? this.findChild(groupDot, (c) => c?.type === "tuple") : undefined
          if (groupDot && groupTuple) {
            deps = []
            const rawPrefix = this.findChild(groupDot, (c) => c?.type === "alias")?.text
              ?? this.findChild(groupDot, (c) => c?.type === "identifier" && c.text === "__MODULE__")?.text ?? ""
            const prefix = this.resolveAlias(resolveSelf(rawPrefix), ctx)
            for (const kid of this.filterChildren(groupTuple, (c) => c?.type === "alias" || c?.type === "dot")) {
              const full = prefix ? \`\${prefix}.\${kid.text}\` : kid.text
              if (full) deps.push({ name: full, line: kid.startPosition.row + 1 })
            }
          }
      }
      if (target === "alias") {`,
  },
  {
    id: "L5",
    file: DIFF,
    what: "oracle: elixirBinaryPart() (mirrors RealElixirAnalyzer.binaryPart)",
    find: `export function deriveElixirEdges(root: any): { label: string; from: string; target: string }[] {`,
    replace: `/**
 * M60 (#924, elixir E): a binary_operator's parts read relative to its operator TOKEN,
 * never by absolute child index — the mirror of RealElixirAnalyzer.binaryPart. The oracle's
 * declName names the function the analyzer's declaration is compared against, so a comment
 * between the head and its \`when\` guard must not become a name on either side.
 */
function elixirBinaryPart(node: any, part: "operator" | "left" | "right"): any {
  let opIdx = -1
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && !c.isNamed) { opIdx = i; break }
  }
  if (opIdx === -1) return null
  if (part === "operator") return node.child(opIdx)
  // A COMMENT is not an operand (mirrors the analyzer's binaryPart, trivia skipped).
  const isTrivia = (c: any) => c.type === "comment"
  if (part === "left") {
    for (let i = opIdx - 1; i >= 0; i--) {
      const c = node.child(i)
      if (c && c.isNamed && !isTrivia(c)) return c
    }
    return null
  }
  for (let i = opIdx + 1; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && c.isNamed && !isTrivia(c)) return c
  }
  return null
}

export function deriveElixirEdges(root: any): { label: string; from: string; target: string }[] {`,
  },
  {
    id: "L6",
    file: DIFF,
    what: "oracle: the when-guard head mirror reads operator/left/right",
    find: `    if (sig.type === "binary_operator" && sig.childCount > 1 && sig.child(1)?.text === "when") {
      actual = sig.childCount > 0 ? sig.child(0) : undefined
    }`,
    replace: `    // M60 (#924, elixir E): the mirror of the analyzer's binaryPart reads — a comment
    // between the head and its \`when\` guard sits at index 1.
    if (sig.type === "binary_operator" && elixirBinaryPart(sig, "operator")?.text === "when") {
      actual = elixirBinaryPart(sig, "left") ?? undefined
    }`,
  },
  {
    id: "L7",
    file: DIFF,
    what: "oracle: an operator head's name is the operator token",
    find: `    if (actual.type === "binary_operator") return actual.childCount > 1 ? actual.child(1)?.text ?? "" : ""`,
    replace: `    if (actual.type === "binary_operator") return elixirBinaryPart(actual, "operator")?.text ?? ""`,
  },
  {
    id: "L8",
    file: DIFF,
    what: "oracle: the group form expands for every directive (mirrors L4)",
    find: `            let depModules: string[] = [moduleName]
            if (target === "alias") {`,
    replace: `            let depModules: string[] = [moduleName]
            // M60 (#924, elixir E): the mirror of the analyzer's group expansion — the
            // group form is a dependency shape for every directive, and its members are
            // the module NAMES.
            if (target !== "alias") {
              const groupDot = find(args, (c) => c.type === "dot" && !!find(c, (d) => d.type === "tuple"))
              const groupTuple = groupDot ? find(groupDot, (c) => c.type === "tuple") : undefined
              if (groupDot && groupTuple) {
                depModules = []
                const rawPrefix = find(groupDot, (c: any) => c.type === "alias")?.text
                  ?? find(groupDot, (c: any) => c.type === "identifier" && c.text === "__MODULE__")?.text ?? ""
                const prefix = resolveAliasO(resolveSelfO(rawPrefix))
                for (let i = 0; i < groupTuple.namedChildCount; i++) {
                  const kid = groupTuple.namedChild(i)
                  if (!kid || (kid.type !== "alias" && kid.type !== "dot")) continue
                  const full = prefix ? \`\${prefix}.\${kid.text}\` : kid.text
                  if (full) depModules.push(full)
                }
              }
            }
            if (target === "alias") {`,
  },
]

let applied = 0
const already: string[] = []
const problems: string[] = []

for (const e of EDITS) {
  const p = path.join(ROOT, e.file)
  if (!fs.existsSync(p)) {
    problems.push(`${e.id} ${e.file}: no such file`)
    continue
  }
  const src = fs.readFileSync(p, "utf8")
  const states: State[] = [
    ...(e.alsoStates ?? []).slice().reverse(),
    { find: e.find, replace: e.replace, state: "HEAD" },
  ]
  if (states.some((s) => src.includes(s.replace))) {
    already.push(`${e.id} ${e.what}`)
    continue
  }
  const hit = states.find((s) => src.includes(s.find))
  if (!hit) {
    problems.push(`${e.id} ${e.file}: anchor not found (${e.what})`)
    continue
  }
  const hits = src.split(hit.find).length - 1
  if (hits > 1) {
    problems.push(`${e.id} ${e.file}: anchor ambiguous (${hits} matches) — ${e.what}`)
    continue
  }
  const next = src.replace(hit.find, hit.replace)
  if (hit.state !== "HEAD") console.log(`  ${e.id}: repairing the ${hit.state} state`)
  // A SYNTAX GATE on every insert. This transform writes TypeScript source and one
  // of its own escapes once shipped a REAL newline inside a string literal
  // (text.includes("\n") — the template evaluated the escape), which Bun then
  // refused to parse: the analyzer file became unimportable and every probe
  // reported an empty analysis instead of an edit. Bun's own transpiler is the
  // cheapest parser in the building, so nothing lands without passing it.
  try {
    new Bun.Transpiler({ loader: "ts" }).transformSync(next)
  } catch (err) {
    problems.push(`${e.id} ${e.file}: SYNTAX — the edit would not parse (${(err as Error).message.slice(0, 160)})`)
    continue
  }
  if (!checkOnly) fs.writeFileSync(p, next)
  applied++
}

console.log(`target: ${ROOT}${checkOnly ? "  (check only)" : ""}`)
console.log(`  ${checkOnly ? "would apply" : "applied"}: ${applied}`)
for (const a of already) console.log(`  already: ${a}`)
for (const p of problems) console.log(`  PROBLEM: ${p}`)
if (problems.length > 0) process.exit(1)
