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
    /^[0-9][0-9A-Za-z_]*$/.test(beforeName.text) &&
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

class CScopeManager {
  private stack: ScopeEntry[] = []

  constructor() {
    this.pushScope(ScopeKind.Global, "global", null as any)
  }

  // CGD20 (M37 #601): does the current scope chain sit inside a FUNCTION
  // body? Function locals (block vars, local struct/union/enum/typedef
  // definitions) are execution artifacts (C-D1) — only file-scope
  // declarations become symbols.
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
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const scopeManager = new CScopeManager()
    const emittedUseRelationships = new Set<string>()
    const functionLocals = new Map<string, Set<string>>()
    // #383 payload: call targets per enclosing function
    const qcByFunction = new Map<string, string[]>()

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

    // Track current active function for localized metadata updates
    let activeFunctionSymbol: ASTEngine.UniversalSymbol | null = null

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
          // CGD20: function-local struct definitions are execution artifacts
          // (C-D1) — no scope, no symbol, no field registration.
          if (scopeManager.isInsideFunction()) break
          const nameNode = node.childForFieldName("name")
    let structName = "anonymous_struct"
    if (nameNode && nameNode.text.trim()) {
      structName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) structName = declNode.text.trim()
    }
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
          )
          break
        }
        case "union_specifier": {
          // CGD20: function-local unions are execution artifacts (C-D1).
          if (scopeManager.isInsideFunction()) break
          const nameNode = node.childForFieldName("name")
    let unionName = "anonymous_union"
    if (nameNode && nameNode.text.trim()) {
      unionName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) unionName = declNode.text.trim()
    }
          if (node.childForFieldName("body")) {
        scopeManager.pushScope(ScopeKind.Union, unionName, node)
        willPushScope = true
      }
          this.extractUnion(node, symbols, unions, scopeManager.getScopeName(), isConditional)
          break
        }
        case "enum_specifier":
          // CGD20: function-local enums are execution artifacts (C-D1) —
          // their members must not leak as file-scope EnumMember symbols
          // (measured: BackupSubCommandEnum/MB_enum members in sqlite).
          if (scopeManager.isInsideFunction()) break
          this.extractEnum(node, symbols, enums, scopeManager.getScopeName(), isConditional)
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
          // CGD20: function-local typedefs are execution artifacts (C-D1).
          if (scopeManager.isInsideFunction()) break
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
          }

          if (
            !suppressCall &&
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
              // malloc allocates BYTES, not a named type - an Instantiates
              // edge to the literal 'malloc' could never resolve to a type
              // symbol and was pure noise (removed; allocation tracking
              // lives in metadata + patterns).
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
        const isWrite = parent && parent.type === "assignment_expression" && lhs && lhs.startIndex === node.startIndex && lhs.endIndex >= node.endIndex
        // CGD17 (M37 #601): a field_expression in the CALLEE position is a
        // CALL, not a read — `p->xClose(p)` emitted BOTH `calls xClose`
        // (from the call_expression branch) and `uses xClose [field_access]`
        // here, doubling every member-function invocation (family contract:
        // one edge per pair). Span-match the call's `function` field.
        const isCallee = parent?.type === "call_expression" &&
          parent.childForFieldName("function")?.startIndex === node.startIndex
        const field = node.childForFieldName("field")
        const obj = node.childForFieldName("argument") || node.namedChild(0)
        if (field && field.text.trim() && !isWrite && !isCallee) {
          const sourceScope = scopeManager.getRelationshipSource()
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
          node.parent?.type !== "function_definition" &&
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
          // CGD1 (M37 #601): an assignment LHS is a WRITE, never a read —
          // plain and compound assignments both parse as
          // assignment_expression with the LHS as its first named child
          // (probe c-shapes1 P5). `g_counter += 1` / `g_counter = 5` leaked a
          // bogus `uses g_counter` (SCD1 class; C was the last unprobed
          // systems language for that sweep). Span-match the LHS exactly —
          // web-tree-sitter returns FRESH node objects per child() call, so
          // reference identity never matches (the DAD3 oracle lesson).
          !(node.parent?.type === "assignment_expression" &&
            node.parent.namedChild(0)?.startIndex === node.startIndex &&
            (node.parent.namedChild(0)?.endIndex ?? 0) >= node.endIndex) &&
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
          const relKey = `${sourceScope}::${isTypeNode ? "ref" : "use"}::${text}`
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
  ) {
    const nameNode = node.childForFieldName("name")
    let structName = "anonymous_struct"
    if (nameNode && nameNode.text.trim()) {
      structName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) structName = declNode.text.trim()
    }
    // A struct_specifier without a body is a forward/reference declaration
    // (e.g. `typedef struct Point Point;` or `struct Point *p;`). It is not a
    // definition site — skip it to avoid phantom duplicates; the definition
    // with a body emits the symbol once.
    if (!node.childForFieldName("body")) return
    const isPacked = this.isPacked(node)

    const fields: any[] = []
    const bodyList = node.childForFieldName("body")
    if (bodyList) {
      for (let i = 0; i < bodyList.namedChildCount; i++) {
        const field = bodyList.namedChild(i)
        if (field && field.type === "field_declaration") {
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
              let isPointer = this.isPointerType(rawDecl)
              let declNode: Node | null = rawDecl

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") || this.findChild(declNode, (c) => c?.type === "number_literal")
                  if (sizeNode && !isNaN(parseInt(sizeNode.text))) arraySize *= parseInt(sizeNode.text)
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              if (declNode && declNode.text.trim()) {
                fields.push({ name: declNode.text, type: typeNode ? typeNode.text : "unknown", arraySize, isPointer })
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
        memorySize: this.calculateMemorySize(fields, isPacked, structs, unions, is64Bit, isLLP64),
        alignment: this.calculateAlignment(fields, structs, unions, is64Bit, isLLP64),
      },
    })
  }

  private extractUnion(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    unions: Record<string, any[]>,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    let unionName = "anonymous_union"
    if (nameNode && nameNode.text.trim()) {
      unionName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) unionName = declNode.text.trim()
    }

    const fields: any[] = []
    const bodyList = node.childForFieldName("body")
    if (bodyList) {
      for (let i = 0; i < bodyList.namedChildCount; i++) {
        const field = bodyList.namedChild(i)
        if (field && field.type === "field_declaration") {
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
              let isPointer = this.isPointerType(rawDecl)
              let declNode: any = rawDecl

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") ||
                    this.findChild(declNode, (c: any) => c?.type === "number_literal")
                  if (sizeNode && !isNaN(parseInt(sizeNode.text))) arraySize *= parseInt(sizeNode.text)
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              if (declNode && declNode.text.trim()) {
                fields.push({ name: declNode.text, type: typeNode ? typeNode.text : "unknown", arraySize, isPointer })
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
      metadata: { isUnion: true, cSpecific: true, isConditional },
    })
  }

  private extractEnum(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    enums: Record<string, boolean>,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    let enumName = nameNode && nameNode.text.trim() ? nameNode.text : "anonymous_enum"
    // Anonymous `typedef enum { ... } Name;` — name the enum from the typedef
    // declarator so the symbol identity is the exported type name.
    if (enumName === "anonymous_enum" && node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) enumName = declNode.text.trim()
    }
    enums[enumName] = true

    const values: string[] = []
    let hasExplicitValues = false
    let isFlagEnum = false

    let listNode = node.childForFieldName("body") || this.findFirstChildOfType(node, "enumerator_list")

    if (listNode) {
      for (let i = 0; i < listNode.namedChildCount; i++) {
        const enumerator = listNode.namedChild(i)
        if (enumerator && enumerator.type === "enumerator") {
          const enumNameNode = enumerator.childForFieldName("name") || enumerator.namedChild(0)

          if (enumNameNode && enumNameNode.text.trim()) {
            values.push(enumNameNode.text)

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
              name: enumNameNode.text,
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
  private calculateMemorySize(
    fields: any[],
    isPacked: boolean,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    isUnion: boolean = false,
  ): number {
    let currentOffset = 0
    let maxAlign = 1
    let maxSize = 0
    const ptrSize = is64Bit ? 8 : 4
    const longSize = is64Bit && !isLLP64 ? 8 : 4

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const type = field.type
      let fieldSize = 4
      let align = 4

      if (field.isPointer) {
        fieldSize = ptrSize
        align = ptrSize
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
      } else if (structs[type]) {
        fieldSize = this.calculateMemorySize(structs[type], false, structs, unions, is64Bit, isLLP64, false)
        align = this.calculateAlignment(structs[type], structs, unions, is64Bit, isLLP64)
      } else if (unions[type]) {
        fieldSize = this.calculateMemorySize(unions[type], false, structs, unions, is64Bit, isLLP64, true)
        align = this.calculateAlignment(unions[type], structs, unions, is64Bit, isLLP64)
      }

      if (isPacked) align = 1
      maxAlign = Math.max(maxAlign, align)

      const totalFieldSize = fieldSize * (field.arraySize || 1)
      if (isUnion) {
        maxSize = Math.max(maxSize, totalFieldSize)
      } else {
        const padding = (align - (currentOffset % align)) % align
        currentOffset += padding + totalFieldSize
      }
    }

    if (isUnion) {
      currentOffset = maxSize
    }

    if (!isPacked && maxAlign > 1) {
      currentOffset += (maxAlign - (currentOffset % maxAlign)) % maxAlign
    }
    return currentOffset
  }

  private calculateAlignment(
    fields: any[],
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
  ): number {
    let align = 1
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      if (field.isPointer || inArray(["size_t", "ssize_t"], field.type)) align = Math.max(align, is64Bit ? 8 : 4)
      else if (field.type === "long") align = Math.max(align, is64Bit && !isLLP64 ? 8 : 4)
      else if (inArray(["double", "int64_t", "uint64_t"], field.type)) align = Math.max(align, 8)
      else if (inArray(["int", "float", "int32_t", "uint32_t"], field.type)) align = Math.max(align, 4)
      else if (inArray(["short", "int16_t", "uint16_t"], field.type)) align = Math.max(align, 2)
      else if (structs[field.type])
        align = Math.max(align, this.calculateAlignment(structs[field.type], structs, unions, is64Bit, isLLP64))
      else if (unions[field.type])
        align = Math.max(align, this.calculateAlignment(unions[field.type], structs, unions, is64Bit, isLLP64))
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
    if (next.type === "expression_statement") {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(=|\()/.exec(next.text.trim())
      if (!match) return false
      const name = match[1]
      if (name === macroId.text) return false
      const callable = match[2] === "("
      if (callable) {
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
    let line = 1
    let column = 1
    const max = Math.min(index, content.length)
    for (let i = 0; i < max; i++) {
      if (content[i] === "\n") {
        line++
        column = 1
      } else {
        column++
      }
    }
    return { line, column }
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
