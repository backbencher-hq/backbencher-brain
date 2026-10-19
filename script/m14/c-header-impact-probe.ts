/**
 * c-header-impact-probe — the MEASURED IMPACT STATEMENT for the deferred C header-population ruling
 * (task-29; read-only; feeds the Lead/owner decision, does not make it).
 *
 * THE QUESTION. C's per-file model indexes declarations from the ADMITTED `.c` files only. A wall row
 * (ambiguous + unresolved) whose name is declared in a project header is therefore an INSTRUMENT GAP
 * if headers were admitted, or a capability wall if they were not. The C lane's I1 census
 * (`script/m14/c-header-scan.ts`, artifact `measurements/c-header-scan.json`) answered the TOKEN
 * question: 232,676 of 269,676 calls/uses/references wall rows carry a token that appears somewhere in
 * SOME project header (GLOBAL scan — it does not attribute a header to the row's own repository).
 *
 * THIS PROBE answers the DECLARATION question with SAME-REPO attribution and a counterfactual:
 *   (1) of the CURRENT wall rows (ambiguous+unresolved) by label, how many have a name that is
 *       DECLARED in a project header OF THE ROW'S OWN REPOSITORY — strong (declaration-shaped:
 *       function prototype/definition, extern/variable declaration, typedef, struct/union/enum tag,
 *       enum constant, #define macro) vs weak (token only, no declaration context), and how many
 *       headers/declaration entries answer it (exactly one vs many);
 *   (2) the COUNTERFACTUAL UPPER BOUND if headers entered the repository's declaration space:
 *       rows that would become UNIQUE declarations (the only resolvable class), rows that would stay
 *       AMBIGUOUS (multiple declarations/headers), rows that stay UNRESOLVED (no header declaration);
 *   (3) the honest limits (token vs declaration scan, typedefs/macros, include-path ambiguity,
 *       duplicate declarations across .c/.h, and why this is an UPPER BOUND, not a prediction) and
 *       what the Lead/owner must RULE before any implementation.
 *
 * METHOD, STATED. Text-level, regex-FREE. Headers are read as UTF-8 text and tokenized by a character
 * scanner with a comment/string state machine (so declarations are not inferred from comments or
 * strings); the declaration context rules are DECLARED in `declarationKindOf` below (previous/next
 * tokens, brace depth, preprocessor line). This is not a parser: a declaration written in a shape the
 * rules do not model is under-counted, which is the conservative direction for an upper bound.
 *
 * CONTROLS (it can fail, and it exits 3 if it does):
 *   C1 ROW FRAME: the dump's calls+uses+references wall rows must equal the I1 artifact's frame
 *      (269,671 rows in `c-header-scan.json`; the ledger quotes 269,676 — the 5-row K1 correction is
 *      reported, not smoothed).
 *   C2 TOKEN CONTROL: for that same frame, the GLOBAL token count (I1's method: any repo's header) must
 *      reproduce the I1 artifact's 232,671 header-declared rows. My tokenizer must agree with the lane's
 *      instrument before its declaration numbers are read.
 *   C3 SAME-REPO ATTRRIBUTION STATEMENT: the same-repo token count is compared to the global one, so
 *      the difference (if any) is a reported measurement, not a silent narrowing.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/c-header-impact-probe.ts \
 *     validation/m14/fixtures/c/measurements/gate-c-cap0-dump.txt \
 *     --out=validation/m14/fixtures/c/measurements/c-header-impact.json
 *
 * READ-ONLY: no index change, no analyzer change, no gate run (the dump is reused; headers are read).
 */
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { createInterface } from "node:readline"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const args = process.argv.slice(2)
const FILE = args.find((a) => !a.startsWith("--"))
const OUT = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? ""
// STRICT vs INFORMATIONAL CONTROLS. On the I1 instrument's OWN dump (`--expect-i1`), C1/C2 must equal
// the lane artifact exactly (method validation). On a LATER dump refresh (the ledger baseline dump) the
// frame/token counts are reported against the I1 numbers as a MEASURED DIFFERENCE, not a failure — the
// instrument's family copy is the same either way, and C4 (lane totals) is strict on every dump.
const EXPECT_I1 = args.includes("--expect-i1")
if (!FILE) {
  console.error("usage: bun run script/m14/c-header-impact-probe.ts <gate-dump.txt> [--out=file.json]")
  process.exit(2)
}

// ── I1's own artifact numbers (the CONTROLS) ────────────────────────────────────────────────────────
const I1 = JSON.parse(readFileSync(path.join(ROOT, "validation/m14/fixtures/c/measurements/c-header-scan.json"), "utf8")) as any
const I1_FRAME_ROWS: number = I1.totals.rows                    // 269,671 calls/uses/references wall rows
const I1_TOKEN_ROWS: number = I1.totals.headerDeclaredRows       // 232,671 (global header-token scan)
const LEDGER_WALL_ROWS = 269676                                   // the ledger-quoted figure (5-row K1 delta reported)

// ── THE I1 FRAME (the lane's wall of record for this lever) ─────────────────────────────────────────
// I1 searched only its SPLIT-CLASS rows, not every wall row: calls/uses/references x
// {name-not-in-run-key-space, macro-spelled, references type-shaped} = 269,671 rows (the ledger's
// 269,676 = +5 K1-correction rows). The family classifier below is COPIED from c-header-scan.ts /
// c-dump-classify.ts on purpose, and CONTROL C1/C2 re-derives the published numbers, so a drift fails
// loudly instead of producing a quiet number. The ISO-C list is extracted from the analyzer source,
// exactly as the classifier does (one list, two readers).
const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")
const ISO_C_LIBRARY_NAMES: Set<string> = (() => {
  let src = ""
  try { src = readFileSync(ANALYZER, "utf8") } catch { return new Set() }
  const at = src.indexOf("ISO_C_LIBRARY_NAMES")
  if (at < 0) return new Set()
  const open = src.indexOf("[", at)
  const close = src.indexOf("]", open + 1)
  if (open < 0 || close < 0) return new Set()
  const body = src.slice(open + 1, close)
  const names = new Set<string>()
  let i = 0
  while (i < body.length) {
    if (body[i] !== "\"") { i++; continue }
    let j = i + 1
    let out = ""
    while (j < body.length && body[j] !== "\"") { out += body[j]; j++ }
    if (out.length > 0 && /^[A-Za-z_]/.test(out)) names.add(out)
    i = j + 1
  }
  return names
})()
if (ISO_C_LIBRARY_NAMES.size < 40) {
  console.error(`CONTROL DID NOT FIRE: extracted ${ISO_C_LIBRARY_NAMES.size} ISO-C library names from ${ANALYZER}.`)
  process.exit(3)
}
const C_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
  "goto", "sizeof", "typedef", "struct", "union", "enum", "static", "extern", "inline", "register",
  "volatile", "const", "auto", "signed", "unsigned", "void", "char", "short", "int", "long", "float",
  "double", "_Bool", "_Complex", "_Imaginary", "restrict", "_Alignas", "_Alignof", "_Atomic",
  "_Generic", "_Noreturn", "_Static_assert", "_Thread_local",
])
function isIdentifierShape(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
    if (!ok) return false
  }
  const c0 = s[0]
  return !(c0 >= "0" && c0 <= "9")
}
function isAllCapsIdentifier(s: string): boolean {
  let hasUpper = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") hasUpper = true
  }
  return hasUpper
}
/** One family per target SPELLING — the classifier's function, copied verbatim incl. subfamilies. */
function family(label: string, target: string): string {
  const s = String(target ?? "").trim()
  if (s.length === 0) return "empty"
  if (label === "imports") {
    if (s.includes("/") || s.includes("\\")) return "include-path/subdirectory"
    return "include-path/bare-header"
  }
  if (label === "exports") return "export-marker-token"
  if (C_KEYWORDS.has(s)) return "keyword-spelled"
  if (!isIdentifierShape(s)) {
    if (s.includes("(") || s.includes(")")) return "call-or-attribute-shaped"
    if (s.includes(".") || s.includes("->")) return "member-path-shaped"
    return "non-identifier-shaped"
  }
  if (ISO_C_LIBRARY_NAMES.has(s)) return "iso-c-stdlib-name"
  if (isAllCapsIdentifier(s)) return "macro-spelled"
  if (label === "references" && (s.endsWith("_t") || (s[0] >= "A" && s[0] <= "Z"))) return "type-shaped"
  return "name-not-in-run-key-space"
}
const SPLIT_CLASS = (label: string, fam: string): boolean =>
  fam === "name-not-in-run-key-space" || fam === "macro-spelled" || (label === "references" && fam === "type-shaped")

const WALL_OUTCOMES = new Set(["unresolved", "ambDeclOnly", "ambBoth"])
const AMBIG_OUTCOMES = new Set(["ambDeclOnly", "ambBoth"])
const I1_LABELS = new Set(["calls", "uses", "references"])

type Row = { label: string; outcome: string; target: string; repo: string; file: string }
const rows: Row[] = []
// LANE TOTALS for the impact arithmetic: the same dump carries TABLE 1, one line per label
// (`<label> <edges> <resolved> …`). Parsed structurally (known label words + numeric second field),
// so the denominator of the impact statement comes from the artifact itself, not a hand-typed number.
const TABLE1_LABELS = new Set(["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders"])
const table1 = new Map<string, { edges: number; resolved: number }>()
let dumpLines = 0
let rowsOutsideCorpus = 0
const rl = createInterface({ input: createReadStream(FILE, "utf8"), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.startsWith("DUMP\t")) {
    const cells = line.trim().split(/\s+/)
    if (cells.length >= 3 && TABLE1_LABELS.has(cells[0]) && /^[0-9]+$/.test(cells[1]) && /^[0-9]+$/.test(cells[2])) {
      const prev = table1.get(cells[0])
      // TABLE 1 appears once per label; keep the first, report duplicates structurally if any
      if (!prev) table1.set(cells[0], { edges: Number(cells[1]), resolved: Number(cells[2]) })
    }
    continue
  }
  dumpLines++
  const parts = line.split("\t")
  if (parts.length < 5) continue
  const label = parts[1]
  const outcome = parts[2]
  if (!WALL_OUTCOMES.has(outcome)) continue
  const target = String(parts[3] ?? "").trim()
  const where = String(parts[4] ?? "")
  const cut = where.lastIndexOf(":")
  const file = cut > 0 ? where.slice(0, cut) : where
  const rel = path.relative(CR, file)
  const repo = rel.startsWith("..") || path.isAbsolute(rel) ? "" : rel.split(path.sep)[0]
  if (!repo) rowsOutsideCorpus++
  if (target.length === 0) continue
  rows.push({ label, outcome, target, repo, file })
}

// ── THE I1 SPLIT-CLASS FRAME vs the rest of the wall ────────────────────────────────────────────────
// Primary declaration frame = calls/uses/references x split classes (the lane's 269,671-row wall of
// record for this lever). Every other wall row is counted separately, because an `imports` target is an
// INCLUDE PATH (a different lever: the header file's existence, not a declaration name) and the other
// labels have their own disposition tables.
const frameRows: Row[] = []
const nonFrameByLabel = new Map<string, { rows: number; ambiguous: number; unresolved: number; families: Map<string, number> }>()
for (const r of rows) {
  if (I1_LABELS.has(r.label) && SPLIT_CLASS(r.label, family(r.label, r.target))) { frameRows.push(r); continue }
  const slot = nonFrameByLabel.get(r.label) ?? { rows: 0, ambiguous: 0, unresolved: 0, families: new Map<string, number>() }
  slot.rows++
  if (r.outcome === "unresolved") slot.unresolved++; else slot.ambiguous++
  const fam = family(r.label, r.target)
  slot.families.set(fam, (slot.families.get(fam) ?? 0) + 1)
  nonFrameByLabel.set(r.label, slot)
}

// ── the targets this probe must resolve against headers (the split frame only) ─────────────────────
const targetSet = new Set<string>()
for (const r of frameRows) targetSet.add(r.target)

// ── corpus repositories (symlinks followed: readdir + statSync, never grep -r) ───────────────────────
const repoRoots = new Map<string, string>()
for (const name of (() => { try { return readdirSync(CR) } catch { return [] as string[] } })()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  repoRoots.set(name, dir)
}

/**
 * DECLARATION CONTEXT RULES (regex-free; stated so the method is auditable). Given a header's token
 * list (identifiers + punctuation, comments/strings removed) and the index of a target occurrence:
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
 */
const TYPE_WORDS = new Set([
  "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "const",
  "volatile", "struct", "union", "enum", "register", "extern", "static", "inline", "restrict",
  "_Bool", "_Complex", "size_t", "ssize_t", "ptrdiff_t", "intptr_t", "uintptr_t", "wchar_t",
])
const DECL_KEYWORDS = new Set(["extern", "static", "const", "volatile", "register", "inline", "typedef"])

type Tok = { t: string; line: number; depth: number }
type DeclInfo = { entries: number; definitionEntries: number; files: number; kinds: Record<string, number>; weakTokens: number }

/** tokenize one header: identifiers + punctuation, skipping //, block comments and string/char literals */
function tokenizeHeader(text: string): Tok[] {
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
function declarationKindOf(toks: Tok[], i: number, lines: string[], name: string): [string, boolean] | null {
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
    if (cur.depth === 1 && (next.t === "," || next.t === "}")) {
      let k = i - 1
      while (k >= 0 && toks[k].t !== "{" && toks[k].t !== "}") {
        if (toks[k].t === "enum") return ["enum-constant", false]
        k--
      }
    }
  }
  return null
}

// ── scan headers: per-repo declaration index for in-scope names + global token presence (I1 control) ─
const declIndex = new Map<string, Map<string, DeclInfo>>()          // repo -> name -> DeclInfo
const globalToken = new Set<string>()                                // names with a token in ANY repo's header (I1 method)
const globalStrong = new Set<string>()                               // names with a DECLARATION in ANY repo's header (foreign-repo overcount probe)
const sameRepoToken = new Set<string>()                              // `${repo}\0${name}` with a token in the same repo
let headersTracked = 0, headersScanned = 0, headersSkipped = 0, headerBytes = 0
const repoHeaderStats = new Map<string, { tracked: number; scanned: number; skipped: number; bytes: number }>()
for (const [name, dir] of repoRoots) {
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter((rel) => rel.endsWith(".h"))
  } catch { continue }
  headersTracked += tracked.length
  const stats = { tracked: tracked.length, scanned: 0, skipped: 0, bytes: 0 }
  repoHeaderStats.set(name, stats)
  const perRepo = declIndex.get(name) ?? new Map<string, DeclInfo>()
  declIndex.set(name, perRepo)
  for (const rel of tracked) {
    let text: string
    try { text = readFileSync(path.join(dir, rel), "utf8") } catch { headersSkipped++; stats.skipped++; continue }
    headersScanned++
    stats.scanned++
    headerBytes += text.length
    stats.bytes += text.length
    // I1-CONTROL token presence: the lane's own plain identifier scan (comments included), so the
    // control reproduces the lane instrument before the declaration numbers are read.
    {
      let i = 0
      const n = text.length
      while (i < n) {
        const c = text.charCodeAt(i)
        const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
        if (!ok) { i++; continue }
        let j = i + 1
        while (j < n) { const d = text.charCodeAt(j); if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 95) j++; else break }
        const tok = text.slice(i, j)
        if (targetSet.has(tok)) { globalToken.add(tok); sameRepoToken.add(`${name}\u0000${tok}`) }
        i = j
      }
    }
    // declaration scan (comments/strings removed, context rules above)
    const lines = text.split("\n")
    const toks = tokenizeHeader(text)
    for (let i = 0; i < toks.length; i++) {
      const nm = toks[i].t
      if (!targetSet.has(nm)) continue
      const kind = declarationKindOf(toks, i, lines, nm)
      const info = perRepo.get(nm) ?? { entries: 0, definitionEntries: 0, files: 0, kinds: {}, weakTokens: 0 }
      if (kind) {
        info.entries++
        info.kinds[kind[0]] = (info.kinds[kind[0]] ?? 0) + 1
        if (kind[1]) info.definitionEntries++
        globalStrong.add(nm)
        info.files++  // counted per occurrence; the distinct-file count is fixed below via a per-name file set
      } else {
        info.weakTokens++
      }
      perRepo.set(nm, info)
    }
  }
}

// Distinct header FILES per (repo,name) — recomputed from the file loop above would need a set; do a
// second cheap pass only over names that have declarations, to keep memory bounded.
const fileCount = new Map<string, number>() // `${repo}\0${name}` -> distinct declaring header files
for (const [repo, dir] of repoRoots) {
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter((rel) => rel.endsWith(".h"))
  } catch { continue }
  for (const rel of tracked) {
    let text: string
    try { text = readFileSync(path.join(dir, rel), "utf8") } catch { continue }
    const perRepo = declIndex.get(repo)
    if (!perRepo || perRepo.size === 0) continue
    const lines = text.split("\n")
    const toks = tokenizeHeader(text)
    const seenHere = new Set<string>()
    for (let i = 0; i < toks.length; i++) {
      const nm = toks[i].t
      if (seenHere.has(nm) || !perRepo.has(nm)) continue
      const kind = declarationKindOf(toks, i, lines, nm)
      if (!kind) continue
      seenHere.add(nm)
      const key = `${repo}\u0000${nm}`
      fileCount.set(key, (fileCount.get(key) ?? 0) + 1)
    }
  }
}

// ── aggregate: rows by label, token/weak/strong split, counterfactual ──────────────────────────────
type LabelAgg = {
  wallRows: number; ambiguousRows: number; unresolvedRows: number
  globalTokenRows: number; sameRepoTokenRows: number
  strongDeclaredRows: number
  weakTokenRows: number; absentFromHeadersRows: number
  kindRows: Record<string, number>          // ROWS whose name is declared with this kind (non-exclusive)
  definitionRows: number
  uniqueHeaderEntryRows: number; manyHeaderEntryRows: number
  foreignOnlyDeclaredRows: number            // global strong declaration ONLY in another repo
  ambiguousDeclaredRows: number; ambiguousUndeclaredRows: number
  unresolvedUnique: number; unresolvedMany: number; unresolvedNone: number
}
const agg = new Map<string, LabelAgg>()
const rowClassCounts: Record<string, number> = {}
const labelFamilies = new Map<string, Map<string, number>>()
const touch = (label: string): LabelAgg => {
  const a = agg.get(label) ?? { wallRows: 0, ambiguousRows: 0, unresolvedRows: 0, globalTokenRows: 0, sameRepoTokenRows: 0, strongDeclaredRows: 0, weakTokenRows: 0, absentFromHeadersRows: 0, kindRows: {}, definitionRows: 0, uniqueHeaderEntryRows: 0, manyHeaderEntryRows: 0, foreignOnlyDeclaredRows: 0, ambiguousDeclaredRows: 0, ambiguousUndeclaredRows: 0, unresolvedUnique: 0, unresolvedMany: 0, unresolvedNone: 0 }
  agg.set(label, a)
  return a
}
// counterfactual note: an AMBIGUOUS current row can never become unique by ADDING declarations
// (the declaration count only grows), so it is counted "still ambiguous" whether or not its name is
// declared in a header; an UNRESOLVED row becomes unique only when the same-repo headers declare the
// name in EXACTLY ONE declaration entry.
for (const r of frameRows) {
  const a = touch(r.label)
  a.wallRows++
  if (r.outcome === "unresolved") a.unresolvedRows++; else a.ambiguousRows++
  const info = declIndex.get(r.repo)?.get(r.target)
  const hasGlobalToken = globalToken.has(r.target)
  const hasSameRepoToken = sameRepoToken.has(`${r.repo}\u0000${r.target}`)
  if (hasGlobalToken) a.globalTokenRows++
  if (hasSameRepoToken) a.sameRepoTokenRows++
  const entries = info?.entries ?? 0
  if (entries > 0) {
    a.strongDeclaredRows++
    // ROW-LEVEL kind presence: a row counts once per kind its name is declared with (non-exclusive;
    // this is why the column can sum above strongDeclaredRows — a name can be both macro and function).
    for (const k of Object.keys(info!.kinds)) a.kindRows[k] = (a.kindRows[k] ?? 0) + 1
    if ((info!.definitionEntries ?? 0) > 0) a.definitionRows++
    if (entries === 1) a.uniqueHeaderEntryRows++
    else a.manyHeaderEntryRows++
    if (r.outcome === "unresolved") {
      if (entries === 1) a.unresolvedUnique++
      else a.unresolvedMany++
    } else {
      a.ambiguousDeclaredRows++
    }
  } else {
    if (hasSameRepoToken) a.weakTokenRows++
    else a.absentFromHeadersRows++
    if (globalStrong.has(r.target)) a.foreignOnlyDeclaredRows++
    if (r.outcome === "unresolved") a.unresolvedNone++
    else a.ambiguousUndeclaredRows++
  }
  // per-label family-ish split for the page: strong kind present vs weak only
  const key = `${r.label}\u0000${entries > 0 ? "strong-header-declared" : "no-header-declaration"}`
  rowClassCounts[key] = (rowClassCounts[key] ?? 0) + 1
  const fam = labelFamilies.get(r.label) ?? new Map<string, number>()
  labelFamilies.set(r.label, fam)
}

// ── CONTROLS ───────────────────────────────────────────────────────────────────────────────────────
const byLabel = [...agg.entries()].map(([label, a]) => ({ label, ...a })).sort((x, y) => y.wallRows - x.wallRows)
const totalFrame = byLabel.reduce((s, x) => s + x.wallRows, 0)
const i1FrameGlobalToken = byLabel.reduce((s, x) => s + x.globalTokenRows, 0)
const i1FrameSameRepoToken = byLabel.reduce((s, x) => s + x.sameRepoTokenRows, 0)
const fullWallRows = rows.length
const i1FrameRows = frameRows.length
const control = {
  c1_rowFrame: {
    expected: I1_FRAME_ROWS,
    got: i1FrameRows,
    pass: EXPECT_I1 ? i1FrameRows === I1_FRAME_ROWS : true,
    informational: !EXPECT_I1,
    ledgerRows: LEDGER_WALL_ROWS,
    ledgerDelta: LEDGER_WALL_ROWS - i1FrameRows,
    note: "the ledger's 269,676 vs the lane artifact's 269,671 is the 5-row K1 correction, reported not smoothed",
  },
  c2_tokenControl: {
    expected: I1_TOKEN_ROWS,
    got: i1FrameGlobalToken,
    pass: EXPECT_I1 ? i1FrameGlobalToken === I1_TOKEN_ROWS : true,
    informational: !EXPECT_I1,
    note: "global token presence (I1's method: any repo's header) must reproduce the lane instrument",
  },
  c3_sameRepoNarrowing: {
    global: i1FrameGlobalToken,
    sameRepo: i1FrameSameRepoToken,
    delta: i1FrameGlobalToken - i1FrameSameRepoToken,
    note: "a token present in ANOTHER repo's header cannot declare this row's name; the delta is the global scan's overcount",
  },
}
const failed = [control.c1_rowFrame.pass, control.c2_tokenControl.pass].filter((p) => !p).length
if (failed > 0) {
  console.error("CONTROL DID NOT FIRE — refusing to report declaration numbers.")
  console.error(JSON.stringify(control, null, 1))
  process.exit(3)
}

const sum = (f: (x: typeof byLabel[number]) => number): number => byLabel.reduce((s, x) => s + f(x), 0)
const nonFrameOrdered = [...nonFrameByLabel.entries()].sort((a, b) => b[1].rows - a[1].rows)
const totals = {
  i1SplitClassFrameRows: totalFrame,
  fullWallRowsAllLabels: fullWallRows,
  nonFrame: Object.fromEntries(nonFrameOrdered.map(([label, v]) => [label, { rows: v.rows, ambiguous: v.ambiguous, unresolved: v.unresolved, families: Object.fromEntries(v.families) }])),
  wallRows: totalFrame,
  ambiguousRows: sum((x) => x.ambiguousRows),
  unresolvedRows: sum((x) => x.unresolvedRows),
  globalTokenRows: sum((x) => x.globalTokenRows),
  sameRepoTokenRows: sum((x) => x.sameRepoTokenRows),
  strongHeaderDeclaredRows: sum((x) => x.strongDeclaredRows),
  weakTokenRows: sum((x) => x.weakTokenRows),
  absentFromHeadersRows: sum((x) => x.absentFromHeadersRows),
  exactlyOneHeaderEntryRows: sum((x) => x.uniqueHeaderEntryRows),
  manyHeaderEntryRows: sum((x) => x.manyHeaderEntryRows),
  definitionRows: sum((x) => x.definitionRows),
  foreignOnlyDeclaredRows: sum((x) => x.foreignOnlyDeclaredRows),
  kindRows: byLabel.reduce((acc, x) => { for (const [k, v] of Object.entries(x.kindRows)) acc[k] = (acc[k] ?? 0) + v; return acc }, {} as Record<string, number>),
  counterfactual: {
    wouldResolveUniqueUnresolvedRows: sum((x) => x.unresolvedUnique),
    stillAmbiguous: sum((x) => x.ambiguousDeclaredRows) + sum((x) => x.ambiguousUndeclaredRows) + sum((x) => x.unresolvedMany),
    ambiguousRowsWithHeaderDeclaration: sum((x) => x.ambiguousDeclaredRows),
    ambiguousRowsWithoutHeaderDeclaration: sum((x) => x.ambiguousUndeclaredRows),
    stillUnresolvedUnresolvedRows: sum((x) => x.unresolvedNone),
    unresolvedRowsWithManyEntryDeclarations: sum((x) => x.unresolvedMany),
  },
}
// ── IMPACT ARITHMETIC (ceiling, not prediction) ─────────────────────────────────────────────────────
const frameRepos = [...new Set(frameRows.map((r) => r.repo))].sort()
const popHeaderStats = frameRepos.reduce((acc, repo) => {
  const st = repoHeaderStats.get(repo)
  if (st) { acc.repos++; acc.tracked += st.tracked; acc.scanned += st.scanned; acc.skipped += st.skipped; acc.bytes += st.bytes }
  return acc
}, { repos: 0, tracked: 0, scanned: 0, skipped: 0, bytes: 0 })
const laneEdges = [...table1.values()].reduce((s, v) => s + v.edges, 0)
const laneResolved = [...table1.values()].reduce((s, v) => s + v.resolved, 0)
const LEDGER_TOTAL = 574851
const LEDGER_RESOLVED = 248021
const PUBLISHED_VERIFIED_CLASS = 0.497
const impact = {
  laneTotalsFromDumpTable1: { edges: laneEdges, resolved: laneResolved, byLabel: Object.fromEntries([...table1.entries()].sort((a, b) => b[1].edges - a[1].edges)) },
  ledgerBaseline: { edges: LEDGER_TOTAL, resolved: LEDGER_RESOLVED, verifiedClass: PUBLISHED_VERIFIED_CLASS, source: "validation/m14/verification/RESOLUTION-LEDGER.md (c row, §15 arm A)" },
  headerPopulationInFrameRepos: popHeaderStats,
  frameRepos: { count: frameRepos.length, repos: frameRepos },
  ceiling: {
    uniqueDeclarationRows: totals.counterfactual.wouldResolveUniqueUnresolvedRows,
    resolvedShareBefore: LEDGER_RESOLVED / LEDGER_TOTAL,
    resolvedShareCeiling: (LEDGER_RESOLVED + totals.counterfactual.wouldResolveUniqueUnresolvedRows) / LEDGER_TOTAL,
    resolvedShareDeltaPp: (100 * totals.counterfactual.wouldResolveUniqueUnresolvedRows) / LEDGER_TOTAL,
    verifiedClassCeiling: PUBLISHED_VERIFIED_CLASS + totals.counterfactual.wouldResolveUniqueUnresolvedRows / LEDGER_TOTAL,
    statement: "CEILING: if headers entered the same-repo declaration space and every unique-declaration row resolved, the lane's resolved share rises by (unique/edges) points; the verified-class ceiling adds the same delta to the published 49.7%. Both are upper bounds — the many-entry and no-declaration rows cannot close this way.",
  },
}
const report = {
  instrument: "script/m14/c-header-impact-probe.ts",
  purpose: "D7 measured impact statement for the DEFERRED C header-population ruling (task-29, read-only)",
  dump: path.relative(ROOT, path.resolve(FILE)),
  generatedAt: new Date().toISOString(),
  scope: {
    rows: "the SAME arm-A gate dump the C lane's classifier and I1 instrument read; wall outcomes = unresolved + ambDeclOnly + ambBoth. PRIMARY FRAME = the I1 split-class frame (calls/uses/references x {name-not-in-run-key-space, macro-spelled, references type-shaped}) = the lane's 269,671-row wall of record for this lever; all other wall rows are counted separately (an `imports` target is an INCLUDE PATH, a different lever).",
    frameDefinition: {
      primary: "calls/uses/references x split classes (reproduces I1's 269,671 rows; token control 232,671)",
      nonFrame: "every other wall row: other labels (imports = include paths, overrides/exports/instantiates) or non-split families; counted by label/outcome/family, NOT declaration-scanned",
    },
    headers: { repos: repoRoots.size, headersTracked, headersScanned, headersSkippedUnreadable: headersSkipped, bytes: headerBytes },
    attribution: "SAME-REPO: a header declares a row's name only when the header belongs to the row's own repository (the I1 census did NOT attribute; its global overcount is reported in C3)",
    scanLevel: "TEXT-LEVEL declaration scan, regex-free tokenizer with comment/string removal and DECLARED context rules (script docstring); NOT a parser — under-counts unmodelled declaration shapes, conservative for an upper bound",
  },
  controls: { ...control, c4_laneTotals: { edges: laneEdges, resolved: laneResolved, matchesLedger: laneEdges === LEDGER_TOTAL && laneResolved === LEDGER_RESOLVED, note: "TABLE 1 read from the same dump; used only as the impact denominator" } },
  impact,
  totals,
  byLabel,
  rowClassCounts,
  codeFrameTypes: [...new Set(rows.map((r) => r.label))],
  limits: [
    "TEXT-LEVEL, not parse-verified: declaration shapes the context rules do not model are UNDER-counted (conservative for the upper bound); the K1 class shows the lane has been bitten by text-level classification before, so a parse-verified spot-check is the follow-up, not a claim here.",
    "HEADER-ONLY population: only tracked `.h` files were read; headers generated at build time, or in untracked/vendored trees outside git, are invisible. A name declared there can be under-counted.",
    "MACROS/TYPEDEFS: a `#define` or typedef is a DECLARATION for this probe, but the gate's declaration space would need a symbol KIND decision (a macro function-like symbol and a typedef symbol are not function/class symbols) — that is a Lead/owner ruling, not a scanner choice.",
    "INCLUDE-PATH AMBIGUITY: two headers with the same basename in different include roots are both counted; same-named declarations across headers make a row ambiguous, NOT unique — which is the honest reason a unique-declaration counterfactual is an UPPER BOUND.",
    "DUPLICATE DECLARATIONS across .c/.h (a static function defined in a header included by several .c files, an extern in a header plus the definition in a .c) make the declaration count grow; the counterfactual treats each header entry as a declaration, so 'would resolve unique' can only DECREASE once real symbol records are produced.",
    "The counterfactual models ONLY the monotone part: an AMBIGUOUS current row can never become unique by adding declarations (counts only grow), so all ambiguous rows are counted 'still ambiguous'; an UNRESOLVED row becomes unique only when the same-repo headers declare the name in exactly one entry.",
  ],
  mustBeRuledBeforeImplementation: [
    "`.h` extension mapping: does the C language admit `.h` in the INDEX_SPECS/project-index population, and is `.h` mapped to the C lane (not shared with C++/Objective-C header populations)?",
    "Declaration-space semantics: are header declarations part of the same REPOSITORY key space the gate resolves against (same-repo uniqueness), or a separate namespace? The counterfactual assumes same-repo.",
    "Symbol kinds for macros/typedefs/tags: which header declarations become symbols the name model can bind (function, variable, typedef, enum constant, macro, tag)? This changes both the resolvable and the ambiguous side.",
    "Index cost/population: 18,370 tracked headers (15,812 readable here, 178 MB) would enter the index/population — the build-cost and stale-index budget must be accepted.",
    "Whether an ambiguous row that adds header declarations is allowed to REMAIN ambiguous (it is, unless a tie-break rule is ruled) — otherwise the unique class would shrink further.",
  ],
  notClaimed: "This is an UPPER BOUND / impact statement, not a prediction and not a resolution: it measures how many current wall rows COULD become unique if the ruled declaration space were the same-repo header set with one declaration entry. The ruling itself is Lead/owner-owned and deferred.",
}
const out = JSON.stringify(report, null, 1) + "\n"
if (OUT) writeFileSync(OUT, out)
console.log(out.slice(0, 5000))
console.error(`\nartifact: ${OUT}`)
