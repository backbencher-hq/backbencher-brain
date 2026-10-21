/**
 * C TRUTH ORACLE — the lane-owned derivations for the three C relationship labels the shared
 * differential did not derive. ALL-OUT-OF-ALL D4 requires BOTH halves: a label must be DERIVED by
 * an oracle AND ADMITTED to the lane's compared set, in the same commit. This module is the
 * lane-owned derivation half; `script/m14/differential.ts` (Lead-serialised) pushes these in its
 * `lang === "c"` block and admits the labels.
 *
 * WHY A LANE MODULE AND NOT THE SHARED FILE: `validation/m60/rel-type-coverage-baseline.json`
 * records the C lane's DERIVATION debt as
 *
 *   contains  emitted, compared against nothing
 *   exports   emitted, compared against nothing
 *   overrides admitted to the compared set but derived by NOTHING  (the differential's own G20
 *             "[label-dump] c: overrides truth=0 comparable=11 <-- COMPARED WITH NO TRUTH",
 *             exit 6)
 *
 * `calls`/`uses`/`references`/`imports` already have a C oracle (`deriveCCalls`) and
 * `instantiates` has `deriveCInstantiates` — both in the shared file. The three above did not, and
 * the lane's prior oracle for `exports`+`overrides` lived in a temporary audit path that is not at
 * HEAD (commit be024555c, `script/m14/tmp/c-audit/c-oracle.ts`; this module re-derives it against
 * the CURRENT analyzer rules and adds `contains`).
 *
 * THE STATED LIMITATION, because it is the kind of thing that must be written down: this is a
 * SECOND WALKER OVER THE SAME GRAMMAR. It convicts a disagreement between two independent
 * implementations of a rule; it cannot see a defect in the grammar, because both sides read the
 * same parse. `contains` is the one label with a genuinely independent reference — clang 14,
 * `validation/m14/fixtures/c/contains-vs-clang.ts`, measured 421/421 = 100.00% members agreed — and
 * that measurement is cited, not reproduced here.
 *
 * WHAT EACH ORACLE REFUSES (a superset oracle trades a fabrication for an unexplained edge, so each
 * rule states its refusals; if the analyzer and the oracle disagree about a refusal, the
 * disagreement is the finding):
 *
 *   contains   a member is published only from a struct/union body (`field_declaration`) or an enum
 *              body (`enumerator`), and only when the declarator chain yields a declared name. The
 *              member NAME is the target; the container is not part of the differential's match key
 *              (`label + normTarget(target)`), but it is carried so a hand-read can see it.
 *
 *   exports    the marker class is the analyzer's own convention list plus the file's OWN linkage
 *              markers (every definition of the macro opens with `extern`, none names `dllimport` —
 *              the #989 agreement rule). A marker on a declaration with an intervening BLOCK is
 *              refused (local declaration), an exported name that IS the marker is refused (recovery
 *              split), and a declaration with no declarator name is refused.
 *
 *   overrides  C has no inheritance; the relationship is REDEFINITION. Two shapes, both from the
 *              AST and both with their refusals measured in docs/analyzers/real-c-analyzer.md:
 *              (1) two function definitions of one name in DIFFERENT arms of one shared
 *              `#if`/`#ifdef` (C 6.9p5) — a pair with no shared conditional is REFUSED (parse
 *              damage or logically-exclusive conditions, C-D2); (2) a macro defined, `#undef`ed and
 *              redefined in source order (C 6.10.3p2) — no arm test needed. An unconditional second
 *              definition is a constraint violation and can never be a pair: shape 2 requires the
 *              `#undef`.
 *
 * No imports from the code under test: the rules are re-derived here (node types, field reads,
 * character scans over node text), so "the oracle agrees" cannot mean "the oracle shares the
 * analyzer's constant". The two convention lists (`EXPORT_MACROS`' five names) ARE transcribed,
 * because they are conventions of the codebases, not a rule of C; that transcription is what makes
 * a disagreement about a SIXTH name visible.
 */

export interface CTruthEdge {
  label: "contains" | "exports" | "overrides"
  from: string
  target: string
  /** 1-based line of the naming token (the later definition for `overrides`). */
  line?: number
}

/** The labels this module derives. The differential's C compared-set union must name all three. */
export const C_ORACLE_LABELS = ["contains", "exports", "overrides"] as const

// ── primitives (character scans, no regex: the module is held to the lane's own no-pattern rule) ──

function isIdentifierText(s: string): boolean {
  if (s.length === 0) return false
  const word = (c: string): boolean =>
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
  if (!word(s[0]) || (s[0] >= "0" && s[0] <= "9")) return false
  for (let i = 1; i < s.length; i++) if (!word(s[i])) return false
  return true
}

/** The first whitespace-delimited word of a text (the analyzer's `firstWordOf` equivalent). */
function firstWord(text: string): string {
  let i = 0
  const ws = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r"
  while (i < text.length && ws(text[i])) i++
  const s = i
  while (i < text.length && !ws(text[i])) i++
  return text.slice(s, i)
}

function anyNamedChild(node: any, type: string): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

function namedChildrenOf(node: any): any[] {
  const out: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/**
 * The identifier a declarator chain names, or null.
 *
 * Mirrors the analyzer's `getIdentifierFromDeclarator` at the level the oracle is allowed to
 * mirror: descend `declarator` fields; when a node has none, take the first NON-ERROR named child
 * (#990: `parenthesized_declarator` carries no `declarator` field and its ERROR child holds the
 * MACRO, not the member); an ERROR/MISSING subtree is never where a declared name is read from.
 */
function declaratorName(node: any): any {
  let cur = node
  for (let depth = 0; cur && depth < 14; depth++) {
    if (cur.type === "identifier" || cur.type === "field_identifier") return cur
    if (cur.type === "type_identifier" || cur.type === "primitive_type") return null
    if (cur.type === "macro_specifier" || cur.type === "macro_type_specifier") return null
    if (cur.type === "ERROR") return null
    const byField = cur.childForFieldName?.("declarator")
    if (byField) {
      cur = byField
      continue
    }
    // The #990 rule: skip ERROR/MISSING children when there is no declarator field.
    const kids = namedChildrenOf(cur)
    const clean = kids.find((k: any) => !k.isError && !k.isMissing)
    cur = clean ?? kids[0] ?? null
  }
  return null
}

/** `preprocConditionalsOf`'s contract: conditional start index -> arm index (0 = true region). */
function preprocConditionalsOf(node: any): Map<number, number> {
  const out = new Map<number, number>()
  let arm = 0
  let p = node.parent
  while (p) {
    if (p.type === "preproc_elif" || p.type === "preproc_else") {
      arm++
      p = p.parent
      continue
    }
    if (p.type === "preproc_if" || p.type === "preproc_ifdef") {
      out.set(p.startIndex, arm)
      arm = 0
    }
    p = p.parent
  }
  return out
}

function sharesConditionalWithDifferentArm(a: Map<number, number>, b: Map<number, number>): boolean {
  for (const [k, v] of a) {
    const w = b.get(k)
    if (w !== undefined && w !== v) return true
  }
  return false
}

const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "goto", "sizeof", "typedef", "struct", "union",
  "enum", "static", "extern", "inline", "register", "volatile", "const",
  "auto", "signed", "unsigned", "void", "char", "short", "int", "long",
  "float", "double", "_Bool", "_Complex", "_Imaginary", "restrict",
  "_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn",
  "_Static_assert", "_Thread_local",
])

/**
 * The five-name convention list the analyzer's `EXPORT_MACROS` holds, transcribed (see the header
 * for why transcription is the point). The PREFIX branch reads markers by CLASS instead, and the
 * class rule is re-derived from the file's own definitions in `deriveCExportTruth`.
 */
const EXPORT_MACROS = new Set(["EXPORT_SYMBOL", "EXPORT_SYMBOL_GPL", "CURL_EXTERN", "REDISMODULE_API", "GIT_EXTERN"])

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONTAINS — container → member names
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Names a field_declaration declares: one per declarator (a declaration may declare several). */
function memberNamesOfField(field: any, out: Array<{ name: string; line: number }>): void {
  for (const c of namedChildrenOf(field)) {
    if (!c) continue
    // The type operand is not a member name; a nested aggregate is walked by the main visitor.
    if (
      c.type === "primitive_type" || c.type === "type_identifier" || c.type === "sized_type_specifier" ||
      c.type === "struct_specifier" || c.type === "union_specifier" || c.type === "enum_specifier" ||
      c.type === "macro_type_specifier" || c.type === "macro_specifier" || c.type === "type_qualifier" ||
      c.type === "storage_class_specifier" || c.type === "attribute_specifier" || c.type === "attribute_declaration" ||
      c.type === "bitfield_clause" || c.type === "comment"
    ) continue
    const id = declaratorName(c)
    if (!id) continue
    const name = String(id.text ?? "").trim()
    if (!name || C_KEYWORDS.has(name)) continue
    out.push({ name, line: id.startPosition.row + 1 })
  }
}

/**
 * `enumeratorsInsideMacroInvocation`'s contract (#930), re-derived rather than imported: an X-macro
 * enumeration puts the invocation in the LIST and the grammar recovery parks its ARGUMENTS as
 * `enumerator` nodes. The analyzer refuses them; an oracle that does not is a strict SUPERSET and
 * manufactures a truth row no analyzer edge can cover (the workstream's superset trap).
 *
 * The state machine reads the list's RAW children, because the punctuation is anonymous: an ERROR
 * child carrying `)` closes the current invocation and one carrying `(` opens the next — a single
 * ERROR can do both (curl's separator is `ERROR(number_literal ")" "," identifier "(")`).
 */
function enumeratorsInsideMacroInvocation(list: any): Set<number> {
  const inside = new Set<number>()
  let inInvocation = false
  for (let i = 0; i < list.childCount; i++) {
    const c = list.child(i)
    if (!c) continue
    if (c.isError || c.type === "ERROR") {
      const text = String(c.text ?? "")
      if (text.indexOf(")") !== -1) inInvocation = false
      if (text.indexOf("(") !== -1) inInvocation = true
      continue
    }
    if (inInvocation && c.type === "enumerator") inside.add(c.startIndex)
  }
  return inside
}

export function deriveCContainsTruth(root: any): CTruthEdge[] {
  const edges: CTruthEdge[] = []
  const seen = new Set<string>()
  const pushMember = (owner: string, name: string, line: number): void => {
    const n = name.trim()
    if (!n || C_KEYWORDS.has(n)) return
    if (seen.has(n)) return
    seen.add(n)
    edges.push({ label: "contains", from: owner, target: n, line })
  }
  /** Fields inside a struct/union body, INCLUDING the ones a conditional wraps (#conditional arms). */
  const collectFields = (body: any, owner: string): void => {
    const walkBody = (node: any): void => {
      for (const child of namedChildrenOf(node)) {
        if (!child) continue
        if (child.type === "field_declaration") {
          const members: Array<{ name: string; line: number }> = []
          memberNamesOfField(child, members)
          for (const m of members) pushMember(owner, m.name, m.line)
          continue
        }
        // A conditional inside the body still declares members; the analyzer records them with
        // `isConditional` metadata rather than dropping them, so the same nodes are read here. The
        // recursion also covers a conditional nested inside another conditional — the shape that
        // cost this oracle two `contains` rows on sqlite (`#ifdef _WIN32 … #else pthread_t tid;` at
        // test/threadtest3.c:458 and `#if … u64 ino;` at src/os_unix.c:1294).
        if (
          child.type === "preproc_if" || child.type === "preproc_ifdef" ||
          child.type === "preproc_else" || child.type === "preproc_elif"
        ) {
          walkBody(child)
        }
        // A NESTED aggregate is walked by the main visitor under its own owner; do not descend.
      }
    }
    walkBody(body)
  }
  const collectEnumerators = (holder: any, owner: string): void => {
    const list = holder.type === "enum_specifier"
      ? (holder.childForFieldName?.("body") ?? anyNamedChild(holder, "enumerator_list"))
      : null
    if (!list) return
    const macroArgs = enumeratorsInsideMacroInvocation(list)
    const walkList = (node: any): void => {
      for (const en of namedChildrenOf(node)) {
        if (!en) continue
        if (en.type === "enumerator" && !macroArgs.has(en.startIndex)) {
          const id = en.childForFieldName?.("name") ?? namedChildrenOf(en)[0]
          const name = id ? String(id.text ?? "").trim() : ""
          if (name) pushMember(owner, name, (id?.startPosition?.row ?? en.startPosition.row) + 1)
          continue
        }
        if (
          en.type === "preproc_if" || en.type === "preproc_ifdef" ||
          en.type === "preproc_else" || en.type === "preproc_elif"
        ) walkList(en)
      }
    }
    walkList(list)
  }
  const visit = (n: any): void => {
    if (!n) return
    if (n.type === "struct_specifier" || n.type === "union_specifier") {
      const body = n.childForFieldName?.("body") ?? anyNamedChild(n, "field_declaration_list")
      if (body) {
        const nameNode = n.childForFieldName?.("name")
        const owner = nameNode ? String(nameNode.text ?? "").trim() : "(anonymous)"
        collectFields(body, owner)
      }
    } else if (n.type === "enum_specifier") {
      const nameNode = n.childForFieldName?.("name")
      const owner = nameNode ? String(nameNode.text ?? "").trim() : "(anonymous)"
      collectEnumerators(n, owner)
    }
    for (const c of namedChildrenOf(n)) visit(c)
  }
  visit(root)
  return edges
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// EXPORTS — the marker convention, in the two spellings the analyzer reads, plus its refusals
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The `#undef NAME` a preproc_call carries, or null (the directive token reads `#  undef`). */
function undefNameOf(call: any): string | null {
  const d = call.childForFieldName?.("directive")
  if (!d) return null
  let t = String(d.text ?? "")
  if (t.length === 0 || t[0] !== "#") return null
  t = t.slice(1)
  let i = 0
  while (i < t.length && (t[i] === " " || t[i] === "\t")) i++
  if (!t.startsWith("undef", i)) return null
  const arg = call.childForFieldName?.("argument")
  const a = arg ? String(arg.text ?? "").trim() : ""
  return isIdentifierText(a) ? a : null
}

/** `hasInterveningBlock`: an export belongs to the translation unit's interface, not a local scope. */
function hasInterveningBlock(node: any): boolean {
  let p = node.parent
  while (p) {
    if (p.type === "compound_statement") return true
    if (p.type === "translation_unit") return false
    p = p.parent
  }
  return false
}

/**
 * `hasExportAttributeSpelling` — THE c LANE's RULE, AND THE ONLY IMPLEMENTATION OF IT IN THIS FILE.
 *
 * The oracle's export-marker verdict reads the SOURCE TEXT it was handed (the production path
 * blanks the AST's value node) and reproduces the analyzer's own helpers, with the analyzer's source
 * line named. That implementation is kept below, verbatim, with its provenance.
 *
 * A SECOND, IDENTICAL-BEHAVIOUR implementation used to stand at this place — the same three
 * positive spellings and the same `visibility("hidden")` exclusion, written against the built-in
 * `String.includes` instead of the oracle's own `stringIncludes`/`stringIndexOf` helpers (which are
 * `indexOf` and `indexOf(...) !== -1`). It was a merge accident with ZERO behavioural difference,
 * and it made the file fail to compile (TS2393, duplicate implementation), so the fleet's
 * ZERO-type-error standard was broken. The duplicate is REMOVED, not the rule.
 */

/** Remove `/* … *​/` and `//` comments (a marker mentioned in a comment is not a marker). */
function stripComments(rawText: string): string {
  let text = ""
  for (let i = 0; i < rawText.length; i++) {
    const c = rawText[i]
    if (c === "/" && rawText[i + 1] === "*") {
      const end = rawText.indexOf("*/", i + 2)
      i = end < 0 ? rawText.length : end + 1
      continue
    }
    if (c === "/" && rawText[i + 1] === "/") {
      const end = rawText.indexOf("\n", i + 2)
      i = end < 0 ? rawText.length : end
      continue
    }
    text += c
  }
  return text
}

function collapseWs(text: string): string {
  let out = ""
  let pending = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const ws = ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v"
    if (ws) { pending = out.length > 0; continue }
    if (pending) { out += " "; pending = false }
    out += ch
  }
  return out
}

/**
 * `exportAttributeTextIn`: the attribute as WRITTEN, found in TEXT (the grammar models no node for
 * it in the guarded spelling). Balanced parentheses, not "to the first `)`".
 */
function exportAttributeTextIn(rawText: string): string {
  const text = stripComments(rawText)
  for (const kw of ["__declspec", "__attribute__"]) {
    const at = text.indexOf(kw)
    if (at < 0) continue
    let depth = 0
    let i = at + kw.length
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === "(") depth++
      else if (c === ")") {
        depth--
        if (depth === 0) { i++; break }
      }
    }
    const spelling = collapseWs(text.slice(at, Math.min(i, text.length)))
    if (hasExportAttributeSpelling(spelling)) return spelling
  }
  return ""
}

/** `attributeTextOutsideMacroDefinitions`: a `#define` LINE is a macro definition, not an attribute. */
function attributeTextOutsideMacroDefinitions(text: string): string {
  const lines = text.split("\n")
  const kept: string[] = []
  for (const line of lines) {
    let i = 0
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++
    let isDefine = false
    if (line[i] === "#") {
      i++
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i++
      isDefine = line.startsWith("define", i)
    }
    if (!isDefine) kept.push(line)
  }
  return kept.join("\n")
}

/** `ATTRIBUTE_NODES` — the four node types the C grammar gives an attribute (node-types.json). */
const ATTRIBUTE_NODES = new Set<string>(["attribute_specifier", "attribute_declaration", "ms_declspec_modifier", "ms_call_modifier"])
/** `PREPROC_ATTRIBUTE_GUARDS` — the four nodes the C grammar gives a conditional block. */
const PREPROC_ATTRIBUTE_GUARDS = new Set<string>(["preproc_ifdef", "preproc_if", "preproc_elif", "preproc_else"])

/** `isHashLineMention`: the naming token sits on a `#` line that recovery spliced into code. */
function isHashLineMention(idNode: any, content: string): boolean {
  if (!content) return false
  const bol = content.lastIndexOf("\n", idNode.startIndex - 1) + 1
  let i = bol
  while (i < idNode.startIndex && (content[i] === " " || content[i] === "\t")) i++
  return content[i] === "#"
}

/** `preprocGuardAttributeInText`: the ORIGINAL lines immediately above the declaration (#endif guard). */
function preprocGuardAttributeInText(decl: any, content: string): string {
  if (!content) return ""
  const lines = content.split("\n")
  let i = decl.startPosition.row - 1
  while (i >= 0 && lines[i] !== undefined && lines[i].trim() === "") i--
  if (i < 0 || lines[i] === undefined) return ""
  const endifLine = lines[i]
  {
    let k = 0
    while (k < endifLine.length && (endifLine[k] === " " || endifLine[k] === "\t")) k++
    if (endifLine[k] !== "#") return ""
    k++
    while (k < endifLine.length && (endifLine[k] === " " || endifLine[k] === "\t")) k++
    if (!endifLine.startsWith("endif", k)) return ""
  }
  const blockEnd = i
  let blockStart = -1
  for (let j = i - 1; j >= 0 && j >= i - 24; j--) {
    const line = lines[j]
    let k = 0
    while (k < line.length && (line[k] === " " || line[k] === "\t")) k++
    if (line[k] !== "#") continue
    k++
    while (k < line.length && (line[k] === " " || line[k] === "\t")) k++
    if (line.startsWith("if", k) || line.startsWith("ifdef", k) || line.startsWith("ifndef", k)) { blockStart = j; break }
  }
  if (blockStart < 0) return ""
  const guardText = attributeTextOutsideMacroDefinitions(lines.slice(blockStart, blockEnd + 1).join("\n"))
  return exportAttributeTextIn(guardText)
}

/** `findExportAttributeNode`: the attribute node INSIDE a guarding preproc block. */
function findExportAttributeNode(n: any, depth: number): any {
  if (depth > 4 || !n || n.type === "compound_statement") return null
  if (ATTRIBUTE_NODES.has(n.type) && hasExportAttributeSpelling(String(n.text ?? ""))) return n
  for (let i = 0; i < n.namedChildCount; i++) {
    const r = findExportAttributeNode(n.namedChild(i), depth + 1)
    if (r) return r
  }
  return null
}

/** `exportedDeclarationName`: the declared name a marker introduces, or null. */
function exportedDeclarationName(callNode: any): any {
  let decl: any = callNode && (callNode.type === "declaration" || callNode.type === "function_definition") ? callNode : null
  let cur = callNode
  for (let depth = 0; !decl && cur && depth < 6; depth++) {
    const up = cur.parent
    if (!up) break
    if (up.type === "declaration" || up.type === "function_definition") decl = up
    else if (up.type === "preproc_ifdef" || up.type === "preproc_if") return null
    cur = up
  }
  if (!decl) return null
  const declarator = decl.childForFieldName?.("declarator")
  if (!declarator) return null
  let n = declarator
  for (let depth = 0; n && depth < 12; depth++) {
    if (n.type === "identifier") return String(n.text ?? "").trim() ? n : null
    if (n.type === "type_identifier" || n.type === "primitive_type") return null
    if (n.type === "macro_specifier" || n.type === "macro_type_specifier") return null
    if (n.type === "ERROR") return null
    n = n.childForFieldName?.("declarator") ?? n.namedChild(0)
  }
  return null
}

/**
 * `precedingPreprocExportAttribute`: Form C, the marker inside the preproc block that IMMEDIATELY
 * precedes the declaration (comments allowed through — adjacency is the guard).
 */
function precedingPreprocExportAttribute(decl: any, content: string): string {
  let prev = decl.previousSibling
  while (prev && (prev.type === "comment" || prev.type === "preproc_call")) prev = prev.previousSibling
  if (prev && PREPROC_ATTRIBUTE_GUARDS.has(prev.type)) {
    const viaTree = findExportAttributeNode(prev, 0)
    if (viaTree) return collapseWs(String(viaTree.text ?? ""))
    const viaBlockText = exportAttributeTextIn(attributeTextOutsideMacroDefinitions(String(prev.text ?? "")))
    if (viaBlockText) return viaBlockText
  }
  return preprocGuardAttributeInText(decl, content)
}

/**
 * #989 (2026-10-21, the c lane's PROPOSAL — applied verbatim from `src/ast/real-c-analyzer.ts`):
 * the export-marker verdict, read from the SOURCE TEXT.
 *
 * The analyzer's rule is the rule of record, and the oracle must apply the SAME rule to stay an
 * oracle of the CURRENT analyzer. The oracle stays STANDALONE — it must not import the
 * implementation it checks — so the analyzer's helpers are reproduced here, with the source line
 * each came from named.
 */

/** `src/ast/real-c-analyzer.ts:29` — stringIncludes. */
function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

/** `src/ast/real-c-analyzer.ts:33` — stringIndexOf. */
function stringIndexOf(str: string, val: string): number {
  return str.indexOf(val)
}

/** `src/ast/real-c-analyzer.ts:147` — replacementListOf. */
function replacementListOf(defineText: string): string {
  const n = defineText.length
  let i = 0
  while (i < n && (defineText[i] === " " || defineText[i] === "\t")) i++
  if (defineText[i] !== "#") return ""
  i++
  while (i < n && (defineText[i] === " " || defineText[i] === "\t")) i++
  if (defineText.slice(i, i + 6) !== "define") return ""
  i += 6
  while (i < n && (defineText[i] === " " || defineText[i] === "\t")) i++
  // the macro NAME
  while (i < n) {
    const c = defineText[i]
    const ok = (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) break
    i++
  }
  // A FUNCTION-LIKE macro's parameter list, and only when the `(` touches the name.
  if (defineText[i] === "(") {
    let depth = 0
    while (i < n) {
      const c = defineText[i]
      if (c === "(") depth++
      else if (c === ")") {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
      i++
    }
  }
  return defineText.slice(i)
}

/** `src/ast/real-c-analyzer.ts:209` — replacementIsReadable. */
function replacementIsReadable(replacement: string): boolean {
  let run = 0
  for (let i = 0; i < replacement.length; i++) {
    if (replacement[i] === " ") {
      run++
      if (run >= 4) return false
    } else {
      run = 0
    }
  }
  return true
}

/** `src/ast/real-c-analyzer.ts:237` — hasExportAttributeSpelling. */
function hasExportAttributeSpelling(text: string): boolean {
  if (text.length === 0) return false
  if (stringIncludes(text, "dllexport")) return true
  if (stringIncludes(text, "export_name")) return true
  const at = stringIndexOf(text, "visibility")
  if (at >= 0 && stringIncludes(text.slice(at, at + 48), "default")) return true
  return false
}

/** `src/ast/real-c-analyzer.ts:455` — EXPORT_BOUNDARY_WORDS. */
const EXPORT_BOUNDARY_WORDS = ["EXTERN", "EXTERNAL", "EXPORT", "PUBLIC", "API", "VISIBLE", "DLLEXPORT", "DLLIMPORT"]

/** `src/ast/real-c-analyzer.ts:465` — isExportMarker. */
function isExportMarker(token: string): boolean {
  if (!token) return false
  let hasUpper = false
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") hasUpper = true
  }
  if (!hasUpper) return false
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    const ok = (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  let end = token.length
  while (end > 0 && token[end - 1] === "_") end--
  if (end === 0) return false
  let part = ""
  for (let i = 0; i <= end; i++) {
    const c = i < end ? token[i] : "_"
    if (c === "_") {
      if (EXPORT_BOUNDARY_WORDS.indexOf(part) !== -1) return true
      part = ""
      continue
    }
    part += c
  }
  for (let w = 0; w < EXPORT_BOUNDARY_WORDS.length; w++) {
    const word = EXPORT_BOUNDARY_WORDS[w]
    if (end < word.length) continue
    let match = true
    for (let i = 0; i < word.length; i++) if (token[end - word.length + i] !== word[i]) { match = false; break }
    if (match) return true
  }
  return false
}

export function deriveCExportTruth(root: any, content?: string): CTruthEdge[] {
  const edges: CTruthEdge[] = []
  const seen = new Set<string>()

  // ── pass 1: the file's OWN linkage markers (the #989 agreement rule over EVERY definition) ──
  // #989 (2026-10-21, the c lane's PROPOSAL): the verdict is read from the SOURCE TEXT, exactly as
  // the analyzer reads it. The AST's `value` node is NOT the source of truth — on the production
  // path `engine.ts` blanks the attribute spellings out of it — so a definition's replacement list
  // comes from the text the ORACLE was handed (`content`), and the analyzer's classification is
  // reproduced verbatim (`src/ast/real-c-analyzer.ts:2197-2234`).
  const verdicts = new Map<string, {
    defs: number
    boundary: boolean
    empty: boolean
    allExtern: boolean
    allAttribute: boolean
    nonBoundary: boolean
    unreadable: boolean
  }>()
  const preStack: any[] = [root]
  while (preStack.length > 0) {
    const n = preStack.pop()!
    if (n.type === "preproc_def" || n.type === "preproc_function_def") {
      const nm = declaredMacroNameNode(n)
      if (nm && String(nm.text ?? "").trim()) {
        const key = String(nm.text).trim()
        const defineText = typeof n.startIndex === "number" && typeof n.endIndex === "number"
          ? (content ?? "").slice(n.startIndex, n.endIndex)
          : ""
        const replacement = replacementListOf(defineText)
        const readable = replacementIsReadable(replacement)
        const trimmed = replacement.trim()
        const isEmpty = trimmed.length === 0
        const lead = firstWord(trimmed)
        const isExportAttribute = !isEmpty && hasExportAttributeSpelling(trimmed)
        const isImport = stringIncludes(trimmed, "dllimport")
        // A definition that states NOTHING (empty) or states an export boundary is "boundary"; one
        // that states anything else — `static`, `const`, a NEGATIVE attribute such as
        // `visibility("hidden")` — is "nonBoundary".
        const statesBoundary = !isEmpty && (isExportAttribute || lead === "extern")
        const statesNonBoundary = !isEmpty && !statesBoundary
        const v = verdicts.get(key) ?? {
          defs: 0,
          boundary: true,
          empty: true,
          allExtern: true,
          allAttribute: true,
          nonBoundary: false,
          unreadable: false,
        }
        v.defs++
        if (!readable) {
          v.unreadable = true
          v.boundary = false
          v.empty = false
          v.allExtern = false
          v.allAttribute = false
        } else {
          if (!statesBoundary) v.boundary = false
          if (!isEmpty) v.empty = false
          if (lead !== "extern") v.allExtern = false
          if (!isExportAttribute) v.allAttribute = false
          if (statesNonBoundary || isImport) v.nonBoundary = true
        }
        verdicts.set(key, v)
      }
    }
    for (const c of namedChildrenOf(n)) preStack.push(c)
  }
  // #989 (2026-10-21, the c lane's PROPOSAL): `isMarkerClass` becomes the analyzer's own
  // `exportMarkerVerdict` (`src/ast/real-c-analyzer.ts:4202-4214`) — the convention list first,
  // then the FILE's OWN definition, and the NAME only when the file states nothing.
  const isMarkerClass = (name: string): boolean => {
    if (!name) return false
    if (EXPORT_MACROS.has(name)) return true
    const v = verdicts.get(name)
    if (v) {
      if (v.unreadable || v.nonBoundary) return false
      if (v.boundary) return true
      // `empty`: the file states nothing, so the NAME decides.
    }
    return isExportMarker(name)
  }
  const text = content ?? ""

  const emit = (nameNode: any, marker: string): void => {
    const name = String(nameNode?.text ?? "").trim()
    if (!name || name === marker || C_KEYWORDS.has(name)) return
    if (isHashLineMention(nameNode, text)) return
    const key = `${name}|${marker}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ label: "exports", from: name, target: marker, line: nameNode.startPosition.row + 1 })
  }

  const visit = (n: any): void => {
    if (!n) return
    if (n.type === "declaration" || n.type === "function_definition") {
      // ── Form C (guarded preproc attribute), then Form A (attribute node in the heading) ──
      let markerText = precedingPreprocExportAttribute(n, text)
      if (!markerText) {
        const scanDepth = (m: any, depth: number): void => {
          if (markerText || depth > 3) return
          if (m.type === "compound_statement" || m.type === "preproc_ifdef" || m.type === "preproc_if") return
          if (ATTRIBUTE_NODES.has(m.type) && hasExportAttributeSpelling(String(m.text ?? ""))) {
            markerText = collapseWs(String(m.text ?? ""))
            return
          }
          for (const c of namedChildrenOf(m)) scanDepth(c, depth + 1)
        }
        scanDepth(n, 0)
      }
      if (markerText) {
        const id = exportedDeclarationName(n)
        if (id) emit(id, markerText)
      } else {
        // ── Form D: the marker prefix (userspace spelling, #963/#989) ──
        const first = namedChildrenOf(n)[0]
        let marker = ""
        if (first && (first.type === "identifier" || first.type === "field_identifier")) {
          marker = String(first.text ?? "").trim()
        } else if (first && (first.type === "macro_prefixed_type_specifier" || first.type === "macro_type_specifier")) {
          for (const c of namedChildrenOf(first)) {
            if (c && (c.type === "macro_specifier" || c.type === "identifier")) {
              marker = String(c.text ?? "").trim()
              break
            }
          }
        }
        if (marker && isMarkerClass(marker) && n.childForFieldName?.("declarator") && !hasInterveningBlock(n)) {
          const id = exportedDeclarationName(n)
          if (id) emit(id, marker)
        }
      }
    } else if (n.type === "call_expression") {
      // ── the KERNEL spelling: `EXPORT_SYMBOL(name, GPL);` — the name is the first argument,
      // unless the marker prefixes a declaration (the userspace call spelling). ──
      const callee = n.childForFieldName?.("function")
      let target = ""
      if (callee) {
        if (callee.type === "identifier") target = String(callee.text ?? "").trim()
        else if (callee.type === "field_expression") {
          const leaf = callee.childForFieldName?.("field") ?? namedChildrenOf(callee).slice(-1)[0]
          target = String(leaf?.text ?? "").trim()
        }
      }
      if (target && isMarkerClass(target)) {
        const declName = exportedDeclarationName(n)
        const arg = n.childForFieldName?.("arguments")?.namedChild(0)
        const nameNode = declName ?? (arg && String(arg.text ?? "").trim() ? arg : null)
        if (nameNode) emit(nameNode, target)
      }
    }
    for (const c of namedChildrenOf(n)) visit(c)
  }
  visit(root)
  return edges
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// OVERRIDES — redefinition, both shapes (#989)
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** `overridableDefinitionName`: the callable a function_definition declares, or null. */
function overridableDefinitionName(fn: any): any {
  const rawDecl = fn.childForFieldName?.("declarator")
  if (rawDecl) {
    let d: any = rawDecl
    while (d && d.type !== "function_declarator") d = d.childForFieldName?.("declarator")
    if (d) {
      const id = declaratorName(rawDecl)
      if (id) {
        const t = String(id.text ?? "").trim()
        if (t && !C_KEYWORDS.has(t)) return id
      }
    }
  }
  // The macro-wrapped TYPED heading (#917/#918 shape): the name is the second argument of the
  // macro call in the `type` slot and the parameter list is the declarator.
  const typed = macroWrappedTypedHeadingShape(fn)
  if (typed) {
    const t = String(typed.nameNode?.text ?? "").trim()
    if (t && !C_KEYWORDS.has(t)) return typed.nameNode
  }
  return null
}

/**
 * The `MACRO(ret_type, name)(params) { ... }` shape: the `type` field is a macro call whose SECOND
 * argument is the declared name, and the declarator field is the parameter list.
 */
function macroWrappedTypedHeadingShape(fn: any): { nameNode: any } | null {
  const typeNode = fn.childForFieldName?.("type")
  if (!typeNode || typeNode.type !== "call_expression") return null
  const args = anyNamedChild(typeNode, "argument_list")
  if (!args) return null
  const kids = namedChildrenOf(args)
  if (kids.length < 2) return null
  const nameNode = kids[1]
  if (!nameNode || !(nameNode.type === "identifier" || nameNode.type === "field_identifier")) return null
  return { nameNode }
}

/** `declaredMacroNameNode`'s contract: no name read through an ERROR/MISSING sibling before it. */
function declaredMacroNameNode(node: any): any {
  const nm = node.childForFieldName?.("name")
  if (!nm) return null
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c) continue
    if (c.id === nm.id) return nm
    if (c.isError || c.isMissing) return null
  }
  return nm
}

export function deriveCOverridesTruth(root: any): CTruthEdge[] {
  const edges: CTruthEdge[] = []
  const seen = new Set<string>()

  // ── pass 1: function definitions, grouped by declared name, in source order ──
  const fnDefs: any[] = []
  const macroOrder: Array<{ idx: number; name: string; row: number; undef: boolean }> = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "function_definition") fnDefs.push(n)
    else if (n.type === "preproc_def" || n.type === "preproc_function_def") {
      const nm = declaredMacroNameNode(n)
      if (nm && String(nm.text ?? "").trim()) {
        macroOrder.push({ idx: n.startIndex, name: String(nm.text).trim(), row: n.startPosition.row + 1, undef: false })
      }
    } else if (n.type === "preproc_call") {
      const u = undefNameOf(n)
      if (u) macroOrder.push({ idx: n.startIndex, name: u, row: n.startPosition.row + 1, undef: true })
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  const byName = new Map<string, Array<{ id: any; node: any }>>()
  for (const node of fnDefs) {
    const id = overridableDefinitionName(node)
    if (!id) continue
    const name = String(id.text ?? "").trim()
    const arr = byName.get(name)
    if (arr) arr.push({ id, node })
    else byName.set(name, [{ id, node }])
  }
  for (const [name, defs] of byName) {
    if (defs.length < 2) continue
    for (let i = 1; i < defs.length; i++) {
      const arms = preprocConditionalsOf(defs[i - 1].node)
      if (!sharesConditionalWithDifferentArm(arms, preprocConditionalsOf(defs[i].node))) continue
      const key = `${name}|${defs[i].id.startPosition.row + 1}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ label: "overrides", from: name, target: name, line: defs[i].id.startPosition.row + 1 })
    }
  }

  // ── pass 2: `#undef X` then `#define X` in source order (no arm test: the sequence is the fact) ──
  macroOrder.sort((a, b) => a.idx - b.idx)
  const undefed = new Set<string>()
  const lastDef = new Map<string, number>()
  for (const m of macroOrder) {
    if (m.undef) {
      undefed.add(m.name)
      continue
    }
    const prior = lastDef.get(m.name)
    if (prior !== undefined && undefed.has(m.name)) {
      const key = `${m.name}|${m.row}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push({ label: "overrides", from: m.name, target: m.name, line: m.row })
      }
    }
    lastDef.set(m.name, m.row)
    undefed.delete(m.name)
  }
  return edges
}

/** One entry point for a differential block that wants all three labels at once. */
export function deriveCExtraTruth(root: any, content?: string): CTruthEdge[] {
  return [...deriveCContainsTruth(root), ...deriveCExportTruth(root, content), ...deriveCOverridesTruth(root)]
}
