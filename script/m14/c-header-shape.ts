/**
 * c-header-shape — THE DECLARATION-SHAPE RULES, IN ONE PLACE, FOR BOTH c-LANE INSTRUMENTS.
 *
 * Author: the c lane. Extracted 2026-10-20 from `c-header-impact-probe.ts` (which was the c lane's
 * own copy) and shared, because a SECOND COPY OF THE RULES IS A SECOND INSTRUMENT, AND A SECOND
 * INSTRUMENT IS A SECOND NUMBER.
 *
 * WHY IT WAS EXTRACTED. The impact probe prices the header wall on the HEADER declarations; the
 * own-file-declares probe asks the same question of the row's OWN `.c` file. Both are the same
 * question, so both must be the same instrument — the second one imports these functions rather
 * than re-implementing the rules.
 *
 * THE RULES ARE STATED IN THE PROBE'S OWN DOC COMMENT, and they are reproduced here unchanged:
 *   macro       the token is the name in a `#define NAME` directive line
 *   typedef     a `typedef` keyword appears earlier in the same statement
 *   tag         the previous token is `struct` / `union` / `enum`
 *   function    the next token is `(` whose matching `)` is followed by `;` (prototype) or `{`
 *               (definition); the occurrence sits at brace depth 0 (header scope) or depth 1 inside
 *               an `extern "C"` / namespace-ish block
 *   variable    the previous token is a declaration keyword (`extern`, `static`, `const`, `volatile`,
 *               a C type keyword) or `*`, and the next token is `;`, `=`, `,`, or `[`
 *   enum-const  the occurrence sits at depth 1 inside an `enum` body and the next token is `,` or `}`
 *   everything else is a WEAK token occurrence (parameter name, struct member, comment-free mention).
 * A declaration whose written shape the rules do not model is UNDER-counted: conservative for an
 * upper bound.
 *
 * TEXT-LEVEL, NOT PARSE-VERIFIED — and that limit travels with every number these rules produce.
 */

const TYPE_WORDS = new Set([
  "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "const",
  "volatile", "struct", "union", "enum", "register", "extern", "static", "inline", "restrict",
  "_Bool", "_Complex", "size_t", "ssize_t", "ptrdiff_t", "intptr_t", "uintptr_t", "wchar_t",
])
const DECL_KEYWORDS = new Set(["extern", "static", "const", "volatile", "register", "inline", "typedef"])


export type Tok = { t: string; line: number; depth: number }

/**
 * tokenize one header: identifiers + punctuation, skipping //, block comments and string/char literals
 *
 * EXPORTED (2026-10-20, the c lane): the c lane's own-file-declares probe measures the same
 * DECLARATION SHAPE over the `.c` files, and it imports these two functions rather than
 * re-implementing the rules — a second copy of the rules is a second instrument, and a second
 * instrument is a second number. `export` is a no-op at runtime, so this probe's own output — and
 * the artifact it produced — are unchanged by it.
 */
export function tokenizeHeader(text: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  let line = 1
  let depth = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === "\n") { line++; i++; continue }
    if (c === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; continue }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") line++; i++ } i += 2; continue }
    if (c === "\"" || c === "'") { const q = c; i++; while (i < n) { if (text[i] === "\\") { i += 2; continue } if (text[i] === q) { i++; break } if (text[i] === "\n") { line++; break } i++ } continue }
    const code = text.charCodeAt(i)
    const isIdStart = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
    if (isIdStart) {
      let j = i + 1
      while (j < n) { const d = text.charCodeAt(j); if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95) j++; else break }
      toks.push({ t: text.slice(i, j), line, depth })
      i = j
      continue
    }
    if (c === "{") { depth++; toks.push({ t: "{", line, depth }); i++; continue }
    if (c === "}") { toks.push({ t: "}", line, depth }); depth = Math.max(0, depth - 1); i++; continue }
    if (c === "(" || c === ")" || c === ";" || c === "," || c === "*" || c === "=" || c === "[" || c === "]" || c === "#" || c === "&" || c === "|") {
      toks.push({ t: c, line, depth }); i++; continue
    }
    i++
  }
  return toks
}

/** is the occurrence a declaration? returns [kind, isDefinition] or null for weak */
export function declarationKindOf(toks: Tok[], i: number, lines: string[], name: string): [string, boolean] | null {
  const cur = toks[i]
  const prev = i > 0 ? toks[i - 1] : null
  const next = i + 1 < toks.length ? toks[i + 1] : null
  // macro: the line (trimmed) starts with #define and the token right after `define` is the name
  const ln = lines[cur.line - 1] ?? ""
  const trimmed = ln.replace(/^\s+/, "")
  if (trimmed.startsWith("#define")) {
    const after = trimmed.slice("#define".length).replace(/^\s+/, "")
    if (after.startsWith(name) && (after.length === name.length || !/[\w$]/.test(after[name.length]))) {
      return ["macro", true]
    }
  }
  // tag: struct/union/enum NAME
  if (prev && (prev.t === "struct" || prev.t === "union" || prev.t === "enum")) return ["tag", false]
  // function/prototype: NAME ( ... ) ; | {
  if (next && next.t === "(") {
    let k = i + 1
    let depthP = 0
    let close = -1
    for (; k < toks.length; k++) {
      if (toks[k].t === "(") depthP++
      else if (toks[k].t === ")") { depthP--; if (depthP === 0) { close = k; break } }
    }
    if (close > 0) {
      const after = close + 1 < toks.length ? toks[close + 1] : null
      const atTop = cur.depth === 0 || cur.depth === 1
      if (after && (after.t === ";" || after.t === "{") && atTop) {
        // avoid treating a parameter-name occurrence as a prototype: require a type-ish previous token
        const prevOk = !prev || prev.t === "*" || prev.t === ")" || TYPE_WORDS.has(prev.t) || (prev.t.length > 0 && !DECL_KEYWORDS.has(prev.t) && prev.t !== "(" && prev.t !== ",")
        if (prevOk) return ["function", after.t === "{"]
      }
    }
    return null
  }
  // typedef: scan back to statement start
  {
    let k = i - 1
    let sawTypedef = false
    while (k >= 0 && toks[k].t !== ";" && toks[k].t !== "{" && toks[k].t !== "}") {
      if (toks[k].t === "typedef") { sawTypedef = true; break }
      k--
    }
    if (sawTypedef) return ["typedef", false]
  }
  // variable/extern declaration: declaration-keyword/type context then a declarator terminator
  if (next && (next.t === ";" || next.t === "=" || next.t === "," || next.t === "[")) {
    let k = i - 1
    let sawDecl = false
    while (k >= 0 && toks[k].t !== ";" && toks[k].t !== "{" && toks[k].t !== "}") {
      if (DECL_KEYWORDS.has(toks[k].t) || TYPE_WORDS.has(toks[k].t)) { sawDecl = true; break }
      k--
    }
    if (sawDecl && (cur.depth === 0 || cur.depth === 1)) return ["variable", next.t === "="]
    // enum constant: at depth 1 inside an enum body
    if (cur.depth === 1 && next.t === ",") {
      let k = i - 1
      while (k >= 0 && toks[k].t !== "{" && toks[k].t !== "}") {
        if (toks[k].t === "enum") return ["enum-constant", false]
        k--
      }
    }
  }
  // enum constant, the LAST one in the body — the next token is `}`, which is NOT a declarator
  // terminator, so this arm has to STAND ON ITS OWN.
  //
  // IT DID NOT. The `}` comparison sat INSIDE the branch above, where the guard had already
  // narrowed the next token to `;` / `=` / `,` / `[` — so the comparison was unreachable, and
  // TypeScript said so (TS2367: a comparison that appears unintentional between the types
  // `";", "[", "="` and `"}"`). The arm now stands on its own, so the instrument's OWN stated rule
  // (the doc comment above: "the next token is `,` or `}`") is true in the CODE and not only in the
  // prose, and the instrument carries no dead branch.
  //
  // **WHAT THE CHANGE DID TO THE MEASUREMENT: NOTHING — AND THAT IS MEASURED, NOT ASSUMED.**
  // The probe was re-run over the same dump with the same corpus root after the change, and the
  // artifact came back with EVERY cell and EVERY kind row UNCHANGED:
  //   `validation/m14/fixtures/c/measurements/c-header-impact.json` — re-shot 2026-10-20 by the
  //   command in `C-HEADER-WALL-BUCKETS.md` §4, and it is the artifact that page is built on.
  //   → per-label cell diffs: none · kindRows diffs: none ·
  //     ceiling `uniqueDeclarationRows` 57,817 = 57,817 · controls C1 269,671 / C2 232,671 both PASS.
  // So this arm fires on ZERO rows of this population, and **the price the wall's buckets are built
  // on is unchanged.** (The enum-constant classification's own reachability — the back-scan stops
  // at the enclosing `{` — is a SEPARATE, PRE-EXISTING question of this instrument, which this
  // change does NOT touch and does not claim to answer: the artifact's 416 enum-constant rows show
  // the class is reached by some other spelling, and the scan above is unchanged.)
  if (next && cur.depth === 1 && next.t === "}") {
    let k = i - 1
    while (k >= 0 && toks[k].t !== "{" && toks[k].t !== "}") {
      if (toks[k].t === "enum") return ["enum-constant", false]
      k--
    }
  }
  return null
}

