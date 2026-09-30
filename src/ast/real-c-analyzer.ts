function inArray(arr: any[], val: any): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === val) return true
  }
  return false
}

function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

// Strip `<`, `>`, and `"` characters from an include-path node text
// (`<stddef.h>` → `stddef.h`, `"CoreApi.h"` → `CoreApi.h`). Pure-String
// scan — replaces the legacy `/[<>"']/g` regex used by getIncludePath and
// extractInclude.
/**
 * #916: an ALL-CAPS identifier — the shape a bare macro has and a declarator
 * almost never does. Mirrors the cpp analyzer's `isAllCapsName`, and is used to
 * decide whether a truncated declaration's last child is a MACRO (so the real
 * declarator must be read from the sibling) or a genuine declarator (left
 * alone).
 */
function isAllCapsIdentifier(text: string): boolean {
  let hasUpper = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch >= "a" && ch <= "z") return false
    if (ch >= "A" && ch <= "Z") hasUpper = true
  }
  return hasUpper
}

function stripIncludeChars(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== "<" && c !== ">" && c !== '"' && c !== "'") out += c
  }
  return out
}

/**
 * #928: is this text a NAME FRAGMENT that a C lexer split off a JNI-mangled
 * identifier -- one that starts at a digit and carries only word characters?
 *
 * This replaces the regex `/^[0-9][0-9A-Za-z_]*$/`, which was a SYNTAX test on an
 * ERROR node's text: "classify this blob as a name fragment". The C lexer cannot
 * start an identifier with a digit, so `…, jstring, 1value_1text16)` splits into
 * an ERROR holding the leading digits and an identifier holding the rest
 * (measured: sqlite3-jni.c's S3JniApi family, every mangled name) -- and reading
 * only the identifier would drop the `1` and name the definition
 * `value_1text16`, a symbol no reader can resolve. The join is gated on
 * ADJACENCY and on the ERROR being nothing but the fragment, so it can only mend
 * a name the lexer itself split.
 *
 * A character test, not a regex literal, for the same reason the include-path
 * strip is one: this file's policy is that string logic does not arrive as a
 * regex (the M49 regex census's standing rule), and a lexical classification is
 * string logic. Measured behaviour is identical on the corpus -- the same two
 * sites the regex gated, the same accept/reject decisions.
 */
function isDigitLedNameFragment(text: string): boolean {
  if (text.length === 0) return false
  const first = text[0]
  if (first < "0" || first > "9") return false
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]
    const ok =
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_"
    if (!ok) return false
  }
  return true
}

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// Pre-allocated lookup arrays — avoids per-node allocation overhead
const MALLOC_FUNCTIONS = ["malloc", "calloc", "realloc", "kmalloc", "vmalloc"]
const FREE_FUNCTIONS = ["free", "kfree", "vfree"]
const UNSAFE_STRINGS = ["strcpy", "sprintf", "gets"]
const SAFE_STRINGS = ["strncpy", "snprintf"]
const EXPORT_MACROS = ["EXPORT_SYMBOL", "EXPORT_SYMBOL_GPL"]
const FORMAT_FUNCTIONS = ["printf", "fprintf", "sprintf", "snprintf", "scanf", "fscanf", "sscanf", "syslog", "dprintf"]
const DANGEROUS_FUNCTIONS = ["system", "popen", "execve", "execvp", "execl", "execlp"]
const SIGNAL_FUNCTIONS = ["signal", "sigaction", "sigprocmask", "sigemptyset", "sigfillset", "sigaddset", "sigdelset", "sigwait", "sigpending", "sigsuspend"]
const ASM_KEYWORDS = ["__asm__", "__asm", "asm", "__volatile__"]
const COMPLEXITY_NODES = ["if_statement", "for_statement", "while_statement", "do_statement", "case_statement", "conditional_expression"]
// CGD9 (M37 #601 dead-code sweep): DECLARATION_NODES, STRUCT_TYPE_NODES,
// DECLARATOR_NODES, TYPE_NODES were declared and never referenced anywhere —
// disconnected constants that suggested coverage that did not exist. Removed.

enum ScopeKind {
  Global = "global",
  Function = "function",
  Block = "block",
  Struct = "struct",
  Union = "union",
}

interface ScopeEntry {
  kind: ScopeKind
  name: string
  node: Node
}

// CGD22 (M37 #601): a C keyword can NEVER be a declared name. ERROR recovery
// glues `else if(...)` fragments into pseudo function_definition shapes whose
// "declarator" is the keyword itself (resolve.c: three `function "if"`
// symbols fabricated from #ifdef-glued else-if chains, each seeding a bogus
// `uses` edge). Names are filtered at the extraction dispatch.
const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "goto", "sizeof", "typedef", "struct", "union",
  "enum", "static", "extern", "inline", "register", "volatile", "const",
  "auto", "signed", "unsigned", "void", "char", "short", "int", "long",
  "float", "double", "_Bool", "_Complex", "_Imaginary", "restrict",
  "_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn",
  "_Static_assert", "_Thread_local",
])

// ---------------------------------------------------------------------------
// #917 SHARED SHAPE RULE (analyzer + F5 oracle)
//
// The vendored C families define functions through an export macro that stands
// where the declaration specifier belongs and makes the whole heading
// CALL-shaped:
//
//   CMPP__EXPORT(int, cmpp_stream)( cmpp_input_f inF, … ){ … }
//   JniDeclFtsXA(jobject,xUserData)(JniArgsEnvObj,jobject jFcx){ … }
//   S3JniApi(sqlite3_value_text16(),jstring,1value_1text16)(…){ … }
//
// The published grammar reads that as `MACRO(ret, name)` CALLED with `(params)`,
// so the body is left as an orphan `compound_statement` — a direct child of the
// translation_unit, or of the ERROR / `preproc_ifdef` that swallowed the region.
// The shape is evidence, not a heuristic: at file scope (and inside a preproc
// block) an `expression_statement` followed by a `compound_statement` is not
// valid C — only recovery produces it.
//
// These two predicates are MODULE-SCOPE and exported because the oracle must
// apply the SAME rule (`script/m14/differential.ts` imports them): the analyzer
// suppresses the heading's naming occurrence as a definition, and truth has to
// suppress the same occurrence or every wrapped definition whose name is also
// declared elsewhere surfaces as a `uses` edge the analyzer correctly refuses
// (measured: 68 rows on the 315-file sqlite c lane). One rule, never two copies.
// ---------------------------------------------------------------------------

/** Does `node` (or a child) hold the argument list of a call-shaped heading? */
function childOfType(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type === type) return child
  }
  return null
}

/**
 * The text of an argument list's FIRST comma-separated argument, scanned over
 * the list's own text with paren/bracket depth so `(sqlite3_value_text16(),
 * jstring, …)` yields the call and `(void *, name)` yields `void *`.
 * Returns null when the list holds a single argument (nothing to split on).
 */
function firstArgumentText(argListNode: Node): string | null {
  const text = argListNode.text
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "(" || ch === "[") depth++
    else if (ch === ")" || ch === "]") depth--
    else if (ch === "," && depth === 1) {
      const first = text.slice(1, i).trim()
      return first || null
    }
  }
  return null
}

// #912 (M60-C): the words a C DECLARATION may put in front of a declarator —
// storage classes, type qualifiers and type keywords. Used as the specifier
// evidence for the CALL-shaped declarator arrival (`static block gen_last_1(
// void) {`), where the damaged region's own tail has to prove that what
// follows it is a declaration and not a macro invocation.
//
// RESERVED WORDS ONLY, deliberately, and it is MEASURED rather than cautious: a
// typedef alias would also be spelled like a specifier, but an identifier that
// merely LOOKS like a type can be a macro name — and a macro NAME is exactly
// what this class otherwise hands back. Gating the arrival on the looser #907
// header test instead (any identifier token since the previous `;`, `{` or `}`,
// which is what admits the bare-identifier arrival) admits **33 macro DEFINITIONS
// in sqlite** — `#define osCloseHandle ((BOOL(WINAPI*)(HANDLE))aSyscall[1].pCurrent)`,
// whose replacement text reads as a call and whose next table entry supplies the
// `{`, while the directive's own `#define osCloseHandle` supplies the "type"
// token. That run published `osCloseHandle`, `osCreateFileMappingW`,
// `osLoadLibraryW` … as functions (+33 symbols, +4 resolved `uses` edges) —
// fabrications, not recoveries. A keyword cannot be a macro name in valid C, so
// keyword-only is the fabrication-resistant spelling of this evidence; with it,
// sqlite's 357 files are byte-identical before and after.
const C_SPECIFIER_KEYWORDS = new Set([
  "static", "extern", "auto", "register", "typedef", "inline",
  "_Noreturn", "_Thread_local", "const", "volatile", "restrict", "_Atomic",
  "void", "char", "short", "int", "long", "float", "double", "signed",
  "unsigned", "_Bool", "_Complex", "struct", "union", "enum",
])

/**
 * #912 (M60-C): the declaration-specifier run the damaged region keeps in front
 * of a CALL-shaped declarator (the CALL node itself), or null when there is
 * none.
 *
 * Shape (`jq/src/builtin.c:2067`, where the macro-driven initializer list
 * swallowed the table's own `};`):
 *
 *   ERROR { `}` `;` #undef… `identifier:static` `identifier:block`
 *           (call_expression `gen_last_1(void)`) }  `<body> {…}`
 *
 * Walks the call's siblings BACKWARD and collects the contiguous run of bare
 * `identifier` tokens directly before it (comments skipped). The run ends at
 * the first sibling of any other type — `;`, `{`, `}`, `(`, a call, a
 * directive — and at an identifier that is the OPERAND of a preprocessor
 * directive (`#undef LIBM_DA` lives as a SIBLING of the directive token):
 * directive text is not declaration material. The run is capped at three
 * tokens, the longest specifier sequence the measured shapes use.
 *
 * The run must hold at least one RESERVED declaration word
 * (`C_SPECIFIER_KEYWORDS`) — see that constant for the measured reason a looser
 * evidence test fabricates macro names instead of recovering functions.
 *
 * A second candidate for this gate was measured and refused: the #907 header
 * test (`declarationHeaderPresent`), which the bare-identifier arrival uses. On
 * the two C corpora it agrees with this predicate on every site of the class it
 * was compared over and disagrees on a class the comparison could not see — the
 * `#define` replacement texts above, 33 of them in sqlite — so it is strictly
 * the wrong evidence here, and this predicate is not a duplication of it but a
 * different question: "does the DAMAGED REGION ITSELF carry declaration words
 * for this name", not "is there any identifier since the last terminator".
 */
export function declarationSpecifierRunBefore(call: Node): Node[] | null {
  // The caller passes the CALL-shaped declarator itself, never its callee: the
  // callee's siblings live INSIDE the call (its own argument list), so the
  // specifier run can only be read from the call's position in the damaged
  // region (measured — reading from the callee returns null at the very site
  // this rule exists for, because the callee is the call's first child).
  const run: Node[] = []
  let s: Node | null = call.previousSibling
  while (s && run.length < 3) {
    if (s.type === "comment") {
      s = s.previousSibling
      continue
    }
    if (s.type !== "identifier") break
    if (s.previousSibling?.type === "preproc_directive") break
    run.push(s)
    s = s.previousSibling
  }
  if (run.length === 0) return null
  for (const id of run) {
    if (C_SPECIFIER_KEYWORDS.has(id.text.trim())) return run
  }
  return null
}

/**
 * Strips `/* … *\/` and `//` comments, replacing each with a space so tokens on
 * either side stay separated.
 */
function stripComments(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      if (end === -1) {
        out += text.slice(i)
        break
      }
      out += " "
      i = end + 2
      continue
    }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i)
      out += " "
      if (nl === -1) break
      i = nl
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Does the text carry an identifier-shaped token at all — any ASCII letter or
 * underscore (the `[A-Za-z_]\w*` test's exact meaning: the `\w*` tail may be
 * empty, so one such character is the whole condition).
 */
function hasIdentifierToken(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") return true
  }
  return false
}

/**
 * #907/#912 (M60-C): is there a declaration header — a return type and/or
 * storage class — between the previous statement terminator and this name?
 * The evidence is a single identifier token in the window since the last `;`,
 * `{` or `}` (comments stripped, whitespace does not count).
 *
 * This is the ONE rule that decides whether a name recovery left behind is a
 * DEFINITION rather than a mere CALL. Its three measured positive cases are
 * `void yyerror(`, `decNumber * decNumberNormalize(`, and `static block
 * gen_last_1(` — and the case it exists to refuse is a macro invocation with a
 * block (`FOREACH(item) {`), which has nothing but the macro's own name in the
 * header.
 *
 * Exported because the oracle imports it (`script/m14/differential.ts`, the
 * #916 contract: one rule, never two copies). The analyzer's two arrivals for a
 * recovery-glued header — the BARE identifier and the CALL-shaped declarator
 * (`static block gen_last_1(void) {`, jq src/builtin.c:2067) — are admitted on
 * exactly this evidence and nothing else, so the mirror must apply exactly this
 * test or the two sides drift into a MISSING edge.
 */
export function declarationHeaderPresent(content: string, nameStart: number): boolean {
  const from = Math.max(0, nameStart - 400)
  const window = content.slice(from, nameStart)
  let cut = -1
  for (const ch of [";", "{", "}"]) {
    const at = window.lastIndexOf(ch)
    if (at > cut) cut = at
  }
  return hasIdentifierToken(stripComments(window.slice(cut + 1)))
}

/**
 * #917: is this `expression_statement` a macro-wrapped function heading, and
 * what does it declare? Returns the declared NAME, its RETURN TYPE text, the
 * naming NODE (the occurrence the analyzer treats as a definition), the macro
 * argument list (where the return type is read from) and the heading's own
 * parameter `argument_list`.
 *
 * The declared NAME is the macro's LAST identifier argument (both spellings in
 * the corpora put it there: `(ret, name)` and `(existing_fn(), type, name)`) and
 * the RETURN TYPE is the text of the macro's first argument — read from the
 * argument list's own structure plus one comma scan, never from the source line.
 */
export function macroWrappedHeadingShape(header: Node): {
  name: string
  returnType: string
  nameNode: Node
  macroArgs: Node
  macroNameText: string
  outerArgs: Node | null
} | null {
  if (!header || header.type !== "expression_statement") return null
  const outer = header.namedChildCount > 0 ? header.namedChild(0) : null
  if (!outer || outer.type !== "call_expression") return null
  const macro = outer.childForFieldName("function") || (outer.namedChildCount > 0 ? outer.namedChild(0) : null)
  if (!macro || macro.type !== "call_expression") return null
  const macroName = macro.childForFieldName("function") || (macro.namedChildCount > 0 ? macro.namedChild(0) : null)
  if (!macroName || macroName.type !== "identifier" || !macroName.text.trim()) return null
  const macroArgs = macro.childForFieldName("arguments") || childOfType(macro, "argument_list")
  if (!macroArgs) return null

  const args = ((macroArgs as any).namedChildren ?? []).filter((c: Node | null): c is Node => !!c) as Node[]
  const argIdentifiers = args.filter((c) => c.type === "identifier" && c.text.trim() !== "")
  // `(ret, name)` needs a SEPARATOR: without a top-level comma in the macro's
  // argument list there is no way to tell which argument names the function,
  // so the shape is refused rather than guessed. The comma — not an
  // identifier count — is the right evidence, because a pointer return type
  // (`(char const *, cmpp_rc_cstr)`) puts its type words in a
  // `binary_expression` and leaves a single identifier standing.
  const returnType = firstArgumentText(macroArgs)
  if (!returnType || argIdentifiers.length < 1) return null
  const lastIdentIdx = (() => {
    for (let i = args.length - 1; i >= 0; i--) {
      if (args[i].type === "identifier" && args[i].text.trim() !== "") return i
    }
    return -1
  })()
  if (lastIdentIdx < 0) return null
  // The C lexer cannot START an identifier with a digit, so a JNI-mangled
  // argument (`…, jstring, 1value_1text16)`) splits into an ERROR holding the
  // leading digits and the identifier holding the rest — adjacent, in that
  // order (measured: sqlite3-jni.c's S3JniApi family, every mangled name).
  // Reading only the identifier would drop the `1` and name the definition
  // `value_1text16`, a symbol no reader can resolve. The join is gated on
  // ADJACENCY and on the ERROR being nothing but digits, so it can only mend
  // a name the lexer itself split.
  let name = args[lastIdentIdx].text.trim()
  const beforeName = lastIdentIdx > 0 ? args[lastIdentIdx - 1] : null
  if (
    beforeName &&
    beforeName.isError &&
    // A NAME FRAGMENT, not junk: the split always starts at the digit, and
    // the lexer can hand back one or two name characters with it
    // (`1` + `value_1text16`, `1b` + `ackup_1finish`).
    isDigitLedNameFragment(beforeName.text) &&
    beforeName.endIndex === args[lastIdentIdx].startIndex
  ) {
    name = beforeName.text + name
  }
  if (!name || name === macroName.text.trim() || C_KEYWORDS.has(name)) return null

  const outerArgs = outer.childForFieldName("arguments") || childOfType(outer, "argument_list")
  return {
    name,
    returnType,
    nameNode: args[lastIdentIdx],
    macroArgs,
    macroNameText: macroName.text.trim(),
    outerArgs,
  }
}

/**
 * #918: the POINTER-RETURN spelling of a macro-wrapped heading.
 *
 * `#917` recovers `MACRO(ret, name)(params){ body }` when the grammar leaves
 * the BODY as an orphan `compound_statement`. When the return type is a
 * POINTER the same heading parses differently — the grammar accepts the
 * heading as a `function_definition` (or, where recovery swallows the region,
 * a `declaration`) whose `type` field is a `macro_type_specifier` holding BOTH
 * macro arguments:
 *
 *   (function_definition
 *     type: (macro_type_specifier name: (identifier)               // CMPP__EXPORT
 *              (ERROR (type_descriptor … declarator: (abstract_pointer_declarator)))
 *              type: (type_descriptor type: (type_identifier)))   // the NAME
 *     declarator: (parenthesized_declarator …)                     // the PARAM LIST
 *     body: (compound_statement …))
 *
 * Measured on `ext/wasm/libcmpp.c`, all six pointer spellings (`char const *`,
 * `void *`, `cmpp_b *`): the declarator is the PARAMETER list, so the
 * analyzer's declarator route (`function_declarator`) finds nothing. The
 * definition was never a symbol and its body never a Function scope; five of
 * the six names existed only as the `#define`d macro constant from the file's
 * thunk block.
 *
 * The POINTER is required, not assumed: `abstract_pointer_declarator` inside
 * the macro's first argument is the parse's own evidence for this spelling, and
 * it is what keeps the value-return headings (the `#917` class, whose body is
 * orphaned instead) out of this rule.
 *
 * The declared NAME is the macro's LAST argument, read structurally: the
 * `macro_type_specifier`'s last named child is a `type_descriptor` whose `type`
 * field is the `type_identifier` that names the function. Never a source-line
 * scan: the return type and the name are the two `type_descriptor`s the parse
 * itself separated.
 */
export function macroWrappedTypedHeadingShape(node: Node): {
  name: string
  returnType: string
  nameNode: Node
  paramGroups: Node[][]
  macroNameText: string
  body: Node | null
  braced: boolean
} | null {
  if (!node) return null
  if (node.type !== "function_definition" && node.type !== "declaration") return null
  const typeField = node.childForFieldName("type")
  if (!typeField || typeField.type !== "macro_type_specifier") return null
  const macroNameNode = typeField.childForFieldName("name")
  if (!macroNameNode || macroNameNode.type !== "identifier" || !macroNameNode.text.trim()) return null

  const mtsKids = ((typeField as any).namedChildren ?? []).filter((c: Node | null): c is Node => !!c) as Node[]
  const retErr = mtsKids.find((c) => c.isError)
  if (!retErr) return null
  const retDesc = (((retErr as any).namedChildren ?? []) as Node[]).find((c) => c?.type === "type_descriptor") ?? null
  // THE POINTER — the discriminator this whole rule rests on.
  if (!retDesc || retDesc.childForFieldName("declarator")?.type !== "abstract_pointer_declarator") return null
  const returnType = retDesc.text.trim()
  if (!returnType) return null

  // The NAME slot: the LAST named child of the specifier, and it must FOLLOW
  // the return-type ERROR — the parse's own ordering evidence, so a shape whose
  // name would have to be guessed is refused instead.
  const nameSlot = mtsKids[mtsKids.length - 1]
  if (!nameSlot || nameSlot.type !== "type_descriptor" || nameSlot.startIndex <= retErr.endIndex) return null
  const nameIdent = nameSlot.childForFieldName("type")
  if (!nameIdent || !inArray(["type_identifier", "identifier"], nameIdent.type)) return null
  const name = nameIdent.text.trim()
  if (!name || name === macroNameNode.text.trim() || C_KEYWORDS.has(name)) return null

  const decl = node.childForFieldName("declarator")
  if (!decl || decl.type !== "parenthesized_declarator") return null
  const paramGroups = splitParamGroups(decl)
  if (!paramGroups || paramGroups.length === 0) return null

  const body = node.childForFieldName("body")
  if (body && body.type === "compound_statement") {
    return { name, returnType, nameNode: nameIdent, paramGroups, macroNameText: macroNameNode.text.trim(), body, braced: true }
  }
  // The DECLARATION spelling: recovery cut the heading after the first
  // parameter and left the rest of the parameter list plus the body's opening
  // in an ERROR child. Only the measured shape is accepted — the ERROR's named
  // children are ALL identifiers (the remaining type word(s) and the parameter
  // name), and the declaration ends at a lone `}` the ERROR could not hold.
  // Anything else is refused: this rule never invents an end.
  if (node.type !== "declaration") return null
  const kids = ((node as any).namedChildren ?? []).filter((c: Node | null): c is Node => !!c) as Node[]
  const pdIdx = kids.findIndex((c) => c.startIndex === decl.startIndex && c.endIndex === decl.endIndex)
  const tail = pdIdx >= 0 ? kids[pdIdx + 1] : null
  if (!tail || !tail.isError) return null
  const tailKids = (((tail as any).namedChildren ?? []) as Node[]).filter((c) => !!c)
  if (tailKids.length === 0 || !tailKids.every((c) => c.type === "identifier" && c.text.trim() !== "")) return null
  // The region's closing brace, straight after the declaration — the parse's
  // own end evidence (measured: `declaration … ; }`). No brace, no end: the
  // shape is refused rather than given an invented span.
  if (node.nextSibling?.type !== "}") return null
  return { name, returnType, nameNode: nameIdent, paramGroups: [...paramGroups, tailKids], macroNameText: macroNameNode.text.trim(), body: null, braced: true }
}

/**
 * #918: the parameter groups of a degraded parameter list, split on the list's
 * own top-level `,` TOKENS (nested parens live inside child nodes, so every
 * top-level comma is a direct child). Returns null when the list carries
 * anything other than the measured shapes — the caller refuses rather than
 * guessing. An empty group is dropped; a `...` group is kept as a node so the
 * variadic evidence survives.
 */
function splitParamGroups(list: Node): Node[][] | null {
  const groups: Node[][] = []
  let cur: Node[] = []
  for (let i = 0; i < list.childCount; i++) {
    const c = list.child(i)
    if (!c) continue
    // A MISSING token is only ever the list's own mended `)` (measured: the
    // declaration spelling cuts at `(void * p` and mends the paren). Anywhere
    // else a MISSING token means the list is a shape this rule has not
    // measured — refused, never guessed.
    if (c.isMissing) {
      if (i === list.childCount - 1) continue
      return null
    }
    if (c.type === ",") {
      if (cur.length) groups.push(cur)
      cur = []
      continue
    }
    if (c.isNamed) cur.push(c)
  }
  if (cur.length) groups.push(cur)
  return groups
}

/**
 * #918: the RIGHTMOST identifier of a degraded parameter group in SOURCE
 * order, skipping C keywords (a type word such as `const` or `int` is never
 * the declared name, and the rightmost survivor is the declarator).
 */
function lastNonKeywordIdentifierIn(group: Node[]): Node | null {
  let found: Node | null = null
  const st: Node[] = [...group].reverse()
  while (st.length > 0) {
    const n = st.pop()!
    const text = n.text.trim()
    if (n.type === "identifier" && text && !C_KEYWORDS.has(text)) found = n
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const ch = n.namedChild(i)
      if (ch) st.push(ch)
    }
  }
  return found
}

/**
 * The body of a wrapped heading — the sibling right after it. The call-shaped
 * reading can leave a mended `;` (MISSING, taken by the heading itself) or a
 * lone `;` token between the two, so both are stepped over; anything else
 * between the heading and the candidate body means the shape is not this one
 * and the heading is refused.
 */
export function wrappedBodyAfter(header: Node): Node | null {
  let next: Node | null = header.nextSibling
  for (let i = 0; next && i < 2 && (next.isMissing || next.type === ";"); i++) {
    next = next.nextSibling
  }
  return next && next.type === "compound_statement" ? next : null
}

/**
 * #928: is this `field_declaration` a member the analyzer can NAME?
 *
 * A vendored C family declares fields through a macro:
 *
 *   #define BIT(x) int x : 1
 *   struct flags { int a; BIT(closing); BIT(keepalive); int b; };
 *
 * tree-sitter-c does not expand macros (C-D2: the preprocessor is textual), so
 * the parse is unambiguous about what it CAN and CANNOT offer:
 *
 *   field_declaration
 *     macro_type_specifier      <- the ONLY named child
 *       identifier              <- the macro's own name
 *       "(" type_descriptor ")" <- its arguments
 *     ";"
 *
 * There is no declarator in that declaration at all. The old extractor walked
 * the field's children, landed on the `macro_type_specifier`, and descended to
 * its first named child -- the macro's own name -- and published THAT as the
 * member. Measured: `curl/lib/cf-h2-proxy.c` emitted `cf_h2_proxy_ctx.BIT` five
 * times and `tunnel_stream.BIT` three times, three more owners in the same
 * directory, and the struct's `memorySize` was computed from a field that does
 * not exist.
 *
 * The real member name (`closing`) is NOT recoverable: whether the macro's
 * parameter lands in name position is a property of the macro's REPLACEMENT list,
 * which is C-D2's ruled-out territory. So the honest result is silence, and the
 * loss is a declared limitation rather than a name borrowed from the macro that
 * stands in for the declaration.
 *
 * The test is the shape itself -- a named declarator is present or it is not --
 * so it cannot fire on a real member: `int a;` carries a `field_identifier`,
 * `unsigned x : 1;` carries a `field_identifier` plus a `bitfield_clause`, and
 * `void (*cb)(int);` carries a `function_declarator`. `#define RESERVED int`
 * used as a statement already produced no member (a bare `type_identifier` and
 * no declarator), and still does not.
 */
function fieldDeclarationHasDeclarator(field: Node): boolean {
  for (let i = 0; i < field.namedChildCount; i++) {
    const c = field.namedChild(i)
    if (!c) continue
    const t: string = c.type
    if (
      t === "field_identifier" ||
      t === "identifier" ||
      t === "pointer_declarator" ||
      t === "array_declarator" ||
      t === "function_declarator" ||
      t === "parenthesized_declarator" ||
      t === "attributed_declarator"
    ) {
      return true
    }
  }
  return false
}

/**
 * #928: the declarator a macro-truncated declaration's re-parsed sibling carries.
 *
 * The sibling is an `expression_statement`, and the two shapes the #916 recovery
 * accepts are both structural:
 *
 *   NAME = value;    assignment_expression { left: identifier NAME, operator "=" }
 *                    -> a VARIABLE's declarator, truncated away and re-parsed
 *   NAME(args);      call_expression { function: identifier NAME, argument_list }
 *                    -> a PROTOTYPE's declarator, truncated away and re-parsed
 *
 * Anything else is refused, which is what keeps a call or an initializer inside
 * an ordinary body from being read as a file-scope declaration. The refusals
 * were measured against the text-parsing rule this replaces (see
 * script/m14/tmp/c-audit/truncation-shape.ts for the ten-shape parity table), so
 * this is a re-expression of the same decision, not a new one.
 */
function truncatedSiblingDeclarator(stmt: Node): { name: string; callable: boolean } | null {
  if (!stmt || stmt.type !== "expression_statement") return null
  const inner = stmt.namedChildCount > 0 ? stmt.namedChild(0) : null
  if (!inner) return null
  if (inner.type === "call_expression") {
    const fn = inner.childForFieldName("function")
    if (fn && fn.type === "identifier" && fn.text.trim()) {
      return { name: fn.text.trim(), callable: true }
    }
    return null
  }
  if (inner.type === "assignment_expression") {
    // Exactly `=`: a compound assignment is a statement, not a declaration.
    const op = inner.childForFieldName("operator")
    const opText = op ? (op.text ?? op.type) : ""
    if (opText !== "=") return null
    const left = inner.childForFieldName("left")
    if (left && left.type === "identifier" && left.text.trim()) {
      return { name: left.text.trim(), callable: false }
    }
    return null
  }
  return null
}


/**
 * #930: the `enumerator`s in this list that are the ARGUMENTS of a macro
 * invocation, not enumerators.
 *
 * curl declares its option table through a macro that stands where an enumerator
 * belongs:
 *
 *   #define CURLOPT(id, type, num) CURLOPT_##id = num
 *   typedef enum {
 *     CURLOPT(CURLOPT_WRITEDATA, CURLOPTTYPE_CBPOINT, 1),
 *     PLAIN_MEMBER = 3,
 *   } CURLoption;
 *
 * The grammar cannot keep the invocation together, so the list comes back as
 * ERROR fragments carrying the macro's punctuation with bare
 * `enumerator(identifier)` fragments BETWEEN them -- one per argument:
 *
 *   enumerator_list { ERROR(identifier "(") enumerator enumerator
 *                     ERROR(number_literal ")" "," identifier "(") enumerator ... }
 *
 * and every one of those fragments was published as a member. Measured on the
 * corpus: `CURLOPTTYPE_CBPOINT` twenty-one times under `CURLoption` in
 * curl/include/curl/curl.h, `CURLOPT_WRITEDATA` beside it, a `contains` edge onto
 * each, and the visible corpus consequence of 41 duplicate member names in curl,
 * 41 in libgit2 and 19 in redis.
 *
 * The rule is POSITIONAL, not "this list is damaged". A damaged list still holds
 * real enumerators -- `PLAIN_MEMBER` above sits BETWEEN two invocations, and
 * `REAL_AFTER` in the fixture FOLLOWS one -- and a blunt rejection would delete
 * them. So the list's children are walked in order, an ERROR carrying an opening
 * paren enters the invocation, an ERROR carrying a closing paren leaves it, and
 * the enumerators in between are refused.
 *
 * It cannot fire on a well-formed list: that has no ERROR children at all, so the
 * invocation state is never entered. And where it DOES fire the situation is
 * genuinely ambiguous -- an enumerator between an ERROR's parens cannot be told
 * from an argument -- so silence is the honest reading (C-D2). The real
 * enumerator name is derivable only after token pasting, which is C-D2's ruled-out
 * territory.
 *
 * The text read here is the ERROR NODE's own text, the same
 * source-text-on-a-recovery-node practice the #907/#912 glue rules already use, and
 * the test is a pure-String character scan rather than a pattern.
 */
function enumeratorsInsideMacroInvocation(list: Node): Set<number> {
  const inside = new Set<number>()
  let inInvocation = false
  for (let i = 0; i < list.childCount; i++) {
    const c = list.child(i)
    if (!c) continue
    if (c.isError || c.type === "ERROR") {
      // A single ERROR can BOTH close one invocation and open the next: curl's
      // list is punctuated by `ERROR(number_literal ")" "," identifier "(")`,
      // which is the separator BETWEEN two invocations. Testing `)` first and
      // then `(` unconditionally is what makes the second invocation's arguments
      // get refused too -- an earlier draft used `else if`, so a closing ERROR
      // that also opened the next one left the state closed and published that
      // invocation's arguments as members.
      const text = c.text
      if (text.indexOf(")") !== -1) inInvocation = false
      if (text.indexOf("(") !== -1) inInvocation = true
      continue
    }
    if (inInvocation && c.type === "enumerator") inside.add(c.startIndex)
  }
  return inside
}

/**
 * #932: is this `field_declaration` a damaged one whose NAME SLOT holds a type
 * rather than a declarator?
 *
 * jemalloc writes a bare macro token in field position:
 *
 *   struct tsd_s {
 *   #define O(n, t, nt)  t TSD_MANGLE(n);
 *     TSD_DATA_SLOW
 *     tsd_state_t state;
 *     TSD_DATA_FAST
 *   };
 *
 * The grammar promotes the bare identifier to a `type_identifier` where a type
 * belongs, and the parse comes out as:
 *
 *   field_declaration { type_identifier(TSD_DATA_SLOW) field_identifier(tsd_state_t) ";" MISSING }
 *   field_declaration { type_identifier(state) ";" }
 *
 * so the extractor published `tsd_state_t` -- a TYPE -- as a member of `tsd_s`,
 * a symbol a reader can navigate to that resolves to nothing. Measured: 1
 * occurrence over the 2,498-file curl+libgit2+redis corpus
 * (redis/deps/jemalloc/.../tsd.h:255).
 *
 * Both conditions are required, and the pair is what makes it sound:
 *   - a MISSING `;` -- well-formed C never produces one, and a member may
 *     LEGITIMATELY share a spelling with a type declared in the same file
 *     (`struct S { struct T T; };` is legal C: the declarator is an ordinary
 *     identifier, the tag is in its own namespace). The MISSING token is what
 *     separates the two, and the corpus found that case: C-D12's ruling is why
 *     the tag/ordinary split is load-bearing rather than pedantic.
 *   - the name slot's text is a name the file declares as a TYPE, so a genuine
 *     field whose name happens to be an identifier-shaped word cannot be caught
 *     by shape alone.
 *
 * What this rule does is SUPPRESS, not mend. The real member (`state`) is one
 * token away in the NEXT declaration's type slot, and recovering it is left
 * unfixed on purpose: a two-token mend whose generality I have not measured
 * would be exactly the kind of fabrication recovery risks. The consequence is
 * therefore a NAMED LOSS (`state` is not a symbol) rather than a phantom, which
 * is the trade the family's contract prefers -- "a missing edge is a defect, a
 * DECLARATION is not an edge" reads the other way here, so both are recorded:
 * a phantom member is a symbol that exists and is wrong, which is worse.
 */
function fieldDeclarationNamesANonDeclarator(
  field: Node,
  declaredTypeNames: Set<string>,
  allMacroNames: Set<string>,
): boolean {
  let missingSemicolon = false
  for (let i = 0; i < field.childCount; i++) {
    const c = field.child(i)
    if (c && c.isMissing && c.type === ";") missingSemicolon = true
  }
  for (let i = 0; i < field.namedChildCount; i++) {
    const c = field.namedChild(i)
    if (!c) continue
    if (c.type === "field_identifier" || c.type === "identifier") {
      const name = c.text.trim()
      if (!missingSemicolon) return false
      // #933, the merged shape. jemalloc writes two macro tokens where a field
      // belongs and the grammar merges them into ONE damaged declaration:
      //
      //   field_declaration { type_identifier(TSD_DATA_FAST) field_identifier(TSD_DATA_SLOWER) ";" MISSING }
      //
      // where `TSD_DATA_SLOW`/`FAST`/`SLOWER` are all FUNCTION-like macros whose
      // replacement lists hold the real declaration. Neither token is a member, so
      // the analyzer published `property TSD_DATA_SLOWER` at tsd.h:257.
      //
      // The MISSING `;` is required for the macro half too, and it is what makes
      // the rule sound for FUNCTION-like macros: `#define min(a, b) ...` followed
      // by `int min;` is legal C, because no `(` follows the name and the
      // preprocessor leaves it alone -- redis's `double min, max;` is exactly
      // that. A well-formed declaration never carries a MISSING token, so the
      // token separates the legal case from the damaged one.
      if (allMacroNames.has(name)) return true
      // A TYPE name in the declarator slot, same MISSING-token requirement,
      // because `struct S { struct T T; };` is legal C too: the declarator is an
      // ordinary identifier while the tag lives in its own namespace.
      if (declaredTypeNames.has(name)) return true
    }
  }
  return false
}
class CScopeManager {
  private stack: ScopeEntry[] = []

  constructor() {
    this.pushScope(ScopeKind.Global, "global", null as any)
  }

  /**
   * #961: the enclosing function's NAME, or null at file scope.
   *
   * This is what makes a function-local TYPE publishable without ambiguity. CGD20
   * dropped these types entirely, so the question of naming them never arose; once
   * they are published it has to be answered, and the measurement says the bare name
   * does not work: across the three corpora, 3 of 20 function-local type names
   * collide with a FILE-SCOPE type of the same name (`transfer`
   * curl/lib/vssh/libssh2.c:3465, `entry` curl/tests/libtest/lib1915.c:35,
   * `clar_counter` libgit2/deps/clar/clar/counter.h:86). Publishing `entry` twice in
   * one file produces two symbols with one name and makes every `contains` edge
   * from either of them ambiguous.
   *
   * Qualifying by the enclosing function resolves all three, and each step of the
   * resulting path is a real symbol -- the function is a symbol, the type is a
   * symbol -- so a `contains` edge anchored on it is resolvable rather than dangling.
   * This is NOT the block-scope naming the contract forbids (`core_init.block_211`
   * names no symbol); the block is still not used, and the function that encloses it
   * is.
   */
  enclosingFunctionName(): string | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Function) return this.stack[i].name
    }
    return null
  }

  // CGD20 (M37 #601): does the current scope chain sit inside a FUNCTION
  // body? CGD20 used this to DROP function-local type definitions as "execution
  // artifacts"; #961 withdrew that reading (a struct definition emits no code) and
  // this predicate now only distinguishes a local type from a file-scope one, so
  // that the local can be published under a qualified name.
  //
  // Function-local VARIABLES remain unpublished, which is the part of C-D1 that was
  // always right: `int counter = 0;` names no entity.
  isInsideFunction(): boolean {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Function) return true
    }
    return false
  }

  pushScope(kind: ScopeKind, name: string, node: Node): void {
    this.stack.push({ kind, name, node })
  }

  popScope(): ScopeEntry | undefined {
    if (this.stack.length > 1) {
      return this.stack.pop()
    }
    return undefined
  }

  currentScope(): ScopeEntry {
    return this.stack[this.stack.length - 1]
  }

  getScopeName(): string {
    const parts = []
    for (let i = 1; i < this.stack.length; i++) {
      parts.push(this.stack[i].name)
    }
    return parts.length > 0 ? parts.join(".") : "global"
  }

  getCurrentFunctionName(): string | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Function) return this.stack[i].name
    }
    return null
  }

  // Relationship source identity: the enclosing FUNCTION name, not the block
  // scope (`core_init.block_211` would be a dangling identity that never
  // resolves to a symbol). Top-level (file-scope) relationships use "global".
  getRelationshipSource(): string {
    const fn = this.getCurrentFunctionName()
    return fn || "global"
  }
}

export class RealCAnalyzer implements ASTEngine.LanguageAnalyzer {
  /**
   * #937: per-file typedef tables, rebuilt at the top of every `analyze` call.
   * Instance state rather than parameters because the layout maths is reached
   * from four call sites and threading a seventh argument through two recursive
   * functions to carry a per-file lookup would obscure the recursion that #927
   * already had to reason about. They are ASSIGNED, never accumulated, so a
   * second file on the same analyzer cannot see the first file's aliases.
   */
  private primitiveAliases: Map<string, string> = new Map()
  /** `typedef A B;` -> `A`, for chains, including non-primitive targets. */
  private aliasTargets: Map<string, string> = new Map()
  /** #939: same-file `#define` replacement text, and same-file enum values. */
  private macroValueTexts: Map<string, string> = new Map()
  private enumConstantValues: Map<string, number> = new Map()

  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // 1. ISOLATED STATE (Thread-Safe)
    // HC5 (deepest review): the CGD19 per-ERROR-span memo is instance state
    // keyed by span startIndex — WITHOUT this clear, a reused instance
    // (differential lanes, F4 runs, batch indexing) reuses file A's verdict
    // for file B's same-offset ERROR span and silently drops B's legitimate
    // declarations (probe: file-A glue@0/14 suppresses file-B clean@24).
    // Fresh instances (engine per-file path) were never affected.
    this.cgd19HeaderIdx.clear()
    // #907 round 2: same per-file hygiene for the recovered-definition name
    // offsets — a reused instance must not carry file A's name offsets into
    // file B's identifier dispatch.
    this.gluedDefNameOffsets.clear()
    // #917: same hygiene for the recovered macro-wrapped definition names.
    this.macroWrappedFunctionNames.clear()
    this.macroWrappedHeaders.clear()
    // CGD40 (M49 W17): the line-anchor gate needs the raw file text — a
    // directive line spliced into code by parse recovery is physically a
    // '#' line even with no surviving preproc_* ancestor.
    this.analyzeContent = content
    // #929: drop the previous file's line index (the HC5 hygiene rule, applied to
    // the one piece of per-file state this wave added).
    this.lineIndex = null
    this.lineIndexContent = ""
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const scopeManager = new CScopeManager()
    const emittedUseRelationships = new Set<string>()
    // #962: one `instantiates` edge per (function, type) pair, beside the `uses` set
    // for the same per-pair-not-per-line reason.
    const emittedInstantiates = new Set<string>()
    const functionLocals = new Map<string, Set<string>>()
    // #383 payload: call targets per enclosing function
    const qcByFunction = new Map<string, string[]>()

    // #937: same-file `typedef <primitive> <alias>;` and plain `typedef A B;`
    // chains, both rebuilt per file so nothing leaks between analyses.
    this.primitiveAliases = this.buildPrimitiveAliases(rootNode)
    this.aliasTargets = this.buildAliasTargets(rootNode)

    const structs: Record<string, any[]> = {}
    const globalVars: Record<string, boolean> = {}
    const unions: Record<string, any[]> = {}
    const enums: Record<string, boolean> = {}
    const patterns: Record<string, boolean> = {}

    // Pre-pass: collect every type DECLARATION name in the file (struct/union/
    // enum names and typedef aliases). Type-identifier resolution is then
    // order-independent — `typedef struct Point Point;` before `struct Point
    // { ... }` still resolves, while a never-defined forward declaration
    // (`struct ForwardOnly;`) emits no dangling use edge.
    const declaredTypes = new Set<string>()
    /**
     * #953: every function name DECLARED in this file -- a definition or a
     * prototype. Needed because a C name can be both a macro and a function in one
     * translation unit, and the two must be told apart before a call edge is
     * suppressed: `#define FOO(x) bar(x)` beside a real `void FOO(int)` means an
     * invocation of `FOO` is a macro use, while `#define MIN(a,b)` in a file that
     * also defines its own `MIN` function means it is a call. Suppressing on the
     * macro name alone would delete real call edges.
     *
     * Collected in the same pre-pass as `declaredTypes` and for the same measured
     * reason: a separate walk cost real time on files like `vdbe.c` (3.6 s/file
     * measured, per the note above).
     */
    const declaredFunctionNames = new Set<string>()
    {
      // CGD20-mirror (PERF, measured): function-local type declarations are
      // execution artifacts (C-D1) — they must not enter declaredTypes, else
      // a `references` edge fires for a type whose SYMBOL was correctly
      // suppressed (measured: test_backup.c backupTestCmd ->
      // BackupSubCommandEnum dangled after the CGD20 symbol fix). The
      // in-function state is carried IN THE STACK (per-node parent walks
      // crossed the WASM boundary millions of times: vdbe.c 3.6s/file →
      // differential timeout).
      const preStack: { n: Node; inFn: boolean }[] = [{ n: rootNode, inFn: false }]
      while (preStack.length > 0) {
        const { n, inFn } = preStack.pop()!
        const nextInFn = inFn || n.type === "function_definition"
        if (!inFn) {
        if (n.type === "struct_specifier" || n.type === "union_specifier") {
          if (n.childForFieldName("body")) {
            const nm = n.childForFieldName("name")
            if (nm && nm.text.trim()) declaredTypes.add(nm.text)
          }
        } else if (n.type === "enum_specifier") {
          const nm = n.childForFieldName("name")
          if (nm && nm.text.trim()) declaredTypes.add(nm.text)
        } else if (n.type === "type_definition") {
          const identNode = this.getIdentifierFromDeclarator(n.childForFieldName("declarator"))
          if (identNode && identNode.text.trim()) declaredTypes.add(identNode.text)
        } else if (n.type === "function_definition" || n.type === "declaration") {
          // `function_declaration` was in this list too, and F1 rejected it: the node
          // type does not exist in this grammar. A prototype parses as
          // `declaration` with a `function_declarator` inside it, which is already
          // covered, so the literal could never match. That is the second time this
          // wave's own grammar-audit run caught a dead node-type literal I had
          // written from memory of a different grammar -- the first was
          // `attributed_type_specifier` -- and the response is the same both times:
          // delete it rather than waive it.
          const d = n.childForFieldName("declarator")
          const fn = d ? this.getIdentifierFromDeclarator(d) : null
          if (fn && fn.text.trim() && (fn.type === "identifier" || fn.type === "field_identifier")) {
            declaredFunctionNames.add(fn.text.trim())
          }
        }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) preStack.push({ n: c, inFn: nextInFn })
        }
      }
    }

    // CGD26 (M37 #601): file-scope DECLARED-NAME pre-pass — order
    // independence for file-scope value names (globals, functions,
    // prototypes, enum members, macros). Mirrors the oracle's declaredNames:
    // a static initializer table (`{ DupStringInternalRep, ... }`, jimsh0.c)
    // or a callback reference walks BEFORE the later function/typedef symbol
    // exists, so symbol-based resolution silently dropped the edge. Uses of
    // names in this set resolve order-independently; the symbol walk still
    // provides scoped/shadowed resolution and kind/visibility payloads.
    // NOTE (M60, #908): a first attempt at the jq lane's single UNEXPLAINED row
    // (`uses yyparse -> YY_INITIAL_VALUE`, src/parser.c L2229-2230) suppressed
    // `uses` for every function-like macro NAME collected here. That traded one
    // UNEXPLAINED row for FOUR MISSING rows (isleap, YYDPRINTF, decFinish,
    // CFUNC) because the truth counts a macro INVOCATION as both `calls (expr)`
    // and `uses (expr)` — the analyzer's identifier-path `uses` was load-bearing
    // for the second row. The attempt was reverted and the residual registered
    // as #908. Do not re-add a blanket macro-name suppression here.
    const declaredNames = new Set<string>()
    // CGD41 (#908 ruling, measured jq src/parser.c L2229/2230): a FUNCTION-LIKE
    // macro's NAME never BINDS. `YYSTYPE yylval YY_INITIAL_VALUE (= yyval_default);`
    // parses as a declaration whose DECLARATOR field is a function_declarator
    // named after the macro (the real declared name, `yylval`, is demoted to the
    // declaration's type_identifier). collectBoundLocals read that fd's leftmost
    // identifier as a function-LOCAL binding, so any later mention of the macro
    // inside that function was suppressed as a shadowed read. That made the
    // emission ORDER-DEPENDENT (the jq lane's row survived only because L2229 is
    // walked before L2230): the preprocessor expands the name wherever it
    // appears, so it is an invocation, never a binding — the same "an invocation
    // is a use" ruling the four-row lesson (#908) established. The oracle's
    // collector carries the identical gate, so both sides agree by construction.
    const functionLikeMacroNames = new Set<string>()
    {
      const preStack: { n: Node; inFn: boolean }[] = [{ n: rootNode, inFn: false }]
      while (preStack.length > 0) {
        const { n, inFn } = preStack.pop()!
        const nextInFn = inFn || n.type === "function_definition"
        if (n.type === "identifier" || n.type === "field_identifier") {
          const p = n.parent
          // CGD36 (M37 #601, measured vdbeaux.c/expr.c/loadext.c): a
          // function DEFINITION name is a file-scope declaration even though
          // the pre-pass carries inFn=true into the function_definition
          // subtree — so a VALUE read of a function BEFORE its definition
          // (`p->xDel==sqlite3VdbeFrameMemDel` at vdbeaux L2220 reads the fn
          // defined at L2258; `sqlite3ExprListDeleteGeneric` passed as a
          // callback; function-pointer tables) resolved only through the
          // ORDER-DEPENDENT Function symbol and silently dropped. The oracle
          // admits fn names (its isFunctionLocal excludes only compound/
          // parameter ancestry), so the analyzer must too. Distinguish from
          // LOCAL fn-pointer declarations: walk up from the name's
          // function_declarator — hitting compound_statement/parameter_list
          // first means a body-local declaration (excluded, C-D1); hitting
          // function_definition first means the defining name.
          const isFnDefName = (() => {
            if (!p || p.type !== "function_declarator") return false
            let mid: Node | null = p
            while (mid) {
              if (mid.type === "compound_statement" || mid.type === "parameter_list") return false
              if (mid.type === "function_definition") return true
              mid = mid.parent
            }
            return false
          })()
          // HC6 (deepest review): parameter names are never file-scope
          // declarations — `int f(int count);` admitted `count` into
          // declaredNames, fabricating a dangling `uses -> count` for any
          // later read (the oracle's isFunctionLocal already excludes
          // parameter ancestry, so this also restores mirror parity).
          // #901 (M60, second half of the basexx.c miss): the directive gate
          // below (`!isDirectiveConditionText`) walks UP to the first
          // `preproc_*` ancestor — and a macro definition's NAME has
          // `preproc_def` as its direct parent, so the gate returned true and
          // killed every macro name before the `isMacroName` branch could add
          // it. That branch has therefore been DEAD CODE since CGD26, and the
          // measured consequence is order dependence for exactly one symbol
          // class: a macro READ above its `#define` (basexx.c: read at L40,
          // `#define` at L48) resolved through the order-dependent Constant
          // symbol and dropped the edge, while a function call or global read
          // in the same position resolved through declaredNames and emitted
          // (measured probes: `later()`/`gv2` forward refs emit, `FWD` macro
          // forward ref does not). The oracle's declaredNames has always
          // admitted macros (its own isDeclaringIdentifier excludes only
          // function-local ancestry), so this restores mirror parity.
          // Narrowed to the NAME field by the helper: macro-body identifiers
          // (`preproc_arg` is an opaque blob, C-D2) and every "mention in
          // directive text" case keep the suppression — the definition site
          // is the one place a `preproc_*`-ancestored name DECLARES.
          if (p && (!inFn || isFnDefName) && this.isDeclarationLikeIdentifier(n) && (!this.isDirectiveConditionText(n) || this.isMacroDefinitionName(n)) && !this.isInsideParameterList(n)) {
            // Prototype names declare even inside ERROR-glued spans
            // (CGD19 scope refinement); the glue-name test below handles
            // bare-fd artifacts.
            const isProto = (() => {
              if (p.type !== "function_declarator") return false
              let mid: Node | null = p
              while (mid) {
                if (mid.type === "function_definition") return true
                if (mid.type === "declaration") return false
                mid = mid.parent
              }
              return false
            })()
            const isGlueFdName = (() => {
              if (p.type !== "function_declarator") return false
              const gp = p.parent
              if (!gp || gp.type !== "ERROR") return false
              // POSITION comparison (KAD2/TSD2 class, hygiene F7):
              // web-tree-sitter returns FRESH node objects per property
              // access, so `m !== gp` could never terminate — this gate was
              // dead code. Reach the ERROR span by comparing spans.
              const errStart = gp.startIndex
              const errEnd = gp.endIndex
              let m: Node | null = n
              while (m) {
                if (m.startIndex === errStart && m.endIndex === errEnd) return true
                if (m.type === "declaration") return false
                m = m.parent
              }
              return false
            })()
            const isMacroName = !!(p.type === "preproc_def" || p.type === "preproc_function_def")
            // CGD37 (M49 W17, measured jq src/builtin.c): a declaration inside
            // a compound_statement is a FUNCTION-BODY local even when parse-
            // recovery glue swallowed the enclosing function_definition —
            // tree-sitter-c folds gen_last_1's body into one top-level
            // `declaration` with a nested compound_statement, so no
            // function_definition ancestor exists and `inFn` never rises.
            // The oracle's isFunctionLocal excludes on the compound ancestor
            // ALONE, so the analyzer must too: otherwise the body reads
            // resolve order-independently through declaredNames and emit
            // `uses -> <local>` edges attributed to source=global (last_var,
            // init, call_arg, rangevar...). C has no file-scope blocks: a
            // decl inside a compound is NEVER file-scope. Macro definitions
            // stay textually file-scoped (C-D2); fn-def names and prototypes
            // have no compound ancestor between name and function_definition.
            const isInsideCompoundStatement = (() => {
              let c: Node | null = n
              while (c) {
                if (c.type === "compound_statement") return true
                c = c.parent
              }
              return false
            })()
            if (isProto || isMacroName || !(isInsideCompoundStatement || isGlueFdName || this.isCgd19SuppressedVarDecl(n))) {
              declaredNames.add(n.text)
              // CGD41: the definition site of a function-like macro is where the
              // name's un-bindability is recorded (its NAME's parent is the
              // preproc_function_def).
              if (p.type === "preproc_function_def") functionLikeMacroNames.add(n.text)
            }
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) preStack.push({ n: c, inFn: nextInFn })
        }
      }
    }

    // #931: every macro's NAME with the byte offset where it is defined, gathered
    // in a pre-pass. Used by the enum extractor to tell a macro USE in enumerator
    // position from a real enumerator -- see `extractEnum`.
    // Value is `"object" | "function"`, because the two expand under DIFFERENT
    // conditions and conflating them fabricates a finding: an object-like macro
    // replaces its name wherever the name appears, while a function-like macro
    // only replaces it when `(` FOLLOWS. redis's `server.h` defines both
    // `#define min(a, b) ...` and `#define max(a, b) ...` and then declares
    // `double min, max;` -- legal, and the field names really are `min` and
    // `max`, because the `,` after each name is not a `(`. Keyed on the FIRST
    // definition, as the preprocessor is.
    const macroDefOffsets = new Map<string, { at: number; kind: "object" | "function" }>()
    // The object-like subset, for the field-position member rule (#928/#932
    // unified): a member's name may not be a name the preprocessor would have
    // replaced.
    const objectMacroNames = new Set<string>()
    // Every macro name, both kinds, for the field-position member rule. The
    // enumerator rule below deliberately uses ONLY the object-like subset,
    // because an enumerator is never followed by `(` and so is never a
    // function-like macro's use -- while a DAMAGED field declaration can merge
    // one in, which is the #933 case.
    const allMacroNames = new Set<string>()
    // #939: `#define NAME <replacement text>`, same-file only. Feeds the array
    // dimension resolver; a macro defined in another header stays unknown, which
    // is C-D2 again and is why the resolver returns null rather than a guess.
    const macroValueTexts = new Map<string, string>()
    this.macroValueTexts = macroValueTexts
    // #939: same-file enumerator values, for `[MAX_FDS]`-shaped dimensions.
    this.enumConstantValues = this.buildEnumConstantValues(rootNode)
    {
      const preStack: Node[] = [rootNode]
      while (preStack.length > 0) {
        const n = preStack.pop()!
        if (n.type === "preproc_def" || n.type === "preproc_function_def") {
          const nm = n.childForFieldName("name")
          if (nm && nm.text.trim() && !macroDefOffsets.has(nm.text.trim())) {
            macroDefOffsets.set(nm.text.trim(), {
              at: nm.startIndex,
              kind: n.type === "preproc_function_def" ? "function" : "object",
            })
            if (n.type !== "preproc_function_def") objectMacroNames.add(nm.text.trim())
            allMacroNames.add(nm.text.trim())
            // #939: the macro's REPLACEMENT text, kept only for object macros. A
            // function macro's replacement is a parameter list plus a body, and
            // treating that as a value is how a "dimension" turns into a number
            // nobody wrote.
            if (n.type === "preproc_def") {
              const val = n.childForFieldName("value")
              if (val && !macroValueTexts.has(nm.text.trim())) macroValueTexts.set(nm.text.trim(), val.text)
            }
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) preStack.push(c)
        }
      }
    }

    // #934: the AST pre-pass above is NOT the whole macro inventory, and the gap
    // is measurable. jemalloc writes a 65-line brace-enclosed macro body:
    //
    //   #define TSD_DATA_SLOW_INITIALIZER   { JEMALLOC_TSD_INITIALIZER(__VA_ARGS__) }  ...
    //       /* reentrancy_level */  0,  \
    //       ...
    //   }
    //   #define TSD_DATA_FAST  ...        <- the grammar never produces a node here
    //   #define TSD_DATA_SLOWER ...
    //
    // The `preproc_def` at 91 swallows the brace block, the brace block absorbs the
    // following DIRECTIVES, and the parse then contains ZERO nodes starting on
    // those lines (measured: `redis/deps/jemalloc/include/jemalloc/internal/tsd.h`,
    // 24 preproc nodes for 29 `#define`s, and a whole-tree scan finds no node at
    // all with a start row in 120..146). A macro the parse never sees produces no
    // symbol, so every read of it is unresolvable, and the member and enumerator
    // rules that key on macro names are blind to it -- which is how
    // `property TSD_DATA_SLOWER` reached the `tsd_s` member list.
    //
    // The supplementary pass reads the file's own text for the ONE shape a C
    // lexer defines without help: a line whose first non-space character is `#`
    // introduces a directive, and `#define` followed by a name DEFINES that name.
    // Nothing else is read, and a line the grammar already modelled is simply
    // recorded twice under the same key. This is the same line-anchored principle
    // the analyzer already applies in `isHashLineMention` (CGD40) and
    // `insideMacroContinuation`, so it is inside the established contract rather
    // than outside it -- and it is a character scan, not a pattern, which is what
    // the lane's own P11 property requires of this file.
    //
    // What it does NOT do is decide what a macro means (C-D2). It makes the
    // inventory COMPLETE, which is a different and much smaller claim.
    {
      const content = this.analyzeContent
      let i = 0
      while (i < content.length) {
        let j = i
        while (j < content.length && (content[j] === " " || content[j] === "\t")) j++
        if (content[j] === "#") {
          j++
          while (j < content.length && (content[j] === " " || content[j] === "\t")) j++
          if (content.startsWith("define", j)) {
            let k = j + 6
            while (k < content.length && (content[k] === " " || content[k] === "\t")) k++
            const start = k
            while (k < content.length) {
              const ch = content[k]
              const word =
                (ch >= "a" && ch <= "z") ||
                (ch >= "A" && ch <= "Z") ||
                (ch >= "0" && ch <= "9") ||
                ch === "_"
              if (!word) break
              k++
            }
            const name = content.slice(start, k)
            if (name !== "" && !allMacroNames.has(name)) {
              allMacroNames.add(name)
              // Only a bare `NAME` with no `(` is object-like, and only a bare
              // `NAME` is a macro this pass can honestly classify. Anything with
              // parameters is left out rather than guessed at -- the enumerator
              // rule does not need function-like macros anyway, and the field rule
              // uses the ALL-macro set.
              if (k < content.length && content[k] !== "(") objectMacroNames.add(name)
            }
          }
        }
        const nl = content.indexOf("\n", i)
        if (nl === -1) break
        i = nl + 1
      }
    }

    // Track current active function for localized metadata updates
    let activeFunctionSymbol: null | ASTEngine.UniversalSymbol = null

    // 2. METRICS TRACKED IN-PASS
    let cyclomaticComplexity = 1
    let mallocCount = 0
    let freeCount = 0
    let hasUnsafeStrings = false
    let hasSafeStrings = false
    let isKernelExport = false
    let hasGotoStatements = false
    let hasVolatileQualifier = false
    let hasRestrictQualifier = false
    let hasInlineAsm = false
    let hasSignalHandlers = false
    let hasSetjmpLongjmp = false
    let hasAtomicTypes = false
    let hasVariableFormatString = false  // printf(user_input) security risk
    let hasDangerousCalls = false        // system(), popen(), exec*()

    // ABI heuristics: default to LP64, adjust with architecture hints and platform headers
    let is64Bit = this.inferIs64Bit(content, filePath)
    let isLLP64 = this.inferIsLLP64(content)

    // 3. THE TRUE SINGLE-PASS UNIFIED WALK
    const stack: { node: Node; isConditional: boolean; isExit: boolean; pushedScope: boolean }[] = [
      { node: rootNode, isConditional: false, isExit: false, pushedScope: false },
    ]

    while (stack.length > 0) {
      const { node, isConditional, isExit, pushedScope } = stack.pop()!

      if (!node) continue

      if (isExit) {
        // --- Scope Management (Leave) ---
        if (pushedScope) {
          if (scopeManager.currentScope().kind === ScopeKind.Function) {
            activeFunctionSymbol = null
          }
          scopeManager.popScope()
        }
        continue
      }

      let willPushScope = false

      // --- Scope Management (Enter) ---
      switch (node.type) {
        case "function_definition": {
          // #918: the POINTER-RETURN macro-wrapped heading. Measured on sqlite
          // `ext/wasm/libcmpp.c`: `CMPP__EXPORT(void *, cmpp_mrealloc)(…)` and
          // its five siblings arrive as a function_definition whose `type` field
          // is the macro call and whose `declarator` is the PARAMETER list — so
          // CGD38's declarator route (correctly) finds no callable and the
          // definition was never a symbol, its body never a Function scope.
          // The shape rule is the exported module-scope one the oracle shares;
          // every refusal travels with it.
          {
            const typed = macroWrappedTypedHeadingShape(node)
            if (typed) {
              scopeManager.pushScope(ScopeKind.Function, typed.name, node)
              willPushScope = true
              // The heading's naming argument is a DECLARATION of the name, not
              // a read of it — the #916/#917 contract, applied to the same
              // occurrence class.
              this.gluedDefNameOffsets.add(typed.nameNode.startIndex)
              activeFunctionSymbol = this.extractMacroWrappedTypedFunction(typed, node, content, symbols, isConditional)
              break
            }
          }
          // CGD38 (M37 #601, measured mem3.c/malloc.c/loadext.c): a
          // macro-qualified struct definition — `static SQLITE_WSD struct
          // Mem3Global {` (SQLITE_WSD is an unknown identifier) — recovers
          // as a function_definition whose DECLARATOR FIELD is a BARE
          // identifier (the struct TAG). Real function_definition
          // declarators are always function_declarator (possibly wrapped in
          // pointer_declarator/array_declarator). Treating the bare-identifier
          // shape as a function fabricated phantom Function symbols
          // (`Mem3Global`, `sqlite3AutoExtList`) whose "body" is the struct.
          // Only a declarator chain that CONTAINS a function_declarator is
          // a real callable.
          const rawDecl = node.childForFieldName("declarator")
          const declIsCallable = (() => {
            if (!rawDecl) return false
            if (rawDecl.type === "function_declarator") return true
            // pointer_declarator / array_declarator / parenthesized wrappers:
            // descend the declarator chain for a function_declarator.
            let d: Node | null = rawDecl
            while (d && d.type !== "function_declarator") d = d.childForFieldName("declarator")
            return !!d
          })()
          const nameNode = declIsCallable ? this.getIdentifierFromDeclarator(rawDecl) : null
          // #916-D: the macro-decorated DEFINITION whose return type the preceding
          // truncated declaration ate. Measured on `sqlite3-jni.c:6245`, where
          // `JNIEXPORT void JNICALL` (declaration) is followed by
          // `Java_…(JniArgsEnvClass){…}` — a function_definition whose `type` field
          // is the NAME and whose `declarator` is the PARAMETER LIST, so the CGD38
          // guard above reads it as "not callable" and the name, had it been derived
          // from the declarator, would have been the parameter. The recovery is
          // gated on the sibling declaration in `recoveredMacroTruncatedFunction`,
          // which is what keeps CGD38's real subject — a macro-qualified STRUCT
          // whose declarator is a bare identifier — untouched.
          const recoveredFn = this.recoveredMacroTruncatedFunction(node)
          const effectiveName = recoveredFn ? recoveredFn.name : nameNode ? nameNode.text : null
          // CGD22: ERROR-glued pseudo definitions can carry a KEYWORD as the
          // "function name" — no scope, no symbol, no locals for it.
          if (effectiveName && effectiveName.trim() && !C_KEYWORDS.has(effectiveName)) {
            scopeManager.pushScope(ScopeKind.Function, effectiveName, node)
            willPushScope = true
            activeFunctionSymbol = this.extractFunction(
              node,
              content,
              symbols,
              scopeManager.getScopeName(),
              isConditional,
              recoveredFn,
            )
            const locals = new Set<string>()
            if (activeFunctionSymbol?.parameters) {
              for (let i = 0; i < activeFunctionSymbol.parameters.length; i++) {
                const p = activeFunctionSymbol.parameters[i]
                if (p && p.name && p.name !== "...") locals.add(p.name)
              }
            }
            functionLocals.set(effectiveName, locals)
          }
          break
        }
        case "expression_statement": {
          // #917: a macro-wrapped HEADING. Registered here rather than at the
          // body, because the heading is walked FIRST — the naming argument's
          // identifier must be marked as a declaration before it is read.
          const rec = this.recoveredMacroWrappedHeader(node)
          if (rec) {
            const body = wrappedBodyAfter(node)
            if (body) {
              this.macroWrappedHeaders.set(body.startIndex, rec)
              if (rec.nameNode) this.gluedDefNameOffsets.add(rec.nameNode.startIndex)
            }
          }
          break
        }
        case "ERROR": {
          // #907 (M60-C, measured jq src/jv_print.c): a top-level definition that
          // parse recovery absorbs into a preceding function's body survives only as
          // an ERROR holding a type node plus a bare function_declarator — no
          // function_definition wrapper, so the walk never emits it and the public
          // API function vanishes from the catalog (jv_dumpf/jv_dump).
          this.recoverGluedDefinitionHeader(node, content, symbols)
          break
        }
        case "compound_statement": {
          // #917: a MACRO-WRAPPED definition's body — the heading is
          // CALL-shaped, so `MACRO(ret, name)(params){ body }` parsed as a call
          // chain plus an ORPHAN compound_statement (a direct child of the
          // translation_unit or of the ERROR / preproc_ifdef that swallowed the
          // region). Without this branch the body got only a Block scope: no
          // function name, its locals published as FILE-SCOPE symbols (an
          // anonymous `enum { BufSize = … }` inside the body emitted
          // `enum_member BufSize` and the array read of it emitted a
          // file-scope `uses global -> BufSize` the oracle cannot derive —
          // the single unexplained edge the whole 315-file sqlite c lane
          // carried), and every read in the body was attributed to `global`.
          // Measured on sqlite: 235 such definitions across `libcmpp.c` (86)
          // and `sqlite3-jni.c` (149) had no Function scope at all.
          //
          // The gate is the SAME rule the oracle uses for function-scope
          // semantics — a body is function-local, wherever recovery parked it —
          // and `isInsideFunction` keeps it from re-scoping a body that already
          // sits inside a real function (C has no nested definitions).
          const wrapped = this.macroWrappedHeaders.get(node.startIndex)
          if (wrapped && !scopeManager.isInsideFunction()) {
            scopeManager.pushScope(ScopeKind.Function, wrapped.name, node)
            willPushScope = true
            this.macroWrappedFunctionNames.add(wrapped.name)
            activeFunctionSymbol = this.extractMacroWrappedFunction(wrapped, node, content, symbols, isConditional)
            break
          }
          // KAD2 sweep: comparing a STORED wrapper (scope entry) to a fresh
          // `node.parent` never matched — the guard was dead and nested
          // blocks always pushed a new scope. Span comparison restores the
          // merge behavior for consecutive same-scope compounds.
          // CGD21 (M37 #601): the GLOBAL scope carries node=null —
          // dereferencing its .node crashed 7/125 sqlite files on VALID C
          // (a top-level or ERROR-glued compound reached while global is
          // current). A null-node scope never merges.
          const cur = scopeManager.currentScope()
          if (!cur.node ||
              cur.node.startIndex !== node.parent?.startIndex ||
              cur.node.endIndex !== node.parent?.endIndex) {
            scopeManager.pushScope(ScopeKind.Block, `block_${node.startIndex}`, node)
            willPushScope = true
          }
          break
        }
        case "struct_specifier": {
          // #961: A FUNCTION-LOCAL TYPE IS A COMPILE-TIME TYPE, NOT AN EXECUTION
          // ARTIFACT. CGD20 read the exclusion the other way -- "function-local
          // struct definitions are execution artifacts (C-D1)" -- and dropped them with
          // no scope, no symbol and no field registration. That reading does not
          // survive contact with C. A struct definition EMITS NO CODE: the local
          // VARIABLE is the execution artifact, and the struct is a type whose type is
          // fully determined at compile time and whose VISIBILITY the block merely
          // limits.
          //
          // Measured over the three corpora: 20 function-local named types carrying 65
          // members across 15 files, of which NONE were published. They are used, not
          // decoration -- deps/jemalloc/test/unit/malloc_io.c:14 `struct test_s` (6
          // members, 4 references), src/ebuckets.c:2230 `struct TestParams` (the
          // parameter table for the benchmark below it), src/listpack.c:1920
          // `struct pick`, src/module.c:4590 `KeyMetaConfAllVersions` and
          // src/module.c:7568 `typemethods.v2`-`v5`.
          //
          // THE DECISIVE ARGUMENT WAS IN THIS LANE'S OWN OUTPUT. The payload already
          // published `uses local_type_in_use -> index` and `-> order` -- uses of
          // members of a type CGD20 declined to declare. Those edges were unresolved in
          // the strict sense: the only way to resolve `index` was the declaration that
          // had been suppressed. A lane that will not publish a type is not consistent
          // about declining to publish uses OF it.
          const nameNode = node.childForFieldName("name")
    let structName = "anonymous_struct"
    if (nameNode && nameNode.text.trim()) {
      structName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) structName = declNode.text.trim()
    }
    // #961: the FUNCTION-QUALIFIED name for a function-local struct lives in the
    // Struct scope pushed below, because `extractStruct` names the symbol from
    // `getScopeName()` rather than from this local. See the note there.
          // Only a struct WITH a body is a definition site — forward/reference
          // declarations (`struct Point;`, `typedef struct Point Point;`) push
          // no scope so the typedef name cannot self-reference its own scope.
          if (node.childForFieldName("body")) {
            scopeManager.pushScope(ScopeKind.Struct, structName, node)
            willPushScope = true
          }
          this.extractStruct(
            node,
            symbols,
            structs,
            unions,
            is64Bit,
            isLLP64,
            scopeManager.getScopeName(),
            isConditional,
            declaredTypes,
            allMacroNames,
          )
          break
        }
        case "union_specifier": {
          // #961: CGD20 dropped function-local types as 'execution artifacts'; the
          // ruling is withdrawn -- a union definition EMITS NO CODE. The local VARIABLE is
          // the execution artifact, and this is a type whose VISIBILITY the block merely
          // limits. Published under the enclosing function's qualified path, for the
          // reason and the three corpus collisions stated at `extractStruct`.
          // #951: as the struct path.
    const unionNameNode = node.childForFieldName("name")
    let unionName = this.specifierOwnName(node)
    if (unionName === "anonymous_union") {
      unionName = this.inlineAggregateOwnerName(node) ?? "anonymous_union"
    }
    void unionNameNode
          if (node.childForFieldName("body")) {
        scopeManager.pushScope(ScopeKind.Union, unionName, node)
        willPushScope = true
      }
          this.extractUnion(node, symbols, unions, scopeManager.getScopeName(), isConditional, declaredTypes, allMacroNames, structs, is64Bit, isLLP64)
          break
        }
        case "enum_specifier":
          // #961: CGD20 dropped function-local types as 'execution artifacts'; the
          // ruling is withdrawn -- a enum definition EMITS NO CODE. The local VARIABLE is
          // the execution artifact, and this is a type whose VISIBILITY the block merely
          // limits. Published under the enclosing function's qualified path, for the
          // reason and the three corpus collisions stated at `extractStruct`.
          //
          // What the original exclusion was RIGHT about is preserved by the
          // qualification rather than by silence: a local enum's MEMBERS are owned by
          // the qualified type, so they cannot leak as file-scope EnumMember symbols --
          // which was the measured harm CGD20 cited (BackupSubCommandEnum, MB_enum in
          // sqlite). Publishing the type with a member path fixes the leak at its
          // cause instead of refusing the type.
          this.extractEnum(
            node,
            symbols,
            enums,
            scopeManager.getScopeName(),
            isConditional,
            macroDefOffsets,
          )
          break
        case "declaration":
          {
            // #918, the DECLARATION spelling of the same heading — recovery cut
            // the region at the first parameter (`declaration` + an ERROR holding
            // the rest of the parameter list and the body's opening — measured:
            // libcmpp.c:5529, `CMPP__EXPORT(void *, cmpp_mrealloc)`). The rule
            // proves the shape structurally (pointer return, name slot, all-
            // identifier tail, a lone `}` after the declaration); when it holds,
            // the definition is emitted and its region becomes the Function
            // scope, exactly as the function_definition spelling does.
            const typedDecl = macroWrappedTypedHeadingShape(node)
            if (typedDecl) {
              scopeManager.pushScope(ScopeKind.Function, typedDecl.name, node)
              willPushScope = true
              this.gluedDefNameOffsets.add(typedDecl.nameNode.startIndex)
              activeFunctionSymbol = this.extractMacroWrappedTypedFunction(typedDecl, node, content, symbols, isConditional)
              break
            }
            const currentFunction = scopeManager.getCurrentFunctionName()
            // #917: a recovered macro-wrapped definition gets NO locals model.
            // The mirror is exact rather than convenient: the oracle's
            // `fnLocals` collector only runs for `function_definition` nodes,
            // and a wrapped heading is not one, so truth collects nothing for
            // these bodies. Registering the body's own bindings here would
            // suppress a read the oracle still derives whenever a body local
            // shadows a FILE-SCOPE name — a MISSING edge created by the
            // recovery itself. The recovered function keeps its name, its
            // scope and its reads; the shadowing model stays where both sides
            // already agree on it (a real `function_definition`).
            if (currentFunction && !this.macroWrappedFunctionNames.has(currentFunction)) {
              const locals = functionLocals.get(currentFunction) || new Set<string>()
              // CGD7 (M37 #601): only names actually BOUND by this declaration
              // enter locals — the old collectDeclaredIdentifiers walked the
              // ENTIRE declaration subtree, so `int y = g;` collected `g` (the
              // RHS initializer identifier) as a "local", and every later
              // genuine read of `g` in the same function was silently dropped
              // (probe c-emit2 B1: `return g + 1` emitted nothing). A local
              // variable shadowing a global is legitimately filtered; a
              // READ of the global is not.
              const bound = this.collectBoundLocals(node, functionLikeMacroNames)
              for (let i = 0; i < bound.length; i++) {
                locals.add(bound[i])
              }
              functionLocals.set(currentFunction, locals)
            }
          }
          this.extractDeclaration(
            node,
            symbols,
            globalVars,
            scopeManager.getScopeName(),
            scopeManager.currentScope().kind === ScopeKind.Global,
            isConditional,
          )
          break
        case "type_definition":
          // #961: CGD20 dropped function-local types as 'execution artifacts'; the
          // ruling is withdrawn -- a typedef definition EMITS NO CODE. The local VARIABLE is
          // the execution artifact, and this is a type whose VISIBILITY the block merely
          // limits. Published under the enclosing function's qualified path, for the
          // reason and the three corpus collisions stated at `extractStruct`.
          this.extractTypedef(node, symbols, structs, scopeManager.getScopeName(), isConditional)
          break
        case "preproc_def":
        case "preproc_function_def":
          patterns["Preprocessor Macros"] = true
          this.extractMacro(node, symbols, isConditional)
          // CGD5 (M37 #601): preproc_arg is an OPAQUE token blob in the
          // pinned grammar (probe c-emit2 B8 — zero named children; the C
          // preprocessor is textual, and expansion is C-D2's recorded
          // non-goal). Walking its text would fabricate identifiers out of
          // macro bodies; treating it as AST would miss that every macro
          // reference in real code IS parsed (as ordinary identifiers at
          // use sites, post-expansion by the compiler). The honest ruling:
          // the blob is neither walked nor re-parsed; macro USE sites resolve
          // through the ordinary identifier path when the macro name is a
          // declared Constant/Macro symbol (extractMacro above).
          break
        case "preproc_include": {
          this.extractInclude(node, imports, (path) => {
            if (stringIncludes(path, "windows.h")) {
              isLLP64 = true
              is64Bit = true
            }
            if (stringIncludes(path, "sys/types.h") || stringIncludes(path, "stddef.h")) {
              // keep existing architecture assumption; these headers are cross-platform
              is64Bit = is64Bit
            }
          })
          // depends: #include creates a compile-time dependency on the header
          // CGD4: isSystem must come from the RAW path text ("<stdio.h>"),
          // never the stripped path — the stripped text never starts with
          // '<', so every include edge carried isSystem=false.
          const includePath = this.getIncludePath(node)
          if (includePath) {
            const rawPathNode =
              node.childForFieldName("path") ||
              this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string")
            const isSystemInclude = rawPathNode ? rawPathNode.text.trimStart().startsWith("<") : false
            // M60/#910: the include is a FIRST-CLASS `imports` edge, not a
            // `references` edge with import metadata. Measured gap the old
            // shape created: every include-family language (c/cpp/go/rust/
            // ruby/php) hid its dependency edges behind `references` +
            // metadata.isImport while ts/js/python/dart/bash/lua/makefile
            // emitted the dedicated `imports` kind, so the one reader that
            // answers "what does this module depend on" (the LSP usages
            // file-level section, `relationship_type IN ('imports','exports')`)
            // could never see a C include. The metadata markers stay — they
            // are the evidence (written path, system-vs-quoted) — but the
            // relationship KIND now says what it is. `module` and `fileLevel`
            // let the store name the importing file on a row whose source is
            // file-scope (see parallel-indexer `importerExternal`).
            relationships.push({
              source: scopeManager.getRelationshipSource(),
              target: includePath,
              type: ASTEngine.RelationshipType.Imports,
              confidence: 1.0,
              // M59.A7 (#825): the include directive is the source construct and
              // its written name is the path token — take THAT node's line, not
              // the directive's (multi-line directives put the path last).
              line_number: this.nodeLine(rawPathNode ?? node),
              metadata: {
                relationshipType: "include_dependency",
                isSystem: isSystemInclude,
                isSystemInclude,
                isImport: true,
                module: includePath,
                fileLevel: true,
              },
            })
          }
          break
        }
      }

      stack.push({ node, isConditional, isExit: true, pushedScope: willPushScope })

      // --- Error Tracking ---
      if (node.type === "ERROR" || node.isMissing) {
        errors.push({
          message: "Syntax Error/Missing Node bypassed - Recovering AST Bounds",
          range: this.nodeToRange(node),
          severity: "warning",
        })
      }

      // --- In-Pass Metrics & Graph Detection ---
      if (
        inArray(COMPLEXITY_NODES, node.type)
      ) {
        cyclomaticComplexity++
      } else if (node.type === "goto_statement") {
        // goto is not a DECISION POINT (family T1 contract: branch constructs
        // + short-circuit operators only) - it no longer inflates the
        // cyclomatic count; maintainability tracking keeps hasGotoStatements.
        hasGotoStatements = true
      } else if (node.type === "labeled_statement") {
        // labels are jump TARGETS, not decisions - same T1 rationale.
        hasGotoStatements = true
      } else if (node.type === "type_qualifier") {
        if (node.text === "volatile") hasVolatileQualifier = true
        if (node.text === "restrict" || node.text === "__restrict") hasRestrictQualifier = true
        if (node.text === "_Atomic") hasAtomicTypes = true
      } else if (node.type === "gnu_asm_expression") {
        // Pinned wasm emits gnu_asm_expression; 'asm_expression' was a dead
        // literal (grammar audit).
        hasInlineAsm = true
        patterns["Inline Assembly"] = true
      } else if (node.type === "binary_expression") {
        const op = node.childForFieldName("operator")
        if (op && (op.text === "&&" || op.text === "||")) cyclomaticComplexity++
      } else if (node.type === "call_expression") {
        const fnNode = node.childForFieldName("function")
        // CGD3: a parenthesized callee is NEVER a resolvable call by name —
        // it is either a vendor-macro cast `(Unit)(x)` (typedef from an
        // untracked header; census: ~100% of paren callees in sqlite/jq are
        // header typedefs like u8/Unit/sqlite3_int64) or a computed
        // function-pointer deref `(*fp)(x)`. Both are dropped as call edges
        // (oracle deriveCCalls already dropped them). CGD2: the old cast
        // branch `continue`d the WALK, which skipped the entire call
        // subtree — calls INSIDE cast arguments vanished. The walk now
        // always recurses; only the calls edge is suppressed.
        let suppressCall = false
        // A call in a preprocessor DIRECTIVE is not a call. The preprocessor is
        // line-anchored text (C-D2): `#if !defined(A) && !defined(B)` never
        // executes, and `defined` is a preprocessor OPERATOR, not a callable
        // name, so `calls global -> defined` is a fabricated edge.
        //
        // The `uses` path has carried both guards against this since CGD40
        // (isDirectiveConditionText + isHashLineMention, lines 2063/2071); the
        // `calls` path had neither, which is why this class survived. Measured
        // over 200 files per corpus by call-edge-fidelity.ts: 61 over-emitted
        // call sites -- `defined` in `#if`/`#elif` conditions in curl
        // (curl_trc.c, http.c, protocol.c, openldap.c, cf-ip-happy.c) and redis.
        //
        // BOTH guards are needed, for the two different ways a directive loses
        // its identity:
        //
        //   isDirectiveConditionText  a cleanly-parsed directive keeps its
        //     `preproc_*` ancestor, so the walk up finds it immediately.
        //
        //   isHashLineMention  an initializer list left OPEN across interleaved
        //     `#ifdef`s (curl_trc.c:530-556 -- `{ "a", 1 },` guarded entries
        //     with the `};` eight lines later) puts the `#if` line inside an
        //     ERROR with NO preproc_* ancestor, so the structural guard is
        //     blind. The preprocessor is still line-anchored: the physical line
        //     starts with '#', which is the fact C-D2 rests on.
        //
        // A clean `#if defined(X)` needed neither -- a clean directive never
        // produces a call_expression at all -- so a fixture written from the
        // tidy version of this defect reproduces nothing and the mutant
        // SURVIVES. The reproducing shape is the damaged one.
        //
        //
        // TWO SEPARATE TESTS, and conflating them is a regression I introduced and
        // then measured: the first version of this guard was
        // `isDirectiveConditionText(node) || isHashLineMention(node)` and it
        // suppressed 15 REAL calls in curl/lib (curl_sasl.c:531-545, cfilters.c,
        // strerr.c -- agreement fell from 99.97% to 99.89%).
        //
        // `isDirectiveConditionText` alone is too coarse, and the reason is
        // structural: a `preproc_ifdef` has the directive line AND the guarded
        // BODY as children, so walking up from a call inside the body reaches
        // `preproc_ifdef` and answers "this is directive text". It is not. The
        // body is ordinary code and must keep its `calls` edge -- the same
        // "conditional CODE inside #ifdef blocks still walks and emits" rule the
        // `uses` path states at its own guard. Measured ancestor chain for
        // curl_sasl.c:534 `sasl_choose_gsasl(data, &sctx)`, which is real code on
        // a line that does NOT start with '#': `ERROR < preproc_ifdef`.
        //
        // So the structural test is dropped here and the LINE-ANCHORED one is
        // kept: a preprocessor directive is text that begins with '#' on its
        // physical line (C-D2), and a call_expression on such a line is
        // directive text whatever its ancestors say. That is the case the whole
        // guard exists for -- `#if !defined(A) && !defined(B)` inside the
        // swallowed initializer, where isHashLineMention is the ONLY test that
        // fires because the ERROR node removed the preproc_* ancestor.
        //
        // The structural test is not discarded, it is simply not the right test
        // for THIS question: it answers "is any ancestor a directive", when the
        // question is "is THIS TOKEN directive text".
        const inDirectiveCondition = this.isHashLineMention(node)
        if (fnNode) {
          let target = fnNode.text
          let isFuncPtr = false
          // M59.A7 (#825): the line belongs to the name, never to the construct
          // that contains it. `obj->method()`'s call_expression starts at the
          // RECEIVER, so a newline-continued member call would take the line the
          // receiver is written on (the scala/java/groovy defect class, in C's
          // node shape); the callee leaf is the naming node.
          let targetNode: Node | null = fnNode

          if (fnNode.type === "field_expression") {
            const field = fnNode.childForFieldName("field")
            if (field) {
              target = field.text
              targetNode = field
            }
            isFuncPtr = true
          } else if (fnNode.type === "subscript_expression") {
            // Dispatch-table invocation handlers[i]() - no static callee
            // NAME exists (family contract with cpp: computed/dynamic
            // calls are filtered rather than emitting bracket-text noise).
            target = ""
          } else if (fnNode.type === "call_expression") {
            // CGD32 (M37 #601, measured libcmpp.c ×90): a NESTED call as the
            // callee — `CMPP__EXPORT(bool, cmpp_isspace)(...)` — is a
            // macro-wrapped declaration whose inner call_expression text
            // (`CMPP__EXPORT(bool, cmpp_isspace)`) leaked as a composite
            // bogus call target (parens/commas; nothing can resolve it). The
            // inner call still walks and emits its own `calls CMPP__EXPORT`
            // edge — suppress only the composite outer target, mirroring the
            // parenthesized-callee ruling (CGD3): a callee that is itself a
            // call has no static NAME.
            suppressCall = true
          } else if (fnNode.type === "parenthesized_expression") {
            // CAST vs FUNCTION POINTER (CGD3): `(Type)expr` through vendor
            // macros parses as a call with a parenthesized callee whose child
            // is a type — a CAST, not a callable (census: ~100% of paren
            // callees in sqlite/jq are header typedefs: u8, Unit,
            // sqlite3_int64). Deref calls ((*fp)(x)) hold a pointer
            // expression. Neither shape has a resolvable call NAME, so the
            // EDGE is suppressed; unlike the old `continue`, the WALK still
            // descends — a call inside a cast argument, `(Unit)(make())`,
            // still emits its own `calls make` (probe c-emit3 C1: previously
            // the entire subtree was skipped).
            suppressCall = true
          } else if (fnNode.type !== "identifier" && fnNode.type !== "field_identifier") {
            // #954: a callee that is not a NAME node is not a call.
            //
            // `#if PCRE2_CODE_UNIT_WIDTH == 8` in libgit2's pcre2_dfa_match.c
            // published `calls pcre2_dfa_match -> "8"`. A number is not callable, and
            // the edge asserted that a function called a numeric literal. Every
            // earlier guard on this branch listed the shapes it RECOGNISED and let
            // everything else fall through to `fnNode.text` -- so a callee that was
            // none of the known shapes became a call target by default, which is the
            // wrong default for a field that is supposed to hold a name.
            //
            // The test is the NODE TYPE rather than a pattern on the text, which is
            // both exact and the only version this lane is allowed: P11 holds this
            // file to zero regex literals, and a shape test on the target string
            // would reintroduce one on the hottest path in the analyzer.
            //
            // The recognised callee shapes are `identifier` and `field_identifier`,
            // plus the four handled above (`field_expression`, `subscript_expression`,
            // `call_expression`, `parenthesized_expression`). Anything else -- a
            // number, a string, a character, a `sizeof`, a type name -- is not a
            // callable name, and `subscript_expression` already declines to invent
            // one for the same reason.
            suppressCall = true
          }

          // REVERTED, and the reason is a pinned contract this wave violated.
          //
          // The call-edge fidelity probe reported ~4,000 "phantom" call edges whose
          // callee is a file-local macro -- `UNUSED(interval)` publishing
          // `calls anetKeepAlive -> UNUSED` -- and suppressing them looked obviously
          // right: the lane refuses macro-named members (#928) and macro-named
          // enumerators (#931), so a macro-named callee looked like the same rule
          // applied a third time.
          //
          // It is not. #908's ruling, pinned by
          // c/function-like-macro-not-a-binding-908 and derived from the M12 TRUTH,
          // is explicit: "the truth counts a macro invocation as `calls (expr)` AND
          // `uses (expr)`". The `calls` edge to a macro name is not an oversight to
          // be tidied up -- it is what the ground truth requires, and a fixture
          // expects `calls c908_read -> YY_INITIAL_VALUE` by name. Suppressing it
          // would have deleted a required edge, and the fixture caught that in one
          // run.
          //
          // What the two failures together establish is worth keeping, because the
          // distinction is sharp and it is not in the analyzer's favour everywhere:
          //   - a REAL function-like macro invocation gets BOTH a `calls` and a
          //     `uses` edge (#908, truth-driven);
          //   - a `#define` REPLACEMENT LIST that recovery reads as a call gets
          //     NEITHER, because it is not an invocation at all -- it is a definition
          //     site (#912, pinned by c/call-shaped-declarator-912, whose note says
          //     the call-shaped text "must not become a `uses` of a symbol either").
          //
          // So the macro-name rule is real but it is about DEFINITION SITES, not
          // about callees, and the analyzer was already right on both. The probe's
          // model was the thing that was wrong: it took the literal parse as ground
          // truth and so counted a documented divergence as a defect.

          if (
            !suppressCall &&
            !inDirectiveCondition &&
            target && target.trim() !== "" &&
            // Malformed recovery guard: include-adjacent macros produced
            // targets containing quotes/newlines (never real callees).
            !target.includes('"') && !target.includes("\n") && !target.includes("{")
          ) {
            relationships.push({
              source: scopeManager.getRelationshipSource(),
              target: target,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 1.0,
              line_number: this.nodeLine(targetNode),
              metadata: { relationshipType: "c_function_call", isFunctionPointer: isFuncPtr },
            })

            // #383 payload: calls of the enclosing function (C has no
            // qualification - the plain call target IS the qualified path).
            const qcFn = scopeManager.getCurrentFunctionName()
            if (qcFn) {
              const list = qcByFunction.get(qcFn) ?? []
              list.push(target)
              qcByFunction.set(qcFn, list)
            }

            // Single pass security tracking
            if (inArray(MALLOC_FUNCTIONS, target)) {
              mallocCount++
              patterns["Dynamic Memory Management"] = true
              if (activeFunctionSymbol && activeFunctionSymbol.metadata) {
                activeFunctionSymbol.metadata.usesMalloc = true
              }
              // #962: publish `instantiates` for the TYPE this allocation produces.
              //
              // The type comes from the CAST, which is where C states it:
              // `(Buffer *)malloc(sizeof(Buffer))` allocates a `Buffer`. Two positions
              // are read, in order, and the first that yields a declared type wins:
              //
              //   1. an enclosing `cast_expression` whose VALUE is this call
              //   2. `sizeof(<type>)` in the argument list -- `sizeof(Buffer)` names
              //      the same type and is often the only one present
              //
              // The target must be a type the file DECLARES. An allocation into `void *`
              // with no cast instantiates no named type, so no edge is published and
              // the `calls` edge plus `metadata.usesMalloc` remain the record -- which
              // is the honest outcome rather than an edge to a function that is not a
              // type.
              //
              // The dedup key matches the `calls` one (per PAIR, not per line) for the
              // same reason and with the same consequence: two allocations of the same
              // type in one function are one fact.
              if (qcFn) {
                const instantiated = this.allocatedTypeName(node, declaredTypes, structs, unions, enums)
                if (instantiated) {
                  const iKey = `${qcFn}::instantiates::${instantiated}`
                  if (!emittedInstantiates.has(iKey)) {
                    emittedInstantiates.add(iKey)
                    relationships.push({
                      source: qcFn,
                      target: instantiated,
                      type: ASTEngine.RelationshipType.Instantiates,
                      confidence: 1.0,
                      line_number: this.nameLine(fnNode),
                      metadata: {
                        relationshipType: "c_allocation",
                        allocator: target,
                        evidenceClass: "usage_contextual",
                      },
                    })
                  }
                }
              }
              // #962: `instantiates` IS PUBLISHED, and it targets the TYPE the
              // allocation produces -- not the allocator.
              //
              // The M12 truth defines this C-specifically: "instantiates = allocator
              // calls (malloc/calloc/realloc family -- C-specific allocation
              // semantic)", and pins `rel:Module.c:instantiates:buffer_create:malloc`
              // with the note "calls + instantiates pair is intentional: call graph
              // fact + allocation". So the semantic is wanted and the `calls` edge
              // alone does not carry it.
              //
              // WHAT WAS WRONG WAS THE TARGET, NOT THE RELATIONSHIP. Measured across
              // all 25 languages whose M12 truth pins an `instantiates` edge, the
              // target is always a TYPE: `Point`, `HashMap`, `List`, `Dictionary`,
              // `User`, `UserService`, `MemoryStorage`, `Shape`. C's `-> malloc` was
              // the only non-type target in the family, and the original removal
              // reasoned exactly that -- "malloc allocates BYTES, not a named type".
              // True, and it is why the TARGET is wrong.
              //
              // The faithful C edge reads the CAST. Module.c:26 is
              // `Buffer *buf = (Buffer *)malloc(sizeof(Buffer));` -- the allocation
              // produces a `Buffer`, the code says so in the cast, and `Buffer` is a
              // type symbol in the same file. So the edge is
              // `instantiates buffer_create -> Buffer`, which satisfies the truth's
              // definition AND the family's meaning. With no cast naming a type there
              // is nothing to instantiate and no edge is published -- an allocator call
              // into a `void *` genuinely instantiates no type, and the `calls` edge
              // plus `metadata.usesMalloc` already record the allocation.
            } else if (inArray(FREE_FUNCTIONS, target)) {
              freeCount++
            } else if (inArray(UNSAFE_STRINGS, target)) {
              hasUnsafeStrings = true
            } else if (inArray(SAFE_STRINGS, target)) {
              hasSafeStrings = true
            } else if (inArray(EXPORT_MACROS, target)) {
              isKernelExport = true
              const arg = node.childForFieldName("arguments")?.namedChild(0)
              if (arg && arg.text.trim()) {
                relationships.push({
                  source: arg.text,
                  target: "KERNEL_EXPORT",
                  type: ASTEngine.RelationshipType.Exports,
                  confidence: 1.0,
                  // M59.A7: the exported NAME is written in the macro argument;
                  // the marker target (KERNEL_EXPORT) is synthesised and the
                  // oracle verifies this edge by its SOURCE token.
                  line_number: this.nodeLine(arg),
                  metadata: { relationshipType: "linux_kernel_export", exportMacro: target },
                })
              }
            } else if (inArray(FORMAT_FUNCTIONS, target)) {
              // Format string security: detect variable format arg (e.g., printf(user_input))
              const args = node.childForFieldName("arguments")
              if (args) {
                const firstArg = args.namedChild(0)
                if (firstArg && firstArg.type === "string_literal") {
                  patterns["Formatted I/O"] = true
                } else if (firstArg && firstArg.type !== "string_literal") {
                  hasVariableFormatString = true
                  patterns["Format String Vulnerability Risk"] = true
                }
              }
            } else if (inArray(DANGEROUS_FUNCTIONS, target)) {
              hasDangerousCalls = true
              patterns["Shell Command Execution Risk"] = true
            } else if (inArray(SIGNAL_FUNCTIONS, target)) {
              hasSignalHandlers = true
              patterns["Signal Handling"] = true
            } else if (target === "setjmp" || target === "longjmp" || target === "sigsetjmp" || target === "siglongjmp") {
              hasSetjmpLongjmp = true
              patterns["Non-Local Jumps"] = true
            }
          }
        }
      } else if (node.type === "field_expression") {
        // struct->field or struct.field access → References + field_access metadata
        // SCD1 (M37 #599 pre-wave addendum 2): an assignment LHS is a
        // WRITE, never a read — `c->count = 0` and `c->count += 1` both
        // leaked a bogus `uses count` (the dedup key merged the two
        // writes into one edge, hiding the leak). Gate by exact LHS span:
        // assignment_expression (the pinned grammar folds compound-assign
        // into it), RHS reads stay genuine (java JAD1 family contract).
        const parent = node.parent
        const lhs = parent ? parent.namedChild(0) : null
        // #960: A WRITE TO A FIELD IS A `uses`. SCD1 (M37 #599) excluded an
        // assignment LHS on the grounds that it is a write "never a read", and the
        // exclusion is withdrawn on two grounds, one of which holds regardless of
        // any oracle.
        //
        // THE ANALYZER WAS ALREADY INCONSISTENT WITH ITSELF. Measured on a
        // five-line reproducer:
        //
        //   p->f++     ->  uses published
        //   p->f += 1  ->  NOT published
        //   p->f = 1   ->  NOT published
        //   p->g &= ~3 ->  NOT published
        //
        // `p->f++` and `p->f += 1` are the same operation in C. The difference is
        // that the pinned grammar folds a compound assignment into
        // `assignment_expression` -- which this gate tests -- while `++` is an
        // `update_expression` and never reached it. There is no semantic reading
        // under which `f++` is a use and `f += 1` is not.
        //
        // THE PINNED M12 TRUTH AGREES WITH THE INCLUSIVE READING, and says so in
        // its own contract text: `uses:buffer_create:capacity` is pinned for
        // `buf->capacity = clamp(...)`, an assignment. So all FIVE facts the truth
        // marks "not produced" are assignment targets -- three field writes
        // (capacity/length/data) and two global-variable writes
        // (`initialized = 1`, `initialized = 0` in module_init/module_shutdown).
        // Removing the gate takes M12 truth drift from 5 not-produced to 0.
        //
        // WHAT THIS DOES NOT CLAIM. A write is not a READ, and the edge is not
        // relabelled: it stays `uses` with `field_access` metadata, because the
        // ontology has no `writes` kind (the vocabulary is calls, contains,
        // exports, extends, implements, imports, instantiates, overrides,
        // references, uses). Before, a write produced NO edge at all, which is not a
        // stronger statement -- it is an ABSENCE, and the fact that this function
        // writes this field was unrepresented anywhere in the graph. With this
        // change it is represented once, and a consumer that cares about writes can
        // see it; a consumer that wants reads has the same information it had,
        // because the metadata does not claim a read.
        const isWrite = parent && parent.type === "assignment_expression" && lhs && lhs.startIndex === node.startIndex && lhs.endIndex >= node.endIndex
        // `isWrite` is still computed: the identifier branch below keeps its own
        // copy of the same test, and this one stays for the metadata below so the
        // edge carries the fact that it is a write rather than a read.
        // CGD17 (M37 #601): a field_expression in the CALLEE position is a
        // CALL, not a read — `p->xClose(p)` emitted BOTH `calls xClose`
        // (from the call_expression branch) and `uses xClose [field_access]`
        // here, doubling every member-function invocation (family contract:
        // one edge per pair). Span-match the call's `function` field.
        const isCallee = parent?.type === "call_expression" &&
          parent.childForFieldName("function")?.startIndex === node.startIndex
        const field = node.childForFieldName("field")
        const obj = node.childForFieldName("argument") || node.namedChild(0)
        if (field && field.text.trim() && !isCallee) {
          const sourceScope = scopeManager.getRelationshipSource()
          // One name occurrence, ONE edge. The key is shared with the identifier
          // branch below on purpose (`::uses::` on BOTH sides): a field read is
          // read twice by the walk -- once at the `field_expression`, once at its
          // own `field_identifier` leaf -- and when the two branches spelled the
          // dedup key differently (`::uses::` against `::use::`) the set could not
          // see that they were the same edge, so every field read in C published
          // two `uses` edges for one occurrence: `field_access`@0.9 from the
          // parent and `identifier_usage`@1.0 from the leaf. One fact, two
          // confidences a threshold filter would return both of, and one fact
          // split across two `relationshipType` vocabularies so any count by
          // relationshipType halved a single semantic event.
          // Measured: 2,369 provable occurrences over 80 redis files (35200
          // edges), 274 over the C fixtures plus a curl/lib slice -- one class,
          // no others. The `field_access` edge is the survivor because it is the
          // one that carries the receiver (`accessedFrom`); pinned by
          // `c/field-read-single-edge`.
          const relKey = `${sourceScope}::uses::${field.text}`
          if (!emittedUseRelationships.has(relKey)) {
            emittedUseRelationships.add(relKey)
            relationships.push({
              source: sourceScope,
              target: field.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              line_number: this.nodeLine(field),
              metadata: { relationshipType: "field_access", accessedFrom: obj?.text },
            })
          }
        }
      } else if (node.type === "init_declarator") {
        // CGD8 (M37 #601): the old init_from_call edge — `p -uses->
        // make_thing` for `Type *p = make_thing();` — is REMOVED. Measured
        // on sqlite @60: 945 distinct dangling edges, every one duplicating
        // the same-site `f -calls-> make_thing` (the enclosing function's
        // call edge already carries the semantic). The dataflow claim
        // ("p receives make_thing's return value") is real but needs
        // cross-file signature resolution to name the return TYPE — a
        // recorded non-goal (C-D2: no macro expansion, no cross-TU
        // resolution). Worse, the source is the LOCAL variable `p`, which
        // never becomes a symbol (extractDeclaration: execution artifact),
        // so the edge could never resolve in the graph. If dataflow edges
        // are wanted later, they must source the enclosing FUNCTION and be
        // gated by resolvable return types.
      } else if (
        inArray(
          [
            "identifier",
            "field_identifier",
            "type_identifier",
            "struct_specifier",
            "union_specifier",
            "enum_specifier",
          ],
          node.type,
        )
      ) {
        let text = node.text
        if (inArray(["struct_specifier", "union_specifier", "enum_specifier"], node.type)) {
          const nameNode = node.childForFieldName("name")
          if (nameNode) text = nameNode.text
        }
        const sourceScope = scopeManager.getRelationshipSource()
        const currentFunction = scopeManager.getCurrentFunctionName()
        const locals = currentFunction ? functionLocals.get(currentFunction) : undefined
        // CGD12 re-route (M37 #601): a plain identifier in a TYPE position
        // (sizeof(X) argument, `(i64)x` cast) that resolves as a TYPE
        // (declaredTypes) emits a REFERENCES edge — one contract for type
        // usage regardless of grammar accident (type_identifier vs
        // identifier-in-type-position). Value resolution is untouched.
        const resolvesAsType =
          this.isTypePositionIdentifier(node) &&
          this.isResolvableUseTarget(text, "type_identifier", symbols, globalVars, structs, unions, enums, declaredTypes, declaredNames)

        if (
          text &&
          text.trim() !== "" &&
          sourceScope !== "" &&
          !this.isDeclarationLikeIdentifier(node) &&
          !(locals && locals.has(text)) &&
          // CGD27 (M37 #601): a designated-initializer field designator —
          // `.nKeySize = KVRECORD_KEY_SZ` parses as field_designator >
          // field_identifier — NAMES the field being initialized (a write
          // target), it does not read it. The old code emitted `uses
          // nKeySize [field_identifier]` for every designated initializer
          // (os_kv.c's entire method table). The VALUE side of the
          // initializer still walks and emits its own edges.
          node.parent?.type !== "field_designator" &&
          // CGD12 (M37 #601): a plain-identifier TYPE position —
          // `sizeof(VfslogFile)` parses the argument as identifier inside
          // parenthesized_expression inside sizeof_expression (probe
          // c-ref-src) — is a TYPE REFERENCE, not a value read. RE-ROUTED
          // (not dropped): resolvesAsType forces the references emission
          // below; a value-only name keeps its normal path.
          // CGD11 (M37 #601): an identifier inside PREPROCESSOR CONDITION
          // TEXT (`#if SQLITE_ENABLE_LOCKING_STYLE>0`, `#ifdef X`,
          // `defined(A) && defined(B)`) is not a code-level read — the
          // preprocessor is textual (C-D2) and the condition vanishes or
          // selects code; it never executes. Gate mirrors the oracle's
          // isDirectiveConditionText: path to the first preproc_* ancestor
          // through NO code container (statement/declaration/declarator/
          // specifier/enumerator). Conditional CODE inside `#ifdef` blocks
          // still walks and emits — test files are one giant #ifdef block.
          !(this.isDirectiveConditionText(node)) &&
          // CGD40-mirror (M49 W17, measured jq src/builtin.c L2056-2061):
          // parse recovery SPLICES directive lines into continuing code —
          // `#undef LIBM_DDD` survives as an argument_list operand with no
          // preproc_* ancestor, so isDirectiveConditionText is blind. The
          // preprocessor is line-anchored text (C-D2): a mention whose
          // PHYSICAL source line starts with '#' is directive text. Mirrors
          // the oracle's CGD40 use-truth gate one-for-one.
          !(this.isHashLineMention(node)) &&
          // A call-target identifier already emits a `calls` edge from the
          // call_expression branch — skipping it here avoids the redundant
          // `uses` pair (family contract: one edge per pair).
          node.parent?.type !== "call_expression" &&
          // CGD34 (M37 #601, measured mem3.c/malloc.c/loadext.c): a bare
          // identifier DIRECTLY under function_definition is the NAME of a
          // phantom function recovered from a macro-mangled declaration —
          // `static SQLITE_WSD struct Mem3Global {` parses as a
          // function_definition whose direct children are
          // [storage_class, type_identifier(SQLITE_WSD), ERROR, identifier
          // (Mem3Global = the recovered "name"), compound_statement]. In
          // well-formed C a function name is always wrapped in a
          // function_declarator (suppressed via isDeclarationLikeIdentifier);
          // only error recovery produces the bare child, and reading it as a
          // value use fabricated `uses Mem3Global` sourced at the phantom
          // function itself.
          // #935: CGD34's gate, NARROWED to the node types it was written for.
          // The rule was "a bare `identifier` DIRECTLY under a function_definition
          // is the NAME of a phantom function recovered from a macro-mangled
          // declaration", but the predicate tested only the PARENT, so it
          // suppressed every direct child -- and a function_definition's direct
          // children include its RETURN TYPE:
          //
          //   function_definition
          //     type_identifier        <- the return type, e.g. `Color f(void)`
          //     function_declarator    <- the name and parameters
          //     compound_statement
          //
          // A return type spelled with a TYPEDEF name is a `type_identifier` in
          // exactly that position, so every function declared with a typedef
          // return type -- the most common C declaration idiom there is -- lost
          // its `references` edge. Measured: 2,903 return types pass through this
          // gate across 326 corpus files, of which 37 name a type the analyzer
          // can resolve, so **37 real edges were missing** (31 in redis: e.g.
          // `defragModuleGlobals() returns doneStatus`; 4 in curl, 2 in libgit2).
          // The pinned M12 ground truth expects exactly this edge --
          // `rel:Negative.c:references:pick_color:Color` -- and the drift probe
          // found it as the one genuinely-lost row among six.
          //
          // Narrowing is SAFE for CGD34's own subject: the phantom's NAME parses
          // as a bare `identifier` (still suppressed below), and the
          // `type_identifier` sibling in that same phantom shape is a MACRO
          // (`SQLITE_WSD`), which `isResolvableUseTarget` refuses for a
          // `type_identifier` because no such type is declared in the file. The
          // `cgd31-37-regressions` fixture pins both halves.
          (node.parent?.type !== "function_definition" ||
            (node.type !== "identifier" && node.type !== "field_identifier")) &&
          // CGD31 (M37 #601, measured os_kv.c): a `field_identifier` LEAF
          // under a callee-position field_expression
          // (`sqlite3KvvfsMethods.xRcrdRead(...)`) fired a redundant `uses`
          // here — the call_expression branch already emits `calls
          // xRcrdRead` (isFuncPtr), and CGD17 gated only the field_expression
          // NODE, never its leaf (whose parent is field_expression, so the
          // rule above cannot see the call). Span-match the call's `function`
          // field exactly, as CGD17 does.
          !(node.parent?.type === "field_expression" &&
            node.parent.parent?.type === "call_expression" &&
            node.parent.parent.childForFieldName("function")?.startIndex === node.parent.startIndex &&
            // Only the FIELD leaf is a callee — the OBJECT leaf
            // (`sqlite3KvvfsMethods.xRcrdRead(...)` → sqlite3KvvfsMethods) is
            // a genuine value read of the table variable and must keep its
            // `uses` edge (CGD31 over-suppressed it on first draft,
            // measured missing `uses sqlite3KvvfsMethods` in os_kv.c).
            node.parent.childForFieldName("field")?.startIndex === node.startIndex
          ) &&
          // CGD37 (M37 #601, measured os_kv.c L363): when a designated
          // initializer's VALUE is itself an identifier, tree-sitter-c
          // parses `.xRcrdRead = kvrecordRead` as field_expression under
          // assignment_expression (not field_designator) — the designator
          // NAMES the field being initialized (a WRITE), so the leaf must
          // stay silent while the value side (`kvrecordRead`) still walks.
          // Mirrors CGD1's LHS-span test one level up (field_expression is
          // the assignment LHS here).
          !(node.parent?.type === "field_expression" &&
            node.parent.parent?.type === "assignment_expression" &&
            node.parent.parent.namedChild(0)?.startIndex === node.parent.startIndex &&
            (node.parent.parent.namedChild(0)?.endIndex ?? 0) >= node.parent.endIndex &&
            node.parent.childForFieldName("field")?.startIndex === node.startIndex
          ) &&
          // #960: the same withdrawal as the field branch above, on the IDENTIFIER
          // path -- an assignment to a plain value (`initialized = 1`) rather than to
          // a field. CGD1 (M37 #601) excluded it for the same reason SCD1 excluded
          // the field form, and the reasoning fails identically: the grammar folds
          // `g_counter = 5` and `g_counter += 1` into `assignment_expression` while
          // `g_counter++` is an `update_expression` that never reaches this gate, so
          // the analyzer already published a `uses` for the increment form and not for
          // the two assignment forms. There is no reading under which that is
          // consistent.
          //
          // The pinned M12 truth requires this edge: `uses:module_init:initialized`
          // and `uses:module_shutdown:initialized` are both assignment targets, and
          // they are the last TWO facts the truth reports as "not produced" once the
          // field branch is fixed. Span-match the LHS exactly -- web-tree-sitter
          // returns FRESH node objects per child() call, so reference identity never
          // matches (the DAD3 oracle lesson).
          // A C KEYWORD can never name a value — reserved words are lexed as
          // keywords, so an `identifier` whose TEXT is one is grammar-recovery
          // debris, never a read. Measured (resolve.c L1336): the `#endif`-glued
          // `else if( is_agg==0 && …)` leaves an `identifier "if"` inside an ERROR
          // whose enclosing scope is resolveExprStep, and the resolvable-use gate
          // below resolved it, fabricating `uses resolveExprStep -> if` — the one
          // unexplained edge the whole-corpus c lane kept after #916. The
          // C_KEYWORDS filter above covers function NAMES only, which is exactly
          // what its comment predicted ("each seeding a bogus `uses` edge").
          !C_KEYWORDS.has(text) &&
          (this.isResolvableUseTarget(text, node.type, symbols, globalVars, structs, unions, enums, declaredTypes, declaredNames) || resolvesAsType) &&
          // CGD33 (M37 #601, measured jimsh0.c ×101 / libcmpp.c ×86): a
          // plain `identifier` that resolves ONLY as a TYPE declaration
          // (struct/union/enum tag or typedef alias — type maps, declaredTypes,
          // Type/Enum symbols) with NO value declaration cannot be a
          // legitimate value read in well-formed C (C has no first-class
          // type values; sizeof/cast/_Alignof positions are detected type
          // positions and re-routed to REFERENCES by CGD12/CGD28). Every
          // `uses <typeName>` emission is a parse artifact of macro-mangled
          // regions (jimsh0: 37/37 plain `Jim_Obj` identifiers sit inside
          // ERROR spans while the 1105 real uses parse as type_identifier).
          // Suppression mirrors the oracle's declaredNames-gated uses truth
          // and keeps the one-edge-per-semantic contract.
          !(node.type === "identifier" && !resolvesAsType && this.isTypeOnlyName(text, symbols, globalVars, structs, unions, enums, declaredTypes, declaredNames)) &&
          // #907 round 2: the NAME of a recovered glued definition is a
          // declaration of that name, never a read of it. Without this the use
          // path resolves the definition header's own identifier against the
          // symbol the recovery just added and fabricates a `uses` edge from the
          // enclosing function (F5 flagged exactly these; see gluedDefNameOffsets).
          !this.gluedDefNameOffsets.has(node.startIndex)
        ) {
          // Family contract (matches Java M12.01): a type identifier is a
          // REFERENCES edge (type usage); a value identifier (global var, enum
          // member) is a USES edge — never both for the same pair.
          const isTypeNode =
            resolvesAsType ||
            inArray(
              ["type_identifier", "struct_specifier", "union_specifier", "enum_specifier"],
              node.type,
            )
          // `::uses::` / `::ref::`, spelled the SAME way the field_expression
          // branch spells its key above. The two branches produce the same
          // relationship kind for the same name occurrence, so they must share
          // one dedup key or the "one edge per pair" contract is unenforced
          // between them (that mismatch was measured as 2,369 duplicate field
          // reads in redis alone).
          const relKey = `${sourceScope}::${isTypeNode ? "ref" : "uses"}::${text}`
          if (!emittedUseRelationships.has(relKey)) {
            emittedUseRelationships.add(relKey)
            relationships.push({
              source: sourceScope,
              target: text,
              type: isTypeNode ? ASTEngine.RelationshipType.References : ASTEngine.RelationshipType.Uses,
              confidence: isTypeNode ? 0.8 : 1.0,
              // M59.A7: the identifier node the name came from — a type
              // expression's start is not the line of the types inside it.
              line_number: this.nameLine(node),
              metadata: isTypeNode
                ? { relationshipType: "type_reference", nodeType: node.type }
                : { relationshipType: "identifier_usage", nodeType: node.type },
            })
          }
        }
      }

      // --- Recurse ---
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          const isCond =
            isConditional ||
            inArray(["preproc_ifdef", "preproc_if", "preproc_elif", "preproc_else"], child.parent?.type || "")
          stack.push({ node: child, isConditional: isCond, isExit: false, pushedScope: false })
        }
      }
    }

    // Patterns
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(structs)
    )
      patterns["Structured Data Types"] = true
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(unions)
    )
      patterns["Memory-Efficient Unions"] = true
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(enums)
    )
      patterns["Enumerated Constants"] = true

    // Frameworks & Phantoms
    const frameworks = this.detectCFrameworks(imports)

    // 4. METRIC CALCULATION
    let security = 50
    let maintainability = 50

    if (mallocCount > 0 && freeCount > 0) {
      if (mallocCount === freeCount) security += 25
      else security += 10
    }

    if (hasUnsafeStrings) security -= 30
    if (hasSafeStrings) security += 15
    if (hasGotoStatements) maintainability -= 10
    if (hasVolatileQualifier) patterns["Hardware-Aware Code"] = true
    if (hasRestrictQualifier) patterns["Strict Aliasing Optimization"] = true
    if (hasInlineAsm) { security -= 15; maintainability -= 10 }
    if (hasSignalHandlers) patterns["Signal-Driven Architecture"] = true
    if (hasSetjmpLongjmp) { security -= 20; patterns["Non-Local Control Flow"] = true }
    if (hasVariableFormatString) security -= 25
    if (hasDangerousCalls) security -= 20
    if (hasAtomicTypes) patterns["Lock-Free Concurrency"] = true

    if (cyclomaticComplexity > 15) maintainability -= 20
    if (cyclomaticComplexity > 50) maintainability -= 30

    const score = Math.round((security + maintainability) / 2)
    const patternsArray = (function (o) {
      const arr: string[] = []
      for (let k in o) arr.push(k)
      return arr
    })(patterns)

    const insights: any[] = []

    // Post-loop: add contains for REAL container ownership only
    // (struct→field, union→field, enum→member). Top-level symbols carry the
    // synthetic scope name "global" — `global contains core_init` would be a
    // dangling edge (no symbol named `global` exists) and pollutes the graph,
    // matching the Java family ontology where contains is container→member.
    //
    // HC2 (holy-c second review): merge same-entity file-scope duplicates —
    // tentative definitions (`int x; int x;`), extern+definition pairs, and
    // prototype+definition pairs (`int f(int); int f(int){...}`) each emitted
    // one symbol PER OCCURRENCE (the prototype case even double-exported).
    // In one TU these are a single entity: keep the definition (a Function
    // without isDeclaration, a Variable with an initializer is still just a
    // Variable — first occurrence wins there), else the first occurrence.
    // Scoped/owned symbols (fields, members) are a different namespace and
    // never merge; cross-kind collisions (illegal C) are left alone.
    {
      const best = new Map<string, number>()
      const drop = new Set<number>()
      const isDefinition = (s: ASTEngine.UniversalSymbol): boolean =>
        !(s.metadata as any)?.isDeclaration
      for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i]
        if (!s || (s as any).ownerName || s.scope !== "global") continue
        if (s.kind !== ASTEngine.SymbolKind.Function && s.kind !== ASTEngine.SymbolKind.Variable) continue
        const key = `${s.kind}::${s.name}`
        const prev = best.get(key)
        if (prev === undefined) {
          best.set(key, i)
        } else if (isDefinition(s) && !isDefinition(symbols[prev])) {
          drop.add(prev)
          best.set(key, i)
        } else {
          drop.add(i)
        }
      }
      if (drop.size > 0) {
        const kept = symbols.filter((_, i) => !drop.has(i))
        symbols.length = 0
        symbols.push(...kept)
      }
    }
    for (const s of symbols) {
      if (!s.ownerName) continue
      relationships.push({
        source: s.ownerName,
        target: s.name,
        type: ASTEngine.RelationshipType.Contains,
        confidence: 1.0,
        // M59.A7 (#825) + #921 (M60): a contains edge moves WITH its symbol, but
        // "the child's line" is the line that NAMES it (the rule every other
        // relationship type follows, and the rule the M59 Tier A oracle checks),
        // while the symbol's RANGE stays the whole declaration node — search, edit
        // anchors and the M73 line base read that. The two were the same thing
        // only because a member's declaration usually starts on its name's line.
        line_number: (s.metadata as any)?.nameLine ?? s.range?.startLine,
        metadata: {},
      })
    }

    // #383 payload attach: calls per enclosing function.
    for (const sym of symbols) {
      const qc = qcByFunction.get(sym.name)
      if (qc && qc.length > 0) sym.qualified_calls = [...new Set(qc)]
    }

    // #419-D evidence tiers on EVERY edge (family classifier).
    this.classifyEvidenceTier(relationships)

    return {
      language: "c",
      symbols,
      relationships,
      imports,
      exports: symbols.filter((s) => s.visibility === "public" && (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Variable)).map((s) => ({
        name: s.name,
        type: s.kind,
        range: s.range,
        isType: false,
      })),
      errors,
      metadata: {
        // REAL cyclomatic complexity - the old 'complexity' field was the
        // synthetic symbols+relationships heuristic (fifth analyzer with
        // that disease).
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworks[0] || "Standard C",
        patterns: patternsArray,
        detectedFrameworks: frameworks,
        frameworkPatterns: [{ framework: frameworks[0] || "C", patterns: patternsArray }],
        architecturalInsights: insights,
        architecturalScore: Math.min(100, Math.max(0, score)),
        codeQuality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        memorySafetyScore: Math.min(100, Math.max(0, security)),
        performanceScore: Math.min(100, Math.max(0, maintainability)),
        portabilityScore: 75,
        analysisVersion: "5.0-c-native-ast-pure-single-pass",
      },
    }
  }

  // --- O(1) Extractor Helpers ---

  /**
   * T1 family contract: 1 + decision points (branch constructs +
   * short-circuit operators; goto/labels are NOT decisions).
   */
  private functionComplexity(node: Node): number {
    const decisionTypes = new Set([
      "if_statement", "for_statement", "while_statement", "do_statement",
      "case_statement", "conditional_expression",
    ])
    let c = 1
    const st: Node[] = [node]
    while (st.length) {
      const n = st.pop()!
      if (decisionTypes.has(n.type)) c++
      else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) st.push(ch)
      }
    }
    return c
  }

  /**
   * #419-D evidence-tier classification for EVERY emitted relationship
   * (family rules).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      // M60/#910: the dedicated `imports` kind carries module dependencies
      // (the JVM/web families' import_based tier, T1 bug class) — the same
      // class the old references+isImport path was given explicitly below.
      if (t === "imports") { md.evidenceClass = "import_based"; continue }
      if (t === "references") {
        md.evidenceClass =
          md.includeDependency || md.isImport ? "import_based"
          : md.relationshipType === "type_reference" ? "reference_qualified"
          : "usage_contextual"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private getIncludePath(node: Node): string | null {
    let pathNode = node.childForFieldName("path")
    // M49 W22 (measured sqlite3-wasm.c L262): tree-sitter-c parses a
    // macro-COMPOSED include argument (`#include INC__STRINGIFY(SQLITE_C)`)
    // as a call_expression under the same `path` field a literal path uses.
    // A composed path is not a statically resolvable header name (C-D2: the
    // preprocessor is textual; the expansion needs the build's -D set), so
    // it must not be emitted as an include_dependency target — mirrors the
    // oracle's CGD16 literal-only mirror. Literal forms (string_literal /
    // system_lib_string) keep every existing behavior.
    if (pathNode && pathNode.type !== "string_literal" && pathNode.type !== "system_lib_string") pathNode = null
    if (!pathNode) {
      pathNode = this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string") || null
    }
    return pathNode ? stripIncludeChars(pathNode.text) : null
  }

  private extractInclude(node: Node, imports: ASTEngine.ImportInfo[], onPath: (path: string) => void) {
    let pathNode = node.childForFieldName("path")
    // M49 W22: same literal-only contract as getIncludePath — a
    // macro-composed include argument parses as a call_expression under the
    // `path` field and is not a resolvable module name.
    if (pathNode && pathNode.type !== "string_literal" && pathNode.type !== "system_lib_string") pathNode = null
    if (!pathNode) {
      pathNode = this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string") || null
    }
    if (pathNode && pathNode.text.trim()) {
      const rawPath = pathNode.text
      const isSystem = rawPath[0] === "<"
      onPath(rawPath)
      imports.push({
        module: stripIncludeChars(rawPath),
        items: ["*"],
        range: this.nodeToRange(node),
        metadata: { isSystemInclude: isSystem, isImport: true },
      })
    }
  }

  private extractFunction(
    node: Node,
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
    scope: string,
    isConditional: boolean,
    // #916-D: a macro-decorated definition whose return type was eaten by a
    // preceding bare-macro declaration arrives with its NAME in the `type` field
    // and its parameter list in `declarator` — the inverse of every other
    // function_definition. Deriving the name from the declarator there yields the
    // PARAMETER (`function JniArgsEnvClass`) and the return type yields the NAME.
    // The caller proves that shape from the sibling declaration and passes the
    // truth in, rather than this method guessing.
    recovered?: { name: string; returnType: string } | null,
  ): ASTEngine.UniversalSymbol | null {
    const declaratorNode = node.childForFieldName("declarator")
    const nameNode = recovered ? null : this.getIdentifierFromDeclarator(declaratorNode)
    if (!recovered && !nameNode) return null

    const isStatic = this.hasStorageClass(node, "static")
    const isInline = this.hasStorageClass(node, "inline")
    let usesPointers = this.isPointerType(declaratorNode)

    let returnTypeNode =
      node.childForFieldName("type") ||
      this.findChild(node, (c) =>
        inArray(
          [
            "primitive_type",
            "type_identifier",
            "sized_type_specifier",
            "struct_specifier",
            "enum_specifier",
            "union_specifier",
          ],
          c?.type || "",
        ),
      )

    const parameters: ASTEngine.Parameter[] = []

    // Deeper parameter scan without crashing loops
    let pList = this.findFirstChildOfType(declaratorNode, "parameter_list")

    if (pList) {
      for (let i = 0; i < pList.namedChildCount; i++) {
        const paramNode = pList.namedChild(i)
        // HC3 (holy-c second review): K&R / untyped parameter names parse
        // as bare identifiers (`int add(a, b)`), which the scan skipped —
        // the params payload lost them (names also feed functionLocals via
        // the K&R declaration path, so reads were already correct; this
        // completes the payload with an honest `any` type).
        if (paramNode && paramNode.type === "identifier") {
          if (paramNode.text.trim()) parameters.push({ name: paramNode.text, type: "any" })
          continue
        }
        if (paramNode && (paramNode.type === "parameter_declaration" || paramNode.type === "variadic_parameter")) {
          if (paramNode.type === "variadic_parameter") {
            parameters.push({ name: "...", type: "variadic", modifiers: [] })
            continue
          }
          const typeNode = paramNode.childForFieldName("type")
          const pDeclNode = this.getIdentifierFromDeclarator(paramNode.childForFieldName("declarator"))
          let paramType = typeNode ? typeNode.text : "any"
          const isFuncPtr = paramNode.text.includes("(*") || paramNode.text.includes("(^") || !!this.findFirstChildOfType(paramNode.childForFieldName("declarator"), "function_declarator")
          if (isFuncPtr) paramType = "function_pointer"
          
          parameters.push({
            name: pDeclNode ? pDeclNode.text : "unknown",
            type: paramType,
          })
          if (this.isPointerType(paramNode.childForFieldName("declarator"))) {
            usesPointers = true
          }
        }
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      name: recovered ? recovered.name : nameNode!.text,
      kind: ASTEngine.SymbolKind.Function,
      range: this.recoverFunctionRange(node, content),
      scope: "global",
      complexity: this.functionComplexity(node),
      visibility: isStatic ? "private" : "public",
      isStatic,
      returnType: recovered ? recovered.returnType : returnTypeNode ? returnTypeNode.text : "any",
      parameters,
      metadata: { cSpecific: true, usesPointers, isInline, isConditional, ...(recovered ? { recoveredFromMacroTruncation: true } : {}) },
    }

    symbols.push(symbol)
    return symbol
  }

  private extractStruct(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    scope: string,
    isConditional: boolean,
    // #932: the file's declared type names, so a field_declaration whose name slot
    // holds a TYPE can be recognised (see `fieldDeclarationNamesAType`).
    declaredTypes: Set<string>,
    allMacroNames: Set<string>,
  ) {
    // #951: an inline aggregate member takes the MEMBER PATH as its name, so two of
    // them stop sharing the placeholder `anonymous_struct`. Everything else keeps
    // the tag-or-alias name it always had.
    const nameNode = node.childForFieldName("name")
    let structName = this.specifierOwnName(node)
    if (structName === "anonymous_struct") {
      structName = this.inlineAggregateOwnerName(node) ?? "anonymous_struct"
    }
    // #961: A FUNCTION-LOCAL TYPE IS QUALIFIED BY ITS ENCLOSING FUNCTION.
    //
    // The bare name does not survive the corpus: measured over the three corpora, 3 of
    // the 20 function-local named types collide with a FILE-SCOPE type of the same name
    // -- `transfer` (curl/lib/vssh/libssh2.c:3465), `entry`
    // (curl/tests/libtest/lib1915.c:35) and `clar_counter`
    // (libgit2/deps/clar/clar/counter.h:86). Publishing `entry` twice in one file
    // yields two symbols with one name and makes every `contains` edge from either
    // ambiguous.
    //
    // `scope` is `getScopeName()`, which joins every scope below global, so for a
    // local struct it is exactly the qualified path (`lpRandomEntries.pick`) and at
    // file scope it is the bare tag. It is therefore used AS the name rather than
    // prefixed onto one -- an earlier draft prefixed and produced
    // `lpRandomEntries.lpRandomEntries.pick.pick`, and a second draft that prefixed
    // only in the caller produced `lpRandomEntries.lpRandomEntries.pick` because the
    // caller had already qualified the Struct scope it pushes.
    //
    // The qualification belongs HERE and not in the `struct_specifier` case in
    // `analyze`: that case's `structName` never reaches the symbol, because this
    // extractor derives its own from `specifierOwnName`, which reads the source tag.
    // The qualified name was computed in the caller and dropped -- the trace showed
    // `enclosingFunctionName="lpRandomEntries"` while the payload published a bare
    // `pick`.
    //
    // Every step of the resulting path is a real symbol -- the function and the type --
    // so a `contains` edge anchored on it RESOLVES. That is what distinguishes this
    // from the block-scope naming the contract forbids: `block_1920` names no symbol,
    // and the enclosing function does.
    //
    // It applies ONLY to a type DECLARATION, never to an inline aggregate. An inline
    // aggregate (`struct { ... } inner;` as a MEMBER) already has the correct owner
    // path from `inlineAggregateOwnerName` -- #950's `S.val` and #958's
    // `R.val.verbatim` -- and taking `scope` for it destroyed those three pinned rows,
    // because the scope chain at that point is the ENCLOSING type (`envelope.body`),
    // not the aggregate being named (`envelope.body.verbatim`). An inline aggregate's
    // specifier sits in a `field_declaration`, which is exactly what
    // `inlineAggregateOwnerName` keys on, so a null there is the precise test for "this
    // is a declaration and not a member".
    if (scope && scope !== "global" && this.inlineAggregateOwnerName(node) === null) structName = scope
    // A struct_specifier without a body is a forward/reference declaration
    // (e.g. `typedef struct Point Point;` or `struct Point *p;`). It is not a
    // definition site — skip it to avoid phantom duplicates; the definition
    // with a body emits the symbol once.
    if (!node.childForFieldName("body")) return
    const isPacked = this.isPacked(node)

    const fields: any[] = []
    // #950: the inline-aggregate keys registered while walking this body, keyed by
    // the member declaration's start offset, and a sequence for naming them.
    const inlineKeys = new Map<number, string>()
    const anonSeq = { n: 0 }
    // #947: how many members the extractor declined because their only name in the
    // parse is a macro's. Struct-level, because a declined member leaves no record.
    let declinedCount = 0
    const bodyList = node.childForFieldName("body")
    // #943/#946: the same conditional-body detection the struct path does, for
    // the same reason -- see `bodyHasConditionalMembers`.
    const bodyIsConditional = this.bodyHasConditionalMembers(bodyList)
    // #948: an UNNAMED bitfield (`unsigned int :0;`, `unsigned int :3;`) is a
    // layout fact with no name, so the member extractor correctly declines to
    // publish a member for it -- and the layout then never learns it exists.
    // Measured: `struct { unsigned before:3; unsigned :0; unsigned after:3; }` is
    // 8 bytes to clang, because the zero-width field forces `after` to a new
    // 32-bit unit. Published 4, unmarked.
    //
    // Packing it needs to know WHERE the marker sits in the bit cursor, and the
    // member extractor visits members in order while this would have to be
    // re-interleaved. So it is NOT guessed: the type is marked as partly
    // unmeasured and the published size stays an honest lower bound. The
    // alternative -- rounding the struct up by the marker type's alignment
    // wherever it appears -- would produce a right number for the common
    // trailing-marker case and a confidently wrong one everywhere else.
    const hasUnnamedBitfield = this.bodyHasUnnamedBitfield(bodyList)
    if (bodyList) {
      // #957: a member declared inside a preprocessor CONDITION is a member.
      //
      // `struct eventNotifier { #ifdef HAVE_EVENT_FD int efd; #else int pipefd[2];
      // #endif } eventNotifier;` (redis/src/eventnotifier.h:19-25) parses with the
      // `preproc_ifdef` as a DIRECT child of the `field_declaration_list` and NO
      // `field_declaration` at that level, so iterating named children found nothing
      // to publish and the struct was emitted with a symbol and ZERO `contains`
      // edges. Found by contains-vs-clang.ts, which is the first oracle in this
      // lane to judge `contains` against a parser that is not the one the analyzer
      // uses -- every tree-sitter-based counter had reported this file as clean,
      // because the payload and the parse agree that there is no field_declaration
      // to find. Agreement between a payload and the grammar that produced it is not
      // evidence about the grammar.
      //
      // A conditional member is a REAL member: the project compiles with one of the
      // arms, and the struct is unusable without it. The preprocessor is textual
      // (C-D2), so the analyzer cannot know WHICH arm -- it publishes every arm's
      // members, which is the honest superset and matches what a C consumer needs to
      // see. `pipefd` and `efd` coexisting in one payload is a true statement about
      // the two possible compilations, and is the same shape as the macro-mediated
      // members already published for #908.
      const memberNodes: Node[] = []
      const collectMembers = (list: Node) => {
        for (let i = 0; i < list.namedChildCount; i++) {
          const child = list.namedChild(i)
          if (!child) continue
          if (child.type === "preproc_ifdef" || child.type === "preproc_if") {
            // Only the CONDITION is directive text; both arms are code.
            for (let j = 0; j < child.namedChildCount; j++) {
              const arm = child.namedChild(j)
              if (!arm) continue
              if (arm.type === "field_declaration") memberNodes.push(arm)
              else if (arm.type === "preproc_else" || arm.type === "preproc_elif") {
                // An `#else` arm's members are nested one level deeper.
                for (let k = 0; k < arm.namedChildCount; k++) {
                  const inner = arm.namedChild(k)
                  if (inner?.type === "field_declaration") memberNodes.push(inner)
                }
              }
            }
            continue
          }
          memberNodes.push(child)
        }
      }
      collectMembers(bodyList)
      for (const field of memberNodes) {
        // #950: an INLINE aggregate member -- `struct { ... } name;` or
        // `union { ... } name;`. Its fields are registered under a synthetic key
        // before the member guard below, and the member record picks the key up.
        // Additive on purpose: the guard and the loop that follow are the path
        // already measured at 100% on every type the analyzer claims to model, and
        // nothing in them changes.
        if (field && field.type === "field_declaration") {
          const inlineType = field.childForFieldName("type")
          if (
            inlineType &&
            (inlineType.type === "struct_specifier" || inlineType.type === "union_specifier") &&
            inlineType.childForFieldName("body") &&
            !inlineType.childForFieldName("name")
          ) {
            const key = `__anon_${structName}_${anonSeq.n++}`
            const nested = this.collectInlineAggregateFields(
              inlineType.childForFieldName("body"),
              declaredTypes,
              allMacroNames,
              structs,
              unions,
              anonSeq,
              () => `__anon_${structName}_${anonSeq.n++}`,
            )
            if (inlineType.type === "struct_specifier") structs[key] = nested
            else unions[key] = nested
            inlineKeys.set(field.startIndex, key)
          }
        }
        // #928: a field_declaration with no declarator names no member. A macro-generated
        // field (`BIT(closing);`) has only a macro_type_specifier, and descending to its
        // first named child is how a `property` named after the MACRO used to be
        // published (cf_h2_proxy_ctx.BIT x5). Silence is the honest result -- the real
        // name lives in the macro's replacement list, which is C-D2.
        // #932: a field_declaration whose name slot holds a TYPE (see the rule for
        // why the MISSING `;` is required, and why this suppresses rather than
        // mends) publishes nothing. The real member is then a NAMED LOSS rather
        // than a phantom symbol that resolves to nothing.
        if (
          field &&
          field.type === "field_declaration" &&
          fieldDeclarationHasDeclarator(field) &&
          !fieldDeclarationNamesANonDeclarator(field, declaredTypes, allMacroNames)
        ) {
          let typeNode =
            field.childForFieldName("type") ||
            this.findChild(field, (c) =>
              inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "enum_specifier",
                  "union_specifier",
                ],
                c?.type || "",
              ),
            )

          for (let j = 0; j < field.childCount; j++) {
            const rawDecl = field.child(j)
            if (
              rawDecl &&
              !inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  ";",
                  "type_qualifier",
                  "storage_class_specifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "union_specifier",
                  "enum_specifier",
                  ",",
                  "bitfield_clause",
                ],
                rawDecl.type,
              )
            ) {
              let arraySize = 1
              let unresolvableDimensions = false
              let bitfieldClause = ""
              // #944: a BITFIELD. `uint32_t iskey:1;` is not a 4-byte member, and
              // the bitfields in redis's raxNode (three 1-bit flags plus a 29-bit
              // counter) pack into ONE 4-byte unit where the model charged 16.
              // The packing rule is a real algorithm and this model does not
              // implement it, so the width is unknown -- but a wrong width is
              // worse than a marked lower bound, and the type must not be
              // published as measured.
              let isBitfield = false
              let isPointer = this.isPointerType(rawDecl)
              let declNode: Node | null = rawDecl

              // #945: the clause's TEXT, so the width can be resolved where the
              // per-file macro and enum tables are in scope, rather than here.
              {
                const clause = this.findChild(field, (c: any) => c?.type === "bitfield_clause")
                if (clause) {
                  isBitfield = true
                  bitfieldClause = clause.text
                }
              }

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") || this.findChild(declNode, (c) => c?.type === "number_literal")
                  // #939: a dimension spelled as a same-file macro resolves too.
                  const dim = this.arrayDimension(sizeNode)
                  if (dim !== null) {
                    arraySize *= dim
                  } else if (!sizeNode) {
                    // #941: a FLEXIBLE ARRAY MEMBER, `T name[]` with no dimension.
                    // C99 6.7.2.1p16 says it is ignored when the size of the
                    // containing struct is computed, so it contributes ZERO bytes
                    // -- and the default of 1 invented a byte. redis's `intset` is
                    // `{ uint32_t encoding; intsetLevel length; uint8_t contents[]; }`
                    // and published 12 bytes where clang says 8: the two real
                    // members plus one byte of imagination, padded out to 4.
                    //
                    // Zero rather than 1 because zero is the DEFINED answer, not a
                    // guess, so this stays a computation and is deliberately NOT
                    // counted by `layoutUnknownMembers`. A sizeless array that is
                    // not a flexible array member is invalid C, and zero is the
                    // right answer for that too.
                    arraySize = 0
                  } else {
                    // #942: a dimension that EXISTS but cannot be resolved -- an
                    // enum constant, or a macro defined in another file. The
                    // count silently defaulted to 1, and 1 is a CLAIM, not a
                    // default: redis's `int metaSize[NUM_MSTR_FLAGS]` published as
                    // a 1-element array (16 bytes) where clang says 72, with
                    // nothing marking the guess. Counted as unknown for that
                    // reason, and 1 is kept as the working value.
                    unresolvableDimensions = true
                  }
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              // #947: a macro-mediated function pointer publishes NO member, because
              // the only name in the parse is the macro's -- AND it counts as an
              // unmeasured member, because the struct is now one member short of
              // the truth and its published size is a LOWER BOUND. libgit2's
              // `struct { int CALLBACK(read)(...); int (*plain)(...); }` is 16
              // bytes; with `read` declined the model computes 8. Publishing 8 with
              // no marker would be a wrong number, which is the whole failure mode
              // #940 exists to end.
              if (declNode && this.isMacroMediatedFunctionPointer(rawDecl)) {
                // A STRUCT-level counter, not a field flag: declining the member
                // means no field record is pushed at all, so a flag on the record
                // would have nowhere to live. The first attempt put it on the
                // field and the type still reported `layoutUnknownMembers: 0`.
                declinedCount++
                declNode = null
              }

              if (declNode && declNode.text.trim()) {
                fields.push({
                  name: declNode.text,
                  type: typeNode ? typeNode.text : "unknown",
                  // #927: how the member SPELLS its type, so the layout maths can
                  // respect C's tag/ordinary namespace split instead of matching
                  // bare text against both maps.
                  typeKind: this.memberTypeKind(typeNode),
                  // #936: the member's WIDTH, taken from the AST rather than
                  // from its spelling. See `primitiveClass` for why the two
                  // text tables this replaces could not do this job.
                  primitive: this.primitiveClass(typeNode),
                  arraySize,
                  unresolvableDimensions,
                  isBitfield,
                  bitfieldClause,
                  // #950: the inline aggregate's registered key, so the member's own
                  // width is derivable instead of falling back to 4 unknown bytes.
                  anonymousKey: inlineKeys.get(field.startIndex),
                  isPointer,
                })
                symbols.push({
                  name: declNode.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(rawDecl),
                  scope: structName,
                  ownerName: structName,
                  ownerKind: ASTEngine.SymbolKind.Type,
                  visibility: "public",
                  // #921 (M60): the line that NAMES the field, not the declaration's
                  // start — a wrapped member type (`unsigned long long` then the
                  // name) writes the name below it, and this symbol's containment
                  // edge has to name THAT line.
                  metadata: { isStructField: true, cSpecific: true, isConditional, nameLine: this.nodeLine(declNode) },
                })
              }
            }
          }
        }
      }
    }

    if (structName !== "anonymous_struct") {
      structs[structName] = fields
    }

    symbols.push({
      name: structName,
      kind: ASTEngine.SymbolKind.Struct,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: {
        isStruct: true,
        cSpecific: true,
        isPacked,
        isConditional,
        ...this.layoutPayload(fields, isPacked, structs, unions, is64Bit, isLLP64, bodyIsConditional, false, hasUnnamedBitfield, declinedCount),
      },
    })
  }

  private extractUnion(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    unions: Record<string, any[]>,
    scope: string,
    isConditional: boolean,
    // #932: as `extractStruct`.
    declaredTypes: Set<string>,
    allMacroNames: Set<string>,
    // #946: the union path needs what the struct path already had, to publish a
    // layout payload. The struct extractor takes these as parameters for exactly
    // this reason; the union extractor not taking them is WHY it had no payload.
    structs: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
  ) {
    // #951: as `extractStruct`, an inline aggregate member takes the MEMBER PATH.
    //
    // The first attempt at this landed in the analyze() DISPATCH rather than here,
    // so the union's SCOPE got the path and the union SYMBOL kept the placeholder --
    // and since this function is what emits the symbol, `struct S { union { int a;
    // double b; } val; }` still published `anonymous_union` while the struct case
    // published `S.val` two functions away. The two sites computing the same name is
    // the third time this name has been derived in more than one place in this file,
    // which is why `specifierOwnName` now exists; this site was simply missed.
    let unionName = this.specifierOwnName(node)
    if (unionName === "anonymous_union") {
      unionName = this.inlineAggregateOwnerName(node) ?? "anonymous_union"
    }
    // #961: a FUNCTION-LOCAL union is qualified by its enclosing function, exactly as the
    // struct and enum paths are. The first draft of this wave fixed struct and enum and
    // MISSED union, so `local_union_and_enum`'s anonymous union still published as the
    // PLACEHOLDER `anonymous_union` with `as_int` and `as_float` owned by it -- the #958
    // defect class, on the one arm of the ruling that was left unfixed. A ruling that covers
    // two of the three spellings is half a ruling, and the fixture caught it by naming the
    // arm in a row of its own.
    //
    // The inline-aggregate test mirrors the struct path: an inline union that is a MEMBER
    // already has its correct owner path from `inlineAggregateOwnerName` (#951's `S.val`),
    // and taking `scope` for it would name the ENCLOSING type instead.
    if (scope && scope !== "global" && unionName === "anonymous_union" && this.inlineAggregateOwnerName(node) === null) {
      unionName = scope
    }

    const fields: any[] = []
    // #950: as the struct path.
    const inlineKeys = new Map<number, string>()
    const anonSeq = { n: 0 }
    const bodyList = node.childForFieldName("body")
    // #943/#946: the same conditional-body detection the struct path does, for
    // the same reason -- see `bodyHasConditionalMembers`.
    const bodyIsConditional = this.bodyHasConditionalMembers(bodyList)
    if (bodyList) {
      for (let i = 0; i < bodyList.namedChildCount; i++) {
        const field = bodyList.namedChild(i)
        // #950: an INLINE aggregate member -- `struct { ... } name;` or
        // `union { ... } name;`. Its fields are registered under a synthetic key
        // before the member guard below, and the member record picks the key up.
        // Additive on purpose: the guard and the loop that follow are the path
        // already measured at 100% on every type the analyzer claims to model, and
        // nothing in them changes.
        if (field && field.type === "field_declaration") {
          const inlineType = field.childForFieldName("type")
          if (
            inlineType &&
            (inlineType.type === "struct_specifier" || inlineType.type === "union_specifier") &&
            inlineType.childForFieldName("body") &&
            !inlineType.childForFieldName("name")
          ) {
            const key = `__anon_${unionName}_${anonSeq.n++}`
            const nested = this.collectInlineAggregateFields(
              inlineType.childForFieldName("body"),
              declaredTypes,
              allMacroNames,
              structs,
              unions,
              anonSeq,
              () => `__anon_${unionName}_${anonSeq.n++}`,
            )
            if (inlineType.type === "struct_specifier") structs[key] = nested
            else unions[key] = nested
            inlineKeys.set(field.startIndex, key)
          }
        }
        // #928: a field_declaration with no declarator names no member. A macro-generated
        // field (`BIT(closing);`) has only a macro_type_specifier, and descending to its
        // first named child is how a `property` named after the MACRO used to be
        // published (cf_h2_proxy_ctx.BIT x5). Silence is the honest result -- the real
        // name lives in the macro's replacement list, which is C-D2.
        // #932: a field_declaration whose name slot holds a TYPE (see the rule for
        // why the MISSING `;` is required, and why this suppresses rather than
        // mends) publishes nothing. The real member is then a NAMED LOSS rather
        // than a phantom symbol that resolves to nothing.
        if (
          field &&
          field.type === "field_declaration" &&
          fieldDeclarationHasDeclarator(field) &&
          !fieldDeclarationNamesANonDeclarator(field, declaredTypes, allMacroNames)
        ) {
          let typeNode =
            field.childForFieldName("type") ||
            this.findChild(field, (c) =>
              inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "enum_specifier",
                  "union_specifier",
                ],
                c?.type || "",
              ),
            )

          for (let j = 0; j < field.childCount; j++) {
            const rawDecl = field.child(j)
            if (
              rawDecl &&
              !inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  ";",
                  "type_qualifier",
                  "storage_class_specifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "union_specifier",
                  "enum_specifier",
                  ",",
                  "bitfield_clause",
                ],
                rawDecl.type,
              )
            ) {
              let arraySize = 1
              let unresolvableDimensions = false
              let isBitfield = false
              let bitfieldClause = ""
              let isPointer = this.isPointerType(rawDecl)
              let declNode: any = rawDecl

              // #945: the union extractor detects the clause too, so a union with
              // bitfields is a real case rather than an unflagged one.
              {
                const clause = this.findChild(field, (c: any) => c?.type === "bitfield_clause")
                if (clause) {
                  isBitfield = true
                  bitfieldClause = clause.text
                }
              }

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") ||
                    this.findChild(declNode, (c: any) => c?.type === "number_literal")
                  // #939: a dimension spelled as a same-file macro resolves too.
                  const dim = this.arrayDimension(sizeNode)
                  if (dim !== null) {
                    arraySize *= dim
                  } else if (!sizeNode) {
                    // #941: a FLEXIBLE ARRAY MEMBER, `T name[]` with no dimension.
                    // C99 6.7.2.1p16 says it is ignored when the size of the
                    // containing struct is computed, so it contributes ZERO bytes
                    // -- and the default of 1 invented a byte. redis's `intset` is
                    // `{ uint32_t encoding; intsetLevel length; uint8_t contents[]; }`
                    // and published 12 bytes where clang says 8: the two real
                    // members plus one byte of imagination, padded out to 4.
                    //
                    // Zero rather than 1 because zero is the DEFINED answer, not a
                    // guess, so this stays a computation and is deliberately NOT
                    // counted by `layoutUnknownMembers`. A sizeless array that is
                    // not a flexible array member is invalid C, and zero is the
                    // right answer for that too.
                    arraySize = 0
                  } else {
                    // #942: a dimension that EXISTS but cannot be resolved -- an
                    // enum constant, or a macro defined in another file. The
                    // count silently defaulted to 1, and 1 is a CLAIM, not a
                    // default: redis's `int metaSize[NUM_MSTR_FLAGS]` published as
                    // a 1-element array (16 bytes) where clang says 72, with
                    // nothing marking the guess. Counted as unknown for that
                    // reason, and 1 is kept as the working value.
                    unresolvableDimensions = true
                  }
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              // #947: a macro-mediated function pointer publishes NO member, because
              // the only name in the parse is the macro's.
              if (declNode && this.isMacroMediatedFunctionPointer(rawDecl)) declNode = null

              if (declNode && declNode.text.trim()) {
                fields.push({
                  name: declNode.text,
                  type: typeNode ? typeNode.text : "unknown",
                  // #927: the struct extractor's classification, for the same reason.
                  typeKind: this.memberTypeKind(typeNode),
                  // #936: the member's WIDTH, taken from the AST rather than
                  // from its spelling. See `primitiveClass` for why the two
                  // text tables this replaces could not do this job.
                  primitive: this.primitiveClass(typeNode),
                  arraySize,
                  unresolvableDimensions,
                  isBitfield,
                  bitfieldClause,
                  // #950: the inline aggregate's registered key, so the member's own
                  // width is derivable instead of falling back to 4 unknown bytes.
                  anonymousKey: inlineKeys.get(field.startIndex),
                  isPointer,
                })
                symbols.push({
                  name: declNode.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(rawDecl),
                  scope: unionName,
                  ownerName: unionName,
                  ownerKind: ASTEngine.SymbolKind.Type,
                  visibility: "public",
                  metadata: { isUnionField: true, cSpecific: true, isConditional, nameLine: this.nodeLine(declNode) },
                })
              }
            }
          }
        }
      }
    }

    if (unionName !== "anonymous_union") {
      unions[unionName] = fields
    }

    symbols.push({
      name: unionName,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: {
        isUnion: true,
        cSpecific: true,
        isConditional,
        // #946: the layout payload, which a union did not publish at all. Every
        // #936-#945 fix -- primitive widths, same-file typedef aliases, the shared
        // unknown-member fallback, macro/enum array dimensions, flexible array
        // members, bitfield packing -- landed on the STRUCT path only, because
        // `{ isUnion: true, cSpecific, isConditional }` was the whole metadata
        // object. So a union's size and alignment were not merely wrong, they were
        // ABSENT, and no probe could report on them: the clang comparison filters
        // on `typeof memorySize === "number"` and silently skipped every union in
        // the corpus. An unmeasured payload is not a payload.
        //
        // The same `layoutPayload` call as the struct path, deliberately: one
        // function, so the two cannot drift the way the size and alignment passes
        // had drifted from each other in #938.
        ...this.layoutPayload(fields, false, structs, unions, is64Bit, isLLP64, bodyIsConditional, true),
      },
    })
  }

  private extractEnum(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    enums: Record<string, boolean>,
    scope: string,
    isConditional: boolean,
    macroDefOffsets: Map<string, { at: number; kind: "object" | "function" }>,
  ) {
    const nameNode = node.childForFieldName("name")
    let enumName = nameNode && nameNode.text.trim() ? nameNode.text : "anonymous_enum"
    // Anonymous `typedef enum { ... } Name;` — name the enum from the typedef
    // declarator so the symbol identity is the exported type name.
    if (enumName === "anonymous_enum" && node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) enumName = declNode.text.trim()
    }
    // #961: a FUNCTION-LOCAL enum is qualified by its enclosing function, exactly as the
    // struct path is. Without it an anonymous local enum publishes as the PLACEHOLDER
    // `anonymous_enum` whose members are owned by that placeholder -- the #958 defect
    // class -- and two anonymous enums in one file produce two symbols with one name.
    //
    // `c/macro-wrapped-heading-917` pinned the CGD20 behaviour precisely because
    // publishing leaked `BufSize` and `PlainSize` as file-scope EnumMembers (the
    // measured harm CGD20's own comment cited). Qualifying the type fixes that leak at
    // its CAUSE: the members are owned by `cmpp_stream.anonymous_enum` and
    // `plain_stream.anonymous_enum`, both real symbols, instead of by a name that
    // resolves to nothing. A named local enum is left alone -- the qualifier is only
    // needed where the source has no name to carry the identity.
    if (scope && scope !== "global" && enumName === "anonymous_enum") enumName = scope
    enums[enumName] = true

    const values: string[] = []
    let hasExplicitValues = false
    let isFlagEnum = false

    let listNode = node.childForFieldName("body") || this.findFirstChildOfType(node, "enumerator_list")

    if (listNode) {
      // #930: enumerator fragments that are a macro invocation's ARGUMENTS are not
      // enumerators (curl's `CURLOPT(CURLOPT_WRITEDATA, CURLOPTTYPE_CBPOINT, 1)`
      // in enumerator position). Positional, so a real enumerator in the SAME
      // damaged list still lands -- see the rule for why a blunt "this list is
      // damaged" rejection would have been wrong.
      const macroArgumentEnumerators = enumeratorsInsideMacroInvocation(listNode)
      for (let i = 0; i < listNode.namedChildCount; i++) {
        const enumerator = listNode.namedChild(i)
        if (enumerator && enumerator.type === "enumerator" && !macroArgumentEnumerators.has(enumerator.startIndex)) {
          const enumNameNode = enumerator.childForFieldName("name") || enumerator.namedChild(0)
          // #931 SHADOWING: this local is `memberName`, NOT `enumName`. Naming it
          // `enumName` shadowed the METHOD's own `enumName` (the enum's name) for
          // the rest of the block, so every member came out with
          // `ownerName: <its own name>` and a self-`contains` edge. The corpus
          // caught it; the lane's own P5 could not, because the ownerName was
          // present -- only the SELF-CONTainment property can see this class, and
          // it is now P12 in script/m14/tmp/c-audit/verify-c-lane.ts.
          const memberName = enumNameNode ? enumNameNode.text.trim() : ""
          // #931: an enumerator whose name is a MACRO defined at or before this
          // point is a macro USE, not a declaration -- the preprocessor replaces
          // the identifier, so the enumerator does not exist. Measured, all one
          // class: `CURLOPTDEPRECATED(CURLOPT_HTTPPOST, ..., 24, 7.56.0, "...")`
          // (the macro's own name, 3x) and `CURLINFO_DOUBLE` x6 in
          // curl/include/curl/curl.h; `REG_OK` in redis's tre.h; `XXH_OK` in
          // xxhash.h; `tsd_state_t` in jemalloc's tsd.h, where a `#define
          // tsd_state_t atomic_u8_t` type macro is read back as a member name out
          // of a damaged enum body.
          //
          // ORDER-RESPECTING, because that is how the preprocessor behaves: the
          // define must be at or before the use. A macro defined AFTER the enum
          // does not touch it, and the enumerator there is real.
          //
          // And OBJECT-LIKE only, which is the second half of the rule and the
          // half an earlier draft of this fix was missing. `#define min(a, b) ...`
          // is a FUNCTION-like macro: it is replaced only where `( ... )` follows
          // the name. An enumerator is followed by `,`, `=` or `}`, never by `(`,
          // so an enumerator named after a function-like macro is REAL -- and
          // redis/src/server.h proves it, declaring `double min, max;` as struct
          // members 3,700 lines after its own `#define min(a, b)`. The first
          // corpus run reported those two members as macro-named phantoms; the
          // # census and the rule were both wrong about C, and the census was the
          // more expensive of the two mistakes.
          const macroDef = memberName ? macroDefOffsets.get(memberName) : undefined
          const isMacroUse =
            macroDef !== undefined && macroDef.kind === "object" && macroDef.at <= enumerator.startIndex

          if (enumNameNode && memberName && !isMacroUse) {
            values.push(memberName)

            const valueNode = enumerator.childForFieldName("value")
            if (valueNode) {
              hasExplicitValues = true
              if (
                this.findFirstChildOfType(
                  valueNode,
                  "binary_expression",
                  (n) => n.childForFieldName("operator")?.text === "<<",
                )
              ) {
                isFlagEnum = true
              }
            }

            symbols.push({
              name: memberName,
              kind: ASTEngine.SymbolKind.EnumMember,
              range: this.nodeToRange(enumerator),
              scope: enumName,
              ownerName: enumName,
              ownerKind: ASTEngine.SymbolKind.Enum,
              visibility: "public",
              metadata: { isEnumValue: true, cSpecific: true, isConditional, nameLine: this.nodeLine(enumNameNode) },
            })
          }
        }
      }
    }

    symbols.push({
      name: enumName,
      kind: ASTEngine.SymbolKind.Enum,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: { isEnum: true, cSpecific: true, values, hasExplicitValues, isFlagEnum, isConditional },
    })
  }

  private extractDeclaration(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    globalVars: Record<string, boolean>,
    scope: string,
    isGlobal: boolean,
    isConditional: boolean,
  ) {
    const isStatic = this.hasStorageClass(node, "static")

    // Function-local declarations (variables inside function bodies) are
    // execution artifacts, not declaration sites — only file/global-scope
    // declarations become symbols.
    if (!isGlobal) return

    // CGD19 (M37 #601): an ERROR ancestor that glues a FUNCTION HEADER to a
    // body makes the following top-level declarations mis-scope as
    // file-scope when they are really function locals (measured:
    // tokenize.c — `int sqlite3RunParser(Parse*, const char*){ int nErr =
    // 0; ...` recovers with the header inside the ERROR span, so `nErr`,
    // `pEngine`, `db`, `lastTokenParsed`, ... leaked as Variable symbols
    // even though they are locals of sqlite3RunParser). Discriminator: the
    // innermost ERROR that contains this declaration must itself contain a
    // function_definition or a declaration whose declarator is a
    // function_declarator — i.e. the recovery swallowed a function HEADER.
    // Real declarations inside a big ERROR-swallowed REGION (status.c: the
    // SQLITE_WSD static struct recovery spans L31-L446 but contains no
    // glued function header before its declarations) stay extracted —
    // blanket ERROR exclusion would drop 13 real symbols there.
    // PERF (measured regression): walking the ERROR subtree per declaration
    // crossed the WASM boundary millions of times on big files (vdbe.c
    // 3.6s/file, differential timeout) — the verdict is memoized PER ERROR
    // span (keyed by startIndex) and answered per declaration by position.
    if (this.isCgd19SuppressedVarDecl(node)) return

    // #916 (measured on sqlite, 5 real symbols): a BARE macro between a type and
    // its declarator truncates the declaration at the macro with a MISSING `;`,
    // and what should have been the declarator is re-parsed as the NEXT SIBLING.
    // `static BtShared *SQLITE_WSD sqlite3SharedCacheList = 0;` becomes
    // `declaration "static BtShared *SQLITE_WSD"` + `expression_statement
    // "sqlite3SharedCacheList = 0;"`; `static void SQLITE_NOINLINE f(Btree*);`
    // becomes `declaration "static void SQLITE_NOINLINE"` +
    // `expression_statement "f(Btree *p);"`; and a macro-decorated DEFINITION has
    // its return type eaten, arriving as a `function_definition` with no
    // declarator field at all. In every case the old code emitted the MACRO as a
    // symbol (`variable SQLITE_WSD`) and the real declaration produced nothing.
    //
    // The trigger is structural and cannot fire on a valid declaration: a MISSING
    // token AND a last named child that resolves to a bare ALL-CAPS identifier
    // (the macro). A `MyType MAX_SIZE;` is clean, so it is not touched; a file
    // that simply ENDS mid-declaration (`static Foo bar`, no `;`) has no next
    // sibling of a recovery shape and is therefore left exactly as it is today —
    // the guard never suppresses without a sibling it can read the truth from.
    if (this.recoverBareMacroTruncation(node, symbols, globalVars, isStatic, isConditional)) return

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        inArray(
          ["init_declarator", "identifier", "pointer_declarator", "array_declarator", "function_declarator"],
          child.type,
        )
      ) {
        let isFuncType = false
        let c: Node | null = child
        while (c) {
          if (c.type === "function_declarator") {
            isFuncType = true
            const innerDecl = c?.childForFieldName("declarator")
            if (innerDecl && innerDecl.type === "parenthesized_declarator") {
              isFuncType = false // function pointer
            }
            break
          }
          c = c?.childForFieldName("declarator") || (c.namedChildCount > 0 ? c.namedChild(0) : null)
        }
        let declNode = this.getIdentifierFromDeclarator(child)

        if (declNode && declNode.text.trim()) {
          if (isFuncType) {
            symbols.push({
              name: declNode.text,
              kind: ASTEngine.SymbolKind.Function,
              range: this.nodeToRange(node),
              scope: isGlobal ? "global" : scope,
              // HC1 (holy-c second review): the prototype branch hardcoded
              // public — a `static` prototype leaked as public API AND into
              // the export list, while a static DEFINITION is private.
              visibility: isStatic ? "private" : "public",
              metadata: { isDeclaration: true, cSpecific: true, isConditional },
            })
          } else {
            if (isGlobal) globalVars[declNode.text] = true
            symbols.push({
              name: declNode.text,
              kind: ASTEngine.SymbolKind.Variable,
              range: this.nodeToRange(child),
              scope: isGlobal ? "global" : scope,
              visibility: isStatic ? "private" : "public",
              metadata: { isVariable: true, cSpecific: true, isGlobal, isConditional },
            })
          }
        }
      }
    }
  }

  private extractTypedef(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    structs: Record<string, any[]>,
    scope: string,
    isConditional: boolean,
  ) {
    const identNode = this.getIdentifierFromDeclarator(node.childForFieldName("declarator"))
    if (!identNode || !identNode.text.trim()) return
    const typeName = identNode.text

    // The typedef alias points at a struct/union/enum specifier.
    const specNode = this.findChild(node, (c) =>
      inArray(["struct_specifier", "union_specifier", "enum_specifier"], c?.type || ""),
    )
    if (specNode) {
      const specNameNode = specNode.childForFieldName("name")
      const specName = specNameNode && specNameNode.text.trim() ? specNameNode.text.trim() : null
      // Anonymous definition (`typedef struct {...} Buffer;`): the struct/union/
      // enum extractor already emitted the symbol under the typedef name — do
      // not emit a duplicate type alias.
      if (!specName) return
      // Self-alias (`typedef struct Point Point;`): identical identity — skip
      // the redundant alias symbol; the struct definition is the declaration.
      if (specName === typeName) return
    }

    symbols.push({
      name: typeName,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: { isTypedef: true, cSpecific: true, isConditional },
    })
  }

  private extractMacro(node: Node, symbols: ASTEngine.UniversalSymbol[], isConditional: boolean) {
    const nameNode = node.childForFieldName("name")
    if (!nameNode || !nameNode.text.trim()) return

    const isFunctionLikeMacro = node.type === "preproc_function_def"

    // #901 (M60, measured on the sqlite pin): a `#define NAME` with no value body
    // was skipped entirely — the old comment called these "include guards ... file
    // artifacts, not symbols". The intent was guard-noise reduction; the CODE was
    // body-based, so it skipped EVERY value-less define, including macros that are
    // later READ in expression position. Measured: `SQLITE_EXTENSION_INIT1;`
    // (ext/misc/basexx.c L40, where the define sits at L48) and `SQLITE_TCLAPI`
    // between the return type and the function name (src/tclsqlite.c L277, defined
    // by a `#ifndef SQLITE_TCLAPI / #define SQLITE_TCLAPI` pair at L43-45) are both
    // real reads the F5 truth counts — the c lane was the only 100%-coverage lane
    // in the sweep with MISSING=2, both edges of this shape.
    //
    // The rule is now the honest one: a `#define` DECLARES a name whatever its
    // body, exactly as the pre-pass already treated macro names
    // (`isMacroName` never looked at the body). Minting the symbol is what makes
    // the read resolvable; the alternative — leaving the name unresolvable so the
    // read stays silent — is a missing true edge, and the family's contract is
    // that a missing edge is a defect while a DECLARATION is not an edge.
    // Measured blast radius: 30 value-less defines across sqlite's src/*.c +
    // ext/misc/*.c, each now one Constant symbol (object-like, the same kind a
    // VALUED object-like macro gets — `MAXN` is a Constant, only function-like
    // macros are Macro-kind), no new edge unless the name is genuinely read.
    // Include guards are therefore minted too; they cost one symbol per guarded
    // file and produce no edge, which is the right trade for not losing reads.

    const parameters: ASTEngine.Parameter[] = []
    if (isFunctionLikeMacro) {
      const paramsNode = node.childForFieldName("parameters") || this.findFirstChildOfType(node, "preproc_params")
      if (paramsNode) {
        for (let i = 0; i < paramsNode.childCount; i++) {
          const param = paramsNode.child(i)
          if (param && param.isNamed) {
            parameters.push({ name: param.text, type: "any" })
          } else if (param && (param.type === "..." || param.text === "...")) {
            parameters.push({ name: "...", type: "variadic", modifiers: [] })
          }
        }
      }
    }

    symbols.push({
      name: nameNode.text,
      kind: isFunctionLikeMacro ? ASTEngine.SymbolKind.Macro : ASTEngine.SymbolKind.Constant,
      range: this.nodeToRange(node),
      scope: "global",
      visibility: "public",
      parameters: isFunctionLikeMacro ? parameters : undefined,
      metadata: { isMacro: true, isFunctionLikeMacro, cSpecific: true, isConditional },
    })
  }

  // --- Shallow Memory Math ---

  /**
   * How a member spells its own type, read from the TYPE NODE the parse already
   * separated. C keeps tag names (`struct S`, `union U`, `enum E`) and ordinary
   * identifiers (typedef names) in SEPARATE namespaces, so the bare text of a
   * member's type cannot say on its own which map it belongs to -- one spelling
   * can name two different entities.
   *
   * This is an ACCURACY input, not the crash guarantee. curl's `h1_tunnel_state`
   * member spells its type with the TYPEDEF (a bare name), so classification
   * alone does not disambiguate that site; the in-progress set below is what
   * makes the descent finite.
   */
  private memberTypeKind(typeNode: Node | null): string {
    if (!typeNode) return "unknown"
    const t: string = typeNode.type
    if (t === "primitive_type" || t === "sized_type_specifier") return "primitive"
    if (t === "struct_specifier") return "tag_struct"
    if (t === "union_specifier") return "tag_union"
    if (t === "enum_specifier") return "tag_enum"
    if (t === "type_identifier") return "typedef"
    return "unknown"
  }

  /**
   * #927: the types whose layout is being computed on THIS descent. A member that
   * reaches a type already on the stack closes a cycle, and "how big is a type
   * that contains itself by value" has no answer -- C forbids the construct (an
   * object type may not contain itself), so any number here would be invented.
   *
   * The measured cause of the crash this replaces is NOT illegal C: it is C's
   * tag/ordinary namespace split letting one bare name be BOTH an enum typedef
   * and a struct tag. `curl/lib/cf-h1-proxy.c` declares
   * `typedef enum {...} h1_tunnel_state;` and then
   * `struct h1_tunnel_state { ... h1_tunnel_state tunnel_state; ... };`, the
   * bare-name lookup resolved the ENUM-typed member to the STRUCT, and the
   * recursion never terminated -- "RangeError: Maximum call stack size
   * exceeded", one crash in 900 curl files against a lane that documents a
   * crash guarantee of 0.
   */
  /**
   * The WIDTH CLASS of a primitive member type, or null when the AST does not
   * determine one.
   *
   * This method exists because of a measurement, not a reading of the C
   * standard. The layout maths used to match a member's type SPELLING against
   * two hand-maintained whitelists -- one in `calculateMemorySize` and a
   * different one in `calculateAlignment`, which had already drifted apart. Both
   * accepted only exact spellings, so every legal C primitive the author had not
   * thought to enumerate fell through to a 4/4 default. Counting the
   * occurrences in the redis corpus: 1027 of 2056 member-type spellings (50%)
   * took that fall-through, led by `long long` (130x, 8 bytes wide, computed as
   * 4) and `unsigned char` (45x, 1 byte wide, computed as 4).
   *
   * An independent check against `clang -ast-dump=json` put the whole payload at
   * 46.9% agreement on size AND alignment over 49 comparable structs -- while
   * the field SETS the sizes were computed from were 97.1% identical to clang's.
   * That split is what identified the arithmetic, rather than member
   * extraction, as the defect; see `script/m14/tmp/c-audit/layout-vs-clang.ts`.
   *
   * Two properties matter more than the win rate:
   *
   *   - It is COMPLETE for primitives, because it reads the keyword sequence the
   *     grammar already parsed rather than a list of spellings. `long long`,
   *     `unsigned long long`, `signed char`, `short int`, `unsigned` and
   *     `long int` are all classified, including ones never enumerated.
   *   - It REFUSES everything else, returning null. A `type_identifier` is a
   *     named type whose width this per-file model does not know (cross-file
   *     resolution is a declared non-goal, C-D2), and inventing a width for
   *     `sds` or `mstime_t` is precisely the "a heuristic wearing a number's
   *     clothes" failure the probe exists to catch. `long double` is refused for
   *     the same reason: it is 8 bytes here, 12 on x86-64 SysV, 16 on i386, and a
   *     model that guessed would be wrong on two of the three.
   */
  private primitiveClass(typeNode: any): string | null {
    if (!typeNode) return null
    // Peel the macro wrappers a type may legitimately be spelled through, so
    // `redisAtomic long long` classifies as `long long` instead of as a name.
    //
    // An `attributed_type_specifier` was in this loop once, from memory of a
    // NEWER tree-sitter-c. F1 caught it immediately: the node type does not exist
    // in this grammar at all -- `__attribute__((aligned(8))) int a;` parses with
    // the attribute as a SIBLING of the type, not a wrapper around it -- so the
    // literal could never match. Dead literals are the failure mode the audit
    // exists for, and the right response to one is deletion, not a waiver entry.
    let node = typeNode
    for (let hop = 0; hop < 8; hop++) {
      if (node.type === "type_identifier") {
        // C99's `_Bool` and C23's `bool` are keywords and one byte wide. Every
        // other name spelled this way has an unknown width here.
        return node.text === "_Bool" || node.text === "bool" ? "bool" : null
      }
      if (node.type !== "macro_type_specifier" && node.type !== "macro_prefixed_type_specifier") break
      const next = (node.namedChildren ?? []).filter(
        (c: Node | null): c is Node => !!c && c.type !== "identifier" && c.type !== "type_identifier",
      )
      if (next.length !== 1) return null
      node = next[0]
    }
    // Only a real primitive specifier reaches the keyword test. A struct, union
    // or enum specifier must return null so the caller's existing descent runs.
    if (node.type !== "primitive_type" && node.type !== "sized_type_specifier") return null
    return this.primitiveClassFromWords(node.text)
  }

  /**
   * The width class for a primitive type's KEYWORD SEQUENCE, or null.
   *
   * Split out from `primitiveClass` so a typedef alias of a primitive is judged
   * by the identical rules as the primitive itself (#937) rather than by a second,
   * inevitably-divergent table.
   */
  private primitiveClassFromWords(specText: string): string | null {
    // The specifier's own text is the keyword sequence; `sized_type_specifier`
    // holds `long long`, `unsigned char` and `short int` whole, so the width
    // words are countable without descending.
    const words = this.splitOnWhitespace(specText)
    const set = new Set(words)
    if (set.has("double")) return set.has("long") ? null : "double"
    if (set.has("float")) return "float"
    if (set.has("char")) return "char"
    if (set.has("void")) return null
    const longs = words.filter((w: string) => w === "long").length
    if (longs >= 2) return "longlong"
    if (longs === 1) return "long"
    if (set.has("short")) return "short"
    // `int`, `unsigned`, `signed` and a bare `unsigned` all land on 4 bytes.
    if (set.has("int") || set.has("unsigned") || set.has("signed") || words.length === 0) return "int"
    return null
  }

  /**
   * `typedef <primitive> <alias>;` declared in THIS file, mapped to the width
   * class of the primitive it names.
   *
   * This is deliberately not cross-file resolution -- C-D2 keeps that a declared
   * non-goal, and a `fingerprint_t` defined in another header stays unknown. But
   * a same-file alias is not a cross-file problem at all, and redis is full of
   * them: `typedef uint16_t fingerprint_t;` sits two lines above the
   * `fingerprint_t fp;` member that needs it, and `uint16_t` was already in the
   * model's tables. Measured cost of not looking: `chkLobbyEntry` was published
   * as 8 bytes / align 1 where clang says 4 / 2.
   *
   * An alias chain (`typedef uint16_t a; typedef a b;`) resolves through, and
   * `typedef A B; typedef B A;` -- legal C, meaningless C -- terminates on the
   * hop cap rather than recursing.
   */
  private buildPrimitiveAliases(rootNode: Node): Map<string, string> {
    const aliases = new Map<string, string>()
    const stack: Node[] = [rootNode]
    const seen = new Set<number>()
    while (stack.length) {
      const n = stack.pop() as Node
      // No numeric ids on every binding, so identity is tracked on the node
      // objects the walk actually yields.
      if (seen.has((n as any).id)) continue
      if (n.id !== undefined) seen.add(n.id)
      if (n.type === "type_definition") {
        const typeNode = n.childForFieldName("type")
        const decl = n.childForFieldName("declarator")
        if (typeNode && decl && decl.type === "type_identifier" && !decl.childForFieldName("declarator")) {
          // Classify the target, which is usually a NAME (`uint16_t`) rather than
          // a keyword -- so the fixed-width table is consulted here too, or every
          // `typedef <stdint name> <alias>;` in the corpus would resolve to nothing.
          const spec = typeNode.text
          const cls =
            this.primitiveClass(typeNode) ??
            (typeNode.type === "type_identifier" ? RealCAnalyzer.FIXED_WIDTH_NAMES[spec] : undefined)
          // A named target that resolves to nothing (`typedef robj *objRef;`) is
          // not a primitive alias and must not shadow the real definition.
          if (cls && !aliases.has(decl.text)) aliases.set(decl.text, cls)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    // Chains, resolved to a terminal primitive class where one exists.
    for (const alias of [...aliases.keys()]) {
      let cur: string | undefined = alias
      const hops = new Set<string>()
      for (let i = 0; i < 8 && cur; i++) {
        if (hops.has(cur)) break
        hops.add(cur)
        const next = this.aliasTargets.get(cur)
        if (!next) break
        cur = next
      }
      const direct = this.primitiveClassFromWords(cur ?? "")
      if (direct) aliases.set(alias, direct)
    }
    return aliases
  }

  /**
   * `typedef A B;` -> `A` for every same-file alias, whatever `A` is.
   *
   * Separate from `primitiveAliases` because the two answer different questions:
   * this one is for walking a chain, the other for the terminal width. A chain
   * that ends in a name the file never defines simply stops, and the member stays
   * unknown -- which is the correct answer for a cross-file type, not a failure.
   */
  private buildAliasTargets(rootNode: Node): Map<string, string> {
    const out = new Map<string, string>()
    const stack: Node[] = [rootNode]
    while (stack.length) {
      const n = stack.pop() as Node
      if (n.type === "type_definition") {
        const typeNode = n.childForFieldName("type")
        const decl = n.childForFieldName("declarator")
        // Only the direct `typedef A B;` form: a function-pointer or array
        // declarator means B is a pointer/array alias, and treating it as a plain
        // name alias would invent a width.
        if (typeNode && decl && decl.type === "type_identifier" && !decl.childForFieldName("declarator")) {
          if (!out.has(decl.text)) out.set(decl.text, typeNode.text)
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
   * `<stdint.h>`-family names, as width classes.
   *
   * These are NAMES, not keywords, so `primitiveClass` refuses them by design --
   * but the layout tables already hardcoded them (`int16_t` alongside `short`,
   * `size_t` at pointer width), so this is not a new assumption. It is the same
   * assumption made REACHABLE, which is what let
   * `typedef uint16_t fingerprint_t;` defeat it: the alias pointed at a name the
   * tables knew and the keyword classifier could not see.
   *
   * Deliberately absent: `time_t`, `off_t`, `intptr_t` and friends. Their width
   * is a property of the platform AND of which header won, so guessing is exactly
   * the failure this class was written to refuse. A member of such a type stays
   * unknown, which is the honest answer.
   */
  private static readonly FIXED_WIDTH_NAMES: Record<string, string> = {
    int8_t: "char",
    uint8_t: "char",
    int16_t: "short",
    uint16_t: "short",
    int32_t: "int",
    uint32_t: "int",
    int64_t: "long",
    uint64_t: "long",
    // Pointer-width on every target the lane models, which is the same
    // assumption `calculateAlignment` already made for these two.
    size_t: "long",
    ssize_t: "long",
    ptrdiff_t: "long",
  }

  /**
   * The width class for a member whose type is a NAME, following same-file
   * primitive typedef aliases, or null when the width stays unknown.
   */
  private resolveMemberPrimitive(field: any): string | null {
    if (field.primitive) return field.primitive
    if (!field.type || field.typeKind === "tag_struct" || field.typeKind === "tag_union" || field.typeKind === "tag_enum") return null
    const direct = this.primitiveClassFromWords(field.type)
    if (direct) return direct
    // Follow the alias chain, bounded.
    let name: string | undefined = field.type
    const hops = new Set<string>()
    for (let i = 0; i < 8 && name; i++) {
      if (hops.has(name)) return null
      hops.add(name)
      const viaAlias = this.primitiveAliases.get(name)
      if (viaAlias) return viaAlias
      const fixed = RealCAnalyzer.FIXED_WIDTH_NAMES[name]
      if (fixed) return fixed
      name = this.aliasTargets.get(name)
    }
    return null
  }

  /**
   * The layout of a member whose width the per-file model cannot determine.
   *
   * ONE constant, used by both the size and the alignment pass, because they used
   * to disagree: `calculateMemorySize` fell back to 4 bytes / align 4 while
   * `calculateAlignment` fell back to align 1. A struct whose members were sized
   * as 4 bytes while its own alignment claimed 1 was the observable result --
   * `chkLobbyEntry` measured 8B/1A against clang's 4B/2A. Two functions cannot be
   * allowed to hold two opinions about the same unknown, so the fallback is now a
   * single value and the pairing can no longer drift.
   *
   * It is a fabricated number and is documented as one: the model has no width
   * for a named type it cannot resolve (C-D2). What it is NOT allowed to be is
   * self-contradictory.
   */
  private static readonly UNKNOWN_MEMBER = { size: 4, align: 4 }

  /**
   * Does this body hold its members inside a preprocessor conditional? (#943)
   *
   * The extractor iterates the body's DIRECT children, and a `preproc_ifdef` is
   * not a `field_declaration`, so those members are skipped entirely -- redis's
   * `eventNotifier` published 0 bytes and NO members against clang's 4, because all
   * it has is `#ifdef HAVE_EVENT_FD int efd; #else int pipefd[2]; #endif`. Which
   * branch is live depends on the build configuration, which the per-file model
   * does not have (C-D2), so the members cannot be recovered -- but a size of 0 is
   * a CLAIM, and the flag has to say the payload is not a measurement rather than
   * a computed zero.
   *
   * One helper rather than the scan written twice: the struct and union paths
   * differ in almost everything, and a conditional-body check is exactly the sort
   * of thing that ends up on one path only.
   */
  private bodyHasConditionalMembers(bodyList: Node | null): boolean {
    if (!bodyList) return false
    for (let i = 0; i < bodyList.namedChildCount; i++) {
      const t = bodyList.namedChild(i)?.type ?? ""
      if (t === "preproc_if" || t === "preproc_ifdef" || t === "preproc_else") return true
    }
    return false
  }

  /**
   * The owner name for an INLINE aggregate member's contents. (#951)
   *
   * `parser.state.UNIX` rather than `anonymous_struct`.
   *
   * Two anonymous aggregates are not one type, and collapsing them is what made the
   * corpus census report `anonymous_struct.main x2` in curl's ftplistparser.c --
   * where `main` appears once under `UNIX` and once under `NT`, two members of two
   * DIFFERENT structs inside a union. The census could not tell that apart, and the
   * lane's own P8 property called the same shape a violation when this fixture grew
   * five inline aggregates: `anonymous_struct.a emitted 5x and 5 of them are
   * UNCONDITIONAL -- mutually exclusive preprocessor arms are the only legal source
   * of a repeated member name`. The property was right and the analyzer was wrong:
   * these are not arms, and they are not the same owner.
   *
   * The name is the MEMBER PATH, which is what a consumer can act on -- it says
   * which field of which type these members belong to, and it is unique by
   * construction, so two anonymous aggregates can no longer collide. It also
   * removes the phantom `anonymous_struct` / `anonymous_union` TYPE symbols from the
   * graph entirely, since a real, addressable name now exists for each.
   *
   * Derived from the parse rather than from a counter, so it is stable across
   * reorderings of unrelated code and does not depend on how many anonymous
   * aggregates came before this one.
   */
  private inlineAggregateOwnerName(specifier: Node): string | null {
    // The specifier must be a MEMBER's type: `struct { ... } name;`
    const fieldDecl = specifier.parent
    if (!fieldDecl || fieldDecl.type !== "field_declaration") return null
    const memberName = this.getIdentifierFromDeclarator(fieldDecl.childForFieldName("declarator"))
    if (!memberName || !memberName.text.trim()) return null
    // Its enclosing body, and the type that body belongs to.
    const body = fieldDecl.parent
    if (!body || body.type !== "field_declaration_list") return null
    const ownerSpecifier = body.parent
    if (!ownerSpecifier) return null
    if (ownerSpecifier.type !== "struct_specifier" && ownerSpecifier.type !== "union_specifier") return null

    // #958: when the OWNER is itself an inline aggregate, the owner's own name is
    // not the type's name -- it is the MEMBER that carries it, one level further
    // out. `struct R { union { ... struct { ... } verbatim_str; ... } val; }` has
    // `verbatim_str` inside the union's field_declaration_list, whose owner
    // specifier is the ANONYMOUS union, so `specifierOwnName` returns the
    // placeholder `anonymous_union` and the path came out as
    // `anonymous_union.verbatim_str` (redis/src/call_reply.c:30-38, where
    // `CallReply.val.verbatim_str.str` and `.format` were published under a
    // placeholder owner while the union's own members got the right path).
    //
    // The correct path composes from the member that carries the outer aggregate:
    // the outer specifier's own `field_declaration` names it (`val`), and THAT
    // specifier's owner is named `R`. So the answer is `R.val.verbatim_str`, and
    // the same question for the outer aggregate itself (`R.val`) already had a
    // working answer, which is why the two disagreed.
    const ownerName = this.specifierOwnName(ownerSpecifier)
    if (!ownerName) return null
    const carried = this.inlineAggregateOwnerName(ownerSpecifier)
    return carried ? `${carried}.${memberName.text.trim()}` : `${ownerName}.${memberName.text.trim()}`
  }

  /**
   * The name a specifier is known by in the source: its own tag, the typedef alias
   * it is bound to, or `anonymous_struct` / `anonymous_union` for a type with
   * neither. Factored out because three sites computed this and they had already
   * drifted on the anonymous case.
   */
  private specifierOwnName(specifier: Node): string {
    const nameNode = specifier.childForFieldName("name")
    if (nameNode && nameNode.text.trim()) return nameNode.text.trim()
    const parent: any = specifier.parent
    if (parent && parent.type === "type_definition") {
      const decl = this.getIdentifierFromDeclarator(parent.childForFieldName("declarator"))
      if (decl && decl.text.trim()) return decl.text.trim()
    }
    // #952: `typedef struct { ... } X;` arrives in TWO shapes from this grammar, and
    // the name logic only ever handled one of them.
    //
    //   (type_definition type: (struct_specifier ...) declarator: (type_identifier))
    //   (declaration (storage_class_specifier) type: (struct_specifier ...)
    //                             declarator: (identifier))
    //
    // libgit2's `git2/sys/alloc.h` uses the second, so `git_allocator` -- a
    // typedef'd anonymous struct with four function-pointer members -- was named
    // `anonymous_struct` and its members were attributed to the placeholder. That is
    // a PRE-EXISTING gap, not something this wave introduced: every name derivation
    // in this file, including the one before #951, tested only for `type_definition`.
    //
    // The `typedef` storage class is required, and that is the part that makes it
    // safe: a file-scope `struct { int a; } x;` has the same shape but declares a
    // VARIABLE, and naming the type after the variable would publish a type that
    // does not exist. Checking the declarator is a bare identifier covers the rest,
    // since `struct {...} x, *y;` would give an `init_declarator` or a pointer.
    if (parent && parent.type === "declaration") {
      const isTypedef = (parent.namedChildren ?? []).some(
        (c: any) => c && c.type === "storage_class_specifier" && c.text.trim() === "typedef",
      )
      const decl = parent.childForFieldName("declarator")
      if (isTypedef && decl && decl.type === "identifier" && decl.text.trim()) return decl.text.trim()
    }
    return specifier.type === "union_specifier" ? "anonymous_union" : "anonymous_struct"
  }

  /**
   * Layout records for an INLINE aggregate member's body. (#950)
   *
   * `struct { int a; int b; } inner;` -- C11's anonymous struct member, and its
   * union counterpart. The member's own layout was never computed, because
   * `extractStruct` registers a struct's fields under its NAME and an anonymous one
   * has none: `if (structName !== "anonymous_struct") structs[structName] = fields`.
   * So the fields existed only for the duration of the call and the member fell
   * through to the 4-byte unknown fallback. Measured over the three declared
   * corpora: 141 such members across 59 files, and
   * `struct { struct { int a; int b; } inner; char c; }` published 8 bytes where
   * clang says 12.
   *
   * Records only, no symbols: the walk already visits the nested specifier and
   * publishes its members, so emitting them twice would double the graph. The
   * nested specifier's members are attributed to the placeholder owner
   * `anonymous_struct`, which is a separate defect and is why the census reports
   * `anonymous_struct.main x2` for two members of two DIFFERENT structs in
   * curl's ftplistparser.c -- legal C that the counter cannot tell apart.
   *
   * This deliberately reuses the field-level primitives (`primitiveClass`,
   * `arrayDimension`, `isPointerType`, `bitfieldWidth`) rather than the whole
   * member-extraction loop, because that loop is entangled with symbol emission and
   * with the #928/#932 refusals. A shared extraction would be tidier; this is
   * additive, so it cannot regress the path that is already measured at 100% on
   * every type the analyzer claims to model.
   */
  private collectInlineAggregateFields(
    body: Node | null,
    declaredTypes: Set<string>,
    allMacroNames: Set<string>,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    seq: { n: number },
    keyFor: (node: Node) => string,
  ): any[] {
    const out: any[] = []
    if (!body) return out
    for (let i = 0; i < body.namedChildCount; i++) {
      const field = body.namedChild(i)
      if (!field || field.type !== "field_declaration") continue
      const typeNode = field.childForFieldName("type")
      if (!typeNode) continue
      // A NESTED inline aggregate, so an inline struct inside an inline struct
      // resolves too rather than needing a second fix.
      let anonymousKey: string | undefined
      if ((typeNode.type === "struct_specifier" || typeNode.type === "union_specifier") && typeNode.childForFieldName("body") && !typeNode.childForFieldName("name")) {
        anonymousKey = keyFor(field)
        const nested = this.collectInlineAggregateFields(typeNode.childForFieldName("body"), declaredTypes, allMacroNames, structs, unions, seq, keyFor)
        if (typeNode.type === "struct_specifier") structs[anonymousKey] = nested
        else unions[anonymousKey] = nested
      }
      if (!fieldDeclarationHasDeclarator(field)) continue
      if (fieldDeclarationNamesANonDeclarator(field, declaredTypes, allMacroNames)) continue
      let arraySize = 1
      let unresolvableDimensions = false
      let isPointer = this.isPointerType(field)
      let declNode: any = field
      let bitfieldClause = ""
      while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
        if (declNode.type === "array_declarator") {
          const sizeNode = declNode.childForFieldName("size") || this.findChild(declNode, (c: any) => c?.type === "number_literal")
          const dim = this.arrayDimension(sizeNode)
          if (dim !== null) arraySize *= dim
          else if (!sizeNode) arraySize = 0
          else unresolvableDimensions = true
        }
        if (declNode.type === "field_declaration" && this.findChild(declNode, (c: any) => c?.type === "bitfield_clause")) {
          const clause = this.findChild(declNode, (c: any) => c?.type === "bitfield_clause")
          bitfieldClause = clause ? clause.text : ""
        }
        declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
      }
      if (!declNode || !declNode.text.trim()) continue
      // #947/#950: refuse a macro-mediated function pointer. The guard was originally
      // `isPointer && this.isMacroMediatedFunctionPointer(field)`, and the `isPointer`
      // half DEFEATED IT in exactly the case it was written for: `isPointerType` looks
      // for a `pointer_declarator`, and a macro-mediated function pointer is precisely
      // the shape that has none -- the `*` lives in the macro. The census still
      // reported `anonymous_struct.GIT_CALLBACK x2` after #951 fixed the ownership,
      // which is what exposed it. The two conditions are independent, so neither
      // belongs in the other's guard.
      if (this.isMacroMediatedFunctionPointer(field)) continue
      out.push({
        name: declNode.text,
        type: typeNode.text,
        typeKind: this.memberTypeKind(typeNode),
        primitive: this.primitiveClass(typeNode),
        arraySize,
        unresolvableDimensions,
        isBitfield: bitfieldClause.length > 0,
        bitfieldClause,
        isPointer,
        anonymousKey,
      })
    }
    return out
  }

  /**
   * Does this body hold an UNNAMED bitfield, which affects layout but names no
   * member? (#948)
   *
   * `unsigned int :0;` and `unsigned int :3;` are layout facts with no declarator,
   * so the member extractor declines them under the #928/#932 rules -- correctly,
   * since publishing a member for them would invent a name. The consequence is
   * that the layout never sees them.
   */
  private bodyHasUnnamedBitfield(bodyList: Node | null): boolean {
    if (!bodyList) return false
    for (let i = 0; i < bodyList.namedChildCount; i++) {
      const f = bodyList.namedChild(i)
      if (!f || f.type !== "field_declaration") continue
      // `unsigned int :0;` parses with `declarator: (MISSING field_identifier)` --
      // the SLOT exists, the name does not. A presence test therefore passes it
      // over, which is why the first version of this detector reported nothing on
      // the one shape it was written for. `isMissing` is the real signal, with the
      // empty-text test as the belt to its braces.
      const decl = f.childForFieldName("declarator")
      if (decl && !decl.isMissing && decl.text.trim().length > 0) continue
      if (this.findChild(f, (c: any) => c?.type === "bitfield_clause")) return true
    }
    return false
  }

  /**
   * A type's `memorySize` / `alignment`, plus the count of members that had to be
   * guessed (#940).
   *
   * One call site for both numbers and the count, so the three cannot disagree --
   * the same lesson as #938, applied one step earlier in the same code.
   */
  private layoutPayload(
    fields: any[],
    isPacked: boolean,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    // #943: the body had members inside a preprocessor conditional, so no
    // measurement of this type was possible at all.
    bodyIsConditional = false,
    // #946: a union's members OVERLAP, so its size is the largest member rounded
    // up to its alignment, not their sum. `layoutPayload` hardcoded `false` here,
    // so publishing a union's payload summed its members: `union { unsigned int u;
    // double d; }` reported 16 bytes where clang says 8, and `union { unsigned int
    // a; unsigned long b; unsigned long long c; }` reported 24 where the answer is
    // 8. The flag was threaded all the way to the call site and then dropped one
    // line before the function that uses it -- which is the same shape of mistake
    // as #938, where two functions held two opinions: here one function held the
    // struct's opinion and was handed the union's fields.
    isUnion = false,
    // #948: the body holds an unnamed bitfield, which occupies bits the member
    // loop cannot see.
    hasUnnamedBitfield = false,
    // #947: members declined as macro-mediated, so the type is a member short.
    declinedCount = 0,
  ): { memorySize: number; alignment: number; layoutUnknownMembers: number } {
    // A conditional body is counted once: its members were never extracted, so
    // the per-member loop below has nothing to account for and would report 0.
    // The same for an unnamed bitfield, and a declined member counts per member.
    const unknown = { count: (bodyIsConditional || hasUnnamedBitfield ? 1 : 0) + declinedCount }
    const memorySize = this.calculateMemorySize(fields, isPacked, structs, unions, is64Bit, isLLP64, isUnion, undefined, unknown)
    return {
      memorySize,
      alignment: this.calculateAlignment(fields, structs, unions, is64Bit, isLLP64),
      layoutUnknownMembers: unknown.count,
    }
  }

  /**
   * Split on whitespace WITHOUT a regex.
   *
   * The lane's P11 property holds this file to zero regex literals, and it caught
   * three I had just added: `split(/\s+/)` and two character-class tests. The
   * property is right and the code was wrong -- a file that has already been
   * audited for regex-based syntax recognition does not get to reintroduce it
   * through a "harmless" tokenizer. Relaxing the gate because this instance was
   * small would be the exact move the gate exists to prevent.
   */
  private splitOnWhitespace(text: string): string[] {
    const out: string[] = []
    let cur = ""
    for (const ch of text) {
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
        if (cur.length > 0) {
          out.push(cur)
          cur = ""
        }
      } else {
        cur += ch
      }
    }
    if (cur.length > 0) out.push(cur)
    return out
  }

  /** `123`, `0`, `42u`, `42U`, `42l`, `42ULL` -- a decimal integer, nothing else. */
  private isDecimalInteger(text: string): boolean {
    if (text.length === 0) return false
    let i = 0
    while (i < text.length && text[i] >= "0" && text[i] <= "9") i++
    if (i === 0) return false
    for (; i < text.length; i++) {
      const c = text[i]
      if (c !== "u" && c !== "U" && c !== "l" && c !== "L") return false
    }
    return true
  }

  private startsWithIdentifierChar(c: string | undefined): boolean {
    if (!c) return false
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"
  }

  /** True when every character is arithmetic this method is willing to evaluate. */
  private isArithmeticOnly(text: string): boolean {
    const allowed = "0123456789+-*/|&<>() \t"
    for (const ch of text) if (!allowed.includes(ch)) return false
    return text.length > 0
  }

  /**
   * Is this member a MACRO-MEDIATED function pointer, whose real name is not in
   * the tree? (#947)
   *
   * libgit2 writes its function-pointer members as
   * `int GIT_CALLBACK(read)(git_odb_stream *s, char *b, size_t n);` where
   * `#define GIT_CALLBACK(name) (*name)`. Tree-sitter resolves that to a single
   * `field_identifier` whose text is `GIT_CALLBACK` -- the real name `read` is
   * consumed by the macro and is NOT a node anywhere in the parse. So the analyzer
   * published FOUR members named `GIT_CALLBACK` in `git_odb_stream` and three in
   * `git_odb_writepack`, where the real members are `read`, `write`,
   * `finalize_write`, `free`, `append` and `commit`. Found by comparing member
   * SETS against clang, which is the check that could see it: a size stays roughly
   * right when a phantom member replaces a real one, but the NAME is simply wrong,
   * and a member named after a macro is a symbol that does not exist in the
   * program.
   *
   * An earlier attempt at this fix recovered the name from inside the macro
   * invocation and was WITHDRAWN as unsound, because the name is not there to
   * find. This one does not try to recover anything; it establishes that the name
   * is unrecoverable and declines.
   *
   * The test is per-file, syntactic, and sound because C requires a
   * function-pointer declarator to be parenthesised and dereferenced: a member
   * whose declarator chain contains a `function_declarator` but NO
   * `pointer_declarator` anywhere cannot be a function pointer written in C, so
   * the `*` came from a macro and the identifier is the macro's. It needs no
   * knowledge of the macro, which is what makes it work here -- `GIT_CALLBACK` is
   * defined in `common.h`, a different file, so the analyzer's own macro inventory
   * cannot see it, and the first attempt failed for exactly that reason.
   *
   * Declining is the #928 answer: silence over invention. The member is not
   * published under a name known to be wrong, and the reason is recorded.
   */
  private isMacroMediatedFunctionPointer(rawDecl: Node): boolean {
    // The rule is C's own, and it is about PARENTHESISES rather than pointers.
    //
    // A function-pointer member must be written `(*name)(args)`: C requires the
    // dereference to be parenthesised, which is the whole difference between
    // `int (*f)(void)` (a pointer to a function) and `int f(void)` (a function
    // declaration, which is not even legal in a struct). So the member's declarator
    // chain, at the point it first reaches a `function_declarator`, must pass
    // through a `parenthesized_declarator` -- and if it does not, the `*` is not in
    // the source and came from a macro.
    //
    // The first version of this test looked for a `pointer_declarator` ANYWHERE in
    // the subtree, which is wrong for the commonest shape of all:
    //
    //     void * GIT_CALLBACK(gmalloc)(size_t n, const char *f, int l);
    //
    // tree-sitter puts that `*` in a `pointer_declarator` around the whole
    // declarator -- it belongs to the RETURN TYPE -- so a subtree search finds it and
    // concludes the member is a genuine function pointer, and the analyzer published
    // two more members named `GIT_CALLBACK` in libgit2's `git2/sys/alloc.h`. Only the
    // parentheses distinguish the two forms, and the corpus is what found it.
    let n: Node | null = rawDecl
    let guard = 0
    while (n && guard++ < 32) {
      if (n.type === "function_declarator") {
        const inner = n.childForFieldName("declarator")
        return inner ? inner.type !== "parenthesized_declarator" : false
      }
      if (n.type === "field_identifier" || n.type === "identifier") return false
      n = n.childForFieldName("declarator") || n.namedChild(0)
    }
    return false
  }

  /**
   * The WIDTH of a bitfield, in bits, or null when it cannot be determined.
   *
   * A bitfield's contribution is not its declared type's width; it is a PACKING
   * result, and the packing is what #945 implements. The width itself comes from
   * the clause, which is usually a plain integer (`uint32_t iskey:1`) but is very
   * often a same-file macro (redis's `signed int fill : QL_FILL_BITS`) or an
   * enumerator. All three forms resolve; anything else returns null, and the
   * caller then falls back to charging the declared type's width and counts the
   * member as unmeasured -- the #944 behaviour, kept as the refusal rather than
   * deleted.
   */
  private bitfieldWidth(field: any): number | null {
    const clause = typeof field.bitfieldClause === "string" ? field.bitfieldClause.trim() : ""
    // The clause node's text is `:1`, `: QL_FILL_BITS`, `:-1` (a GNU signed
    // width) or `: 0`. Only the magnitude is a storage width.
    if (clause.length === 0) return null
    let text = clause.startsWith(":") ? clause.slice(1).trim() : clause
    if (text.startsWith("-")) text = text.slice(1).trim()
    if (text.length === 0) return null
    if (this.isDecimalInteger(text)) return parseInt(text, 10)
    // A macro or an enumerator: one bare identifier, nothing else.
    if (this.startsWithIdentifierChar(text[0]) && this.splitOnWhitespace(text).length === 1) {
      const viaMacro = this.macroIntValue(text)
      if (viaMacro !== null) return viaMacro
      const viaEnum = this.enumConstantValues.get(text)
      if (typeof viaEnum === "number") return viaEnum
    }
    return null
  }

  /**
   * The integer value of a same-file `#define`, or null.
   *
   * #939 exists because `int heavy_entries[CHK_HEAVY_ENTRIES_PER_BUCKET];` was
   * measured as a ONE-element array. The old code read an array dimension only
   * from a `number_literal`, so a dimension spelled as a macro silently became
   * 1 -- which is not a small error, because a fixed-size array is usually the
   * largest member in the struct that holds it. `chkBucket` published 24 bytes
   * where clang says 40.
   *
   * What it will NOT do is evaluate an arbitrary expression. Only an integer
   * literal, and the four integer operators over already-resolved integers, are
   * accepted; anything mentioning an identifier, a cast, a function call or a
   * float yields null and the dimension stays 1. A wrong dimension is worse
   * than an unknown one, and "1" is at least visibly the default.
   */
  private macroIntValue(name: string, depth = 0): number | null {
    if (depth > 6) return null
    const text = this.macroValueTexts.get(name)
    if (text === undefined) return null
    const trimmed = text.trim()
    // A plain integer literal, with the integer-suffix spellings C allows.
    if (this.isDecimalInteger(trimmed)) return parseInt(trimmed, 10)
    // `(N * 2)`, `2 * N`, `N + 1` ... only over names this file can resolve, and
    // only arithmetic. Tokenising first and rejecting any token that is neither a
    // number, an operator nor a resolvable name is stricter than a character-class
    // test, because a token like `0x10` or `1u` or `1.5f` is rejected as a WHOLE
    // rather than having its odd characters quietly accepted.
    const tokens = this.splitOnWhitespace(trimmed)
    if (tokens.length === 0) return null
    let expr = ""
    for (const tok of tokens) {
      if (this.isDecimalInteger(tok)) {
        expr += tok
        continue
      }
      if (tok.length === 1 && "()+-*/|&<>".includes(tok)) {
        expr += tok
        continue
      }
      // Multi-character runs of arithmetic characters: `((`, `))`, `<<`, `>>`.
      if (this.isArithmeticOnly(tok) && !this.startsWithIdentifierChar(tok[0])) {
        expr += tok
        continue
      }
      if (!this.startsWithIdentifierChar(tok[0])) return null
      const v = this.macroIntValue(tok, depth + 1)
      if (v === null) return null
      // Substitute as a parenthesised integer so precedence cannot shift.
      expr += `(${v})`
    }
    if (expr.length === 0 || !this.isArithmeticOnly(expr)) return null
    try {
      // No identifiers remain, so this is a fixed integer expression, and
      // `isArithmeticOnly` has already excluded everything that is not arithmetic.
      const value = Function(`"use strict";return (${expr})`)()
      return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1 << 24 ? value : null
    } catch {
      return null
    }
  }

  /**
   * An array dimension from a `size` node: a literal, or a same-file macro.
   * Returns null when the dimension is genuinely unknown.
   */
  private arrayDimension(sizeNode: Node | null): number | null {
    if (!sizeNode) return null
    if (sizeNode.type === "number_literal") {
      const v = parseInt(sizeNode.text, 10)
      return isNaN(v) ? null : v
    }
    if (sizeNode.type === "identifier" || sizeNode.type === "type_identifier") {
      const viaMacro = this.macroIntValue(sizeNode.text)
      if (viaMacro !== null) return viaMacro
      // A dimension may also be an enumeration constant, and a same-file enum is
      // resolvable the same way a macro is.
      const viaEnum = this.enumConstantValues.get(sizeNode.text)
      return viaEnum ?? null
    }
    return null
  }

  /**
   * Same-file enumerator values, so `[MAX_EVENTS]` resolves like `[8]`.
   *
   * Both forms count: an enumerator with `= 12`, and one that continues from the
   * previous enumerator (`enum { A, B = 12, C }` gives C = 13). An enumerator
   * whose value is not an integer literal ends that enum's chain rather than
   * guessing a position, because continuing from an unknown value produces a
   * confidently wrong number -- the same refusal `macroIntValue` makes.
   */
  private buildEnumConstantValues(rootNode: Node): Map<string, number> {
    const out = new Map<string, number>()
    const stack: Node[] = [rootNode]
    while (stack.length) {
      const n = stack.pop() as Node
      if (n.type === "enumerator_list") {
        let next = 0
        for (let i = 0; i < n.namedChildCount; i++) {
          const e = n.namedChild(i)
          if (!e || e.type !== "enumerator") continue
          const nm = e.childForFieldName("name") || e.namedChild(0)
          const val = e.childForFieldName("value")
          if (val) {
            const literal = /^\d+[uUlL]*$/.test(val.text.trim())
            if (!literal) {
              next = Number.NaN // unknown: the chain stops here
              continue
            }
            next = parseInt(val.text.trim(), 10)
          }
          if (nm && !Number.isNaN(next)) out.set(nm.text.trim(), next)
          if (!Number.isNaN(next)) next++
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  /** Bytes and alignment for a width class from `primitiveClass`. */
  private primitiveLayout(cls: string, is64Bit: boolean, isLLP64: boolean): { size: number; align: number } {
    const longSize = is64Bit && !isLLP64 ? 8 : 4
    switch (cls) {
      // C requires `long long` to be at least 64 bits, so 8 is a standard
      // guarantee rather than a platform guess -- which is why this one ignores
      // `is64Bit` the way `long` cannot.
      case "bool":
      case "char":
        return { size: 1, align: 1 }
      case "short":
        return { size: 2, align: 2 }
      case "long":
        return { size: longSize, align: longSize }
      case "longlong":
        return { size: 8, align: 8 }
      case "float":
        return { size: 4, align: 4 }
      case "double":
        return { size: 8, align: 8 }
      default:
        return { size: 4, align: 4 }
    }
  }

  private calculateMemorySize(
    fields: any[],
    isPacked: boolean,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    isUnion: boolean = false,
    inProgress?: Set<string>,
    // #940: how many members this pass had to charge at UNKNOWN_MEMBER. The size
    // is still published, because a consumer needs a number -- but a number that
    // was partly INVENTED must not be indistinguishable from one that was
    // computed. `struct { long double d; }` is the clean case: `long double` is 8
    // on some ABIs, 12 on i386 and 16 on x86-64 SysV, so `primitiveClass` refuses
    // it, and that refusal used to become a silent 4 bytes -- published as 4/4
    // with nothing marking that a guess had been made.
    unknown?: { count: number },
  ): number {
    const active = inProgress ?? new Set<string>()
    let currentOffset = 0
    let maxAlign = 1
    let maxSize = 0
    // #945: a bit cursor, in BITS, or -1 when no bitfield run is in progress. It is
    // a separate cursor rather than a reinterpretation of `currentOffset` so the
    // non-bitfield arithmetic below stays byte-for-byte the arithmetic that was
    // measured at 100% agreement against clang on every type the analyzer claims
    // to model. Rewriting that to a unified bit cursor would put a proven path at
    // risk to gain nothing.
    let bitPos = -1
    const ptrSize = is64Bit ? 8 : 4
    const longSize = is64Bit && !isLLP64 ? 8 : 4
    const roundUpTo = (v: number, unit: number) => (unit <= 0 ? v : Math.ceil(v / unit) * unit)

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const type = field.type
      // #938: the one unknown-member layout, shared with the alignment pass, so
      // a struct can never size its members as 4 bytes while claiming align 1.
      let fieldSize = RealCAnalyzer.UNKNOWN_MEMBER.size
      let align = RealCAnalyzer.UNKNOWN_MEMBER.align
      // #937: the member's width may come from a same-file typedef alias, so this
      // is resolved per member rather than read off the field record once.
      const primitive = this.resolveMemberPrimitive(field)
      // #949: ONE account of why this member is unmeasured, and at most once.
      //
      // The three guards this replaces were independent `if`s, and a bitfield whose
      // declared TYPE is unknown fired TWO of them -- the bitfield guard and the
      // general unresolvable-type guard -- so `external_flags_t a : 3;` was counted
      // twice and the type reported `layoutUnknownMembers: 2` for one member. The
      // number is a diagnostic of how many members are unmeasured, so counting one
      // member twice makes it a worse number than useless: it reads as "two things
      // are wrong here" and invites a reader to go looking for a second.
      //
      // A BITFIELD is deliberately not a branch here. It has two failure modes and
      // they are counted where each is detected: a bitfield whose declared type is
      // unknown is an `unresolvableType` and is caught above, while one whose type
      // is known but whose WIDTH is not cannot be packed and is counted by the
      // packing branch's own fallback. An earlier draft added a `field.isBitfield`
      // branch here for symmetry, and it counted every bitfield including the ones
      // that pack perfectly -- `Flags` went from 0 unmeasured members to 4. The
      // test is not "is it a bitfield", it is "did the bitfield fail".
      if (unknown) {
        const unresolvableType =
          !field.isPointer &&
          !primitive &&
          field.typeKind !== "tag_enum" &&
          this.structKeyForMember(field, structs) === null &&
          this.unionKeyForMember(field, unions) === null
        if (unresolvableType) {
          // A named type this file cannot resolve (C-D2), or a width deliberately
          // refused (`long double`). Enums and by-value structs/unions are resolved
          // by descent and are not guesses.
          unknown.count++
        } else if (field.unresolvableDimensions) {
          // #942: the member's TYPE was known, its array COUNT was not, so the
          // width that went into the total is as invented as any refused one.
          unknown.count++
        }
      }

      // #945: REAL BITFIELD PACKING, replacing #944's "charge it its declared type".
      //
      // A bitfield occupies BITS in a shared storage unit, not a whole member. The
      // rules implemented here are the Itanium/x86-64 psABI ones:
      //   - bits are allocated from the low end of the unit, upward;
      //   - a field that would STRADDLE a boundary of its declared type is moved
      //     up to the next such boundary, so a `uint32_t a:1, b:31, c:1` costs 8
      //     bytes rather than 4 -- the classic case;
      //   - a ZERO-width field (`unsigned int :0;`) consumes no bits and forces
      //     the next field up to the declared type's boundary;
      //   - the STRUCT's alignment is the maximum of its members' declared-type
      //     alignments, bitfields included, and the size is rounded up to it.
      //
      // What this replaces, measured: redis's raxNode declares `uint32_t iskey:1,
      // isnull:1, iscompr:1, size:29` and clang packs all four into ONE 4-byte
      // unit where the model published 16. quicklist charged 4 bytes for each of
      // three bitfields and published 56 against clang's 48.
      //
      // The STRADDLE test is the one that matters and the one a naive
      // "sum the bits and divide by 8" gets wrong. It is also why the cursor is
      // kept in bits: a byte cursor cannot express a field that starts 3 bits into
      // a unit.
      if (field.isBitfield && primitive && !isUnion) {
        const width = this.bitfieldWidth(field)
        if (width !== null) {
          const unit = this.primitiveLayout(primitive, is64Bit, isLLP64)
          const unitBits = unit.size * 8
          if (bitPos < 0) bitPos = currentOffset * 8
          maxAlign = Math.max(maxAlign, unit.align)
          if (width === 0) {
            // A zero-width bitfield is a boundary marker, not storage.
            bitPos = roundUpTo(bitPos, unitBits)
          } else {
            if (unitBits > 0 && (bitPos % unitBits) + width > unitBits) bitPos = roundUpTo(bitPos, unitBits)
            bitPos += width
          }
          continue
        }
        // Width unresolvable: fall through to the declared-type charge below, and
        // count it as unmeasured there, because a member charged its declared
        // type's width is a lower bound and not a layout.
        if (unknown) unknown.count++
      }

      // A whole member after a bitfield run starts at the next BYTE, and the byte
      // offset is resynchronised before the padding arithmetic runs.
      if (bitPos >= 0) {
        currentOffset = Math.ceil(bitPos / 8)
        bitPos = -1
      }

      if (field.isPointer) {
        fieldSize = ptrSize
        align = ptrSize
      } else if (primitive) {
        // #936: the AST-derived width, ahead of the spelling tables. Those stay
        // for the fixed-width typedefs (`int64_t`, `ssize_t`), which are NAMED
        // types and so deliberately return null from `primitiveClass`.
        const p = this.primitiveLayout(primitive, is64Bit, isLLP64)
        fieldSize = p.size
        align = p.align
      } else if (inArray(["char", "int8_t", "uint8_t", "bool"], type)) {
        fieldSize = 1
        align = 1
      } else if (inArray(["short", "int16_t", "uint16_t"], type)) {
        fieldSize = 2
        align = 2
      } else if (inArray(["long"], type)) {
        fieldSize = longSize
        align = longSize
      } else if (inArray(["double", "int64_t", "uint64_t", "size_t", "ssize_t"], type)) {
        fieldSize = 8
        align = 8
      } else if (field.typeKind === "tag_enum") {
        // An enum member has platform int layout, and is never a struct to
        // descend into -- the `tag_enum` case is what keeps an enum/struct name
        // collision out of the descent in the first place.
        fieldSize = 4
        align = 4
      } else {
        const structKey = this.structKeyForMember(field, structs)
        const unionKey = structKey ? null : this.unionKeyForMember(field, unions)
        const key = structKey ?? unionKey
        if (key) {
          if (active.has(key)) {
            // A by-value cycle: C forbids the construct, so no size exists. Bounded, not followed.
            fieldSize = 0
            align = 1
            // #940: a cycle is a REFUSAL, so it counts as a member whose width was
            // not computed. `eventnotifier.h`'s eventNotifier published 0 bytes
            // against clang's 4, and the flag has to say so rather than report 0.
            if (unknown) unknown.count++
          } else {
            active.add(key)
            const list = structKey ? structs[key] : unions[key]
            // The SAME counter goes down the recursion. A member of type `rax` is
            // only as well known as `rax` itself, so a nested guess has to
            // propagate to the parent or the flag flatters the analyzer: measured
            // before this was threaded, 8 redis types were reported as
            // `layoutUnknownMembers == 0` while their miss class said
            // "a named type whose width the model cannot know" -- the metric and
            // the classification contradicting each other inside one report.
            fieldSize = this.calculateMemorySize(list, false, structs, unions, is64Bit, isLLP64, !structKey, active, unknown)
            align = this.calculateAlignment(list, structs, unions, is64Bit, isLLP64, active)
            active.delete(key)
          }
        }
      }

      if (isPacked) align = 1
      maxAlign = Math.max(maxAlign, align)

      // #941: `|| 1` would turn a FLEXIBLE ARRAY MEMBER's deliberate 0 back into
      // 1, so the default is taken on the ABSENCE of a number rather than on
      // falsiness. A zero-length array is a real, meaningful count here.
      const count = typeof field.arraySize === "number" ? field.arraySize : 1
      const totalFieldSize = fieldSize * count
      if (isUnion) {
        maxSize = Math.max(maxSize, totalFieldSize)
      } else {
        const padding = (align - (currentOffset % align)) % align
        currentOffset += padding + totalFieldSize
      }
    }

    if (isUnion) {
      currentOffset = maxSize
    } else if (bitPos >= 0) {
      // #945: a struct whose LAST member is a bitfield has bits outstanding, not
      // whole bytes. `uint32_t iskey:1, isnull:1, iscompr:1, size:29` is 32 bits
      // = 4 bytes, and rounding the BIT cursor up to bytes before the alignment
      // step is what produces that 4 rather than a rounded-up 0 or 1.
      currentOffset = Math.ceil(bitPos / 8)
    }

    if (!isPacked && maxAlign > 1) {
      currentOffset += (maxAlign - (currentOffset % maxAlign)) % maxAlign
    }
    return currentOffset
  }

  /**
   * #927: the STRUCT-map key this member's declared type resolves to, or null.
   * Only where the spelling allows it -- a member written `union U` is a union
   * even if a struct of that name exists, and `enum E` is neither. A bare/typedef
   * spelling keeps the historical behaviour (structs first), which is precisely
   * why the in-progress set, and not this rule, is the crash guarantee.
   *
   * The KEY is returned rather than a boolean because a `struct S` member is
   * spelled `struct S` while the map is keyed `S`: one lookup, one answer, and no
   * chance of the caller re-indexing with the unstripped text (which is the bug
   * this shape was written to prevent -- the first draft of this fix passed a
   * boolean back and then looked the map up with `field.type` again).
   */
  private structKeyForMember(field: any, structs: Record<string, any[]>): string | null {
    // #950: an inline aggregate member's fields were registered under a synthetic
    // key, and this is where the member's width finally becomes derivable.
    if (field.anonymousKey && structs[field.anonymousKey]) return field.anonymousKey
    const k = field.typeKind
    if (k === "tag_union" || k === "tag_enum") return null
    const key = k === "tag_struct" ? this.stripTagKeyword(field.type) : field.type
    return structs[key] ? key : null
  }

  private unionKeyForMember(field: any, unions: Record<string, any[]>): string | null {
    // #950: as `structKeyForMember`, for an inline UNION member.
    if (field.anonymousKey && unions[field.anonymousKey]) return field.anonymousKey
    const k = field.typeKind
    if (k === "tag_union") {
      const tag = this.stripTagKeyword(field.type)
      return unions[tag] ? tag : null
    }
    if (k === "tag_struct" || k === "tag_enum") return null
    return unions[field.type] ? field.type : null
  }

  /** `struct Foo` / `union Foo` / `enum Foo` as the parse spells it -> the bare tag. */
  private stripTagKeyword(typeText: string): string {
    let s = typeText.trim()
    for (const kw of ["struct", "union", "enum"]) {
      if (s.length > kw.length && s.startsWith(kw) && (s[kw.length] === " " || s[kw.length] === "\t")) {
        s = s.slice(kw.length).trim()
        break
      }
    }
    return s
  }

  private calculateAlignment(
    fields: any[],
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    // #927: the same in-progress set and the same reason -- this function
    // recursed on the identical cycle one function away, so bounding only the
    // size computation would have left half the crash in place.
    inProgress?: Set<string>,
  ): number {
    const active = inProgress ?? new Set<string>()
    let align = 1
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      // #936/#937: the SAME resolution the size pass uses -- the AST-derived
      // primitive class, then same-file typedef aliases. These two functions used
      // to carry independent spelling whitelists that had already drifted, and
      // then independent fallbacks that drifted too (4/4 against 1). One
      // resolver and one fallback, so neither can disagree with the other.
      const primitive = this.resolveMemberPrimitive(field)
      if (field.isPointer || inArray(["size_t", "ssize_t"], field.type)) align = Math.max(align, is64Bit ? 8 : 4)
      else if (primitive) align = Math.max(align, this.primitiveLayout(primitive, is64Bit, isLLP64).align)
      else if (field.type === "long") align = Math.max(align, is64Bit && !isLLP64 ? 8 : 4)
      else if (inArray(["double", "int64_t", "uint64_t"], field.type)) align = Math.max(align, 8)
      else if (inArray(["int", "float", "int32_t", "uint32_t"], field.type)) align = Math.max(align, 4)
      else if (inArray(["short", "int16_t", "uint16_t"], field.type)) align = Math.max(align, 2)
      else if (field.typeKind === "tag_enum") align = Math.max(align, 4)
      else {
        const structKey = this.structKeyForMember(field, structs)
        const unionKey = structKey ? null : this.unionKeyForMember(field, unions)
        const key = structKey ?? unionKey
        if (key) {
          if (active.has(key)) align = Math.max(align, 1)
          else {
            active.add(key)
            const list = structKey ? structs[key] : unions[key]
            align = Math.max(align, this.calculateAlignment(list, structs, unions, is64Bit, isLLP64, active))
            active.delete(key)
          }
        } else {
          // #938: an unresolvable member. It is missing the align-1 the old code
          // implied, which is the fix: the size pass was already charging it 4
          // bytes, and a member cannot be 4 bytes wide with alignment 1.
          align = Math.max(align, RealCAnalyzer.UNKNOWN_MEMBER.align)
        }
      }
    }
    return align
  }

  // --- Safe Shallow Helpers ---

  private getIdentifierFromDeclarator(node: Node | null): Node | null {
    let current = node
    while (current && !inArray(["identifier", "field_identifier", "type_identifier"], current.type)) {
      const byField = current.childForFieldName("declarator")
      if (byField) {
        current = byField
        continue
      }
      // #916-C: a parenthesized declarator can hold an ERROR child BESIDE the
      // real declarator — `(SQLITE_CDECL *sqlite3IoTrace)` recovers as
      // `parenthesized_declarator( ERROR[ SQLITE_CDECL ],
      //  pointer_declarator( *, sqlite3IoTrace ) )`. `namedChild(0)` descends
      // into that ERROR and RETURNS THE MACRO'S NAME, which is how
      // `sqlite3IoTrace` was emitted as `variable SQLITE_CDECL` (the phantom did
      // not merely accompany the real symbol — it took its place). The first
      // child that is not ERROR/MISSING is the declarator; when every child is an
      // error the old behaviour is preserved exactly.
      const kids = (current.namedChildren ?? []).filter((k: Node | null): k is Node => !!k)
      const clean = kids.find((k: Node) => !k.isError && !k.isMissing)
      current = clean ?? kids[0] ?? null
    }
    return current
  }

  /**
   * #916: the real declarator of a declaration truncated by a bare macro, read
   * from the SIBLING the recovery re-parsed. Returns false — leaving the old
   * behaviour untouched — unless the truncation is proven AND the sibling is one
   * of the measured recovery shapes, so no symbol is ever dropped on a guess.
   */
  private recoverBareMacroTruncation(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    globalVars: Record<string, boolean>,
    isStatic: boolean,
    isConditional: boolean,
  ): boolean {
    const macroId = this.macroTruncatedDeclarationIdentifier(node)
    if (!macroId) return false

    const next = node.nextSibling
    if (!next) return false

    // Shape A/B — the declarator was re-parsed as an expression statement.
    //
    // #928: the name and its "is it a declarator or a call" verdict are read from
    // the SIBLING'S OWN STRUCTURE, not from its text. The old rule parsed
    // `/^([A-Za-z_][A-Za-z0-9_]*)\s*(=|\()/` off `next.text` -- an identifier and
    // a delimiter recovered by regex from a node the grammar had already parsed,
    // which is the one thing this analyzer's own contract forbids ("Pure AST --
    // symbols and relationships derive from Tree-sitter nodes/fields, never
    // source-text scanning") and what the M49 regex census exists to catch.
    //
    // The structural reading is FAITHFUL, and the parity was measured
    // (truncation-shape.ts) over the ten spellings the regex accepted or refused:
    //   `NAME = value;`      -> expression_statement > assignment_expression with
    //                           `left` an identifier and the operator exactly "="
    //   `NAME(args);`        -> expression_statement > call_expression with
    //                           `function` an identifier
    //   `NAME;`              -> a bare identifier statement; REFUSED, as before
    //   `*NAME;`             -> pointer_expression; REFUSED, as before
    //   `NAME += 1;`         -> operator "+=", so REFUSED (the regex needed `=` or
    //                           `(` immediately after the name)
    //   `(NAME) = 1;`        -> left is parenthesized; REFUSED, as before
    // The operator test is exact rather than "first `=` in the text", which is
    // what the old regex did implicitly and why a compound assignment could never
    // have been accepted by it.
    if (next.type === "expression_statement") {
      const read = truncatedSiblingDeclarator(next)
      if (!read) return false
      const name = read.name
      if (name === macroId.text) return false
      if (read.callable) {
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node),
          scope: "global",
          visibility: isStatic ? "private" : "public",
          metadata: {
            isDeclaration: true,
            cSpecific: true,
            isConditional,
            recoveredFromMacroTruncation: true,
          },
        })
      } else {
        globalVars[name] = true
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Variable,
          range: this.nodeToRange(next),
          scope: "global",
          visibility: isStatic ? "private" : "public",
          metadata: {
            isVariable: true,
            cSpecific: true,
            isGlobal: true,
            isConditional,
            recoveredFromMacroTruncation: true,
          },
        })
      }
      return true
    }

    // Shape D — a macro-decorated DEFINITION whose return type the truncated
    // declaration ate: it arrives with NO declarator field, which the
    // function_definition branch reads as "not callable" (CGD38's correct rule for
    // a different shape) and drops. The symbol and its scope are emitted THERE, so
    // the body's reads and calls stay attributed to the function; here only the
    // phantom is suppressed.
    if (next.type === "function_definition" && this.recoveredMacroTruncatedFunction(next)) {
      return true
    }
    return false
  }

  /**
   * #916: the macro identifier of a declaration truncated by a bare macro — a
   * MISSING token AND a last named child that resolves to a bare ALL-CAPS
   * identifier. Null for every valid declaration (`MyType MAX_SIZE;` is clean) and
   * for a file that merely ENDS mid-declaration, which has no MISSING token and
   * is therefore never treated as this shape.
   */
  private macroTruncatedDeclarationIdentifier(node: Node): Node | null {
    if (node.type !== "declaration") return null
    let missing = false
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.isMissing) missing = true
    }
    if (!missing) return null
    const last = node.namedChild(node.namedChildCount - 1)
    const id = last ? this.getIdentifierFromDeclarator(last) : null
    if (!id || !isAllCapsIdentifier(id.text)) return null
    return id
  }

  /**
   * #916-D: the truth for a function_definition whose return type was consumed by
   * a bare-macro declaration immediately before it — `JNIEXPORT void JNICALL`
   * (truncated) then `NAME(params){...}`, which parses with the NAME in the `type`
   * field and the PARAMETER LIST in `declarator`. Every condition is structural and
   * the sibling declaration is the proof, so this cannot fire on an ordinary
   * definition (whose declarator is a function_declarator and whose prev sibling is
   * not a truncated declaration).
   */
  /**
   * #917: is this `compound_statement` the BODY of a macro-wrapped definition?
   *
   * The vendored C families define functions through an export macro that
   * stands where the declaration specifier belongs and makes the whole heading
   * CALL-shaped:
   *
   *   CMPP__EXPORT(int, cmpp_stream)( cmpp_input_f inF, … ){ … }
   *   JniDeclFtsXA(jobject,xUserData)(JniArgsEnvObj,jobject jFcx){ … }
   *   S3JniApi(sqlite3_value_text16(),jstring,1value_1text16)(…){ … }
   *
   * The published grammar reads that as `MACRO(ret, name)` CALLED with
   * `(params)`, so the body is left as an orphan `compound_statement` — a
   * direct child of the translation_unit, or of the ERROR / `preproc_ifdef`
   * that swallowed the region. The shape is evidence, not a heuristic: at file
   * scope (and inside a preproc block) an `expression_statement` followed by a
   * `compound_statement` is not valid C — only recovery produces it — and C has
   * no nested definitions, which is what `isInsideFunction` additionally keeps
   * honest at the call site.
   *
   * The declared NAME is the macro's LAST argument (both spellings in the
   * corpora put it there: `(ret, name)` and `(existing_fn(), type, name)`) and
   * the RETURN TYPE is the text of the macro's first argument — read from the
   * argument list's own structure plus one comma scan, never from the source
   * line.
   */
  private recoveredMacroWrappedHeader(header: Node): {
    name: string
    returnType: string
    header: Node
    nameNode: Node | null
    parameters: ASTEngine.Parameter[]
  } | null {
    // The SHAPE (including every refusal — no comma, macro-named, keyword) is
    // the exported module-scope rule the oracle shares; only the parameter
    // payload is analyzer-side (it reads `this.analyzeContent`).
    const shape = macroWrappedHeadingShape(header)
    if (!shape) return null
    return {
      name: shape.name,
      returnType: shape.returnType,
      header,
      nameNode: shape.nameNode,
      parameters: this.collectWrappedHeaderParameters(shape.outerArgs),
    }
  }

  /**
   * Parameter payload for a recovered macro-wrapped heading. The heading's
   * second parenthesised group is an `argument_list`, not a `parameter_list`,
   * so the measured shapes are what the collector follows: a named parameter is
   * `identifier(type) ERROR(identifier(name))` or `identifier(type)
   * identifier(name)`, and a lone identifier is an unnamed parameter.
   */
  private collectWrappedHeaderParameters(paramArgList: Node | null): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []
    if (!paramArgList) return parameters
    // Split on the list's own `,` TOKENS (nested parens live inside child
    // nodes, so every top-level comma is a direct child), and read each
    // group's text from the source span — joining child texts would glue
    // `cmpp_ssize_t` and `nIn` into one word.
    const groups: Node[][] = []
    let cur: Node[] = []
    for (let i = 0; i < paramArgList.childCount; i++) {
      const c = paramArgList.child(i)
      if (!c) continue
      if (c.type === ",") {
        if (cur.length) groups.push(cur)
        cur = []
        continue
      }
      if (c.isNamed) cur.push(c)
    }
    if (cur.length) groups.push(cur)

    // The RIGHTMOST identifier in SOURCE order — a `binary_expression` that
    // swallowed a pointer parameter (`unsigned char const **p`) holds its type
    // words and the declared name together, and the name is written last.
    // Children are pushed in reverse so the stack pops left-to-right.
    const lastIdentifierIn = (node: Node): Node | null => {
      let found: Node | null = null
      const st: Node[] = [node]
      while (st.length) {
        const n = st.pop()!
        if (n.type === "identifier" && n.text.trim()) found = n
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const ch = n.namedChild(i)
          if (ch) st.push(ch)
        }
      }
      return found
    }

    for (const group of groups) {
      const groupText = this.analyzeContent.slice(group[0].startIndex, group[group.length - 1].endIndex)
      if (groupText.includes("...")) {
        parameters.push({ name: "...", type: "variadic", modifiers: [] })
        continue
      }
      const last = group[group.length - 1]
      // A named parameter arrives as `identifier(type) ERROR(identifier(name))`
      // (value types) or as one `binary_expression` that swallowed the pointer
      // (`cmpp_dx *dx`); a lone `identifier` is an UNNAMED declaration like
      // `JniArgsEnvObj` or `void` — the analyzer's clean path calls that
      // `unknown`, and so does this one.
      const nameNode = last.isError
        ? (last.namedChildCount > 0 && last.namedChild(0)?.type === "identifier" ? last.namedChild(0) : null)
        : last.type === "binary_expression"
          ? lastIdentifierIn(last)
          : group.length >= 2 && last.type === "identifier"
            ? last
            : null
      if (!nameNode) {
        // An unnamed parameter (`void`, `JniArgsEnvObj`) is named NOTHING — R7: the
        // honest state is absence, never the literal "unknown", which would become a
        // parameter name that does not exist in the source. The TYPE is still known
        // and stays; only the name field is empty.
        parameters.push({ name: "", type: groupText.trim() || "any" })
        continue
      }
      const name = nameNode.text.trim()
      const type = groupText.slice(0, nameNode.startIndex - group[0].startIndex).trim()
      parameters.push({ name, type: type || "any" })
    }
    return parameters
  }

  /**
   * Emit the definition a wrapped heading names. Without this the file lost the
   * function entirely (`cmpp_stream`, `cmpp_outputer_cleanup` and 147 JNI
   * entries were not symbols at all — the only mention of some names was a
   * `#define`-adjacent Constant elsewhere in the file).
   */
  private extractMacroWrappedFunction(
    rec: { name: string; returnType: string; header: Node; nameNode: Node | null; parameters: ASTEngine.Parameter[] },
    body: Node,
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
    isConditional: boolean,
  ): ASTEngine.UniversalSymbol | null {
    const bodyRange = this.recoverFunctionRange(body, content)
    const headerRange = this.nodeToRange(rec.header)
    const symbol: ASTEngine.UniversalSymbol = {
      name: rec.name,
      kind: ASTEngine.SymbolKind.Function,
      // The definition STARTS at its heading: the body range supplies the end
      // (the matching brace), the heading supplies the start line/column, so a
      // reader that jumps to the symbol lands on the macro-decorated header.
      range: {
        ...bodyRange,
        startLine: headerRange.startLine,
        startColumn: headerRange.startColumn,
        startIndex: headerRange.startIndex,
      },
      scope: "global",
      complexity: this.functionComplexity(body),
      visibility: "public",
      isStatic: false,
      returnType: rec.returnType,
      parameters: rec.parameters,
      metadata: {
        cSpecific: true,
        recoveredFromMacroWrappedHeader: true,
        usesPointers: rec.parameters.some((p) => String(p.type ?? "").includes("*")),
        isConditional,
      },
    }
    symbols.push(symbol)
    return symbol
  }

  /**
   * #918: emit the definition a POINTER-RETURN macro-wrapped heading names (the
   * `function_definition` and `declaration` spellings of the same shape). The
   * range starts at the heading so a reader lands on the macro-decorated
   * header, and ends at the body's matching brace, found by the same
   * brace-matcher every other function uses.
   *
   * The LOCALS model is the one asymmetry the two spellings have, and it is a
   * mirror, not a taste: the F5 oracle keys `fnLocals` by `function_definition`
   * startIndex, so the function_definition spelling gets truth-side locals
   * (collected from body declarations) and the declaration spelling gets none.
   * Registering locals the oracle cannot see is how a recovery fabricates a
   * MISSING row — measured twice in this family (the #917 heading mention, the
   * #917 enum case) — so the declaration spelling joins the
   * `macroWrappedFunctionNames` set the #917 contract built for exactly this.
   */
  private extractMacroWrappedTypedFunction(
    rec: {
      name: string
      returnType: string
      nameNode: Node
      paramGroups: Node[][]
      macroNameText: string
      body: Node | null
      braced: boolean
    },
    node: Node,
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
    isConditional: boolean,
  ): ASTEngine.UniversalSymbol | null {
    if (!rec.body) this.macroWrappedFunctionNames.add(rec.name)
    const parameters = this.collectTypedWrappedParameters(rec.paramGroups)
    const endNode = rec.body ?? node
    const bodyRange = this.recoverFunctionRange(endNode, content)
    const headerRange = this.nodeToRange(node)
    const symbol: ASTEngine.UniversalSymbol = {
      name: rec.name,
      kind: ASTEngine.SymbolKind.Function,
      range: {
        ...bodyRange,
        startLine: headerRange.startLine,
        startColumn: headerRange.startColumn,
        startIndex: headerRange.startIndex,
      },
      scope: "global",
      complexity: this.functionComplexity(rec.body ?? node),
      visibility: "public",
      isStatic: false,
      returnType: rec.returnType,
      parameters,
      metadata: {
        cSpecific: true,
        recoveredFromMacroWrappedHeader: true,
        usesPointers: rec.returnType.includes("*") || parameters.some((p) => String(p.type ?? "").includes("*")),
        isConditional,
      },
    }
    symbols.push(symbol)
    return symbol
  }

  /**
   * #918: the parameter payload of a degraded parameter list. Each group's
   * declared name is the RIGHTMOST non-keyword identifier in source order
   * (measured: `int rc` keeps `rc` from beside a `type_identifier`-looking
   * `int`, `cmpp_dx const *dx` keeps `dx` from behind a `pointer_declarator`),
   * and a lone identifier is an UNNAMED declaration (`(void)`, `(JniArgsEnvObj)`)
   * — the same contract the #917 collector publishes, over the node shapes this
   * spelling produces.
   */
  private collectTypedWrappedParameters(groups: Node[][]): ASTEngine.Parameter[] {
    const parameters: ASTEngine.Parameter[] = []
    for (const group of groups) {
      if (!group.length) continue
      const groupText = this.analyzeContent.slice(group[0].startIndex, group[group.length - 1].endIndex)
      if (groupText.includes("...")) {
        parameters.push({ name: "...", type: "variadic", modifiers: [] })
        continue
      }
      const alone = group.length === 1 ? group[0] : null
      const nameNode =
        group.length >= 2
          ? lastNonKeywordIdentifierIn(group)
          : alone && alone.type === "pointer_declarator"
            ? lastNonKeywordIdentifierIn(group)
            : null
      if (!nameNode) {
        // Unnamed parameter: absence, not a placeholder literal (R7) — see the note in
        // `collectWrappedHeaderParameters`.
        parameters.push({ name: "", type: groupText.trim() || "any" })
        continue
      }
      const name = nameNode.text.trim()
      const type = this.analyzeContent.slice(group[0].startIndex, nameNode.startIndex).trim()
      parameters.push({ name, type: type || "any" })
    }
    return parameters
  }

  private recoveredMacroTruncatedFunction(node: Node): { name: string; returnType: string } | null {
    if (node.type !== "function_definition") return null
    const prev = node.previousSibling
    if (!prev || prev.type !== "declaration" || !this.macroTruncatedDeclarationIdentifier(prev)) return null
    const typeField = node.childForFieldName("type")
    const declField = node.childForFieldName("declarator")
    if (!typeField || !declField) return null
    if (declField.type !== "parenthesized_declarator") return null
    if (!inArray(["identifier", "field_identifier", "type_identifier"], typeField.type)) return null
    return { name: typeField.text, returnType: this.macroTruncatedReturnType(prev) }
  }

  /**
   * The return type the truncation ate: the specifier the macro decorates. For
   * `macro_prefixed_type_specifier "JNIEXPORT void"` the macro is a decorator and
   * `void` is the type, so the macro's text is stripped rather than reported as
   * the type.
   */
  private macroTruncatedReturnType(decl: Node): string {
    const kids = ((decl as any).namedChildren ?? []).filter((c: Node | null): c is Node => !!c) as Node[]
    const spec = kids.find((c) =>
      inArray(
        ["macro_prefixed_type_specifier", "primitive_type", "type_identifier", "sized_type_specifier", "struct_specifier"],
        c.type,
      ),
    )
    if (!spec) return "any"
    if (spec.type === "macro_prefixed_type_specifier") {
      const specKids = ((spec as any).namedChildren ?? []).filter((c: Node | null): c is Node => !!c) as Node[]
      const macro = specKids.find((c) => c.type === "macro_specifier")
      if (macro) return spec.text.slice(macro.text.length).trim() || "any"
    }
    return spec.text.trim() || "any"
  }

  /**
   * CGD7 (M37 #601): names actually BOUND by a local declaration — the
   * declarator identifiers of its init_declarator children, plus bare
   * declarator identifiers. NOT the RHS initializer identifiers: `int y = g;`
   * must bind only `y`. Binding `g` (the old collectDeclaredIdentifiers
   * behavior) suppressed every later genuine read of `g` in the function.
   */
  private collectBoundLocals(node: Node, functionLikeMacroNames?: Set<string>): string[] {
    const names: string[] = []
    const seen: Record<string, boolean> = {}
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (
        inArray(
          ["init_declarator", "identifier", "pointer_declarator", "array_declarator", "function_declarator"],
          child.type,
        )
      ) {
        // For init_declarator the declarator (first named child chain) is the
        // bound name; the `value` field is the initializer and is excluded.
        const decl =
          child.type === "init_declarator"
            ? this.getIdentifierFromDeclarator(child.childForFieldName("declarator"))
            : this.getIdentifierFromDeclarator(child)
        // CGD41 (#908): a function-like macro's NAME is not a binding — the
        // declarator it appears in is the macro INVOCATION spliced into the
        // declaration (see the pre-pass note above). Mirrors the oracle's
        // collectLocalDecl gate one-for-one.
        if (decl && decl.text.trim() && !seen[decl.text] && !(functionLikeMacroNames && functionLikeMacroNames.has(decl.text))) {
          seen[decl.text] = true
          names.push(decl.text)
        }
      }
    }
    return names
  }

  // #917: the names of macro-wrapped definitions recovered THIS file
  // (`MACRO(ret, name)(params){…}`). Two reasons it must be per-file state:
  // (1) the `declaration` branch must NOT register their body locals — see the
  // gate there; (2) a reused analyzer instance must not carry file A's names
  // into file B (the HC5 lesson the two fields below both carry).
  private macroWrappedFunctionNames = new Set<string>()

  // CGD19 PERF memo: per-ERROR-span verdict (last glued function-header
  // position, or -1 when the span holds no glued header). Keyed by the
  // span's startIndex; lives for the lifetime of one analyze() call.
  private cgd19HeaderIdx = new Map<number, number>()

  // #907 round 2: startIndex of every NAME that recoverGluedDefinitionHeader
  // emitted this file. The use path reads a bare identifier under an ERROR as a
  // read, which is right for the swallowed body's real references and wrong for
  // the definition header's own name — F5 measured the fabrication this way:
  // `decNumberPower uses decNumberQuantize` at the header's own line
  // (vendor/decNumber/decNumber.c L2284/2304/2306) and the os_win.c dispatch
  // table's `uses winRead` / `uses winWrite` pair. This set is what tells the
  // two apart, and it is filled before those identifiers are walked because the
  // ERROR node is processed before its children are pushed.
  //
  // #917 extends the SAME contract to the other recovery that mints a
  // definition: the macro-wrapped heading's naming argument. Its identifier is
  // a declaration too, and leaving it readable made the result ORDER-DEPENDENT
  // in a way F5 caught — `JniDeclFtsTok(jint,xTokenize)` on sqlite3-jni.c:6033
  // was silent only while no symbol named `xTokenize` existed, so the moment
  // the recovery emitted the definition at L6027 the LATER heading's own name
  // resolved and fabricated `uses global -> xTokenize` (a pair truth cannot
  // derive). Registering the offset with the heading removes the order from the
  // rule. One set, one gate, one meaning: a recovered definition's name is a
  // declaration, never a read.
  private gluedDefNameOffsets = new Set<number>()

  // #917: the recovered heading for each wrapped BODY (keyed by the body's
  // startIndex), filled when the heading is walked and consumed when the body
  // is entered. The heading's own case runs BEFORE its children are pushed, so
  // the name offset above is registered before that identifier is read.
  private macroWrappedHeaders = new Map<
    number,
    { name: string; returnType: string; header: Node; nameNode: Node | null; parameters: ASTEngine.Parameter[] }
  >()

  // CGD19 (M37 #601): positional ERROR-span discriminator for VARIABLE
  // declarations. The innermost ERROR ancestor containing `node` is scanned
  // ONCE (memoized per span by startIndex): glue = the FIRST
  // function_definition OR bare function_declarator (direct ERROR child).
  // Everything declared AFTER that glue is body text of the glued function
  // (tokenize.c sqlite3RunParser locals) and must not surface as file-scope
  // symbols. Prototypes (function_declarator inside a declaration wrapper)
  // are NOT glue — os_win.c's winMemMalloc/... are real file-scope names —
  // and function NAMES declare regardless (extractFunction path). status.c
  // (big recovery region, no glue) keeps all 13 real symbols.
  private isCgd19SuppressedVarDecl(node: Node): boolean {
    let cur: Node | null = node
    let innermostError: Node | null = null
    while (cur) {
      if (cur.type === "ERROR") innermostError = cur
      cur = cur.parent
    }
    if (!innermostError) return false
    const key = innermostError.startIndex
    let headerIdx = this.cgd19HeaderIdx.get(key)
    if (headerIdx === undefined) {
      headerIdx = -1
      const st: Node[] = [innermostError]
      const errStart0 = innermostError.startIndex
      const errEnd0 = innermostError.endIndex
      while (st.length > 0) {
        const m = st.pop()!
        // POSITION comparison (KAD2/TSD2 class, hygiene F7): web-tree-sitter
        // hands out fresh wrappers per access, so object identity only ever
        // holds for the very root object we pushed — compare spans to skip it.
        const isSpanRoot = m.startIndex === errStart0 && m.endIndex === errEnd0
        if (!isSpanRoot) {
          if (m.type === "function_definition") {
            if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
          } else if (m.type === "function_declarator") {
            // BARE fd = no declaration/function_definition wrapper between
            // the fd and the ERROR span (tokenize.c: direct child; jimsh0.c:
            // nested inside preproc_ifdef < ERROR — the direct-child test
            // missed it and 80+ post-glue locals leaked as globals). An fd
            // inside a declaration wrapper is an ordinary prototype
            // (os_win.c L331 winMemMalloc) — NOT glue. POSITION comparison
            // throughout: web-tree-sitter recreates node objects per access
            // and object identity NEVER holds (the same trap that broke the
            // direct-child test).
            let w: Node | null = m
            let bare = true
            const errStart = innermostError.startIndex
            const errEnd = innermostError.endIndex
            while (w) {
              if (w.startIndex === errStart && w.endIndex === errEnd) break
              if (w.type === "declaration" || w.type === "function_definition") {
                bare = false
                break
              }
              w = w.parent
            }
            if (bare && w) {
              if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
            }
          }
        }
        for (let k = 0; k < m.namedChildCount; k++) {
          const c = m.namedChild(k)
          if (c) st.push(c)
        }
      }
      this.cgd19HeaderIdx.set(key, headerIdx as number)
    }
    return (headerIdx as number) >= 0 && node.startIndex > (headerIdx as number)
  }

  // HC6: is this identifier inside a parameter list? Parameter names
  // (prototype or definition) are bound by the function, never file-scope
  // declarations — they must not enter the declaredNames pre-pass.
  private isInsideParameterList(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      if (t === "parameter_list" || t === "parameter_declaration") return true
      if (t === "function_definition" || t === "declaration") return false
      cur = cur.parent
    }
    return false
  }

  // CGD11: preprocessor CONDITION text vs conditional CODE. An identifier
  // is directive text iff the path from it to the first preproc_* ancestor
  // passes through no code container node. `#if (X>0)` → expression chain
  // only → text; `int y = F_OK;` inside #ifndef → init_declarator on path
  // → code. Mirrors the differential oracle exactly (one contract).
  private isDirectiveConditionText(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      // ≡ /statement|declaration|definition|declarator|specifier|enumerator|compound/ — unanchored alternation ≡ includes() per disjunct.
      if (
        t.includes("statement") ||
        t.includes("declaration") ||
        t.includes("definition") ||
        t.includes("declarator") ||
        t.includes("specifier") ||
        t.includes("enumerator") ||
        t.includes("compound")
      ) return false
      if (t.startsWith("preproc_")) return true
      cur = cur.parent
    }
    return false
  }

  // #901: is `node` the NAME field of a macro definition (`#define NAME ...`
  // or `#define NAME(...) ...`)? Field-identity by SPAN (web-tree-sitter
  // hands back fresh node objects per property access — the KAD2/TSD2 lesson
  // cited in isGlueFdName), not by object identity. A macro body is an
  // opaque preproc_arg (C-D2) and never the name field, so this cannot admit
  // a body mention; `#undef NAME` is a preproc_call with no name field, so it
  // cannot admit an undef target either (the oracle does not treat `#undef`
  // as a declaration).
  private isMacroDefinitionName(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    if (p.type !== "preproc_def" && p.type !== "preproc_function_def") return false
    const nameNode = p.childForFieldName("name")
    if (!nameNode) return false
    return nameNode.startIndex === node.startIndex && nameNode.endIndex === node.endIndex
  }

  // CGD40-mirror helper (see the use-emission gate): the C preprocessor is
  // line-anchored text (C-D2). A mention whose PHYSICAL source line starts
  // with '#' is directive text even when parse recovery spliced the node
  // into surviving code containers (no preproc_* ancestor remains for
  // isDirectiveConditionText). One lastIndexFrom(0) per mention — measured
  // negligible on the vdbe.c perf budget.
  private analyzeContent = ""
  // #929: the per-file line-start index backing `indexToLineColumn`. Both fields
  // move together; the content key is what makes a reused instance safe, and the
  // reset at `analyze()` entry is what keeps the array from outliving its file.
  private lineIndex: Int32Array | null = null
  private lineIndexContent = ""
  /**
   * #962: the TYPE an allocator call produces, read from the cast or from `sizeof`.
   *
   * Returns null when the allocation names no declared type -- an allocation into
   * `void *` with no cast, or a cast to a type the file does not declare -- because in
   * that case there is no `instantiates` edge to publish. `instantiates` targets a TYPE
   * in all 25 M12 truths that pin one (`Point`, `User`, `List`, `Dictionary`,
   * `MemoryStorage`), so an edge to `malloc` would be the only non-type target in the
   * family and could never resolve to a type symbol.
   *
   * `sizeof(Buffer)` is read as well as the cast, because the two frequently disagree in
   * which one carries the type: `p = malloc(sizeof(Buffer))` names it only in `sizeof`,
   * and `Buffer *p = (Buffer *)realloc(old, n)` names it only in the cast.
   */
  private allocatedTypeName(
    call: Node,
    declaredTypes: Set<string>,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    enums: Record<string, boolean>,
  ): string | null {
    // A type NAME in the source, whatever node carries it. `(Buffer *)` is a
    // `type_descriptor` around a `type_identifier`; `(struct Buf *)` is a
    // `type_descriptor` around a `struct_specifier`; `(struct Buf *)`'s descriptor
    // text is `"struct Buf *"`, WITH the keyword and the pointer, so matching the
    // descriptor's own text against a declared-type set never hits. Reading only the
    // `type_identifier` case -- the first draft -- published no edge at all, and
    // `(Buffer *)malloc(...)` and `(struct Buf *)malloc(...)` are the same fact.
    const typeNameOf = (n: Node | null | undefined): string | null => {
      if (!n) return null
      if (n.type === "type_identifier") return n.text
      if (n.type === "struct_specifier" || n.type === "union_specifier" || n.type === "enum_specifier") {
        return n.childForFieldName("name")?.text ?? null
      }
      if (n.type === "type_descriptor") return typeNameOf(n.childForFieldName("type"))
      // `sizeof_expression` has NO `argument` FIELD in this grammar -- its operand is
      // `namedChild(0)`. Reading the field returned undefined, so every `sizeof`-only
      // allocation silently produced no edge: `struct Node *nd = malloc(sizeof(struct
      // Node));` published nothing while `(struct Buf *)malloc(sizeof(struct Buf))`
      // published correctly through its CAST. The two spellings disagree about which
      // one carries the type, which is why both are read, and one of the two was
      // reading a field that does not exist.
      if (n.type === "sizeof_expression") return typeNameOf(n.namedChild(0))
      if (n.type === "parenthesized_expression") return typeNameOf(n.namedChild(0))
      // NOT `elaborated_specifier`: that node type does not exist in tree-sitter-c --
      // it is Java/TypeScript's, and the F1 grammar oracle caught the literal on the
      // first run of this change ("unknown=1"), which is exactly the finding it exists
      // to make: a string compared against a node type that can never match. Verified
      // by scanning 60 corpus files for the node type across the whole grammar.
      return null
    }
    const declared = (name: string | null | undefined): string | null => {
      if (!name || !name.trim()) return null
      const n = name.trim()
      if (declaredTypes.has(n) || structs[n] || unions[n] || enums[n]) return n
      return null
    }

    // 1. An enclosing cast whose VALUE is this call: `(Buffer *)malloc(...)`.
    let p: Node | null = call.parent
    for (let depth = 0; p && depth < 4; depth++, p = p.parent) {
      if (p.type !== "cast_expression") continue
      const value = p.childForFieldName("value")
      if (value && value.id === call.id) {
        // `(Buffer *)` parses as a `type_descriptor` wrapping the `type_identifier`,
        // so the descriptor's own text is `"Buffer *"` -- WITH the pointer -- and
        // matching that against a declared-type set never hits. The inner node is the
        // name. Measured on Module.c:26, where the payload emitted no `instantiates`
        // for exactly this reason.
        const hit = declared(typeNameOf(p.childForFieldName("type")))
        if (hit) return hit
      }
      break
    }

    // 2. `sizeof(<type>)` in the argument list.
    const args = call.childForFieldName("arguments")
    if (args) {
      for (let i = 0; i < args.namedChildCount; i++) {
        const a = args.namedChild(i)
        if (a?.type !== "sizeof_expression") continue
        // `typeNameOf` reads `namedChild(0)`, because `sizeof_expression` has no
        // `argument` FIELD in this grammar. This call site still read the field, so the
        // whole `sizeof` path returned undefined and every allocation that carried its
        // type ONLY in `sizeof` published no edge -- which is half the cases the ruling
        // is about. The two spellings disagree in practice: `malloc(sizeof(struct Node))`
        // has no cast at all, and `(struct Buf *)realloc(p, n)` has no sizeof.
        const hit = declared(typeNameOf(a))
        if (hit) return hit
      }
    }
    return null
  }

  private isHashLineMention(node: Node): boolean {
    const bol = this.analyzeContent.lastIndexOf("\n", node.startIndex - 1) + 1
    let i = bol
    while (i < node.startIndex && (this.analyzeContent[i] === " " || this.analyzeContent[i] === "\t")) i++
    return this.analyzeContent[i] === "#"
  }

  // CGD12: is this plain `identifier` really a TYPE position? The pinned
  // grammar parses `sizeof(VfslogFile)` and C++-style template args as a
  // bare identifier chain; the honest classification is the first
  // code-container ancestor. If we reach a sizeof_expression (or the type
  // slot of a cast/type_descriptor) before any statement/declaration
  // container, the identifier names a type.
  private isTypePositionIdentifier(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t: string = cur.type
      if (t === "sizeof_expression") return true
      if (t === "cast_expression") {
        // CGD28 (M37 #601): only the cast's TYPE OPERAND is a type position
        // — `(i64)x` → i64 yes, x no. The VALUE operand is the LAST named
        // child of the cast_expression; anything starting before it sits in
        // the type operand. (Measured hole: `(sqlite3_syscall_ptr)ts_open`
        // — the function-name VALUE must stay a `uses` read, test_syscall.c
        // syscall tables.)
        const kids: (Node | null)[] = []
        for (let i = 0; i < cur.namedChildCount; i++) kids.push(cur.namedChild(i))
        const valid = kids.filter((k): k is Node => !!k)
        if (valid.length >= 2) {
          const value = valid[valid.length - 1]
          return node.startIndex < value.startIndex
        }
        return false
      }
      // ≡ /statement|declaration|declarator|specifier|enumerator|compound|argument_list|init/ — includes() per disjunct ("init" also hits init_declarator, as before).
      if (
        t.includes("statement") ||
        t.includes("declaration") ||
        t.includes("declarator") ||
        t.includes("specifier") ||
        t.includes("enumerator") ||
        t.includes("compound") ||
        t.includes("argument_list") ||
        t.includes("init")
      ) return false
      cur = cur.parent
    }
    return false
  }

  // CGD12-mirror (M37 #601): within a declarator-chain parent, only the
  // LEFTMOST identifier declares. `int x = F_OK;` parses as declaration >
  // init_declarator with children [declarator(x), value(F_OK)] — the old
  // any-child rule treated the initializer VALUE as declaring too, so the
  // read was suppressed and the edge never emitted (measured: F_OK in
  // test_demovfs, pTestCollateInterp in test1.c, and the
  // `*(*const autolockIoFinder)(...) = autolockIoFinderImpl` value in
  // os_unix.c were all silent while the oracle derived truth → MISSING).
  // Same chain walk as the oracle's isDeclaringIdentifier (one contract).
  private isDeclaringChainLeftmost(node: Node): boolean {
    const p = node.parent
    // ≡ /declarator$/ — matches declarator, init_declarator, abstract_declarator, field_declarator, …
    if (!p || !p.type.endsWith("declarator")) return false
    let cur: Node | null = p
    while (cur) {
      if (cur.type === "identifier" || cur.type === "field_identifier") {
        return cur.startIndex === node.startIndex
      }
      let next: Node | null = null
      for (let k = 0; k < cur.namedChildCount; k++) {
        const c = cur.namedChild(k)
        if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) {
          next = c
          break
        }
      }
      cur = next
    }
    return false
  }

  private isDeclarationLikeIdentifier(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    // CGD35 (M37 #601, measured showwal.c/fossildelta.c/showdb.c ×15): a
    // TYPE_identifier inside a declaration/parameter is a USE of the type,
    // never the declaring occurrence — the NAME of a typedef alias or struct
    // tag parses as type_identifier (the grammar tracks in-file typedefs),
    // and only the alias/TAG declaration itself (declaredTypes pre-pass) is
    // the declaration. The old any-parent rule classified `i64 x` / the
    // return type of `static i64 f(...)` as "declaring", suppressing the
    // references-truth the oracle derives (`typedef long long int i64;` in
    // showwal.c → every real `i64` read vanished → references i64 missing).
    // Mirrors the oracle's isDeclaringIdentifier exclusion exactly
    // (`if (n.type === "type_identifier") return false`).
    if (node.type === "type_identifier") return false
    const declParents = [
      "declaration",
      "parameter_declaration",
      "field_declaration",
      "init_declarator",
      "function_declarator",
      "pointer_declarator",
      "array_declarator",
      "type_definition",
      "enumerator",
      "preproc_def",
      "preproc_function_def",
    ]
    if (!inArray(declParents, p.type)) return false
    // CGD12-mirror: within a declarator-chain parent only the leftmost
    // identifier declares — an initializer value is a READ (see
    // isDeclaringChainLeftmost for the measured defects).
    // ≡ /declarator$/ (endsWith — same match set as above).
    if (p.type.endsWith("declarator") || p.type === "init_declarator") {
      return this.isDeclaringChainLeftmost(node)
    }
    return true
  }

  // CGD33: does `name` resolve ONLY as a type declaration (no value
  // declaration anywhere)? Value evidence = a global variable, a declared
  // value name (globals/functions/prototypes/enum members/macros — the
  // CGD26 pre-pass), or a VALUE symbol. VALUE kinds are the ones that name
  // run-time entities a C expression can read: Variable/Constant/Macro
  // (globals + preprocessor constants), Function (callbacks read as
  // values), EnumMember. Everything else is a TYPE-ish kind — Type, Enum,
  // Struct, Union, Class, Trait, Interface, Property (struct FIELDS are
  // member declarations, never bare-value names in well-formed C) — and
  // NEVER counts as value evidence, even when the symbol's scope is
  // "global" (a top-level tagged `struct Mem3Global {...}` carries scope
  // global and kind Struct — the exact class that leaked `uses
  // Mem3Global`). Type evidence = the structs/unions/enums type maps, a
  // declaredTypes entry, or a type-ish symbol. See the emission-gate
  // comment for the measured defect.
  private isTypeOnlyName(
    name: string,
    symbols: ASTEngine.UniversalSymbol[],
    globalVars: Record<string, boolean>,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    enums: Record<string, boolean>,
    declaredTypes: Set<string>,
    declaredNames?: Set<string>,
  ): boolean {
    if (globalVars[name] || declaredNames?.has(name)) return false
    const VALUE_KINDS = new Set([
      ASTEngine.SymbolKind.Variable,
      ASTEngine.SymbolKind.Constant,
      ASTEngine.SymbolKind.Macro,
      ASTEngine.SymbolKind.Function,
      ASTEngine.SymbolKind.EnumMember,
    ])
    const TYPE_KINDS = new Set([
      ASTEngine.SymbolKind.Type,
      ASTEngine.SymbolKind.Enum,
      ASTEngine.SymbolKind.Struct,
      ASTEngine.SymbolKind.Union,
      ASTEngine.SymbolKind.Class,
      ASTEngine.SymbolKind.Trait,
      ASTEngine.SymbolKind.Interface,
      ASTEngine.SymbolKind.Property,
    ])
    let hasValueSymbol = false
    let hasTypeSymbol = false
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (!s || s.name !== name) continue
      if (TYPE_KINDS.has(s.kind)) hasTypeSymbol = true
      if (VALUE_KINDS.has(s.kind)) {
        hasValueSymbol = true
        break
      }
    }
    if (hasValueSymbol) return false
    return !!structs[name] || !!unions[name] || !!enums[name] || hasTypeSymbol || declaredTypes.has(name)
  }

  private isResolvableUseTarget(
    name: string,
    nodeType: string,
    symbols: ASTEngine.UniversalSymbol[],
    globalVars: Record<string, boolean>,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    enums: Record<string, boolean>,
    declaredTypes: Set<string>,
    declaredNames?: Set<string>,
  ): boolean {
    if (!name || !name.trim()) return false
    if (inArray(["NULL", "true", "false", "..."], name)) return false

    // Type identifiers resolve only when the type is actually DECLARED in this
    // file (pre-pass set — order-independent). A bare forward declaration that
    // is never defined (`struct ForwardOnly;`) has no symbol to resolve to, so
    // it must not produce a dangling use edge.
    if (inArray(["type_identifier", "struct_specifier", "union_specifier", "enum_specifier"], nodeType))
      return declaredTypes.has(name)
    if (globalVars[name] || structs[name] || unions[name] || enums[name]) return true
    // CGD26: order-independent file-scope name resolution (static
    // initializer tables reference later symbols; see the pre-pass).
    if (declaredNames?.has(name)) return true

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (!s || s.name !== name) continue
      if (
        s.scope === "global" ||
        s.kind === ASTEngine.SymbolKind.Type ||
        s.kind === ASTEngine.SymbolKind.Enum ||
        // Enum members are global constants in C — usage (e.g. `return
        // STATUS_OK;`) must resolve (matches the Java family: `Status uses
        // ACTIVE`). Their scope is the enum name, not "global".
        s.kind === ASTEngine.SymbolKind.EnumMember ||
        s.kind === ASTEngine.SymbolKind.Function ||
        s.kind === ASTEngine.SymbolKind.Constant
      ) {
        return true
      }
    }
    return false
  }

  private inferIs64Bit(content: string, filePath: string): boolean {
    const hints64 = ["__LP64__", "_LP64", "__x86_64__", "__aarch64__", "__ppc64__", "__s390x__"]
    for (let i = 0; i < hints64.length; i++) {
      if (stringIncludes(content, hints64[i])) return true
    }

    const hints32 = ["__ILP32__", "__i386__", "__arm__", "__mips__"]
    for (let i = 0; i < hints32.length; i++) {
      if (stringIncludes(content, hints32[i])) return false
    }

    if (stringIncludes(content, "_WIN64")) return true
    if (stringIncludes(content, "_WIN32")) return false
    if (stringIncludes(filePath, "x86_64") || stringIncludes(filePath, "aarch64")) return true
    if (stringIncludes(filePath, "i386") || stringIncludes(filePath, "armv7")) return false

    return true
  }

  private inferIsLLP64(content: string): boolean {
    return stringIncludes(content, "_WIN64") || stringIncludes(content, "windows.h")
  }

  private recoverFunctionRange(node: Node, content: string): ASTEngine.UniversalSymbol["range"] {
    const base = this.nodeToRange(node)
    const body = node.childForFieldName("body")

    let openBraceIdx = -1
    if (body) {
      openBraceIdx = content.indexOf("{", body.startIndex)
    }

    if (openBraceIdx < 0) {
      const declarator = node.childForFieldName("declarator")
      const searchFrom = declarator ? declarator.endIndex : node.startIndex
      openBraceIdx = content.indexOf("{", searchFrom)
      if (openBraceIdx < 0 || openBraceIdx > node.startIndex + 32768) return base
    }

    let depth = 0
    let inLineComment = false
    let inBlockComment = false
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false

    for (let i = openBraceIdx; i < content.length; i++) {
      const ch = content[i]
      const next = i + 1 < content.length ? content[i + 1] : ""

      if (inLineComment) {
        if (ch === "\n") inLineComment = false
        continue
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false
          i++
        }
        continue
      }

      if (inSingleQuote) {
        if (escaped) {
          escaped = false
        } else if (ch === "\\") {
          escaped = true
        } else if (ch === "'") {
          inSingleQuote = false
        }
        continue
      }

      if (inDoubleQuote) {
        if (escaped) {
          escaped = false
        } else if (ch === "\\") {
          escaped = true
        } else if (ch === '"') {
          inDoubleQuote = false
        }
        continue
      }

      if (ch === "/" && next === "/") {
        inLineComment = true
        i++
        continue
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true
        i++
        continue
      }
      if (ch === "'") {
        inSingleQuote = true
        continue
      }
      if (ch === '"') {
        inDoubleQuote = true
        continue
      }

      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          const endIndex = i + 1
          const pos = this.indexToLineColumn(content, endIndex)
          return {
            startLine: base.startLine,
            startColumn: base.startColumn,
            endLine: pos.line,
            endColumn: pos.column,
            startIndex: base.startIndex,
            endIndex,
          }
        }
      }
    }

    return base
  }

  private indexToLineColumn(content: string, index: number): { line: number; column: number } {
    // #929: this used to walk the WHOLE content from 0 on every call, and its one
    // caller is `recoverFunctionRange` -- once per FUNCTION. That is O(n) per
    // function, so O(n * functions) per file: superlinear in the file, and
    // invisible in a per-kilobyte number taken from small files. The analyzer
    // documentation claimed "No O(n^2) or per-symbol O(n) scans", which this
    // contradicted.
    //
    // MEASURED attribution (script/m14/tmp/c-audit/perf-attribution.ts, three
    // variants of the real analyzer on `redis/src/server.c`, 360,751 bytes /
    // 39,321 nodes, median of 3, load1 disclosed in the run):
    //   as-is                        4809 ms
    //   line index built once        3930 ms   (-18.3%)
    //   constant answer (upper bound) 3667 ms (-23.7%)
    // so the term was roughly a fifth of the analyzer's wall time on a 360 KB
    // file. The build is O(n) once per file; each lookup is then O(log lines) by
    // binary search, or O(1) amortised from a cursor -- the cursor is kept out
    // because `recoverFunctionRange` asks for increasing offsets in practice but
    // nothing guarantees it, and a wrong answer would be worse than a slower one.
    const starts = this.lineStartIndex(content)
    // The clamp is NOT cosmetic: the pre-#929 walk used `Math.min(index,
    // content.length)` and a negative index simply ran no iterations, so both
    // out-of-range directions answered "line 1, column 1"-shaped values. The
    // parity probe (script/m14/tmp/c-audit/line-index-parity.ts) measured 36
    // disagreements over 383,195 in-range offsets being zero but every
    // out-of-range probe differing -- a past-the-end index returned a column of
    // `index - lastLineStart + 1` and a negative index returned column 0. Clamping
    // to the content's own bounds restores the old answers exactly, and the probe
    // is re-run to prove it.
    const clamped = index < 0 ? 0 : index > content.length ? content.length : index
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= clamped) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: clamped - starts[lo] + 1 }
  }

  /**
   * #929: the byte offset of each line's first character, built once per file.
   * Keyed on the content so a reused instance (the HC5 lesson) can never answer
   * for the previous file, and reset at `analyze()` entry so the array does not
   * outlive the file it describes.
   */
  private lineStartIndex(content: string): Int32Array {
    if (this.lineIndexContent === content && this.lineIndex) return this.lineIndex
    let lines = 1
    for (let i = 0; i < content.length; i++) if (content[i] === "\n") lines++
    const starts = new Int32Array(lines)
    let n = 0
    starts[n++] = 0
    for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts[n++] = i + 1
    this.lineIndex = starts
    this.lineIndexContent = content
    return starts
  }

  private isPointerType(node: Node | null): boolean {
    let current = node
    while (current) {
      if (current.type === "pointer_declarator") return true
      current = current.childForFieldName("declarator") || (current.namedChildCount > 0 ? current.namedChild(0) : null)
    }
    return false
  }

  private hasStorageClass(node: Node, className: string): boolean {
    return !!this.findChild(node, (c) => c?.type === "storage_class_specifier" && c.text === className)
  }

  private isPacked(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "attribute_specifier" || child.type === "attribute") {
        if (stringIncludes(child.text, "packed")) return true
      }
    }
    return false
  }

  private findFirstChildOfType(node: Node | null, type: string, condition?: (n: Node) => boolean): Node | null {
    if (!node) return null
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === type && (!condition || condition(current))) return current
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return null
  }

  private detectCFrameworks(imports: ASTEngine.ImportInfo[]): string[] {
    const frameworks: Record<string, boolean> = {}
    for (let idx = 0; idx < imports.length; idx++) {
      const i = imports[idx]
      const m = i.module
      if (!m) continue
      if (stringIncludes(m, "stdio.h") || stringIncludes(m, "stdlib.h")) frameworks["Standard C Library"] = true
      if (stringIncludes(m, "unistd.h") || stringIncludes(m, "pthread.h")) frameworks["POSIX"] = true
      if (stringIncludes(m, "windows.h")) frameworks["Windows API"] = true
      if (m.startsWith("gtk/")) frameworks["GTK"] = true
      if (stringIncludes(m, "glib.h")) frameworks["GLib"] = true
      if (m.startsWith("SDL")) frameworks["SDL"] = true
      if (stringIncludes(m, "linux/module.h")) frameworks["linux_kernel"] = true
      if (stringIncludes(m, "FreeRTOS.h")) frameworks["freertos"] = true
    }
    const arr: string[] = []
    for (const f in frameworks) arr.push(f)
    return arr
  }

  /**
   * #907 (M60-C): recover a definition HEADER that parse recovery glued into a
   * preceding function's body. Measured shape (jq src/jv_print.c L389/L393, where a
   * `} else {` at L262 pairs with a closing brace living inside a later
   * `#ifdef USE_DECNUM`, so the `case` at L254 runs away to L394):
   *
   *   ERROR { primitive_type "void", function_declarator "jv_dumpf(...)" }  then `{`
   *
   * The invariant that makes emission safe: **C has no nested functions.** A
   * definition header inside a body can therefore only be recovery glue for a
   * FILE-SCOPE definition, so the symbol is emitted at global scope rather than
   * into the block that swallowed it.
   *
   * The discriminator is the character after the declarator — `{` means definition,
   * while `;`/`,`/`)` means prototype, call, or initializer. That single test is what
   * keeps this from fabricating: recovery ALSO misparses ordinary calls as
   * function_declarators (jv_dump's body holds `jv_dumpf(x, stdout, flags)` as one),
   * and those are followed by `;`.
   *
   * Deliberately SILENT about anything else: no symbol, no scope push, no local
   * re-attribution. The swallowed bodies keep the attribution they already have, so
   * this adds catalog entries without moving a single relationship (which is what
   * keeps it F5-neutral).
   */
  private recoverGluedDefinitionHeader(
    node: Node,
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // Never a parameter list: a declarator there is a function-pointer parameter.
    // A `compound_statement` on the path is NOT required — round 2 of #907 measured
    // the same loss at ROOT scope (jq `jv.c:673` `jv jv_number(double x) {`, whose
    // ERROR is a direct child of `translation_unit`) and in `jv_dtoa.c`'s
    // `ERROR[2-4277]`, so gating on "swallowed into a body" left four sites unfixed.
    // What carries the safety is the brace test below, not the ancestor shape: a
    // prototype, call, or initializer ends in `;`, `,`, `)`, or `=`.
    let macroAncestor: Node | null = null
    let insideBody = false
    let w: Node | null = node.parent
    while (w) {
      if (w.type === "parameter_list") return
      if (w.type === "preproc_def" || w.type === "preproc_function_def") macroAncestor = w
      if (w.type === "compound_statement") insideBody = true
      w = w.parent
    }

    for (const { id, wrapped, rangeNode } of this.gluedDeclaratorNames(node, content)) {
      const name = id.text.trim()
      if (!name || C_KEYWORDS.has(name)) continue
      // Definition iff the name's own parameter list is followed by the body's
      // opening brace. The test is made on the TEXT from the name rather than on
      // the declarator node's end, because when recovery degrades far enough the
      // name is a bare `identifier` whose parent is the whole ERROR region — using
      // the parent's end makes every such site look like `…}` and refuses it (that
      // was measured: decNumber.c's three public functions were still lost after
      // the identifier rule was added for exactly this reason).
      if (!this.definitionBodyFollows(content, id)) continue
      // A `#define` body can write a definition-shaped sequence too (`#define
      // DEF(name) void name(void) {`), and `name` there is the macro PARAMETER, not
      // a symbol. A declarator inside the macro's own logical line is therefore
      // skipped; one that lives past the last backslash-continuation is not — that
      // is how jq's `parser.c` reaches `void yyerror(...)` (macro ends at L403, the
      // definition is L406).
      if (macroAncestor && this.insideMacroContinuation(macroAncestor, id, content)) continue
      if (symbols.some((s) => s.name === name && s.kind === ASTEngine.SymbolKind.Function)) continue
      this.gluedDefNameOffsets.add(id.startIndex)
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Function,
        range: this.nodeToRange(rangeNode ?? id),
        scope: "global",
        visibility: this.isStaticInDeclaration(id, content) ? "private" : "public",
        // The arrival is recorded because it is what round 2 added, and because
        // a mutant can only target one arrival if the result says which it was.
        metadata: {
          cSpecific: true,
          recoveredFromGlue: true,
          glueArrival: insideBody ? "body" : "file-scope",
          glueWrapped: wrapped,
          glueNameShape:
            rangeNode.type === "function_declarator"
              ? "declarator"
              : rangeNode.type === "call_expression"
                ? "call-declarator"
                : "bare-identifier",
        },
      })
    }
  }

  /**
   * #907: the identifiers a glued definition header can expose, unwrapping the
   * declarator forms the damaged tree actually produces. Three measured arrivals:
   *   ERROR > function_declarator                       (jv.c `jv_number`)
   *   ERROR > pointer_declarator > function_declarator  (util.c `strptime`,
   *                                                      jv_dtoa.c `jvp_dtoa`)
   *   ERROR > call_expression > identifier               (#912: builtin.c
   *                                                      `static block gen_last_1(void)`)
   * Only the ERROR's own children are visited, and only through declarator
   * wrappers — a `function_declarator` nested in a struct or an argument list is
   * NOT a file-scope definition header and is deliberately unreachable here.
   */
  private gluedDeclaratorNames(
    error: Node,
    content: string,
  ): Array<{ id: Node; wrapped: boolean; rangeNode: Node }> {
    const found: Array<{ id: Node; wrapped: boolean; rangeNode: Node }> = []
    const unwrap = (n: Node, depth: number, wrapped: boolean): void => {
      if (depth > 3) return
      if (n.type === "function_declarator") {
        const id = n.childForFieldName("declarator")
        if (id && id.type === "identifier") found.push({ id, wrapped, rangeNode: n })
        return
      }
      // A more degraded recovery drops the declarator node entirely: the name
      // arrives as a BARE identifier under the ERROR (jq decNumber.c:2303
      // `decNumber * decNumberNormalize(...) {` inside a swallowed body; jq
      // parser.c:406 `void yyerror(...) {` under a macro's ERROR). Calls are the
      // same shape — which is why an identifier is only accepted when the text
      // before it still reads as a DECLARATION (see declarationHeaderBefore
      // below): `FOREACH(item) {` and `foo(x) {` have no return type and are
      // refused, while `void yyerror(...)` and `decNumber * decNumberNormalize(...)`
      // are not.
      if (n.type === "identifier" && this.declarationHeaderBefore(n, content)) {
        found.push({ id: n, wrapped, rangeNode: n })
        return
      }
      if (
        n.type === "pointer_declarator" ||
        n.type === "parenthesized_declarator" ||
        n.type === "attributed_declarator"
      ) {
        const inner = n.childForFieldName("declarator")
        if (inner) unwrap(inner, depth + 1, true)
      }
      // #912 (M60-C): the CALL-shaped declarator. When recovery absorbs the
      // declaration's TYPE words into the ERROR and leaves the declarator
      // behind, the damaged tree writes the definition header as a CALL —
      // jq `src/builtin.c:2067`, inside the macro-driven initializer list that
      // swallowed the table's own `};`:
      //
      //   ERROR { `}` `;` #undef… `identifier:static` `identifier:block`
      //           (call_expression `gen_last_1(void)`) }  `<body> {…}`
      //
      // The declared NAME is the call's own callee, and the caller's brace test
      // (`definitionBodyFollows`: the argument list must END at the body's `{`)
      // still applies. The discriminator that separates this from a macro
      // INVOCATION with a block — the entire ground on which this shape was
      // refused in #907 — is the declaration-specifier run the region keeps in
      // front of the call (`declarationSpecifierRunBefore` above): reserved
      // specifier words, read from the damaged tree's own tail, which
      // `FOREACH(item) {` cannot present and which `#define osCloseHandle ((BOOL…`
      // cannot present either (see that predicate for the 33 fabricated sqlite
      // functions the looser #907 header test produces here).
      //
      // The argument list is required to exist: without it there is no
      // parameter list for `definitionBodyFollows` to resolve.
      if (n.type === "call_expression") {
        const callee = n.childForFieldName("function") ?? (n.namedChildCount > 0 ? n.namedChild(0) : null)
        const args = n.childForFieldName("arguments") ?? childOfType(n, "argument_list")
        if (callee && callee.type === "identifier" && args && declarationSpecifierRunBefore(n) !== null) {
          found.push({ id: callee, wrapped, rangeNode: n })
        }
        return
      }
    }
    for (let i = 0; i < error.namedChildCount; i++) {
      const c = error.namedChild(i)
      if (c) unwrap(c, 0, false)
    }
    return found
  }

  /**
   * The whitespace set the JS `\s` class matches, as a code-point test. These
   * #907 recovery guards scan raw source text, so they need a character test,
   * not an extraction — and the census's standing rule (R2) is that a character
   * test is string logic, not a regex literal. Same set as `\s`: ASCII space,
   * tab, LF, VT, FF, CR, NBSP, OGHAM SPACE MARK, the EN/EM quad family,
   * LINE/PARAGRAPH SEPARATOR, NNBSP, MMSP, IDEOGRAPHIC SPACE.
   */
  private static isSourceSpace(ch: string): boolean {
    const c = ch.charCodeAt(0)
    return (
      c === 32 ||
      (c >= 9 && c <= 13) ||
      c === 0xa0 ||
      c === 0x1680 ||
      (c >= 0x2000 && c <= 0x200a) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0x202f ||
      c === 0x205f ||
      c === 0x3000
    )
  }

  /** `\w` for this file's purposes: ASCII word characters, the set `\b` uses. */
  private static isWordChar(ch: string | undefined): boolean {
    if (ch === undefined) return false
    return (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_"
    )
  }

  /**
   * Does the text carry the keyword `static` as a WHOLE word — the `\bstatic\b`
   * test, walked so the census stays free of a new regex literal.
   */
  private static hasStaticKeyword(text: string): boolean {
    const word = "static"
    let at = text.indexOf(word)
    while (at !== -1) {
      const before = at === 0 ? undefined : text[at - 1]
      const after = text[at + word.length]
      if (!RealCAnalyzer.isWordChar(before) && !RealCAnalyzer.isWordChar(after)) return true
      at = text.indexOf(word, at + 1)
    }
    return false
  }

  /**
   * #907: does this name's own parameter list end at a `{`? Walked on the text so
   * it works the same for a proper declarator node and for the bare-identifier
   * arrival. Anything else after the parameter list (`;`, `,`, `)`, `=`, or a
   * trailing attribute/initialiser) means prototype, call, or initialiser.
   */
  private definitionBodyFollows(content: string, id: Node): boolean {
    let j = id.endIndex
    if (!(j >= 0 && j <= content.length)) return false
    while (j < content.length && RealCAnalyzer.isSourceSpace(content[j])) j++
    if (content[j] !== "(") return false
    let depth = 0
    for (; j < content.length; j++) {
      if (content[j] === "(") depth++
      else if (content[j] === ")") {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) return false
    j++
    while (j < content.length && RealCAnalyzer.isSourceSpace(content[j])) j++
    return content[j] === "{"
  }

  /**
   * #907/#912: the shared declaration-header test — see
   * `declarationHeaderPresent`. Kept as a method because every call site in
   * this file already has the node and the source text in hand.
   */
  private declarationHeaderBefore(id: Node, content: string): boolean {
    return declarationHeaderPresent(content, id.startIndex)
  }

  /**
   * #907: is the declarator inside the `#define` macro's own logical line? True
   * only while every line from the directive to the declarator ends with a
   * backslash continuation — the macro's body. A declarator reached after a line
   * that does NOT continue is ordinary file text the damaged tree merely reparented.
   */
  private insideMacroContinuation(macroNode: Node, id: Node, content: string): boolean {
    const startRow = macroNode.startPosition.row
    const declRow = id.startPosition.row
    if (declRow <= startRow) return true
    let lineStart = macroNode.startIndex
    for (let row = startRow; row < declRow; row++) {
      const nl = content.indexOf("\n", lineStart)
      if (nl < 0) return false
      let end = nl - 1
      if (end >= lineStart && content[end] === "\r") end--
      if (content[end] !== "\\") return false
      lineStart = nl + 1
    }
    return true
  }

  /**
   * #907: `static` belongs to the declaration, not to the ERROR that swallowed it —
   * a root-level ERROR can span thousands of lines (jv.c `ERROR[673-2185]`,
   * jv_dtoa.c `ERROR[2-4277]`), so testing the ERROR's whole text marks public
   * functions private. The storage class is looked for in the window since the
   * previous statement/brace terminator, which is where a wrapped header writes it
   * (`static double` on the line above `ulp`).
   */
  private isStaticInDeclaration(id: Node, content: string): boolean {
    const from = Math.max(0, id.startIndex - 400)
    const window = content.slice(from, id.startIndex)
    let cut = -1
    for (const ch of [";", "{", "}"]) {
      const at = window.lastIndexOf(ch)
      if (at > cut) cut = at
    }
    const blank = window.lastIndexOf("\n\n")
    if (blank > cut) cut = blank
    return RealCAnalyzer.hasStaticKeyword(window.slice(cut + 1))
  }

  /**
   * M59.A7 (#825): the 1-based line of the node that NAMES a relationship.
   * The contract (reviews/m49-callsite-line-gap.md) is "the line belongs to the
   * name, never to the construct that contains it": a call takes its callee
   * leaf, a type reference the node the name came from, an include its path.
   * Returns undefined — the honest value — when no node can derive a line; a
   * synthesised target must never be given an enclosing declaration's line.
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

  /**
   * M59.A7 (#825): a type expression's start is not the line of the names inside
   * it. A `struct_specifier` starts at its KEYWORD, and a wrapped declaration
   * puts the tag on the following line — measured on jq `jv_dtoa.c`:
   *
   *   struct        <- 512 (the specifier's start)
   *   Bigint {      <- 513 (where the name is written)
   *
   * The grammar's `name` field is the site when it exists; otherwise the node is.
   */
  private nameLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    const nameField =
      typeof (node as any).childForFieldName === "function" ? node.childForFieldName("name") : null
    return this.nodeLine(nameField ?? node)
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    const startRow =
      node && node.startPosition && typeof node.startPosition.row === "number" ? node.startPosition.row : 0
    const startCol =
      node && node.startPosition && typeof node.startPosition.column === "number" ? node.startPosition.column : 0
    const endRow =
      node && node.endPosition && typeof node.endPosition.row === "number" ? node.endPosition.row : startRow
    const endCol =
      node && node.endPosition && typeof node.endPosition.column === "number" ? node.endPosition.column : startCol
    const startIndex = node && typeof node.startIndex === "number" ? node.startIndex : 0
    const endIndex = node && typeof node.endIndex === "number" ? node.endIndex : startIndex

    return {
      startLine: startRow + 1,
      startColumn: startCol + 1,
      endLine: endRow + 1,
      endColumn: endCol + 1,
      startIndex,
      endIndex,
    }
  }
}
