import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * PowerShell analyzer.
 *
 * Contract notes that are not obvious from the code. Each is a ruling, and each
 * names the measurement that forced it. The lane was the largest ungated
 * analyzer in the tree when this contract was written: an M12 corpus claim, a
 * regex-census row, an F1 grammar PASS — and no fixture, no mutant, no
 * differential oracle, no completeness spec, no review folder. F1 is the one
 * gate that was green, and it asks the one question that cannot fail here: the
 * analyzer names 18 node types and all 18 exist in the grammar, while the 134
 * it did not name were never F1's question.
 *
 * Measured on the production half of two real corpora (50 files of
 * powershell@91ce9844 and 24 of ansible@7ec731b, through the production
 * `parseFile`), the pre-wave lane produced 2,145 symbols and 3,410
 * relationships carrying FOUR relationship kinds, `uses`/`overrides`/`exports`
 * at ZERO, and `line_number` on 0 of 3,410.
 *
 *  - PS1  THE FILE IS THE MODULE. The pre-wave analyzer spelled its file-scope
 *    edge source as the literal string `global` (`relSource() || "global"`),
 *    which wrote `source_external = "global"` onto every top-level relationship
 *    in the language. `isIndexArtifactName` (src/ast/analysis-exclusions.ts:129)
 *    rejects `global` as a symbol name, so not one of those edges could ever
 *    resolve to a stored symbol: measured at the store, 4 of 7 relationships on
 *    a two-file project had `source_symbol_id = NULL`, and `bb_graph` on a
 *    method that IS called returned `callers: []`. The store's own seam fix for
 *    this class (parallel-indexer.ts, M60/#910) substitutes the importing FILE
 *    only when the analyzer sets `metadata.fileLevel`, and only c and php do.
 *    PowerShell is STRONGER than bash here — a `.psm1` IS a module and a `.psd1`
 *    IS its manifest — so bash's BD2 ruling ("the file is the unit of bash, so
 *    the file is a real owner ... a `module` symbol named after its own
 *    basename") is adopted verbatim, with the extension KEPT: `Build.psm1` and
 *    `Build.ps1` are different files.
 *
 *  - PS2  EVERY RELATIONSHIP CARRIES A LINE, AND THE LINE IS PART OF THE EDGE'S
 *    IDENTITY. The pre-wave lane emitted no `line_number` at all, and the graph
 *    surface rendered `"callSite": {"file": "Deploy.ps1", "line": null}` as if
 *    it knew a position (M59 #825's per-language handoff, open for this lane;
 *    M62's rule is that no surface shows a position it does not know). The line
 *    is the line of the node that BEARS THE EDGE'S NAME, not the enclosing
 *    declaration's start line (M60 #921), and it is in the dedupe key so two
 *    call sites of one callee are two rows — the store resolves a containment
 *    edge BY the line it carries, and a per-set key swallows every site but the
 *    first.
 *
 *  - PS3  A METHOD IS A SCOPE. The pre-wave lane pushed an owner only for
 *    `function_statement` / `class_statement` / `enum_statement`, so every call
 *    written inside a class method was attributed to the CLASS. Measured at the
 *    surface: `bb_graph Start` on a method that IS called returned
 *    `callers: []` and `callees: []` — a dead end in both directions, reported
 *    with `evidenceClass: "inferred"` and no disclosure. M59 #879 ("a nested
 *    site's answer was uninterpretable; the store now gives it the enclosing
 *    method") and the web family's #814 ruling both point the same way: the
 *    enclosing METHOD, because it composes with the call graph. A class's
 *    incoming edges are its own, not every method's. So this lane keeps TWO
 *    names per frame: `owner` (the nearest declaration container, which a
 *    `contains` edge names) and `scope` (the nearest scope, which a `calls` or
 *    `uses` edge is sourced from). They differ exactly inside a class.
 *
 *  - PS4  A CONSTRUCTOR IS NAMED `constructor`. PowerShell writes a constructor
 *    with the class's own name, so the pre-wave lane's guard ("a constructor
 *    never contains itself") suppressed the containment edge — and the store
 *    then refused the owner too, because its M51.A1 self-ownership guard
 *    compares `parentSymbol.name !== symbol.name`. Measured: every PowerShell
 *    class constructor stored with `owner_symbol_id = NULL` while the property
 *    and method beside it were linked. csharp already settled this: a member
 *    whose SYMBOL NAME the source never writes takes the synthesised name and NO
 *    line, and `contains Class -> constructor` carries it. PowerShell writes
 *    `Deployment(...)`, never `constructor`, so the name is synthesised and the
 *    line is the declaration's — the same state csharp's `callsite-lines-825`
 *    fixture pins with `line_number: null`.
 *
 *  - PS5  A RESERVED WORD IS NOT A CALL. The pre-wave `FLOW_KEYWORDS` omitted
 *    PowerShell's named blocks, and the grammar models `Begin`/`Process`/`End`
 *    as `command` nodes (reproduced: `hasError=false`, `command nodes:
 *    ["End","Process","Begin"]`), so every advanced function or script emitted
 *    three fabricated `calls` edges naming its own block keywords — 6 fabricated
 *    edges in the production draw, hand-confirmed at
 *    `dsc/pwsh.profile.resource.ps1:15-16`. Worse, an `if` written as an
 *    EXPRESSION — `$x = if (…) { } elseif (…) { }` — parses with
 *    `hasError = false` and still leaves `elseif`/`else` as bare commands, which
 *    no `hasError`-keyed gate in this repo can see. Both are refused at the emit
 *    site, and `script/m60/powershell-keyword-census.ts` measures the residue on
 *    the real corpora so a new one cannot land silently.
 *
 *  - PS6  NOTHING IS EMITTED FROM A RECOVERY REGION. bash BD5, extended: a
 *    `command` whose name lives inside an ERROR/MISSING node is recovery noise.
 *
 *  - PS7  A SWITCH ARGUMENT IS NOT A MODULE. The pre-wave import reader took the
 *    token after ANY `command_parameter` as the module's name, so
 *    `Import-Module Az.Accounts -ErrorAction Stop` stored TWO external module
 *    imports — `Az.Accounts` and `Stop`, an `-ErrorAction` VALUE. The rule is
 *    now structural (the grammar's own `argument` field, or a following token
 *    that is not a switch-argument value) plus a module-path SHAPE test, not a
 *    name list.
 *
 *  - PS8  AUTOMATIC VARIABLES ONLY. The pre-wave suppression set contained
 *    `foreach` and `switch` — those are LANGUAGE KEYWORDS, not automatic
 *    variables, and `$switch = 1` is a legal declaration. Reproduced: 6 of 9
 *    top-level assignments in a probe file were silently dropped. The ledger's
 *    standing fixture-authoring rule exists for exactly this class ("every
 *    language's fixtures MUST include identifiers that collide with
 *    stdlib/builtin words, because suppression filters are invisible to
 *    output-diff tests otherwise"), and this lane had no fixtures, so nothing
 *    pinned it.
 *
 *  - PS9  A MEMBER READ IS A `uses` EDGE. The pre-wave lane had a
 *    `case "member_access"` whose entire body was `break`, commented "Property
 *    reads ($obj.Prop) are not declarations or calls — no edge". So the language
 *    emitted ZERO `uses` edges in 2,145 symbols and 3,410 relationships, while
 *    the 105 grammar types it never named include `member_access` (20,188
 *    occurrences), `element_access`, `type_name` and `sub_expression`. This is
 *    the #740 kotlin defect class ("emits no member uses at all") in a second
 *    language, with no issue filed, because no corpus lane existed to see it.
 *
 *  - PS10 AN INLINE PARAMETER LIST IS A PARAMETER LIST. The pre-wave reader
 *    accepted only `script_parameter` and `class_method_parameter`, so
 *    `function G($x, $y) { … }` — the most idiomatic PowerShell function form —
 *    published ZERO parameters. The grammar declares the shape
 *    (`function_parameter_declaration`) and the production draw holds 0
 *    occurrences of it, so this is a shape-probe fix and is described as such in
 *    the fixture, not as a corpus MISSING.
 *
 * Complexity envelope (M60 R6): one iterative DFS over the tree, a frame stack
 * whose depth is the nesting depth, O(1) Map-backed symbol dedupe keyed by
 * `scope:name:kind`, Set-backed per-site relationship dedupe, and descendant
 * searches that stop at the first hit. No per-symbol O(n) scan, no O(n²) pass.
 * Measured on the pinned corpus: `validation/m12/results/powershell-corpus-
 * complexity.json`, and per-ms in `validation/m60/results/powershell-perf.json`.
 */

// ---------------------------------------------------------------------------
// PS8 — the AUTOMATIC variables: names the engine supplies, which are therefore
// never project declarations. The pre-wave set also carried `foreach` and
// `switch`, which are keywords.
//
// LOOKUPS ARE LOWERCASED, and that is a MEASURED requirement rather than a
// style choice. PowerShell variable names are case-insensitive, so `$null`,
// `$Null` and `$NULL` are the same automatic variable — and the pre-wave
// case-sensitive comparison published the lower-case spellings as project
// declarations (measured: `exec_wrapper.ps1` published `null` as a variable
// FIVE times, and `$Script:AnsibleClrFacadeSet` was published as a variable
// named `Script:AnsibleClrFacadeSet` because the scope-prefix list was
// case-sensitive too and `$Script:` is `$script:`). Every comparison against
// this set and against QUALIFIED_PREFIXES goes through `.toLowerCase()`.
const AUTOMATIC_VARIABLES = new Set([
  "this", "_", "psitem", "args", "input", "psscriptroot", "pscommandpath",
  "psmodulepath", "psversiontable", "host", "pid", "lastexitcode", "error",
  "home", "pwd", "myinvocation", "matches", "null", "true", "false", "ofs",
  "shellid", "stacktrace", "executioncontext", "psculture", "psuiculture",
  "psdebugcontext", "psedition", "iscoreclr", "islinux", "ismacos", "iswindows",
  "consolefilename", "consoleverbosity", "enabledexperimentalfeatures",
  "errorview", "maximumhistorycount", "nestedpromptlevel", "outputencoding",
])

// Flow-control and operator keywords that can reach command position.
const FLOW_KEYWORDS = new Set([
  "break", "continue", "return", "exit", "throw", "else", "elseif", "finally",
  "trap", "try", "catch", "in", "notin", "as", "is", "and", "or", "xor", "not",
  "band", "bor", "bxor", "bnot", "shl", "shr",
  "eq", "ne", "gt", "ge", "lt", "le", "like", "notlike", "match", "notmatch",
  "contains", "notcontains", "replace", "split", "join", "f", "r",
  // A class member's accessor keyword: `set { … }` is not a cmdlet.
  "get", "set",
])

/**
 * PS5 — the named blocks of an advanced function or script. `about_Functions`
 * / `about_Classes`: `begin`, `process`, `end`, `clean` and `dynamicparam`
 * delimit blocks, and the grammar emits each as a `command` node. A `calls` edge
 * naming one is a fabrication by construction — the name is reserved, so it can
 * never be a command name.
 */
/**
 * ZERO REGEX — the policy, and the eight helpers that satisfy it.
 *
 * This analyzer once claimed "zero regex usages (census 10 → 0)" in a doc that
 * cited a census which did not exist, while the source carried eight regexes put
 * back by later waves after the original ten were removed. The claim is now true
 * for real, and it is worth saying what it means rather than leaving it as a count:
 *
 *   NO REGEX IN THIS FILE DECIDES A FACT.
 *
 * Every symbol, relationship, type and parameter is read off the AST. What remains
 * is string NORMALIZATION on text the tree has already told us is a flag, a type
 * name, a comment body or a filesystem path — cases where the string is the value
 * and the decision was made structurally. A reader counting `.test(` calls would
 * have concluded the AST was bypassed; the honest statement is that eight normalizers
 * were regexes and are now character loops, each written to be provably equivalent
 * to the pattern it replaced.
 *
 * Every replacement below was checked against its ORIGINAL PATTERN over generated
 * inputs rather than by reading (script/m60/powershell-zero-regex-equiv.ts), because
 * "looks the same" is not a proof and `\s` is a specific 25-code-point set that a
 * naive `c <= 32` would get wrong.
 */

/** JavaScript's `\s`, exactly: whitespace, line terminators, and the Unicode
 *  separators. Spelled out rather than approximated — `/[\s]/` also matches NBSP
 *  and \uFEFF, and a `<= 32` test would silently stop matching both. */
const isSpaceCode = (code: number): boolean =>
  code === 32 || (code >= 9 && code <= 13) ||
  code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) ||
  code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f ||
  code === 0x3000 || code === 0xfeff

/** `a-zA-Z` on a single already-lowercased or raw character. `text[i]` is `undefined`
 *  past the end of the string and every comparison below is false for `undefined`, so
 *  a caller needs no bound check of its own. */
const isAsciiLetter = (c: string | undefined): boolean => {
  if (c === undefined) return false
  const code = c.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/**
 * F9 — could this string be a SYMBOL NAME at all?
 *
 * Not a reserved-word test and not an identifier test: the question is only whether
 * the text could name a stored symbol, and the answer is used to DROP an edge rather
 * than to keep one. Letters, digits, `_`, `.`, `:` and `-` are allowed because real
 * PowerShell names use all of them (`$script:x`, `$a.b`, `Get-ChildItem`, a COM
 * ProgID). Whitespace, a newline, a sigil or a quote is not a name, and an edge
 * carrying one is a target nothing can ever resolve to.
 *
 * This exists because `unknownTargets` did not catch it. That metric asks whether a
 * target MATCHES a symbol, and a target containing a newline matches nothing exactly
 * as quietly as a correct target matches something — so the malformed here-string
 * targets sat at 0 unknown for as long as they existed.
 */
const isPlausibleSymbolName = (name: string): boolean => {
  if (name.length === 0) return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    const ok =
      (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
      c === 95 /* _ */ || c === 46 /* . */ || c === 58 /* : */ || c === 45 /* - */
    if (!ok) return false
  }
  return true
}

/** `/^-/` — one leading dash, so `-ErrorAction` and `ErrorAction` compare equal. */
const stripLeadingDash = (text: string): string =>
  text.length > 0 && text.charCodeAt(0) === 45 ? text.slice(1) : text

/** `/(\[[\s]*\])+/g` — array/generic SUFFIX brackets on a declared type, so
 *  `string[]` and `Dictionary[string,int][]` reduce to their bare name. It matches
 *  only `[]` (with optional inner space), never `[T]`, which is why the scan below
 *  consumes a bracket pair and copies everything else through verbatim. */
const stripTypeSuffixBrackets = (text: string): string => {
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 91 /* [ */) {
      let j = i + 1
      while (j < text.length && isSpaceCode(text.charCodeAt(j))) j++
      if (j < text.length && text.charCodeAt(j) === 93 /* ] */) { i = j + 1; continue }
    }
    out += text[i]
    i++
  }
  return out
}

/** `/\.[A-Za-z0-9]+$/` — "ends in something shaped like a file extension".
 *  Anchoring on the LAST dot is equivalent, not an approximation: if the text after
 *  the last dot is not all alphanumerics then no earlier dot can be followed by
 *  alphanumerics to the end either, because that remainder would contain the same
 *  offending character. */
const hasTrailingExtension = (text: string): boolean => {
  const dot = text.lastIndexOf(".")
  if (dot < 0 || dot === text.length - 1) return false
  for (let i = dot + 1; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    if (!alnum) return false
  }
  return true
}

/** `/^\s*<#/` — leading whitespace then the block-comment opener. */
const stripOpenCommentDelim = (line: string): string => {
  let i = 0
  while (i < line.length && isSpaceCode(line.charCodeAt(i))) i++
  if (line.charCodeAt(i) === 60 /* < */ && line.charCodeAt(i + 1) === 35 /* # */) return line.slice(i + 2)
  return line
}

/** `/#>\s*$/` — the block-comment closer and any whitespace after it. */
const stripCloseCommentDelim = (line: string): string => {
  let end = line.length
  while (end > 0 && isSpaceCode(line.charCodeAt(end - 1))) end--
  if (end >= 2 && line.charCodeAt(end - 1) === 62 /* > */ && line.charCodeAt(end - 2) === 35 /* # */) {
    return line.slice(0, end - 2)
  }
  return line
}

/** `/^#+\s?/` — a run of comment markers and AT MOST ONE following space. The
 *  "at most one" is load-bearing: a markdown-style `##  Title` keeps its second
 *  `#` and loses one space, which is what makes the retained text a heading. */
const stripCommentMarkerRun = (text: string): string => {
  let i = 0
  while (i < text.length && text.charCodeAt(i) === 35 /* # */) i++
  if (i > 0 && i < text.length && isSpaceCode(text.charCodeAt(i))) i++
  return text.slice(i)
}

const NAMED_BLOCK_KEYWORDS = new Set(["begin", "process", "end", "clean", "dynamicparam"])

/**
 * PS5 — the language keywords that DSC and the workflow subsystem resolve. A
 * DSC configuration is a language construct, not a sequence of cmdlet calls.
 * The first version of this set carried capitalised multi-word guesses
 * (`xWebsite`, `websitelink`) that match nothing in the corpora; it was
 * replaced by the set the measured residue actually contains.
 */
const LANGUAGE_KEYWORD_COMMANDS = new Set([
  "inlinescript", "parallel", "sequence", "workflow",
  "param", "function", "class", "enum", "filter", "data", "default", "hidden",
  "static", "type", "namespace", "module", "export",
])

/**
 * PS5 (c) — the two DSC constructs that DECLARE something and therefore carry a
 * block. A DSC RESOURCE type (`File`, `Registry`, `Environment`, …) is
 * deliberately NOT in this set: the resource branch is entered on the STRUCTURE
 * (a command with a script-block argument inside a configuration), so adding
 * resource names here would reintroduce exactly the guess-list this replaced.
 */
const DSC_KEYWORDS = new Set(["configuration", "node"])

/**
 * PS7 — values that are an argument to a SWITCH parameter, never a positional
 * argument. `-ErrorAction Stop` is the commonest shape in the corpora and the
 * pre-wave reader turned `Stop` into a second external module import.
 */
const SWITCH_ARGUMENT_VALUES = new Set([
  "stop", "silentlycontinue", "continue", "inquire", "yes", "no", "none",
  "ignore", "true", "false", "0", "1", "pass", "fail",
])

/**
 * The `$name:` prefixes that scope a variable outside the local scope. PowerShell
 * scope modifiers are case-insensitive (`$Script:x` IS `$script:x`), so every
 * entry is lowercase and every comparison lowercases the candidate — see the
 * AUTOMATIC_VARIABLES note for the measurement that forced it.
 */
const QUALIFIED_PREFIXES = ["$global:", "$script:", "$env:", "$using:", "$local:", "$private:", "$variable:"]

/**
 * Is this declared type a PowerShell TYPE ACCELERATOR rather than a project
 * type?
 *
 * The suffix has to come off first: `[string[]]$Tags` declares the type
 * `string[]`, which is not in the accelerator set, so the first version emitted
 * `uses EventEntry -> string[]` — a target no symbol can ever have. A PowerShell
 * type name may carry any number of `[]` (array) and `[T]` (generic) suffixes,
 * so they are stripped before the lookup and the ORIGINAL text is what the edge
 * carries.
 */
const isTypeAccelerator = (declared: string): boolean => {
  const bare = stripTypeSuffixBrackets(declared).trim()
  return TYPE_ACCELERATORS.has(bare.toLowerCase()) || TYPE_ACCELERATORS.has(bare)
}

/** Type accelerators: `[int]`, `[string]`, `[pscustomobject]` … */
const TYPE_ACCELERATORS = new Set([
  "array", "bool", "byte", "char", "datetime", "decimal", "double", "float",
  "guid", "hashtable", "int", "int16", "int32", "int64", "long", "ordered",
  "psobject", "pscustomobject", "regex", "sbyte", "scriptblock", "single",
  "string", "switch", "timespan", "uint32", "uint64", "uint16", "xml", "void",
])

export class RealPowershellAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    /** Exported names already emitted, lowercased — see `addExport` for why a module exports a name once. */
    const exportedNames = new Set<string>()
    /** PS2 — the per-site relationship key. */
    const relKeys = new Set<string>()

    const frameworks = new Set<string>(["PowerShell"])
    const patterns = new Set<string>()

    // PS1 — the file's own basename IS the module. The extension is kept:
    // `Build.psm1` and `Build.ps1` are different files, and this analyzer is
    // handed both.
    const fileName = this.basenameOf(filePath)
    const lines = content.split("\n")

    // PS1 — the file IS the module, and the module is a real SYMBOL. Its name is
    // the file's own basename WITH the extension, which is deterministic (no
    // machine path, so the index fingerprint is stable), cannot collide with a
    // PowerShell identifier (no PowerShell name contains a `.`), and is not
    // rejected by `isIndexArtifactName`. bash BD2, adopted verbatim.
    symbols.push({
      name: fileName,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(rootNode),
      visibility: "public",
      metadata: { powershellSpecific: true, isScript: true, scriptPath: filePath },
    })

    let cyclomaticComplexity = 1
    /**
     * PS5 (c) — Desired State Configuration nesting depth. The grammar has no
     * marker for a configuration (a `Configuration X { … }` is a plain
     * `command` with a script-block argument), so the depth is tracked as the
     * walk enters and leaves each DSC block. Every other language construct
     * that carries a block — a function, a class, a `begin`/`process`/`end`
     * block — resets it, because none of them is a DSC block.
     */
    let dscDepth = 0
    /**
     * Every `command` node that opened a DSC block, keyed by
     * `startIndex:endIndex`.
     *
     * `startIndex` ALONE is unsound and cost a measured debugging round: a node
     * and its FIRST CHILD share a start offset (`Configuration`'s command and
     * its `command_name` both start at 0 in a file whose configuration opens
     * the file), so the exit marker matched the child — whose exit fires
     * BEFORE the block's own subtree is walked — and the depth dropped back to
     * zero before the first resource. Symptom: the `Configuration` keyword was
     * correctly suppressed while `File`, `Destination` and `Ensure` all still
     * emitted fabricated `calls` edges, i.e. 3 of 4 DSC fabrications survived a
     * fix that looked correct. A node and its parent cannot share BOTH offsets
     * unless one is zero-width, and only a `command` is ever added here, so the
     * pair is a sound identity for this use.
     */
    const dscBlocks = new Set<string>()
    // PS-A2 — the same push/pop discipline for an INTERFACE declaration block. The
    // first version pushed a frame and never popped it, and the measured damage was
    // worse than the bug being fixed: every class declared after an interface in the
    // same file was re-owned by the interface (`contains IShape -> Circle`), because
    // the leaked frame made the interface the attribution scope for the rest of the
    // file. Scoping without an exit is not a narrower fix, it is a different defect.
    const interfaceBlocks = new Set<string>()
    const nodeKey = (n: Node): string => `${n.startIndex}:${n.endIndex}`
    /**
     * A DSC block's DECLARED NAME, so the frame it pushes can be popped on the
     * same node's exit. Containment inside a configuration nests properly:
     * `SiteConfig` contains `Marker`, and `Marker` contains `Destination`.
     */
    const dscOwner = new Map<string, string>()

    // PS3 — the frame stack. `owner` is the nearest DECLARATION container (the
    // one a `contains` edge names); `scope` is the nearest SCOPE (the one a
    // `calls`/`uses`/`overrides` edge is sourced from). They differ exactly
    // inside a class: a method's owner is the CLASS (containment) while its
    // scope is the METHOD (attribution).
    interface Frame { owner: string; scope: string; containerLine: number }
    const frames: Frame[] = [{ owner: fileName, scope: fileName, containerLine: 1 }]
    const top = (): Frame => frames[frames.length - 1]
    const atFileScope = (): boolean => frames.length === 1

    /** PS6 — `className → baseClass`, for the `overrides` pass. */
    const baseClassByClass = new Map<string, string>()
    /** `className → its own declared member names`. */
    const classMembers = new Map<string, Set<string>>()
    /** Subclass member declarations, resolved after the whole file is read. */
    const overrideCandidates: { className: string; memberName: string; line: number }[] = []

    /**
     * PS2 — every edge carries the line of the node that BEARS ITS NAME, and
     * that line is part of the identity, so two sites of one callee are two
     * rows.
     */
    /**
     * The EVIDENCE TIER of an edge: how it was derived, which is analyzer knowledge
     * and therefore the analyzer's to emit. The same shape as bash's `evidenceClassFor`
     * and applied centrally so no call site can forget it; a caller may override it in
     * its own metadata, which is why the spread puts `metadata` LAST.
     *
     * The tiers are the graph engine's, not invented here. `structural` means the tree
     * states the fact — a container holds a declared child, a class header literally
     * lists its base. `usage_contextual` means the edge comes from a node's POSITION
     * rather than a named field: a variable read has no field saying "this is read
     * here", and a `New-Object` target is read out of a flag's VALUE.
     * `import_based` is for an import edge. `inferred` is reserved for a fact this
     * analyzer derives by matching rather than reading, and exactly one relationship
     * in this lane is that: `overrides`, which matches a subclass member's name
     * against the base's declared member set because PowerShell has no `override`
     * keyword. Calling that `structural` would overstate it.
     */
    const evidenceClassFor = (type: ASTEngine.RelationshipType, isImport = false): string => {
      // `imports` is `import_based` through the `isImport` line above, and it is NOT also
      // given a `case` here — which was the first version of this fix and it was wrong in
      // the way that matters. Adding `case Imports: return "import_based"` beside the
      // `References` case looks like the obvious place for a type whose name says
      // "import", and it is DEAD: `isImport` is true for every `imports` edge `addImport`
      // emits, so the first line answers and the switch is never reached for that type.
      //
      // A branch that cannot affect any output is an L2 dead branch, and here it was
      // worse than untidy, because a MUTANT written against it SURVIVED twice: once
      // while `imports` shared a fallthrough return with `references`, and once after
      // they were split into separate cases with separate returns. Both mutants changed
      // a line no edge's tier depended on, so both read as "the fixtures do not check the
      // tier" when what they actually proved is that the tier has a different home.
      //
      // The tier is asserted where it is decided, and the mutant that matters deletes the
      // `isImport` line: `powershell/imports-tier-short-circuit-removed`. That one is
      // caught by imports-psb12's `meta.evidenceClass` constraint on all six `imports`
      // rows, which is what makes the tier a check rather than a claim.
      if (isImport) return "import_based"
      switch (type) {
        case ASTEngine.RelationshipType.Contains:
        case ASTEngine.RelationshipType.Extends:
        case ASTEngine.RelationshipType.Implements:
        case ASTEngine.RelationshipType.Exports:
          return "structural"
        case ASTEngine.RelationshipType.References:
          return "import_based"
        default:
          return "usage_contextual"
      }
    }

    const addRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      line: number,
      metadata: Record<string, unknown> = {},
    ) => {
      if (!source || !target) return
      const key = `${source}\u0000${type}\u0000${target}\u0000${line}`
      if (relKeys.has(key)) return
      relKeys.add(key)
      const isImport = (metadata as { import?: boolean }).import === true
      relationships.push({
        source,
        target,
        type,
        confidence,
        line_number: line,
        // The caller's metadata comes LAST so an explicit `evidenceClass` at a call
        // site wins over the default — that is how the `overrides` edges say `inferred`
        // without every other call site having to repeat the reasoning.
        metadata: { evidenceClass: evidenceClassFor(type, isImport), ...metadata },
      })
    }

    // F9 (M60 #278): a BRACED variable — `${a}` — is the SAME variable as `$a`, and
    // this helper used to return `{a}` for it, so the two spellings became two
    // different symbols. Measured on a probe: `$a = 1` declared `a`, and
    // `"... ${a}"` published `uses -> {a}`, a read naming a symbol nothing declares
    // and nothing can own. The braced form is how PowerShell writes a variable whose
    // name would otherwise run into adjacent text, so it is not rare — and a graph
    // that gives one variable two names has lost the reference.
    //
    // Fixed in `stripDollar` rather than at the two call sites, because a variable's
    // name is normalized on many paths and the scope-qualified check (`isQualified`)
    // reads the RAW text, so `$env:FOO` is still recognised as qualified and
    // suppressed exactly as before.
    const stripDollar = (text: string): string => {
      if (text.length < 2 || text.charCodeAt(0) !== 36 /* $ */) return text
      if (text.charCodeAt(1) === 123 /* { */ && text.charCodeAt(text.length - 1) === 125 /* } */) {
        return text.slice(2, -1)
      }
      return text.slice(1)
    }

    /**
     * M60 (#278) — strip ONE layer of matching surrounding quotes.
     *
     * Zero regex, like every other normalizer in this file: `"` is char code 34 and
     * `'` is 39, so the test is a length check plus two code-point reads.
     *
     * Why it exists: an invocation-operator target is often WRITTEN as a quoted
     * string, and a command-name node's text is source text, so the quotes came
     * through into the published callee name. Measured on the production draw:
     *
     *     . "$PSScriptRoot\tools\buildCommon\startNativeExecution.ps1"
     *       -> calls -> "$PSScriptRoot\tools\buildCommon\startNativeExecution.ps1"
     *
     * The target carries its own double quotes, so it names nothing any symbol can be
     * called, and the dot-sourced file is not published as a dependency at all.
     * 5 sites, 3 files. It hid because the BARE spelling is the rare one: the
     * control `. ./plain.ps1` was already clean, so a reader sampling dot-sourcing
     * would see nothing wrong.
     */
    const unquoteTarget = (text: string): string => {
      if (text.length < 2) return text
      const first = text.charCodeAt(0)
      if (first !== 34 && first !== 39) return text
      if (text.charCodeAt(text.length - 1) !== first) return text
      return text.slice(1, -1)
    }

    /** PS8 — a scope-qualified name (`$global:x`) is never a local declaration. */
    const isQualified = (raw: string): boolean => {
      const lower = raw.toLowerCase()
      return QUALIFIED_PREFIXES.some((p) => lower.startsWith(p))
    }

    /** PS8 — case-insensitive membership, per the AUTOMATIC_VARIABLES note. */
    const isAutomatic = (name: string): boolean => AUTOMATIC_VARIABLES.has(name.toLowerCase())

    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()

    const pushSymbol = (
      name: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      line: number,
      meta: Record<string, unknown> = {},
      parameters?: ASTEngine.Parameter[],
    ): ASTEngine.UniversalSymbol | null => {
      const raw = name.trim()
      if (raw === "") return null
      if (isQualified(raw)) return null
      const owner = top().owner
      const clean = stripDollar(raw)
      if (clean === "") return null
      if (isAutomatic(clean)) return null
      // Case-insensitive, because PowerShell identifiers are: `$Foo` and
      // `$foo` are ONE variable, and two symbols for one binding is the same
      // defect as two declarations.
      const key = `${owner}\u0000${clean.toLowerCase()}\u0000${kind}`
      const existing = symbolMap.get(key)
      if (existing) return existing
      const sym: ASTEngine.UniversalSymbol = {
        name: clean,
        kind,
        range: this.nodeToRange(node),
        scope: owner,
        ownerName: owner,
        visibility: "public",
        parameters,
        metadata: { powershellSpecific: true, ...meta },
      }
      // The payload the STORE actually reads. The pre-wave lane wrote
      // `isStatic`/`isHidden`/annotations into `metadata`, and pool-worker.ts
      // drops the whole `metadata` object at the worker boundary except the
      // narrow `isDeclaration` key — so every one of them was lost before the
      // store ever saw it (measured: a `static [int]` property stored with
      // `is_static = 0`, and `[ValidateSet(…)]` stored with `annotations = null`).
      if (typeof meta.isStatic === "boolean") sym.isStatic = meta.isStatic
      if (typeof meta.isAbstract === "boolean") sym.isAbstract = meta.isAbstract
      if (Array.isArray(meta.annotations)) sym.decorators = meta.annotations as string[]
      if (typeof meta.returnType === "string" && meta.returnType) sym.returnType = meta.returnType
      if (typeof meta.docstring === "string" && meta.docstring) sym.docstring = meta.docstring
      symbols.push(sym)
      symbolMap.set(key, sym)
      return sym
    }

    /**
     * PS4/PS8 — containment, from the nearest DECLARATION container (never the
     * current scope, which may be a method) and never as a self-edge.
     *
     * An automatic variable is refused here as well as in `pushSymbol`: a
     * suppressed name must not become a contained CHILD either, and the only
     * way to guarantee that is to refuse it at the single point every caller
     * goes through. `$this.Name = $x` was publishing `contains Class -> this`.
     */
    const addContains = (target: string, line: number | null) => {
      const owner = top().owner
      if (!owner || owner === target) return
      if (isAutomatic(target)) return
      addRel(owner, target, ASTEngine.RelationshipType.Contains, 1.0, line ?? top().containerLine, {})
    }

    /**
     * A DECLARATION: the symbol plus its ONE containment edge, bound together.
     *
     * NAMED `declareSymbol`, NOT `declare`: `declare` is a TypeScript keyword
     * (the ambient-declaration modifier). `tsc` and esbuild both accept
     * `declare(x)` as a call; bun's parser does not, and it reports the failure
     * as `Unexpected }` at the END of the enclosing block — a long way from the
     * call that caused it. The name is therefore not a stylistic choice.
     *
     * They must be bound because PS2 makes the edge identity per-SITE, so a
     * repeated name earns a second EDGE while `pushSymbol` dedupes it to one
     * SYMBOL — and the result is a `contains` edge pointing at a name the file
     * does not declare. Measured, twice, in two different kinds:
     *
     *   · variables — `$value = 1` then `$value = $(…)` published TWO
     *     `contains` edges for one variable;
     *   · hashtable keys — `analyze-pr-test-failures.ps1` writes `@{ Name =
     *     $failure.name }` after a class/other `Name` had already been declared
     *     in the same scope, and the corpus measurement reported exactly ONE
     *     `contains` edge whose target matched no symbol in its own file.
     *
     * So the rule is now stated once, for every kind, instead of being
     * re-derived (and re-missed) at each declaration site.
     */
    const declareSymbol = (
      rawName: string,
      kind: ASTEngine.SymbolKind,
      node: Node,
      line: number,
      meta: Record<string, unknown> = {},
      parameters?: ASTEngine.Parameter[],
      containsLine: number | null = line,
    ): void => {
      const name = stripDollar(rawName)
      if (name === "") return
      if (kind === ASTEngine.SymbolKind.Variable && (isAutomatic(name) || isQualified(rawName))) return
      const key = `${top().owner}\u0000${name.toLowerCase()}\u0000${kind}`
      if (symbolMap.has(key)) return
      pushSymbol(rawName, kind, node, line, meta, parameters)
      addContains(name, containsLine)
    }

    /**
     * PS9 — the member names an expression READS or WRITES, and the `uses`
     * edges for them. `$obj.Prop`, `$this.Name`, `$cfg.Retries` and `$h.A` all
     * arrive here; the target is the member LEAF, which is the family contract
     * (a bare callee/member leaf, never the dotted chain).
     */
    const emitMemberUses = (node: Node, kind: "read" | "write") => {
      const member = this.findChildByType(node, "member_name")
      if (!member) return
      const leaf = member.text
      if (!leaf || leaf.startsWith("$")) return
      addRel(top().scope, leaf, ASTEngine.RelationshipType.Uses, kind === "write" ? 0.9 : 0.8,
        member.startPosition.row + 1, {
          powershellSpecific: true,
          isMemberAccess: true,
          ...(kind === "write" ? { isMemberWrite: true } : { isMemberReference: true }),
        })
    }

    /**
     * PS9 — every variable READ inside a subtree, as a `uses` edge. Used for
     * interpolation subexpressions, where the pre-wave lane read only the
     * method call and never the variable.
     */
    // `marker` names WHAT KIND of read this pass is, so each kind is independently
    // attributable in the output and a mutant can revert one without touching the
    // others. Without it an argument read and a here-string read are the same row
    // shape — `uses` + `isVariableReference` — and reverting either from the result
    // alone would silently revert both. Two of the five PS-A4 mutants cannot be
    // written faithfully without it, and a mutant that cannot fail is decoration,
    // which is the standard this file already states.
    const emitVariableReads = (node: Node, skipBlocks = false, marker?: string) => {
      const work: Node[] = [node]
      const seen = new Set<number>()
      while (work.length > 0) {
        const n = work.pop()!
        if (n.type === "comment") continue
        // A script block is a SCOPE. When this pass runs over a command's arguments,
        // descending into one would attribute the block's locals to the CALLER —
        // `ForEach-Object { $x }` would publish `uses $x` from the command's owner.
        // The block's own body is read by the main switch, which pushes the frame, so
        // skipping here loses nothing and gains correct attribution.
        if (skipBlocks && (n.type === "script_block_expression" || n.type === "named_block")) continue
        // An ELEMENT ACCESS is likewise not this pass's business, and reading into it
        // is actively wrong rather than merely redundant. `$names[$index]` has two
        // variables in it, and PS9's ruling is that the readable one is the KEY:
        // `uses -> index`. This pass would also read the RECEIVER, publishing
        // `uses -> names` beside it, which `member-reads-psb5` forbids by name as
        // the pre-fix shape of form 4 ("the RECEIVER instead of the key"). The
        // dedicated `element_access` case already reads the key with the right grain,
        // so the correct behaviour here is to skip the node entirely.
        //
        // Caught by the fixture on the run that introduced this pass, which is the
        // gate working: +15,354 edges is not a licence to add a shape a fixture has
        // already ruled on.
        if (skipBlocks && n.type === "element_access") continue
        // F9: a `braced_variable` (`${a}`) is the same node the analyzer must read
        // as `${a}`, and it is a DIFFERENT node type from `variable`, so the read
        // pass walked straight past it: `Write-Host ${braced}` published no `uses` at
        // all. Both spellings now enter the same branch, and `stripDollar` collapses
        // them to one name.
        if (n.type === "variable" || n.type === "braced_variable") {
          if (seen.has(n.startIndex)) continue
          seen.add(n.startIndex)
          // F9: SPLATTING. The grammar models `@name` as a `variable` node whose
          // text is `@name` — no sigil — so `stripDollar` left it alone and
          // `New-PSOptions @OptionsArguments` published `uses -> @OptionsArguments`.
          // That is the same dangling-target defect as the braced form, in the same
          // family, and `@name` and `$name` are one variable in PowerShell.
          //
          // Found by a line-level check over all 25,205 variable-reference edges in
          // the corpora, asking whether the declared line actually contains
          // `$<target>`: 96.75% did, and the residue was dominated by braced
          // variables (a false negative in the CHECK, since `"${x}"` does not
          // contain `$x`) with splatting as the one real defect in it.
          //
          // Only a leading `@` on a `variable` node is stripped. `@()` and `@{}` are
          // array- and hashtable literals and arrive as `array_literal_expression`
          // and `hash_literal_expression`, never as `variable`, so they cannot reach
          // here.
          // F9, the here-string half. A `variable` inside an EXPANDABLE HERE-STRING
          // carries the surrounding line break in its own span: the grammar reports
          // `variable [6,8]-[7,8]` for `$message` on its own line, so `n.text` is
          // "\n$message\n". Two things went wrong from that. `stripDollar` did
          // nothing, because the text does not START with `$`; and the resulting edge
          // published `uses -> "\n$message"`, a target no symbol can have.
          //
          // The grammar was not fixed and should not be: the span is the text the
          // interpolation occupies, and trimming the TEXT is the whole correction.
          // Verified on a reproduction built from build.psm1:2248-2254, where the
          // emitted targets were `"\n$message"` and `"\n$stack_trace"`.
          const trimmed = n.text.trim()
          const rawName = stripDollar(trimmed)
          const name = rawName.length > 1 && rawName.charCodeAt(0) === 64 /* @ */
            ? rawName.slice(1)
            : rawName
          // And a GUARD, so a name that is still not a plausible identifier is
          // dropped rather than published. Every surface metric stayed at 0 while
          // these two malformed targets were being emitted — `unknownTargets` counts
          // a target that matches no symbol, and a target with a newline in it
          // matches nothing just as silently as a correct one. A line-level check
          // over all 25,202 variable-reference edges is what found them, at
          // 99.98% justified and 5 residue.
          if (!isPlausibleSymbolName(name)) continue
          // The qualified check runs against BOTH the raw text and the name with
          // its sigil restored, because `QUALIFIED_PREFIXES` are written WITH the
          // `$` (`"$env:"`) and a braced qualified variable arrives as `${env:FOO}`,
          // which matches neither form on its own. Without the second check a
          // `${env:FOO}` read would be published as a project variable — trading one
          // gap for a worse one, since the whole point of PS8 was to suppress these.
          // F9, the scope-qualified READ. A scope-qualified name is still not a
          // DECLARATION — PS8 stands, and `$env:PATH = 'x'` declares nothing, pinned
          // by suppression-and-params-psb7. But a READ of one is a real dependency on
          // something outside the file, and the read path was reusing the DECLARATION
          // guard, so `Write-Host $env:Temp` published nothing at all.
          //
          // The independent F5 oracle expects these (`uses Sign-Package -> env:Temp`,
          // 7 rows in the non-test sample, all from one file), and the reasoning
          // agrees with it: the graph already records external dependencies — a
          // `calls -> Write-Host` target is equally unresolvable — so `$env:WINDIR`
          // is a dependency of exactly the same kind, and dropping it loses a fact
          // about what the script needs from its environment.
          //
          // The qualified name is KEPT (`env:Temp`, not `Temp`), so the target can
          // never be confused with a project variable: nothing this lane declares
          // carries a colon, and a scope prefix is the only thing that produces one.
          // AUTOMATIC variables stay suppressed — those are the engine's own bindings
          // (`$_`, `$args`, `$PSVersionTable`), which is the subject PS8 actually
          // ruled on, and no oracle asks for them.
          const isScoped = isQualified(n.text) || isQualified(`$${name}`)
          if (!name || isAutomatic(name)) continue
          if (isScoped && name.indexOf(":") < 0) continue
          // The LINE must skip the leading break too, not just the name. A
          // here-string interpolation's node starts at the END of the previous line
          // (the grammar reports `variable [6,8]-[7,8]` for a `$message` written on
          // line 7), so `startPosition.row + 1` published the edge one line ABOVE the
          // variable — measured as `build.psm1:2251 -> message` when `$message` is
          // on line 2252. This lane has a fixture (`per-site-lines-psb2`) and a
          // mutant for exactly this class of error, so an off-by-one here is not a
          // rounding matter.
          const lead = n.text.length - n.text.trimStart().length
          let skippedLines = 0
          for (let i = 0; i < lead; i++) {
            if (n.text.charCodeAt(i) === 10 /* \n */) skippedLines++
          }
          addRel(top().scope, name, ASTEngine.RelationshipType.Uses, 0.9,
            n.startPosition.row + 1 + skippedLines, {
            powershellSpecific: true, isVariableReference: true,
            ...(marker ? { [marker]: true } : {}),
            ...(isScoped ? { isScopedEnvironmentRead: true } : {}),
            // A read written in the BRACED spelling. The marker's job is to make the
            // normalization independently revertible: once `${a}` and `$a` are the
            // same string in the result, nothing distinguishes them, so a mutant for
            // "the braces come back" has nothing to key on and would be a no-op — a
            // mutant that cannot fail is decoration.
            ...(trimmed.charCodeAt(0) === 36 && trimmed.charCodeAt(1) === 123 ? { isBracedVariable: true } : {}),
          })
          continue
        }
        if (n.type === "member_access") { emitMemberUses(n, "read"); continue }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) work.push(c)
        }
      }
    }

    const isBranch = (type: string) =>
      type === "if_statement" ||
      type === "elseif_clause" ||
      type === "while_statement" ||
      type === "do_statement" ||
      type === "for_statement" ||
      type === "foreach_statement" ||
      type === "switch_statement" ||
      type === "try_statement" ||
      type === "catch_clause" ||
      type === "trap_statement" ||
      // A `switch` CASE is a decision point. `switch_clause` was never named by
      // this lane, so a 10-case switch measured a cyclomatic complexity of 1
      // (measured: 174 `switch_clause` nodes in the production draw, all
      // uncounted).
      type === "switch_clause"

    const findFirstChild = (node: Node, type: string): Node | null => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === type) return child
      }
      return null
    }

    /**
     * First descendant of `type`, BOUNDED BY DEPTH.
     *
     * The bound is not an optimisation, it is the envelope. The unbounded
     * version of this search was introduced with the DSC branch (to find a
     * command's script-block argument) and it walked the WHOLE argument subtree
     * — which for `Configuration X { … }` is the entire configuration body. A
     * per-command walk of a whole block is a per-command O(n) pass, the exact
     * shape the M60 R6 envelope forbids, and it is invisible on any file without
     * a large script-block argument. `maxDepth` defaults to 6, which is
     * measured to be the deepest the grammar ever puts the shapes this analyzer
     * looks for: `command_elements > array_literal_expression > unary_expression
     * > script_block_expression` is 3.
     */
    const findDescendant = (node: Node, type: string, maxDepth = 6): Node | null => {
      let frontier: Node[] = [node]
      for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
        const next: Node[] = []
        for (const n of frontier) {
          if (n.type === type) return n
          for (let i = n.namedChildCount - 1; i >= 0; i--) {
            const child = n.namedChild(i)
            if (child) next.push(child)
          }
        }
        frontier = next
      }
      return null
    }

    /** A variable in a subtree, bounded: the LHS of an assignment is shallow. */
    const findDescendantVariable = (node: Node): Node | null =>
      findDescendant(node, "variable", 12)

    /**
     * The TYPE CONSTRAINT of a parameter or member, as SOURCE TEXT.
     *
     * Two shapes, and reading only the first is why every `[string]$Name` in the
     * fixtures was reported `untyped`:
     *
     *   `[void] M([int]$a)`  →  `class_method_parameter > type_literal` (direct)
     *   `param([string]$Name)` →  `script_parameter > attribute_list > attribute
     *                             > type_literal` (TWO levels down, because a
     *                             parameter's type is spelled as an attribute)
     *
     * `type_spec` is the grammar's own wrapper, so reading its text gets the
     * QUALIFIED spelling (`System.Collections.Generic.List`) rather than only
     * the leaf — the difference between a target that resolves and one that
     * does not.
     *
     * The discrimination inside an `attribute_list` matters: `[Parameter()]`,
     * `[ValidateSet('a','b')]` and `[CmdletBinding()]` are ALSO attributes, and
     * the rule that separates them from a type constraint is that a type
     * constraint's `attribute` has a DIRECT `type_literal` child while the
     * others carry `attribute_name` or `attribute_arguments`. Picking the first
     * attribute would report `[Parameter()]`'s name as the declared type.
     */
    const typeSpecText = (node: Node): string => {
      const specTextOf = (literal: Node): string => {
        const spec = findFirstChild(literal, "type_spec")
        if (spec) return spec.text
        return this.stripBrackets(literal.text)
      }
      const direct = node.type === "type_literal" ? node : findFirstChild(node, "type_literal")
      if (direct) return specTextOf(direct)
      for (const list of this.collectChildrenByType(node, "attribute_list")) {
        for (const attr of this.collectChildrenByType(list, "attribute")) {
          const literal = findFirstChild(attr, "type_literal")
          if (literal) return specTextOf(literal)
        }
      }
      return ""
    }

    const collectParameters = (list: Node | null): ASTEngine.Parameter[] => {
      const params: ASTEngine.Parameter[] = []
      if (!list) return params
      for (let i = 0; i < list.namedChildCount; i++) {
        const p = list.namedChild(i)
        if (!p) continue
        // PS10 — the parameter ITEM shapes. Measured grammar:
        //   `param($a)`                  → parameter_list > script_parameter
        //   `function F($a)`             → function_parameter_declaration
        //                                     > parameter_list > script_parameter
        //   `[void] M([int]$a)`          → class_method_parameter_list
        //                                     > class_method_parameter
        // `function_parameter_declaration` is the WRAPPER on the inline form, not
        // the item — the first version of this fix assumed it was the item and so
        // matched nothing, which is why `Inline-Params` still published zero
        // parameters after the "fix". The pre-wave reader accepted only the first
        // and third shapes, so `function G($x, $y) { … }` published nothing.
        if (p.type !== "script_parameter" && p.type !== "class_method_parameter") continue
        const varNode = findFirstChild(p, "variable")
        if (!varNode) continue
        const declared = typeSpecText(p)
        const def = findFirstChild(p, "script_parameter_default")
        const entry: ASTEngine.Parameter = {
          name: stripDollar(varNode.text),
          // An untyped parameter is not `any` by declaration — it is untyped.
          // `[int]$Default = 0` and `$Default = 0` are different contracts and
          // the store's `parameters` JSON is the only place either survives.
          type: declared || "untyped",
          isOptional: def !== null,
        }
        if (def) {
          const val = def.namedChildCount > 1 ? def.namedChild(1) : null
          if (val) entry.defaultValue = val.text
        }
        params.push(entry)
      }
      return params
    }

    const commandNameOf = (node: Node): string => {
      // M60 (#278): resolve the name NODE first and normalise once at the end.
      //
      // Two things were wrong here and only the second was visible. A quoted
      // invocation target — `. "$PSScriptRoot\tools\buildCommon\start.ps1"` — is
      // parsed as `command_name_expr > string_literal > expandable_string_literal`,
      // and the name was read as raw SOURCE TEXT, so the quotes came through into
      // the published callee:
      //
      //     calls -> "$PSScriptRoot\tools\buildCommon\start.ps1"
      //
      // A name carrying its own quotes names nothing any symbol can be called, so
      // the dot-sourced file was published as no dependency at all — 5 sites, 3
      // files. And the obvious fix, handling `command_name_expr` in the branch that
      // looks for it, does not work: the grammar gives the `command_name_expr` node
      // the FIELD NAME `command_name`, so `childForFieldName("command_name")`
      // returns it and the early return fires first. That is why this is a single
      // normalisation at the exit rather than a branch.
      //
      // It hid because the BARE spelling is the rare one — `. ./plain.ps1` was always
      // clean, so sampling dot-sourcing by eye finds nothing wrong.
      const field = (node as any).childForFieldName?.("command_name")
      const fieldNode: Node | null = field ?? null
      const nameNode = fieldNode ?? findFirstChild(node, "command_name")
      if (nameNode) return unquoteTarget(nameNode.text)
      const expr = findFirstChild(node, "command_name_expr")
      if (expr) {
        const inner = findFirstChild(expr, "command_name")
        if (inner) return inner.text
        return unquoteTarget(expr.text)
      }
      return ""
    }

    /**
     * PS7 — the POSITIONAL arguments of a command, plus the values of
     * two-token parameters, decided STRUCTURALLY: a `command_parameter`
     * contributes a value only when a value token physically follows it AND that
     * token is not a switch-argument value (`-ErrorAction Stop`).
     *
     * `valueAfter` and a module-scope `isValueToken` used to sit directly above this
     * function and both were DEAD: `valueAfter` had no call site at all (the private
     * `valueAfterNode` does that job), and the outer `isValueToken` was shadowed by the
     * identical declaration inside `commandArgs` below, so both of that function's call
     * sites bound to the inner copy. A duplicate that is never the binding one is the
     * kind of thing a reader has to re-derive to be sure of, and `grep -c` answers it
     * only if you count the right string. Removed; the behaviour is unchanged, which is
     * why removal is safe rather than merely tidy.
     */
    const commandArgs = (node: Node): string[] => {
      const out: string[] = []
      const elements = findFirstChild(node, "command_elements")
      if (!elements) return out
      // A plain boolean, deliberately NOT a `c is Node` type predicate: a
      // predicate would narrow `c` to `never` on the fall-through path, which
      // is exactly the branch that inspects `array_literal_expression`.
      const isValueToken = (c: Node | null | undefined): boolean =>
        !!c && (c.type === "generic_token" || c.type === "string_literal" || c.type === "expandable_string_literal")
      for (let i = 0; i < elements.namedChildCount; i++) {
        const c = elements.namedChild(i)
        if (!c) continue
        if (c.type === "command_parameter") {
          // No field probe here: the grammar's 14 fields are
          // argument_expression_list, command_elements, command_name, condition,
          // else_clause, elseif_clauses, for_condition, for_initializer,
          // for_iterator, named_block_list, script_block_body, statement_list,
          // statements, value — there is no `argument`, and `childForFieldName`
          // on an absent field returns null rather than throwing (measured, not
          // assumed), so the `?.` guard was load-bearing for nothing. The sibling
          // scan below is what has always produced the value.
          const next = elements.namedChild(i + 1)
          if (next && isValueToken(next) && !SWITCH_ARGUMENT_VALUES.has(next.text.toLowerCase())) {
            out.push(this.stripQuotes(next.text))
          }
          continue
        }
        if (isValueToken(c)) { out.push(this.stripQuotes(c.text)); continue }
        if (c.type === "array_literal_expression" || c.type === "unary_expression") {
          const v = findDescendantVariable(c)
          if (v) out.push(stripDollar(v.text))
          else {
            const lit = this.findQuoted(c)
            if (lit) out.push(this.stripQuotes(lit.text))
          }
        }
      }
      return out
    }

    /**
     * PS11 — does this argument LOOK like a filesystem path?
     *
     * Used ONLY to decide whether an invocation-operator target (`. ./lib.ps1`,
     * `& ./run.ps1`) is a path call or a variable call. It is deliberately NOT
     * used to gate `Import-Module`: an installed PowerShell module is named by a
     * BARE name — `Import-Module PoshRSJob`, `Import-Module Pester` — and a
     * path-shape requirement silently dropped every one of them. Measured: with
     * the shape test applied to imports, `Import-Module -Name SqlServer` and
     * `Import-Module PoshRSJob` both produced no import at all, while
     * `Import-Module Az.Accounts` did, because a dotted name happens to match the
     * extension regex. What distinguishes a module name from a switch-argument
     * VALUE is the switch-value set, not its shape.
     */
    const looksLikeModulePath = (text: string): boolean =>
      text.length > 0 && (text.includes("/") || text.includes("\\") || hasTrailingExtension(text))

    const addImport = (moduleName: string, via: string, line: number, node: Node) => {
      if (!moduleName) return
      imports.push({
        module: moduleName,
        items: ["*"],
        isDefault: true,
        range: this.nodeToRange(node),
        metadata: { powershellSpecific: true, via },
      })
      // A module dependency carries TWO edges, and the second one is the fix.
      //
      // `imports` is the ontology's own type for "this file depends on that module",
      // and PowerShell states the dependency four ways — `Import-Module`, `using
      // module`, `using namespace`, `#requires -Module` — all four of which this
      // function is the single reader for. The lane emitted only `references`, so over
      // the 1,092-file corpus the `imports` type was EMITTED 0 times: a real
      // construct, read correctly, recorded in `imports[]`, and absent from the graph
      // as an `imports` edge. `script/m60/powershell-surface-measure.ts:223` computes
      // `absent: ONTOLOGY.filter(k => !kinds[k])` and `:243` prints it as the types
      // "not exercised by this draw (all implemented + gated)" — and a type with zero
      // edges over the whole 1,092-file corpus is necessarily in that list for every
      // draw that is a subset of it. That parenthetical is a string literal, so it
      // asserted `imports` was implemented and gated while `RelationshipType.Imports`
      // appeared nowhere in this file.
      //
      // `references` is KEPT, not replaced. bash is the precedent and the same shape of
      // fact: `real-bash-analyzer.ts:1299` emits `imports` and `:1304` emits
      // `references` for one `source ./x.sh`, at the same confidence, because a
      // file-level dependency answers two different consumers and dropping either loses
      // an edge something already resolves. Measured, not asserted:
      // `grep -l 'RelationshipType.Imports' src/ast/real-*-analyzer.ts` names 22 of the
      // 48 analyzers before this line and 23 after, so PowerShell was one of the 26 that
      // did not carry the type while filling an `imports[]` array.
      //
      // Confidence is 0.9 on BOTH edges and that is not a new number: it is the value
      // this function has always put on this exact fact. The module NAME is read off the
      // tree; the module's RESOLUTION to a file on disk happens at run time, so the edge
      // is a read of a dependency, not a proof of a file on disk. Both edges carry
      // identical metadata so the two rows cannot come to describe different facts.
      // `via` is on the ImportInfo already; putting it on the EDGE as well is what
      // makes a row self-describing — `file -> Module` does not say whether the file
      // wrote `Import-Module`, `using namespace`, `using module` or `#requires`, and
      // those four are read by three different grammar branches. PS24 needed the
      // distinction to be nameable from the result alone, because a `#requires`
      // HASHTABLE row and a bare `#requires -Module X` row are otherwise identical
      // in every field the output carries, and the pre-PS24 defect is invisible
      // without it.
      const meta = { powershellSpecific: true, import: true, via, fileLevel: atFileScope() }
      // A file-level dependency's source is the importing FILE (M60/#910), so
      // the stored row names an importer a reader can key on.
      addRel(top().scope, moduleName, ASTEngine.RelationshipType.Imports, 0.9, line, { ...meta })
      addRel(top().scope, moduleName, ASTEngine.RelationshipType.References, 0.9, line, { ...meta })
    }

    /**
     * PS20 — `Export-ModuleMember -Function F` is how a `.psm1` publishes its
     * surface. The pre-wave lane hard-coded `exports: []`, so a module's public
     * API was invisible.
     */
    const addExport = (name: string, via: string, line: number) => {
      if (!name || name.startsWith("*")) return
      // A MODULE EXPORTS A NAME ONCE. The pre-G6 reader could only reach one value
      // per flag, so the duplicate case never arose; the G6 comma-list reader walks
      // the whole value list, which means a name can be reachable by two paths in
      // the same statement — `Export-ModuleMember -Function F` is seen both by the
      // flag's value walk and by the bare-value branch, because a value in
      // `command_elements` is preceded by a `command_argument_sep` that both match.
      // `module-surface-psb9` caught it as a violated export invariant on
      // `Get-Setting`, which is exactly what an invariant is for: the fixture
      // asserted a property of the lane's output that the change would otherwise
      // have quietly broken, and the corpus would not have shown it.
      //
      // Deduplicated on the name, case-insensitively, because PowerShell's
      // identifiers are — `Export-ModuleMember -Function Get-Setting, get-setting`
      // is one export, and a reader keying the graph on the name would see two.
      if (exportedNames.has(name.toLowerCase())) return
      exportedNames.add(name.toLowerCase())
      exports.push({ name, range: this.lineRange(line), metadata: { powershellSpecific: true, via } })
      addRel(top().scope, name, ASTEngine.RelationshipType.Exports, 1.0, line, {
        powershellSpecific: true, viaExportModuleMember: true, fileLevel: atFileScope(),
      })
    }

    const detectFrameworks = (cmdName: string) => {
      const lower = cmdName.toLowerCase()
      if (
        lower.startsWith("get-az") || lower.startsWith("new-az") || lower.startsWith("set-az") ||
        lower.startsWith("remove-az") || lower.startsWith("connect-az") || lower === "az" || lower.startsWith("az_")
      ) frameworks.add("Azure Az Module")
      if (lower.startsWith("get-msol") || lower.startsWith("set-msol") || lower.startsWith("connect-msol"))
        frameworks.add("Azure AD / MSOnline")
      if (
        lower.startsWith("get-exo") || lower.startsWith("set-exo") || lower.startsWith("new-exo") ||
        lower.startsWith("get-mailbox") || lower.startsWith("set-mailbox") || lower.startsWith("enable-mailbox")
      ) frameworks.add("Exchange Online")
      if (
        lower.startsWith("get-sp") || lower.startsWith("set-sp") || lower.startsWith("new-sp") ||
        lower.startsWith("connect-pnp") || lower.startsWith("get-pnp")
      ) frameworks.add("SharePoint PnP")
      if (lower.startsWith("get-ad") || lower.startsWith("set-ad") || lower.startsWith("new-ad") || lower.startsWith("remove-ad"))
        frameworks.add("Active Directory")
      if (lower.startsWith("get-vm") || lower.startsWith("new-vm") || lower.startsWith("start-vm") || lower.startsWith("stop-vm"))
        frameworks.add("VMware / Hyper-V")
      if (lower.startsWith("invoke-rest") || lower.startsWith("invoke-web") || lower === "irm" || lower === "iwr")
        patterns.add("REST API Calls")
      if (lower.startsWith("write-") || lower.startsWith("read-")) patterns.add("I/O Operations")
      if (lower === "get-service" || lower === "stop-service" || lower === "start-service" || lower === "restart-service")
        patterns.add("Service Management")
    }

    // -------------------------------------------------------------- traversal

    const work: { node: Node; exit: boolean }[] = [{ node: rootNode, exit: false }]
    while (work.length > 0) {
      const { node, exit } = work.pop()!
      if (!node) continue

      if (exit) {
        // PS5 (c) — leaving a DSC block. Keyed on the node's own `startIndex`,
        // so the depth cannot drift if a later construct nests differently.
        if (dscBlocks.has(nodeKey(node))) {
          dscBlocks.delete(nodeKey(node))
          const declared = dscOwner.get(nodeKey(node))
          dscOwner.delete(nodeKey(node))
          if (declared !== undefined) frames.pop()
          dscDepth--
        }
        // PS-A2 — leaving an interface block, mirroring the DSC exit above.
        if (interfaceBlocks.has(nodeKey(node))) {
          interfaceBlocks.delete(nodeKey(node))
          frames.pop()
        }
        // PS3 — a method is a SCOPE whose OWNER stays the class, so popping its
        // frame restores the class as the attribution scope.
        if (
          node.type === "function_statement" ||
          node.type === "class_statement" ||
          node.type === "enum_statement" ||
          node.type === "class_method_definition"
        ) {
          frames.pop()
        }
        continue
      }
      work.push({ node, exit: true })

      if (isBranch(node.type)) cyclomaticComplexity++

      switch (node.type) {
        // ------------------------------------------------------- functions
        case "function_statement": {
          const nameNode = findFirstChild(node, "function_name")
          if (!nameNode) break
          const fnName = nameNode.text
          // PS10 — the inline list first, then the `param()` block form. The
          // inline form's `parameter_list` is one level down, inside the
          // `function_parameter_declaration` WRAPPER, so a direct-child lookup on
          // the function statement finds nothing.
          const inline = findFirstChild(node, "function_parameter_declaration")
          const inlineList = inline ? findFirstChild(inline, "parameter_list") : null
          const direct = findFirstChild(node, "parameter_list")
          const blockList = this.findParamList(node)
          const params = collectParameters(inlineList ?? direct ?? blockList)
          const parameterForm = inlineList ? "inline" : (direct ?? blockList) ? "paramBlock" : "none"
          // PS11 — the attribute list. `[CmdletBinding()]` and `[OutputType()]` on
          // a function live on the `param_block`'s `attribute_list`, NOT as
          // direct children of the `function_statement`, so a direct-child read
          // found none and every PowerShell function stored with
          // `annotations = NULL` even where the analyzer had extracted them.
          // Both places are read, because PowerShell allows either.
          const annotations: string[] = []
          annotations.push(...this.allAttributeTexts(node))
          for (const attr of annotations) {
            if (attr.includes("CmdletBinding")) patterns.add("Advanced Functions")
            if (attr.includes("Parameter")) patterns.add("Parameter Attributes")
            if (attr.includes("ValidateSet") || attr.includes("ValidateRange") || attr.includes("ValidatePattern"))
              patterns.add("Input Validation")
          }
          // PS2 — a function's line is where its NAME is written, which for a
          // wrapped `function` keyword is not the node's start line.
          const line = nameNode.startPosition.row + 1
          declareSymbol(fnName, ASTEngine.SymbolKind.Function, node, line, {
            ...(annotations.length > 0 ? { annotations } : {}),
            docstring: this.docstringAbove(nameNode.startPosition.row, lines),
            returnType: "any",
            parameterForm,
          }, params)
          frames.push({ owner: fnName, scope: fnName, containerLine: line })
          break
        }

        // ------------------------------------------------- script parameters
        case "param_block": {
          // A SCRIPT-level `param()` declares the script's parameters; a
          // function's is consumed by `function_statement`.
          if (!atFileScope()) break
          const list = findFirstChild(node, "parameter_list")
          if (!list) break
          for (const p of this.collectChildrenByType(list, "script_parameter")) {
            const varNode = findFirstChild(p, "variable")
            if (!varNode || isQualified(varNode.text)) continue
            const vline = varNode.startPosition.row + 1
            const declared = typeSpecText(p)
            const attrs = this.attributeTexts(p)
            declareSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, vline, {
              isScriptParameter: true,
              type: declared || "untyped",
              ...(attrs ? { annotations: attrs } : {}),
            })
          }
          break
        }

        // ---------------------------------------------------------- classes
        case "class_statement": {
          const names = this.collectChildrenByType(node, "simple_name")
          if (names.length === 0) break
          const className = names[0].text
          const baseClass = names.length > 1 ? names[1].text : ""
          const interfaces = names.slice(2).map((n) => n.text)
          const declLine = names[0].startPosition.row + 1
          if (baseClass) {
            baseClassByClass.set(className, baseClass)
            addRel(className, baseClass, ASTEngine.RelationshipType.Extends, 1.0, declLine, {
              powershellSpecific: true,
            })
          }
          for (const iface of interfaces) {
            addRel(className, iface, ASTEngine.RelationshipType.Implements, 0.85, declLine, {
              powershellSpecific: true,
            })
          }
          // The declared member set, so a SUBCLASS's method can be matched
          // against its base's members and emit `overrides`. PowerShell class
          // methods are virtual by default; the pre-wave lane emitted ZERO
          // `overrides` edges in the language.
          classMembers.set(className, new Set())
          // PS1 — a top-level declaration is contained by the FILE, which is a
          // real owner. The pre-wave lane emitted no `contains` for a top-level
          // class at all, so nothing tied it to the file that declares it.
          declareSymbol(className, ASTEngine.SymbolKind.Class, node, declLine, {
            ...(baseClass ? { baseClass } : {}),
            docstring: this.docstringAbove(names[0].startPosition.row, lines),
          })
          frames.push({ owner: className, scope: className, containerLine: declLine })
          break
        }

        // ------------------------------------------------------------ enums
        case "enum_statement": {
          const nameNode = findFirstChild(node, "simple_name")
          if (!nameNode) break
          const line = nameNode.startPosition.row + 1
          declareSymbol(nameNode.text, ASTEngine.SymbolKind.Enum, node, line, {
            docstring: this.docstringAbove(nameNode.startPosition.row, lines),
          })
          frames.push({ owner: nameNode.text, scope: nameNode.text, containerLine: line })
          break
        }

        case "enum_member": {
          const nameNode = findFirstChild(node, "simple_name")
          if (!nameNode) break
          const line = nameNode.startPosition.row + 1
          declareSymbol(nameNode.text, ASTEngine.SymbolKind.EnumMember, node, line, {})
          break
        }

        // -------------------------------------------------- class members
        case "class_method_definition": {
          const nameNode = findFirstChild(node, "simple_name")
          if (!nameNode) break
          const className = top().owner
          const isCtor = nameNode.text === className
          const line = nameNode.startPosition.row + 1
          const params = collectParameters(this.findMethodParamList(node))
          const attrText = this.classAttributeTexts(node)
          // PS4 — a PowerShell constructor is WRITTEN with the class's own
          // name, so the SYMBOL name is the synthesised `constructor` and the
          // containment edge reads `Class -> constructor`. Naming it after the
          // class made it a self-edge, which the store's M51.A1 guard then
          // refused — so every PowerShell constructor stored ownerless.
          const symName = isCtor ? "constructor" : nameNode.text
          const returnType = typeSpecText(node) || (isCtor ? "void" : "any")
          declareSymbol(symName, isCtor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method, node, line, {
            isStatic: attrText.includes("static"),
            isHidden: attrText.includes("hidden"),
            returnType,
            ...(this.allAttributeTexts(node).length > 0 ? { annotations: this.allAttributeTexts(node) } : {}),
            docstring: this.docstringAbove(nameNode.startPosition.row, lines),
          }, params)
          if (!isCtor) {
            if (classMembers.has(className)) classMembers.get(className)!.add(nameNode.text)
            // Resolved after the file is read: a subclass may precede its base.
            overrideCandidates.push({ className, memberName: nameNode.text, line })
          }
          // PS3 — the method is now the SCOPE. Its OWNER stays the class, so a
          // `contains` edge from inside still names the class.
          frames.push({ owner: className, scope: symName, containerLine: line })
          break
        }

        case "class_property_definition": {
          const varNode = findFirstChild(node, "variable")
          if (!varNode) break
          const line = varNode.startPosition.row + 1
          const attrText = this.classAttributeTexts(node)
          const className = top().owner
          const name = stripDollar(varNode.text)
          const declared = typeSpecText(node)
          declareSymbol(name, ASTEngine.SymbolKind.Property, varNode, line, {
            isStatic: attrText.includes("static"),
            isHidden: attrText.includes("hidden"),
            type: declared || "untyped",
            docstring: this.docstringAbove(varNode.startPosition.row, lines),
          })
          if (classMembers.has(className)) classMembers.get(className)!.add(name)
          // A CLASS-typed member is a type reference, and in PowerShell classes
          // it is how two classes in one file refer to each other:
          // `[EventMessage] $EventMessage` is the only edge between them. The
          // pre-wave lane read the type only into the symbol's `type` metadata
          // — which pool-worker.ts DROPS at the worker boundary — so the
          // reference was invisible in the graph on both sides. Measured on the
          // production draw: `ResxGen.psm1` declares `class EventEntry` with
          // `[EventMessage] $EventMessage` and no edge joined them.
          if (declared && !isTypeAccelerator(declared)) {
            addRel(className, declared, ASTEngine.RelationshipType.Uses, 0.8, line, {
              powershellSpecific: true, isTypeReference: true, viaMemberType: name,
            })
          }
          break
        }

        // ----------------------------------------------------- assignments
        case "assignment_expression": {
          const left = findFirstChild(node, "left_assignment_expression")
          // F9: a COMPOUND assignment reads its left side. `$m += 1` is a read of
          // `$m` and a write to it; the write is the declaration, and the read was
          // published nowhere, so the same variable that `$m = 1` declares had a use
          // the graph could not see. The operator is what decides it: `=` writes only,
          // and every `+=`/`-=`/`*=`/`/=`/`%=` reads first. Reading the operator's
          // own text is what keeps the plain assignment from gaining a read edge it
          // does not have — the distinction is the whole point and is pinned by the
          // fixture's two rows on the same construct.
          if (left) {
            const op = findFirstChild(node, "assignement_operator")
            const opText = op ? op.text.trim() : "="
            if (opText.length > 1) {
              // `findDescendantVariable`, not a depth guess: the left side of an
              // assignment sits at the BOTTOM of the expression ladder
              // (left_assignment_expression > logical > bitwise > comparison >
              // additive > multiplicative > format > range > array_literal >
              // unary > variable — eleven levels), and the neighbouring member-write
              // search uses depth 14 for the same reason. The helper is the one the
              // declaration path already uses, so the read and the declaration cannot
              // drift apart on a different depth constant.
              const lhsVar = findDescendantVariable(left)
              if (lhsVar) {
                const lname = stripDollar(lhsVar.text.trim())
                if (isPlausibleSymbolName(lname) && !isQualified(lhsVar.text) && !isAutomatic(lname)) {
                  addRel(top().scope, lname, ASTEngine.RelationshipType.Uses, 0.9, lhsVar.startPosition.row + 1, {
                    powershellSpecific: true,
                    isVariableReference: true,
                    isCompoundAssignmentRead: true,
                    assignmentOperator: opText,
                  })
                }
              }
            }
          }
          if (left) {
            // PS9 — a member WRITE (`$this.Name = …`, `$cfg.Retries = 3`) is a
            // use of the member, at the member's own line. The pre-wave lane
            // emitted no edge for it, so a property's only appearance in the
            // graph was its declaration.
            //
            // The member is NOT a direct child: `left_assignment_expression`
            // wraps it under the operator ladder
            // (`logical > bitwise > comparison > additive > multiplicative >
            // format > range > array_literal > unary > member_access`), so a
            // direct-child lookup finds nothing. Tested FIRST, because the same
            // subtree also contains the `$this` variable — taking the variable
            // branch first made the member write unreachable, and that ordering
            // bug is what kept `$this.Name = $x` edge-free even after PS9.
            // Depth 14: the LHS is `left_assignment_expression > logical > bitwise
            // > comparison > additive > multiplicative > format > range >
            // array_literal > unary > member_access` — 11 hops — plus headroom.
            const memberAccess = findDescendant(left, "member_access", 14)
            if (memberAccess) {
              emitMemberUses(memberAccess, "write")
              break
            }
            const varNode = findDescendantVariable(left)
            if (varNode && !isQualified(varNode.text)) {
              const line = varNode.startPosition.row + 1
              // PS8 — a suppressed name (an automatic variable) is not a
              // declaration, so it must not become a contained child either.
              // `$this.Name = $x` was publishing `contains Class -> this`.
              declareSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, line, { isVariable: true })
            }
          }
          break
        }

        // --------------------------------------------------------- foreach
        case "foreach_statement": {
          const varNode = findFirstChild(node, "variable")
          if (varNode && !isQualified(varNode.text)) {
            const line = varNode.startPosition.row + 1
            declareSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, line, { isLoopVariable: true })
          }
          break
        }

        // ------------------------------------------- typed declarations (PS12)
        case "cast_expression": {
          // `[int]$x`, `[string]$label`, `[ValidateSet('a')]$mode` — a TYPED
          // DECLARATION. Measured shapes:
          //   `[string]$label`      → unary_expression > expression_with_unary_operator
          //                            > cast_expression > (type_literal, unary > variable)
          //   `[int]$x = 0`         → the same, under `left_assignment_expression`
          // so the `type_literal` and the `variable` are children of
          // `cast_expression`, not of the `expression_with_unary_operator` the
          // pre-wave lane read — and reading them there found nothing, so a
          // typed declaration published no symbol at all.
          //
          // `[ValidateSet('a')]$mode = 'a'` — an attribute WITH arguments — puts
          // an ERROR node in the assignment, and the variable is recovered from
          // outside it. That is a grammar limitation, recorded in the F9 spec;
          // the declaration is still published, which is the honest outcome.
          const typeLit = findFirstChild(node, "type_literal")
          const target = findFirstChild(node, "unary_expression")
          const varNode = target ? findFirstChild(target, "variable") : null
          if (!varNode || isQualified(varNode.text)) break
          const line = varNode.startPosition.row + 1
          const declared = typeSpecText(node)
          declareSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, line, {
            isVariable: true,
            isTypedDeclaration: true,
            type: declared || "untyped",
            ...(this.allAttributeTexts(node).length > 0 ? { annotations: this.allAttributeTexts(node) } : {}),
          })
          if (declared && !isTypeAccelerator(declared)) {
            addRel(top().scope, declared, ASTEngine.RelationshipType.Uses, 0.8, line, {
              powershellSpecific: true, isTypeReference: true,
            })
          }
          break
        }

        case "unary_expression":
        case "expression_with_unary_operator": {
          // `[int]$x = …`, `[ValidateSet('a')]$x` and `[int]$x` as a bare
          // statement. `cast_expression` is a name the grammar actually has; the
          // pre-wave lane named neither it nor the typed-declaration shape, so a
          // typed declaration with no assignment published nothing.
          //
          // This previously guarded on `inner.type === "attributed_variable"`,
          // under a comment asserting that was "the grammar's own name". It is
          // not: the grammar's 410 node types contain no `attributed_variable`
          // (it has `attribute`, `attribute_argument`, `class_attribute`,
          // `variable`, `braced_variable`), so the branch could never fire and the
          // comment recorded a false fact about the grammar. The guard is removed
          // rather than registered — M14.0.F1 exists to find exactly this, and
          // allowing-listing an invented node type would let any of them be
          // blessed. Removal is behaviour-preserving: the branch never matched.
          const typeLit = findFirstChild(node, "type_literal")
          const varNode = findFirstChild(node, "variable")
          if (!typeLit || !varNode || isQualified(varNode.text)) break
          const line = varNode.startPosition.row + 1
          const declared = typeSpecText(node)
          declareSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, line, {
            isVariable: true,
            type: declared || "untyped",
          })
          if (declared && !TYPE_ACCELERATORS.has(declared)) {
            addRel(top().scope, declared, ASTEngine.RelationshipType.Uses, 0.8, line, {
              powershellSpecific: true, isTypeReference: true,
            })
          }
          break
        }

        // ------------------------------------------------- hashtable (PS15)
        case "hash_entry": {
          // `@{ Retries = 3; Nested = @{ C = 2 } }` — the most idiomatic
          // PowerShell data structure. The pre-wave lane named neither
          // `hash_entry` nor `key_expression`, so 711 keys in the production
          // draw published no symbol and no edge. A key declares a named slot.
          const keyNode = findFirstChild(node, "key_expression")
          if (!keyNode) break
          const keyName = keyNode.text
          if (!keyName || keyName.includes("$") || keyName.includes(" ")) break
          const line = keyNode.startPosition.row + 1
          declareSymbol(keyName, ASTEngine.SymbolKind.Property, keyNode, line, {
            isHashtableKey: true, type: "untyped",
          })
          break
        }

        // ------------------------------------------------ member reads (PS9)
        case "member_access": {
          // `$obj.Prop` is a READ. The pre-wave lane's `case` for this node had
          // `break` as its entire body, so the language emitted ZERO `uses`
          // edges — the #740 kotlin class, in a second language.
          emitMemberUses(node, "read")
          break
        }

        case "element_access": {
          // `$h['Retries']`, `$a[0]`, `$matrix[$i][$j]`. A constant key names a
          // slot; a variable key is a read of that variable.
          //
          // The index expression is NOT `namedChild(1)`. Measured shape:
          // `element_access` has direct children `[variable, logical_expression]`
          // and the key sits at the BOTTOM of the operator ladder —
          // `logical > bitwise > comparison > additive > multiplicative > format
          // > range > array_literal > unary > (string_literal | variable |
          // integer_literal)` — nine hops down. The direct-child read found a
          // `logical_expression`, matched neither branch, and emitted NOTHING:
          // `$settings['Label']` and `$names[$index]` published no `uses` edge
          // at all while the hashtable key `Label` and the variable `index` were
          // both declared in the same file. Depth 12 covers the ladder with
          // headroom; `$m[0][1]`'s OUTER access holds the inner `element_access`
          // as its key, and the inner one is visited on its own, so both indices
          // are read exactly once each.
          // The search starts at the SECOND direct child. Started at `node`, the
          // first `variable` it found was the RECEIVER (`$names` in
          // `$names[$index]` sits one hop away, the key nine), so the edge read
          // `$names` indexing itself — a real, resolvable, meaningless row. The
          // measured shape puts the key's ladder under `namedChild(1)`.
          const keyRoot = node.namedChildCount > 1 ? node.namedChild(1) : null
          if (!keyRoot) break
          const idx = findDescendant(keyRoot, "string_literal", 12)
            ?? findDescendant(keyRoot, "variable", 12)
            ?? findDescendant(keyRoot, "integer_literal", 12)
            ?? findDescendant(keyRoot, "real_literal", 12)
          if (!idx) break
          const idxLine = idx.startPosition.row + 1
          if (idx.type === "string_literal") {
            const key = this.stripQuotes(idx.text)
            if (key && !key.includes("$")) {
              addRel(top().scope, key, ASTEngine.RelationshipType.Uses, 0.8, idxLine, {
                powershellSpecific: true, isElementAccess: true, isConstantKey: true,
              })
            }
          } else if (idx.type === "variable") {
            addRel(top().scope, stripDollar(idx.text), ASTEngine.RelationshipType.Uses, 0.9, idxLine, {
              powershellSpecific: true, isElementAccess: true, isVariableReference: true,
            })
          } else if (idx.type === "integer_literal" || idx.type === "real_literal") {
            // A numeric index is a read of an element, not of a name: there is no
            // symbol to point at, so the honest record is the site itself. The
            // SOURCE is still recorded, which is what makes "who indexes" a
            // answerable question.
            addRel(top().scope, idx.text, ASTEngine.RelationshipType.Uses, 0.7, idxLine, {
              powershellSpecific: true, isElementAccess: true, isNumericIndex: true,
            })
          }
          break
        }

        // ------------------------------- interpolation (PS16, the groovy G7)
        case "sub_expression": {
          // `$($name.ToUpper())` inside a double-quoted string. The pre-wave
          // lane never named `sub_expression`, so every interpolated
          // subexpression contributed no read — 283 sites in the production
          // draw. This is verbatim the class
          // `reviews/m49-groovy-gstring-interpolation.md` found in groovy
          // ("parse-clean, line-clean, oracle-clean and GRAPH-INCOMPLETE —
          // which is why every gate in the repo is green on it"), reproduced in
          // a second language.
          const inner = node.namedChildCount > 0 ? node.namedChild(0) : null
          if (inner) emitVariableReads(inner)
          break
        }

        case "expandable_string_literal": {
          // `"Hello $name"` — a bare interpolated variable. PS16's simpler
          // half; the subexpression case above is the nested one.
          emitVariableReads(node)
          break
        }

        // F9: an INCREMENT or DECREMENT reads its operand. `$n++` / `++$n` are the
        // one remaining place a variable is read and nothing was published — the F9
        // audit found these four types in the "the analyzer never names it" set, and
        // probing them confirmed all four emit nothing at all, so `$n++` left the
        // graph with `contains -> n` and no read.
        //
        // A `uses` is the right edge and not a weaker one: the operand is genuinely
        // read, and the WRITE half has no edge in this lane's model because a write to
        // a local is not a fact the graph can express (a member write can, which is
        // what `isMemberWrite` is for). The metadata says which operation it was so a
        // reader is not left guessing, and so a fixture can pin the distinction.
        case "post_increment_expression":
        case "post_decrement_expression":
        case "pre_increment_expression":
        case "pre_decrement_expression": {
          // A DESCENDANT search, not a direct child, and the reason is the prefix
          // forms: `++$n` nests its operand as
          // `pre_increment_expression > unary_expression > variable`, while `$n++`
          // puts it directly under the increment node. A direct-child lookup found the
          // postfix pair and silently missed the prefix pair — the same shape of
          // miss as `sub_expression` (PS16) and `left_assignment_expression` (PS2),
          // both of which this lane has already been bitten by.
          const operand = findDescendant(node, "variable", 6)
          if (operand) {
            const name = stripDollar(operand.text.trim())
            if (isPlausibleSymbolName(name) && !isQualified(operand.text) && !isAutomatic(name)) {
              addRel(top().scope, name, ASTEngine.RelationshipType.Uses, 0.9, operand.startPosition.row + 1, {
                powershellSpecific: true,
                isVariableReference: true,
                isCounterUpdate: true,
                isPostfix: node.type.startsWith("post_"),
              })
            }
          }
          break
        }

        case "expandable_here_string_literal": {
          // F9: a HERE-STRING interpolates exactly as a double-quoted string does,
          // and this node type was simply not in the switch — so `@"… $name …"@`
          // published no read at all while the identical text in `"… $name …"` did.
          // It is a distinct node type from `expandable_string_literal`, which is why
          // the existing case could not have caught it: the grammar parses
          // `variable [6,8]-[7,8]` for a here-string's `$message`, a span that starts
          // at the END of the previous line, and the read pass now trims that and
          // skips the leading break when it stamps the line. The marker makes this
          // read independently revertible: without it an argument read and a
          // here-string read are the same row shape, so a mutant for either would
          // silently revert both.
          emitVariableReads(node, false, "isHereStringInterpolation")
          break
        }

        // ---------------------------------------- invocation (PS17/PS18/PS19)
        case "invokation_expression": {
          const typeLit = findFirstChild(node, "type_literal")
          const member = findFirstChild(node, "member_name")
          const line = (member ?? typeLit ?? node).startPosition.row + 1
          if (typeLit) {
            const typeName = typeSpecText(node) || this.stripBrackets(typeLit.text)
            if (!typeName) break
            const memberName = member?.text ?? ""
            if (memberName === "new") {
              addRel(top().scope, typeName, ASTEngine.RelationshipType.Instantiates, 0.9, line, {
                powershellSpecific: true, dotNetNew: true,
              })
            } else if (memberName) {
              addRel(top().scope, `${typeName}::${memberName}`, ASTEngine.RelationshipType.Calls, 0.8, line, {
                powershellSpecific: true, staticMemberCall: true,
              })
            }
            break
          }
          // `$obj.Method(…)` — object method invocation. PS3: sourced from the
          // METHOD, not the class.
          const receiver = findFirstChild(node, "variable")
          if (member) {
            // F9: a DYNAMIC method target — `$type::$method()` — has a `$`-prefixed
            // member, and publishing it as a `calls` edge wrote the sigil into the
            // target: `calls -> $method`, a name no symbol can have, measured on the
            // same ConstrainedLanguageRestriction.Tests.ps1 line as the residue
            // above. A `$`-prefixed member is not a method name at all — it is a
            // VARIABLE holding one — so it is published as a `uses` of that variable,
            // which is what the source says.
            const dynamicTarget = member.text.length > 0 && member.text.charCodeAt(0) === 36 /* $ */
            if (dynamicTarget) {
              const dynName = stripDollar(member.text)
              if (isPlausibleSymbolName(dynName)) {
                addRel(top().scope, dynName, ASTEngine.RelationshipType.Uses, 0.9, member.startPosition.row + 1, {
                  powershellSpecific: true, isDynamicMethodTarget: true, isVariableReference: true,
                })
              }
              break
            }
            addRel(top().scope, member.text, ASTEngine.RelationshipType.Calls, 0.6, line, {
              powershellSpecific: true, methodCall: true,
              on: receiver ? stripDollar(receiver.text) : "",
            })
            if (receiver) {
              const name = stripDollar(receiver.text)
              if (name && !isQualified(receiver.text) && !isAutomatic(name)) {
                addRel(top().scope, name, ASTEngine.RelationshipType.Uses, 0.9, receiver.startPosition.row + 1, {
                  powershellSpecific: true, isReceiverReference: true, isVariableReference: true,
                })
              }
            }
          }
          break
        }

        // ------------------------------------------------------- commands
        case "command": {
          // PS6 — nothing is emitted from a recovery region.
          if (this.withinRecovery(node)) break

          const cmdName = commandNameOf(node)
          if (!cmdName) break
          const leaf = cmdName.includes("::") ? cmdName.slice(cmdName.lastIndexOf("::") + 2) : cmdName
          const lowerLeaf = leaf.toLowerCase()
          const nameLine = (findFirstChild(node, "command_name") ?? node).startPosition.row + 1

          // PS-A2 — a class INTERFACE declaration. `interface IShape { … }` is a
          // PowerShell 5.0 construct the GRAMMAR does not model at all: it parses as
          // a plain `command` named `interface`. Two consequences, and the second is
          // the worse one. (1) The analyzer published `calls -> interface` — a
          // language keyword promoted to a call edge, which is the PS5 defect class
          // reached through a grammar gap rather than a missing guard, and the reason
          // `interface` is missing from LANGUAGE_KEYWORD_COMMANDS while its siblings
          // `class` and `enum` are both present. (2) `IShape` was never DECLARED, so
          // every `implements` edge pointed at a target no symbol could ever have —
          // a permanently dangling row the store cannot resolve. Authoring the
          // fixture that pins `implements` is what found this: the type had zero
          // fixture rows and zero mutants, so the path was live and unguarded.
          //
          // The GRAMMAR can fix it, and that version was built, measured and
          // REJECTED. An `interface_statement` rule plus an optional method body
          // reshaped 491 of 550 clean corpus files — making a body optional in a hot
          // rule shifts global tie-breaking, and the visible symptom was zero-width
          // `command_argument_sep` nodes appearing throughout otherwise-untouched
          // files. Removing the `reserved()` wrapper did not help (491 either way), so
          // the cost is the optional, not the keyword. This branch is therefore keyed
          // on STRUCTURE, the same way the DSC branch below is: the keyword as command
          // name, plus a first positional argument, plus a script block. The tree is
          // unchanged from G9, so F11's G2 gate has nothing to object to.
          if (lowerLeaf === "interface") {
            const ifaceElements = findFirstChild(node, "command_elements")
            const ifaceBlock = ifaceElements ? findDescendant(ifaceElements, "script_block_expression") : null
            const ifaceName = ifaceElements
              ? this.collectChildrenByType(ifaceElements, "generic_token")[0] ?? null
              : null
            if (ifaceBlock && ifaceName) {
              const ifaceLine = ifaceName.startPosition.row + 1
              declareSymbol(ifaceName.text, ASTEngine.SymbolKind.Interface, ifaceName, ifaceLine, {
                powershellSpecific: true,
                docstring: this.docstringAbove(ifaceName.startPosition.row, lines),
              })
              interfaceBlocks.add(nodeKey(node))
              frames.push({ owner: ifaceName.text, scope: ifaceName.text, containerLine: ifaceLine })
            }
            break
          }

          // PS5 — a reserved word is not a command. The named blocks come first
          // because the grammar models them as `command` nodes; the keyword set
          // second; DSC's own constructs are handled by the block branch below,
          // which is structural rather than a name list.
          if (NAMED_BLOCK_KEYWORDS.has(lowerLeaf)) break
          if (FLOW_KEYWORDS.has(lowerLeaf)) break
          if (LANGUAGE_KEYWORD_COMMANDS.has(lowerLeaf)) break

          // PS5 (c) — DESIRED STATE CONFIGURATION. The grammar has NO marker for
          // a configuration: `Configuration X { … }` is a plain `command` with a
          // script-block argument, byte-for-byte the shape of any cmdlet taking
          // a script block. What IS derivable is the structure INSIDE:
          //
          //   Configuration SiteConfig { … }      keyword + name + block
          //     node 'localhost' { … }            keyword + arg + block
          //       File Marker { … }               RESOURCE TYPE + name + block
          //         Destination = 'x'             PROPERTY = value
          //
          // So the discriminator is a `command` that carries a
          // `script_block_expression` (a block declaration) or whose first
          // positional argument is the `=` token (a property assignment) — both
          // read off the grammar, neither from a list of DSC resource names.
          // The measured pre-wave residue was 3 fabricated edges in this one
          // fixture (`File`, `Destination`, `Ensure`) and 6 keyword-named edges
          // in the corpus; before the fix, 4 of 4 relationships in a
          // representative DSC file were fabrications.
          // The block argument is NOT a direct child of `command_elements`: the
          // grammar wraps it as `command_argument_sep`/`generic_token` then
          // `array_literal_expression > unary_expression > script_block_expression`.
          // A direct-child lookup returns null and the whole DSC branch is dead
          // — which is exactly what the first run of this fixture measured
          // (4 of 4 DSC relationships were still fabrications).
          const elements = findFirstChild(node, "command_elements")
          const blockArg = elements ? findDescendant(elements, "script_block_expression") : null
          // The first POSITIONAL argument, skipping the separators.
          const firstToken = elements
            ? this.collectChildrenByType(elements, "generic_token")[0] ?? null
            : null
          const isAssignmentForm = !!firstToken && firstToken.text === "="

          if (DSC_KEYWORDS.has(lowerLeaf) && blockArg) {
            // `Configuration`/`node` — the keyword itself names no resource, but
            // the configuration's own NAME is a real declaration.
            const declared = elements && elements.namedChildCount > 1 ? elements.namedChild(1) : null
            if (lowerLeaf === "configuration" && declared && declared.type === "generic_token") {
              const line = declared.startPosition.row + 1
              declareSymbol(declared.text, ASTEngine.SymbolKind.Class, declared, line, { isDscConfiguration: true })
              dscDepth++
              dscBlocks.add(nodeKey(node))
              dscOwner.set(nodeKey(node), declared.text)
              frames.push({ owner: declared.text, scope: declared.text, containerLine: line })
            }
            break
          }

          if (dscDepth > 0) {
            if (blockArg && firstToken && firstToken.type === "generic_token") {
              // A DSC RESOURCE declaration: `File Marker { … }`. The resource
              // type is a DSC built-in the engine resolves, so it is not a
              // cmdlet call; the instance NAME is a real declaration.
              const line = firstToken.startPosition.row + 1
              declareSymbol(firstToken.text, ASTEngine.SymbolKind.Class, firstToken, line, {
                isDscResource: true, dscResourceType: leaf,
              })
              dscDepth++
              dscBlocks.add(nodeKey(node))
              dscOwner.set(nodeKey(node), firstToken.text)
              frames.push({ owner: firstToken.text, scope: firstToken.text, containerLine: line })
              break
            }
            if (isAssignmentForm) {
              // A DSC PROPERTY assignment: `Destination = 'x'`. The property is
              // a declared slot on the resource, and the value is a literal.
              declareSymbol(leaf, ASTEngine.SymbolKind.Property, node, nameLine, { isDscProperty: true })
              break
            }
            // Anything else inside a configuration is part of the DSC engine's
            // own evaluation (a `if` inside a resource, a `dependsOn`, a
            // script expression) and is not a cmdlet call.
            break
          }

          // PS19 — the invocation operator: `. ./lib.ps1`, `& ./run.ps1`,
          // `& $sb`. The target is a PATH when it is one and a VARIABLE when it
          // is one; the pre-wave lane wrote the raw text, so `& $sb` published a
          // `calls` edge whose target was the string `$sb` — a name no symbol
          // can have, since a variable is stored stripped.
          const op = findFirstChild(node, "command_invokation_operator")
          if (op) {
            // M60 (#278): the target may be a QUOTED path, and the quotes are not
            // part of the name. Unquote first, then dispatch.
            //
            // The ORDER of the two tests was also wrong, and unquoting alone does not
            // fix it. The `$` test ran first, so a quoted path like
            // `. "$PSScriptRoot\tools\x.ps1"` was classified as an invoked VARIABLE
            // and the path reading was never reached — and the unquoted text still
            // starts with `$`. A path-shape test FIRST is correct for both:
            // `$PSScriptRoot\tools\x.ps1` contains a separator so it is a path, while a
            // bare `$sb` has no separator and no extension, so it still takes the
            // variable reading. Controls for both are asserted.
            const target = unquoteTarget(leaf)
            if (looksLikeModulePath(target)) {
              addRel(top().scope, target, ASTEngine.RelationshipType.Calls, 0.9, nameLine, {
                powershellSpecific: true, invokationOperator: op.text,
              })
            } else if (target.startsWith("$")) {
              // F9: guard the name. `$type::$method()` leaves the command-name node
              // holding `$method()` plus the rest of the recovered line, so the
              // stripped text was `method()\n                }` — published as a
              // `uses` target that no symbol can have, on
              // ConstrainedLanguageRestriction.Tests.ps1:513. Found by the
              // line-level check, the last of its residue at 100.00% justified.
              const invoked = stripDollar(target)
              if (isPlausibleSymbolName(invoked)) {
                addRel(top().scope, invoked, ASTEngine.RelationshipType.Uses, 0.9, nameLine, {
                  powershellSpecific: true, isInvokedVariable: true, isVariableReference: true,
                })
              }
            }
            break
          }

          detectFrameworks(leaf)

          // PS7 — imports.
          if (leaf === "Import-Module" || leaf === "ipmo") {
            for (const arg of commandArgs(node)) {
              if (SWITCH_ARGUMENT_VALUES.has(arg.toLowerCase())) continue
              addImport(arg, leaf, nameLine, node)
            }
            break
          }

          // PS18 — `New-Object -TypeName X` is THE PowerShell instantiation
          // form and the pre-wave lane emitted no `instantiates` edge for it.
          // `New-Object` is a CONSTRUCTOR CALL, and PowerShell spells the thing
          // being constructed two ways: `-TypeName <managed type>` and
          // `-ComObject <ProgID>`. Only the first was read, so the second produced
          // NO EDGE AT ALL — not a wrong edge, none. Found by hand-auditing the F5
          // differential's MISSING samples, where `instantiates Extract-ZipLegacy ->
          // Shell.Application` appears on ansible's own Windows modules, and
          // confirmed in isolation: `New-Object -ComObject Shell.Application`
          // published neither a call nor an instantiation.
          //
          // `-ComObject` is not a rarer spelling of `-TypeName`, it is the ONLY
          // spelling for a COM object, and `$shell = New-Object -ComObject
          // Shell.Application` is how the language gets a Shell handle. The COM
          // ProgID is a dotted name, so its target is external by nature — which is
          // the designed handling for a name the file does not declare, the same as
          // a cmdlet name.
          if (leaf === "New-Object") {
            // THREE spellings, and the first version of this fix read one of them
            // for the wrong reason — it keyed `isComObject` on the constructed name
            // containing a dot, so `-TypeName System.Text.StringBuilder` was
            // published as a COM object. The flag decides the kind, never the
            // spelling of the type: a dotted .NET name and a COM ProgID look alike
            // and mean different things. Caught by the fixture's two metadata rows
            // before it was committed.
            const comObject = this.parameterValue(node, "ComObject") ?? this.parameterValue(node, "comobject")
            const typeName = this.parameterValue(node, "TypeName") ?? this.parameterValue(node, "typename")
            // The POSITIONAL form: `New-Object System.Collections.ArrayList` and
            // `New-Object System.Version`, which is how the cmdlet is written
            // whenever the author did not bother with a flag. `commandArgs` returns
            // values only, having already skipped every `command_parameter`, so the
            // first entry is the positional type name and the flagged forms leave it
            // empty.
            const positional = commandArgs(node)[0]
            const constructed = comObject ?? typeName ?? positional
            if (constructed && !isTypeAccelerator(constructed)) {
              addRel(top().scope, constructed, ASTEngine.RelationshipType.Instantiates, 0.9, nameLine, {
                powershellSpecific: true,
                viaNewObject: true,
                ...(comObject ? { isComObject: true } : {}),
              })
            }
            break
          }

          // PS20 — `Export-ModuleMember -Function F`.
          //
          // G6 (M60 #278): a flag's value is a LIST, not one token. The reader used
          // to take `valueAfterNode(elements, i)` — the single next named child —
          // which is correct for `-Function F` and silently drops every name after
          // the first in `-Function A, B`. That never showed, because the grammar
          // could not parse a comma-separated command argument at all, so the only
          // way this line reached the reader before the G6 grammar patch was as
          // ERROR-recovery text and the recovery path emitted BOTH names by
          // accident. The moment the line parses correctly the latent gap is
          // visible: on powershell/test/perf/perf.psm1:207
          // (`Export-ModuleMember -Function 'Start-Benchmarking', 'Compare-BenchmarkResult'`)
          // the wired grammar reported two exports and the corrected grammar
          // reported one. A patch that fixes 28 files and adds 243 edges should not
          // quietly cost a real module-surface edge, so the reader now walks to the
          // next flag instead of taking one token, and also accepts a bare
          // `string_literal` / `generic_token` child, which is what a value after a
          // comma is in the new tree.
          if (leaf === "Export-ModuleMember") {
            const elements = findFirstChild(node, "command_elements")
            if (elements) {
              const isFlag = (t: string) => t === "function" || t === "cmdlet" || t === "variable" || t === "alias"
              for (let i = 0; i < elements.namedChildCount; i++) {
                const c = elements.namedChild(i)
                if (!c) continue
                if (c.type === "command_parameter") {
                  const flag = stripLeadingDash(stripDollar(c.text)).toLowerCase()
                  if (!isFlag(flag)) continue
                  // Walk the whole value list, stopping at the next flag.
                  for (let j = i + 1; j < elements.namedChildCount; j++) {
                    const v = elements.namedChild(j)
                    if (!v) break
                    if (v.type === "command_parameter") break
                    if (v.type === "command_argument_sep") continue
                    if (v.type === "generic_token" || v.type === "string_literal" || v.type === "expandable_string_literal") {
                      addExport(this.stripQuotes(v.text), leaf, v.startPosition.row + 1)
                    } else {
                      for (const t of this.literalTokens(v)) addExport(t, leaf, v.startPosition.row + 1)
                    }
                  }
                  continue
                }
                if (
                  c.type === "array_literal_expression" ||
                  c.type === "unary_expression" ||
                  c.type === "command_argument_sep" ||
                  c.type === "string_literal" ||
                  c.type === "generic_token"
                ) {
                  for (const t of this.literalTokens(c)) addExport(t, leaf, c.startPosition.row + 1)
                }
              }
            }
            break
          }

          // PS21 — the `using` directives, which are STATEMENTS, not calls.
  // `using` was listed in `FLOW_KEYWORDS`, which is where the pre-wave lane
  // filtered it — so `using namespace System.IO` and `using module ./h.psm1`
  // published nothing at all: not an import, and not even the (wrong) call edge.
  // The keyword is handled HERE instead, and removed from the flow set, so the
  // branch is reachable.
          if (lowerLeaf === "using") {
            const args = commandArgs(node)
            if (args.length >= 2) {
              const directive = args[0].toLowerCase()
              addImport(args[1], directive === "namespace" ? "using namespace" : "using module", nameLine, node)
            }
            break
          }

          // F9 (M60 #278): a bare VARIABLE passed as a command argument is a USE,
          // and it was emitting nothing. Measured on a probe: `$a = 1` then
          // `Write-Host $a` published `calls -> Write-Host` and no `uses -> a` at
          // all — so every variable handed to a cmdlet was invisible in the graph,
          // while the same variable interpolated in a string was read. Passing a
          // variable to a cmdlet is one of the commonest things PowerShell does.
          //
          // Read from `command_elements` rather than the whole `command` node, and
          // with `skipBlocks`, so a nested script block's locals stay with the block
          // that declares them. `addRel` dedupes on source|type|target|line, so a
          // variable that is also interpolated on the same line is published once.
          const argElements = findFirstChild(node, "command_elements")
          if (argElements) emitVariableReads(argElements, true, "isArgumentReference")
          addRel(top().scope, leaf, ASTEngine.RelationshipType.Calls, leaf.includes("-") ? 0.9 : 0.6, nameLine, {
            powershellSpecific: true,
          })
          break
        }

        // ------------------------------------------------------- comments
        case "comment": {
          // PS22 — `#requires`. The pre-wave lane read `-Module` only, so the
          // commonest form — `#requires -Version 7.0` — published nothing and a
          // module's declared minimum runtime was invisible.
          const text = node.text
          if (text.startsWith("#requires") || text.startsWith("#Requires")) {
            const line = node.startPosition.row + 1
            const moduleNames = this.extractRequiresModules(text)
            for (const m of moduleNames) addImport(m.name, m.via, line, node)
            const version = this.extractRequiresValue(text, "version")
            if (version) {
              addRel(top().scope, version, ASTEngine.RelationshipType.References, 0.9, line, {
                powershellSpecific: true, requiresVersion: true, fileLevel: atFileScope(),
              })
            }
          }
          break
        }
      }

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) work.push({ node: child, exit: false })
      }
    }

    // ------------------------------------------------------------ overrides
    // Resolved AFTER the whole file is read, because a subclass may be declared
    // before its base. PowerShell class methods are virtual by default, so a
    // same-named member in a subclass IS an override.
    for (const cand of overrideCandidates) {
      let base = baseClassByClass.get(cand.className)
      let guard = 0
      while (base && guard++ < 8) {
        const inherited = classMembers.get(base)
        if (inherited && inherited.has(cand.memberName)) {
          addRel(cand.className, base, ASTEngine.RelationshipType.Overrides, 0.9, cand.line, {
            powershellSpecific: true, overridesMember: cand.memberName,
            // The one edge in this lane that is INFERRED rather than read: PowerShell
            // has no `override` keyword, so this is a name match between a subclass
            // member and the base's declared member set. Calling it `structural` would
            // overstate the evidence, and the tier is the whole point of emitting one.
            evidenceClass: "inferred",
          })
          break
        }
        base = baseClassByClass.get(base)
      }
    }

    const detectedPatterns = [...patterns]
    const detectedFrameworks = [...frameworks]

    return {
      language: "powershell",
      symbols,
      relationships,
      imports,
      exports,
      errors: [], // engine-owned syntax errors (engine.ts merges treeErrors)
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: lines.length,
        cyclomaticComplexity,
        framework: detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns: detectedPatterns.map((p) => ({
          framework: "PowerShell",
          patterns: [{ type: "usage", detected: true, description: p }],
        })),
        architecturalInsights: [],
        architecturalScore: Math.min(100, 60 + relationships.length),
        codeQuality: "Excellent",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "6.0-ps-file-owner-lines-scope-reads",
      },
    }
  }

  // ------------------------------------------------------------- helpers

  /** PS1 — the file's own basename, extension included. */
  private basenameOf(filePath: string): string {
    const normalized = filePath.split("\\").join("/")
    const base = normalized.slice(normalized.lastIndexOf("/") + 1)
    return base.length > 0 ? base : "script.ps1"
  }

  private lineRange(line: number): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: line, startColumn: 1, endLine: line, endColumn: 1,
      startIndex: 0, endIndex: 0,
    }
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private collectChildrenByType(node: Node, type: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) results.push(child)
    }
    return results
  }

  private stripQuotes(text: string): string {
    if (text.length >= 2) {
      const first = text.charCodeAt(0)
      const last = text.charCodeAt(text.length - 1)
      if ((first === 34 || first === 39) && last === first) return text.slice(1, -1)
    }
    return text
  }

  private stripBrackets(text: string): string {
    if (text.length >= 2 && text.charCodeAt(0) === 91 && text.charCodeAt(text.length - 1) === 93) {
      return text.slice(1, -1)
    }
    return text
  }

  private findQuoted(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "string_literal" || child.type === "expandable_string_literal") return child
      const nested = this.findQuoted(child)
      if (nested) return nested
    }
    return null
  }

  /**
   * PS6 — is this node inside a recovery region? A `command` whose name lives
   * under an ERROR/MISSING node is recovery noise, not a call. bash BD5
   * established the rule; this lane needed it because its own
   * `if`-as-expression shape manufactures `command` nodes out of an ERROR
   * region with `hasError = false`.
   */
  private withinRecovery(node: Node): boolean {
    let n: Node | null = node.parent
    let depth = 0
    while (n && depth < 24) {
      if (n.type === "ERROR" || n.isMissing) return true
      n = n.parent
      depth++
    }
    return false
  }

  /** The value of a two-token parameter (`-TypeName Foo`) or `-Name:Foo`. */
  private parameterValue(node: Node, flag: string): string | null {
    const elements = this.findChildByType(node, "command_elements")
    if (!elements) return null
    const wanted = stripLeadingDash(flag).toLowerCase()
    for (let i = 0; i < elements.namedChildCount; i++) {
      const c = elements.namedChild(i)
      if (!c || c.type !== "command_parameter") continue
      if (stripLeadingDash(this.stripQuotes(c.text)).toLowerCase() !== wanted) continue
      const next = this.valueAfterNode(elements, i)
      if (next && (next.type === "generic_token" || next.type === "string_literal" || next.type === "expandable_string_literal")) {
        return this.stripQuotes(next.text)
      }
    }
    return null
  }

  /**
   * The value token that FOLLOWS the named child at `fromIndex`, skipping the
   * grammar's `command_argument_sep` separators.
   *
   * This is the whole of the two-token parameter form, and reading
   * `namedChild(i + 1)` instead is the whole bug: measured shape for
   * `Import-Module -Name SqlServer -ErrorAction SilentlyContinue` is
   * `[sep, command_parameter(-Name), sep, generic_token(SqlServer), sep,
   * command_parameter(-ErrorAction), sep, generic_token(SilentlyContinue)]`, so
   * the value sits at `i + 3`. Every `i + 1` read found a separator, matched no
   * branch, and read NO two-token parameter value anywhere in the language.
   * Also worth recording: this grammar gives `command_parameter` NO `argument`
   * field, so a probe for one could only ever return null.
   */
  private valueAfterNode(elements: Node, fromIndex: number): Node | null {
    for (let i = fromIndex + 1; i < elements.namedChildCount; i++) {
      const c = elements.namedChild(i)
      if (!c) continue
      if (c.type === "command_argument_sep") continue
      return c
    }
    return null
  }

  /** Every bare string/number token under a node, in source order. */
  private literalTokens(node: Node): string[] {
    const out: string[] = []
    const work: Node[] = [node]
    while (work.length > 0) {
      const n = work.pop()!
      if (n.type === "string_literal" || n.type === "expandable_string_literal" || n.type === "generic_token") {
        out.push(this.stripQuotes(n.text))
        continue
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) work.push(c)
      }
    }
    return out.reverse()
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private findParamList(node: Node): Node | null {
    const block = this.findChildByType(node, "script_block")
    if (block) {
      const paramBlock = this.findChildByType(block, "param_block")
      if (paramBlock) return this.findChildByType(paramBlock, "parameter_list")
    }
    return null
  }

  private findMethodParamList(node: Node): Node | null {
    const paramDecl = this.findChildByType(node, "class_method_parameter_list")
    if (!paramDecl) return null
    return this.findChildByType(paramDecl, "parameter_list") ?? paramDecl
  }

  private classAttributeTexts(node: Node): string[] {
    return this.collectChildrenByType(node, "class_attribute").map((a) => a.text.toLowerCase())
  }

  /**
   * PS11 — every attribute attached to a declaration, from BOTH places
   * PowerShell allows one: directly on the declaration, and on its `param_block`
   * (which is where `[CmdletBinding()]` and `[OutputType()]` actually sit).
   * Scoped to a parameter/attribute-list chain, so the `path` of a
   * `command_parameter` is never mistaken for a declaration attribute.
   */
  private allAttributeTexts(node: Node): string[] {
    const out: string[] = []
    for (const direct of this.collectChildrenByType(node, "attribute")) out.push(direct.text)
    // The `param_block` is under the `script_block`, not directly under the
    // declaration — `function_statement > script_block > param_block >
    // attribute_list`. A direct-child read found nothing, so `[CmdletBinding()]`
    // was still invisible after the first fix; this fixture caught it.
    const blocks = this.collectChildrenByType(node, "param_block")
    for (const sb of this.collectChildrenByType(node, "script_block")) {
      blocks.push(...this.collectChildrenByType(sb, "param_block"))
    }
    for (const block of blocks) {
      for (const list of this.collectChildrenByType(block, "attribute_list")) {
        for (const attr of this.collectChildrenByType(list, "attribute")) out.push(attr.text)
      }
    }
    for (const list of this.collectChildrenByType(node, "attribute_list")) {
      for (const attr of this.collectChildrenByType(list, "attribute")) out.push(attr.text)
    }
    return out
  }

  /** An `attribute_list`'s `attribute` children, as raw text. */
  private attributeTexts(node: Node): string[] | undefined {
    const lists = this.collectChildrenByType(node, "attribute_list")
    if (lists.length === 0) return undefined
    const texts: string[] = []
    for (const list of lists) {
      for (const attr of this.collectChildrenByType(list, "attribute")) texts.push(attr.text)
    }
    return texts.length > 0 ? texts : undefined
  }

  /**
   * PS23 — the comment-based help block immediately above a declaration. A
   * PowerShell function's documentation IS its `.SYNOPSIS`/`.DESCRIPTION`
   * comment block (`about_Comment_Based_Help`), and the pre-wave lane read no
   * comment but `#requires`, so `docstring` was `null` for every symbol in the
   * language. `row` is the 0-based row of the declaration's NAME.
   */
  private docstringAbove(row: number, lines: string[]): string | undefined {
    // Walk UP from the declaration's own line. The first version walked up but
    // then located a block comment's `<#` with `findIndex` from line 0, so it
    // found the FILE'S opening block rather than the declaration's; and it
    // treated a closing `#>` as a `#` comment line, which both invented a
    // docstring and kept the walk going. Measured on `payload-psb11.ps1`: the
    // function's `.SYNOPSIS` block was missed entirely and the FILE HEADER was
    // published as the function's documentation.
    let i = row - 1
    // ADJACENCY IS THE RULE, and it is the Javadoc/JSdoc rule: a blank line
    // between the comment and the declaration ends the association. The first
    // version skipped blank lines "if nothing collected yet", so it walked
    // through a blank line and up into a FILE BANNER — publishing
    // `payload-psb11.ps1`'s twenty-nine-line file header as the documentation of
    // the function that happened to be first. A file banner belongs to the
    // file, and the file symbol's docstring is where it belongs.
    if (i < 0 || lines[i] === undefined || lines[i].trim() === "") return undefined
    // 1. a block comment ending just above the declaration
    if (lines[i].trim().endsWith("#>")) {
      let open = -1
      for (let k = i; k >= 0; k--) {
        if (lines[k].includes("<#")) { open = k; break }
      }
      if (open < 0) return undefined
      const last = i
      const body = lines.slice(open, last + 1)
        .map((l, k) => (k === 0 ? stripOpenCommentDelim(l) : k === last - open ? stripCloseCommentDelim(l) : l))
        .join("\n")
        .trim()
      return body.length > 0 ? body : undefined
    }
    // 2. a contiguous run of `#` comment lines
    const collected: string[] = []
    while (i >= 0) {
      const raw = lines[i]
      if (raw === undefined) break
      const trimmed = raw.trim()
      if (trimmed === "" || !trimmed.startsWith("#") || trimmed.startsWith("#>")) break
      collected.unshift(trimmed)
      i--
    }
    if (collected.length === 0) return undefined
    const text = stripCommentMarkerRun(collected.join("\n")).trim()
    return text.length > 0 ? text : undefined
  }

  /**
   * PS24 — EVERY module name a `#requires -Module[s]` declares, which is not the
   * same question `extractRequiresValue` answers.
   *
   * The reader above stops at the first space, tab or comma, which is right for
   * `-Version 7.0` and wrong twice for a module list. Measured on the corpus's own
   * two files that use the hashtable form
   * (`ansible/.../win_app_control/files/{New-AnsiblePowerShellSignature,
   * Set-ManifestSignature}.ps1`, both carrying
   * `#Requires -Modules @{ ModuleName = 'OpenAuthenticode'; ModuleVersion = '0.5.0' }`):
   * the old reader returned the literal `@{` as the module name, so `imports[]` stored
   * a row whose `path` was `@{` and `addImport` published `imports`/`references` edges
   * to `@{`. Those edges died one stage later — `filterNoiseRelationships` in
   * `src/ast/pool-worker.ts` drops any target whose leaf contains `{` — which is why
   * the census reads `imports[] 552` against `imports 550`, and the two rows that
   * vanish are exactly these two files. A garbage edge killed by shared machinery is
   * still a garbage row already written, and the module it should have named
   * (`OpenAuthenticode`) is a dependency the file genuinely declares.
   *
   * The comma list is the second miss, and rarer than the hashtable:
   * `#requires -Modules Pester, PoshRSJob` names two modules and the old reader
   * returned `Pester` alone, because the loop stopped at the comma. Measured over the
   * 1,092-file admitted corpus: ONE occurrence of a comma-separated `#requires` module
   * list — `#Requires -Modules PSScriptAnalyzer, PSSA-PSCustomUseLiteralPath` at
   * `ansible/test/lib/ansible_test/_util/controller/sanity/pslint/pslint.ps1:2` — so
   * `PSSA-PSCustomUseLiteralPath` was a declared dependency this lane read and dropped.
   *
   * MEASURED DELTA, and the population it is measured over. Only a file carrying a
   * `#requires -Module(s)` directive can be affected, and 59 of the 1,092 admitted files
   * do, so those 59 are the whole population and the delta is exact rather than
   * sampled. Through production `parseFile`, before -> after: `imports[]` records
   * 101 -> 102, `imports` edges 99 -> 102, `references` edges 105 -> 108. The records /
   * edges gap of 2 that exists BEFORE the fix is the two `@{` rows: they were written
   * and then dropped by the pool-worker's brace rule, which is why the whole-corpus
   * census reads `imports[] 552` against `imports 550`.
   *
   * Zero regex, like the reader above, for the reason recorded there. Three shapes are
   * recognized and nothing else: a bare list, a comma-continued bare list, and a
   * hashtable whose `ModuleName` key names the module. A hashtable with no
   * `ModuleName` names no module and yields nothing — `@{ ModuleVersion = '1.0' }` is
   * not a module declaration, and returning the flag's value for it is how `@{`
   * reached `imports[]` in the first place.
   */
  private extractRequiresModules(text: string): Array<{ name: string; via: string }> {
    const names: Array<{ name: string; via: string }> = []
    const seen = new Set<string>()
    // The `via` a row carries is the SHAPE it was declared in, not just the keyword:
    // `requires_hashtable` and `requires_list` are different grammar — a hashtable's
    // name is inside `{ ModuleName = '…' }` and a list's is a bare token — and an edge
    // that does not record which one it came from cannot be told apart from the other
    // by anything downstream.
    let via = "requires_list"
    const lower = text.toLowerCase()
    const add = (raw: string): void => {
      const v = this.stripQuotes(raw.trim())
      if (v.length === 0 || seen.has(v)) return
      seen.add(v)
      names.push({ name: v, via })
    }
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "-") continue
      // The flag must be the WHOLE word: `-Module` is a prefix of `-Modules`, and a
      // longer flag that merely begins with it (`-ModulePath`) is a different flag.
      let j = i + 1
      while (isAsciiLetter(lower[j])) j++
      const flag = lower.slice(i + 1, j)
      if (flag !== "module" && flag !== "modules") continue
      while (text[j] === " " || text[j] === "\t") j++
      if (j >= text.length) break
      // The value is a LIST. Each element is a bare name or a module hashtable, and a
      // `,` continues it — PowerShell accepts `#requires -Modules @{…}, @{…}` and
      // `#requires -Modules A, @{ModuleName='B'}`, so the walk is over elements and
      // not over one token.
      for (;;) {
        if (text[j] === "@" && text[j + 1] === "{") {
          const ht = this.readHashtableModuleName(text, j + 1)
          via = "requires_hashtable"
          if (ht) add(ht)
          // Step past the hashtable's closing brace so neither a `,` nor a `;` inside
          // it can be read as the list separator.
          while (text[j] !== undefined && text[j] !== "}") j++
          if (text[j] === "}") j++
        } else {
          let end = j
          while (text[end] !== undefined && text[end] !== " " && text[end] !== "\t" && text[end] !== "," && text[end] !== ";") end++
          if (end > j) add(text.slice(j, end))
          j = end
        }
        while (text[j] === " " || text[j] === "\t") j++
        if (text[j] !== ",") break
        j++
        while (text[j] === " " || text[j] === "\t") j++
        if (j >= text.length) break
      }
      i = j - 1
    }
    return names
  }

  /**
   * PS24 — the `ModuleName` value inside a `#requires -Modules @{ … }` hashtable,
   * starting at the `{`. Char-scanned and brace-balanced with quote awareness, because
   * a `}` inside a quoted `ModuleVersion` must not close the hashtable.
   *
   * Returns null when the hashtable carries no `ModuleName` key. PowerShell's module
   * hashtable is `{ ModuleName = 'X'; ModuleVersion | RequiredVersion | GUID = … }`, so
   * the key is the only thing in it that names a module.
   */
  private readHashtableModuleName(text: string, openBrace: number): string | null {
    const lower = text.toLowerCase()
    let depth = 0
    let quote = ""
    for (let i = openBrace; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === quote) quote = ""
        continue
      }
      if (c === "'" || c === '"' || c === "`") { quote = c; continue }
      if (c === "{") { depth++; continue }
      if (c === "}") {
        depth--
        if (depth === 0) return null
        continue
      }
      if (depth !== 1) continue
      // A KEY is a bare identifier at the hashtable's top level, so the scan can read
      // one and compare it without knowing where the value ends.
      if (!isAsciiLetter(c) && c !== "_") continue
      let e = i
      while (isAsciiLetter(lower[e]) || lower[e] === "_") e++
      const key = lower.slice(i, e)
      let v = e
      while (text[v] === " " || text[v] === "\t") v++
      if (text[v] !== "=") { i = e - 1; continue }
      v++
      while (text[v] === " " || text[v] === "\t") v++
      // The VALUE ends at the `;` that separates hashtable entries, at the closing
      // brace, or at whitespace — and a quoted value may contain both `;` and `}`
      // without ending, so the scan is quote-aware for the same reason the brace
      // balance is. A value cut at a `;` inside quotes yields `'Semi`, which is a
      // garbage module name and worse than no name at all.
      let vend = v
      let vq = ""
      while (vend < text.length) {
        const vc = text[vend]
        if (vq) {
          if (vc === vq) vq = ""
          vend++
          continue
        }
        if (vc === "'" || vc === '"' || vc === "`") { vq = vc; vend++; continue }
        if (vc === ";" || vc === "}" || vc === " " || vc === "\t") break
        vend++
      }
      if (key === "modulename") {
        const val = this.stripQuotes(text.slice(v, vend))
        return val.length > 0 ? val : null
      }
      i = vend - 1
    }
    return null
  }

  /**
   * PS22 — a `#requires` value by name, char/index scanned. Comments are opaque
   * to the grammar, so this one place is text by necessity, and it is declared
   * as such here and in the M12 regex census (which records zero regex
   * usages for this lane: no `/…/` literal is used).
   */
  private extractRequiresValue(text: string, name: string): string | null {
    const lower = text.toLowerCase()
    const key = name.toLowerCase()
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "-") continue
      if (!lower.slice(i + 1).startsWith(key)) continue
      let j = i + 1 + name.length
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j++
      if (j >= text.length) return null
      let end = j
      while (end < text.length && text[end] !== " " && text[end] !== "\t" && text[end] !== ",") end++
      const value = this.stripQuotes(text.slice(j, end))
      return value.length > 0 ? value : null
    }
    return null
  }
}
