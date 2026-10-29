// PowerShell Intelligence Engine — Author: Muhammad Ishaq Khan
// What this file is: the pure-AST analyzer for PowerShell (.ps1/.psm1/.psd1, routed by
// src/ast/language-detection.ts); it produces the symbols and relationships the graph engine stores,
// and string logic runs only on AST-extracted values, never as a regex on source.
// Relationship types covered (eleven): calls, uses, contains, imports, references, exports, extends,
// implements, overrides, instantiates, part_of — per-type rulings and emission sites in
// script/m14/spec/powershell-completeness.json; lane doc docs/analyzers/real-powershell-analyzer.md.
// `renders` and `mixes_in` are RULED with whole-population counts (PS-B20, 2026-10-27) and this
// analyzer does not emit them: a serializer/UI-reader is a `calls` site (never a component render),
// and the class base list is conformance (extends/implements) while runtime member attachment carries
// an INLINE member set, never a declaration. Pinned both ways by the fixture
// powershell/ruled-extended-types.
// Where its scripts and validations live: script/m14/spec/powershell-completeness.json · fixtures
// validation/m14/fixtures/powershell/** (`bun run script/m14/run-fixtures.ts --lang powershell`).
// WHEN THIS FILE CHANGES, EDIT THESE TOO (the co-edit list): docs/analyzers/real-powershell-analyzer.md,
// the spec JSON's emission sites, and every fixture/expectation pinning an edge whose type or target
// moved. A kind this file emits must be named in the contract row, or the reverse check fails.
// Grammar: tree-sitter-powershell (wasm/tree-sitter-powershell.wasm).

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
 *    PS-B26 FINISHED THE RULE, and it needed finishing because a value-shaped rule cannot
 *    see all of it: `Import-Module $m -ErrorVariable ErrorImportingModule` and
 *    `Import-Module X -RequiredVersion 1.0` name a parameter value that is PERFECTLY SHAPED
 *    as a module name, so the analyzer published two edges on an error variable and one on
 *    a version number. `commandArgs` now takes an `onlyParameters` set and the import reader
 *    passes `-Name`/`-Assembly`, which is the cmdlet's own module-naming surface: a value of
 *    any other parameter belongs to that parameter, and a positional value is still read.
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
  // `psmodulepath` IS NOT IN THIS SET, and its absence is a measured correction: the
  // automatic variable is `$env:PSModulePath`, which the scope-prefix guard already keeps
  // out of the declaration space, while `$PSModulePath` is not on
  // about_Automatic_Variables at all. The list carried the bare spelling, so
  // `ConsoleHost.Tests.ps1:403`'s `$psModulePath = & $powershell …` — a real local — declared
  // nothing and every read of it was suppressed. Two rows over the whole admitted
  // population, both real declarations.
  "psversiontable", "host", "pid", "lastexitcode", "error",
  "home", "pwd", "myinvocation", "matches", "null", "true", "false", "ofs",
  "shellid", "stacktrace", "executioncontext", "psculture", "psuiculture",
  "psdebugcontext", "psedition", "iscoreclr", "islinux", "ismacos", "iswindows",
  "consolefilename", "consoleverbosity", "enabledexperimentalfeatures",
  "errorview", "maximumhistorycount", "nestedpromptlevel", "outputencoding",
  // M60 #278 / ontology review 2026-10-27: `$PSHOME` and `$PROFILE` are on the SAME
  // documented page (about_Automatic_Variables) as `$PWD` and `$SHELLID`, which this
  // list already carries — and they were missing. `& "$PSHOME/pwsh"` therefore
  // published `uses -> PSHOME` for an engine binding while `$PID` in the same file
  // was suppressed, and F5 scored the row as an unexplained read against an oracle
  // that had correctly refused it. The set is the documentation's, so the fix is to
  // finish reading it rather than to invent a rule: these are bindings the engine
  // supplies, not names the file declares or reads from program data.
  "pshome", "profile",
  // The call-site family: `$PSCmdlet` is the cmdlet instance, `$PSBoundParameters`
  // its bound arguments, and the invocation-info/event members are all documented on
  // about_Automatic_Variables beside the ones above. Measured on OutErrorVariable.
  // Tests.ps1: `$PSCmdlet.writeobject("foo")` published `uses -> PSCmdlet` — an
  // engine binding read as program data — on three lines, after the pipeline-read
  // case started reading `$PSCmdlet.Member(...)` receivers.
  "pscmdlet", "psboundparameters", "pscommandline", "pscmdletbindingmetadata",
  "senderinfo", "event", "eventargs", "eventsubscriber", "sourceeventargs",
  "sender", "invocationinfo", "psinvocationinfo", "scriptstacktrace",
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

/**
 * PS-B26 — is this member name the CONSTRUCTOR spelling `new`, case-insensitively?
 *
 * The comparison was a regex (`/^new$/i`), and this file's header forbids a regex that decides a
 * fact: a character loop is where the fact lives. PowerShell member names are case-insensitive and
 * .NET's own documentation writes `::New()`, so `New`, `new` and `NEW` are the same member.
 *
 * `| 0x20` folds ASCII case for the three letters and cannot make a non-letter compare equal to
 * `n`, `e` or `w` (the fold changes only the 0x40 bit, and those code points differ in more than
 * that bit). A wrong-length string is not the keyword, checked first.
 */
const isNewSpelling = (name: string): boolean => {
  if (name.length !== 3) return false
  return (name.charCodeAt(0) | 0x20) === 110 /* n */ &&
    (name.charCodeAt(1) | 0x20) === 101 /* e */ &&
    (name.charCodeAt(2) | 0x20) === 119 /* w */
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

/**
 * THE SOURCED FILE'S OWN NAME — the `part_of` target for a dot-source.
 *
 * A dot-source names a FILE, and the file's module symbol is its basename WITH the
 * extension (PS1 keeps the extension: `Build.psm1` and `Build.ps1` are different
 * files). A `part_of` target is resolved against SYMBOL names, so this returns the
 * basename as the sourced file declares it — `./lib.ps1` -> `lib.ps1`,
 * `.\modules\Wdu.psm1` -> `Wdu.psm1`, `$PSScriptRoot\tools\start.ps1` -> `start.ps1`.
 * The extension is NOT stripped: stripping it (`lib`) would match no symbol at all,
 * which is the cpp lane's measured failure mode for path targets (0 of 4,612 rows
 * resolved). The WRITTEN path is kept separately in `metadata.partPath`.
 *
 * A separator-only tail or a name no symbol can carry yields null, so the caller
 * falls back to the `calls` reading rather than publishing an unresolvable target.
 * Both separators are handled because PowerShell accepts either on every platform.
 */
const sourcedPartName = (target: string): string | null => {
  const normalized = target.split("\\").join("/")
  const base = normalized.slice(normalized.lastIndexOf("/") + 1)
  if (base.length === 0) return null
  return isPlausibleSymbolName(base) ? base : null
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
 * PS-B26 — `Import-Module`'s parameters whose VALUE can name a module.
 *
 * The cmdlet's module argument is POSITIONAL or `-Name`'s value; `-Assembly` names an
 * assembly file and this lane has always read it as a dependency. Every other parameter
 * names something else — `-RequiredVersion 1.0`, `-Prefix Typed`, `-ArgumentList $args` —
 * and the COMMON parameters (`-ErrorVariable`, `-ErrorAction`, `-OutVariable`, …) are
 * runtime plumbing shared by every cmdlet. Measured on ParameterBinding.Tests.ps1:52:
 * `Import-Module $mod[0].Assembly -ErrorVariable ErrorImportingModule` published two edges
 * on a module named after an ERROR VARIABLE. PS7's switch-VALUE list caught `-ErrorAction
 * Stop` and cannot catch this, because the value is a legal module name; the parameter's
 * IDENTITY is the discriminator.
 */
const IMPORT_MODULE_MODULE_PARAMETERS = new Set(["name", "assembly"])

/**
 * The `$name:` prefixes that scope a variable outside the local scope. PowerShell
 * scope modifiers are case-insensitive (`$Script:x` IS `$script:x`), so every
 * entry is lowercase and every comparison lowercases the candidate — see the
 * AUTOMATIC_VARIABLES note for the measurement that forced it.
 */
const QUALIFIED_PREFIXES = ["$global:", "$script:", "$env:", "$using:", "$local:", "$private:", "$variable:"]

/** Does this target carry a byte no bare PowerShell identifier has? `.` `\` `/` and `:` are
 *  the four, and `::` is the `:` pair — all four are checked by char code, never by a regex
 *  over source text. See `externalReadingOf` for what the answer is used for. */
const carriesQualifierByte = (t: string): boolean => {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 46 /* . */ || c === 92 /* \ */ || c === 47 /* / */ || c === 58 /* : */) return true
  }
  return false
}
/** The scope prefixes a declaration IN THIS FILE can bind. `function global:Foo {…}` and
 *  `$script:Foo` are ordinary PowerShell, and this analyzer publishes both as symbols — so a
 *  target carrying one of these prefixes is a name the FILE ITSELF may declare, and marking it
 *  external would be a claim this file can falsify. They are excluded from the qualified
 *  reading for that reason, and the exclusion is measured: 881 of 6,358 corpus edges carry one
 *  (`global:functionName` 2, `global:Invoke-WebRequest` 1, `global:Get-SimpleFunc*` 1,
 *  `Local:`/`PRIVATE:`/`ScRiPt:`/`script:Start-UnelevatedProcess` and others, one each). */
const FILE_DEFINABLE_SCOPE_PREFIXES = ["global", "script", "local", "private", "function"]
/** The tables this file cannot declare into. `$env:FOO` reads the process environment,
 *  `$variable:X` the dynamic variable table, `$using:X` the CALLER's scope — all three are
 *  bound by the runtime from outside the parse, so they keep the qualified reading. */
const RUNTIME_TABLE_SCOPE_PREFIXES = ["env", "variable", "using"]
/** Case-insensitive `prefix:` match, folded with a char-code scan rather than
 *  `startsWith` on a lowered copy so the predicate stays allocation-free on a hot path and the
 *  file's zero-regex property is not the only thing being asserted. */
const hasScopePrefix = (t: string, prefixes: string[]): boolean => {
  for (const p of prefixes) {
    if (t.length <= p.length + 1) continue
    if (t.charCodeAt(p.length) !== 58 /* : */) continue
    let eq = true
    for (let i = 0; i < p.length; i++) {
      let c = t.charCodeAt(i)
      if (c >= 65 && c <= 90) c += 32 // PowerShell scope keywords are case-insensitive
      if (c !== p.charCodeAt(i)) { eq = false; break }
    }
    if (eq) return true
  }
  return false
}
const hasFileDefinableScopePrefix = (t: string): boolean => hasScopePrefix(t, FILE_DEFINABLE_SCOPE_PREFIXES)
const isAsciiUpper = (c: number): boolean => c >= 65 && c <= 90
/**
 * WHICH EXTERNALITY READING FIRES ON THIS TARGET, or null for neither.
 *
 * `"cmdlet"`   a hyphen with an ASCII uppercase letter on BOTH sides — PowerShell's own
 *              `Verb-Noun` command spelling, and the only one: `Get-ChildItem`, `Should`,
 *              `Join-Path`. A lowercase letter on either side means it is not this shape,
 *              which is why a corpus that lowercases its cmdlets is measured rather than
 *              assumed.
 * `"qualified"` a qualifier byte, with TWO exclusions and both are measured, not stylistic:
 *                - a leading QUOTE, because this analyzer publishes hashtable keys and command
 *                  arguments verbatim, so `'Content-Type'` (43 edges), `"Authorization"` (18)
 *                  and `"it:skip"` (7) arrive as property/variable names and "carries a dot"
 *                  is not evidence that a target is a module path;
 *                - a scope prefix this file can DECLARE INTO (`global`, `script`, `local`,
 *                  `private`, `function` — 881 corpus edges), because `function global:Foo` is
 *                  ordinary PowerShell and this analyzer publishes it as a symbol.
 *              A `env:` / `variable:` / `using:` prefix KEEPS the reading: those are runtime
 *              tables and the caller's scope, bound from outside the parse.
 *
 * Zero regex, and no word list: every predicate here is a byte test over the published name.
 */
/** PS-RELATIVE-PATH (fleet baseline 2026-10-19; WIDENED 2026-10-20 — the second refuted claim):
 *  a RELATIVE path naming one of the lane's ADMITTED spellings is a PROJECT FILE reference, not an
 *  external target. Character scan, not a regex: the fleet's no-regex policy applies to the Lead's
 *  own edits exactly as it does to a lane's.
 *
 *  ## WHY THE FIRST VERSION OF THIS PREDICATE WAS TOO NARROW, AND WHAT THE ARBITER ACTUALLY ASKS
 *
 *  The first version read: "is this a relative path ending in `.ps1`?" The arbiter asks a
 *  DIFFERENT question — "is this path one of the PROJECT's admitted files?"
 *  (`pathTargetInProject`, `script/m14/incoming-rule.ts`) — and the two disagreed on two axes.
 *  Both were MEASURED, not argued:
 *
 *  1. THE EXTENSION. The arbiter's project facts hold the lane's ADMITTED files, and the gate's own
 *     map admits `powershell: "ps1,psm1,psd1"` (`script/m14/incoming-gate.ts:134`) — so a project
 *     owns `.psm1` and `.psd1` files exactly as it owns `.ps1` ones. `pathTargetInProject` matches
 *     by SUFFIX, so the extension is irrelevant to the arbiter and decisive to the old predicate.
 *     MEASURED, whole population, 1,181 files / 30 repos: two rows —
 *     `powershell/test/powershell/Modules/Microsoft.PowerShell.Security/FileCatalog.Tests.ps1:365`
 *     and `:366` — publish `uses -> DSCResources\UserConfigProviderModVersion1\UserConfigProvider
 *     ModVersion1.psm1` with `externalTarget: true`, and that file IS in the project. The
 *     arbiter's own `verifyExternalClaim` answers `externalRefuted` on both. The lane's extFAIL
 *     column read 0 anyway, because PS38 withholds the arbiter-readable key on a bare owner and
 *     the spelling the analyzer DOES publish (`externalTarget`) is not in `EXTERNAL_KEYS` — so the
 *     false claim was published AND INVISIBLE. That is the second refuted claim, and the first
 *     incident's fix is what made it hard to see: the fix answered the wrong question.
 *  2. THE SEPARATOR. The old predicate also required a path separator, so a BARE `Helper.psm1`
 *     was marked. The arbiter's suffix match does not care: `nf.endsWith("/" + norm)` matches a
 *     bare `Helper.psm1` against ANY admitted file with that basename.
 *
 *  ## AND THE ABSOLUTE CASE, WHICH THE OLD PREDICATE GOT WRONG THE OTHER WAY
 *
 *  An ABSOLUTE path can never be refuted by the path branch: the gate's facts are REPO-RELATIVE
 *  (`path.relative(repoRoot, abs)`, `incoming-gate.ts:577`), so no admitted path ends with `/` plus
 *  an absolute norm. The old predicate withheld the claim on `/usr/lib/x.ps1` — a TRUE claim thrown
 *  away, for a shape the arbiter can check and answer.
 *
 *  ## THE RULE THIS SHIPS
 *
 *  Withhold the externality reading when the target ends in one of the lane's ADMITTED spellings
 *  and its spelling is a RELATIVE path — not `/unix-rooted`, not `C:\drive`, not a URI scheme.
 *  This is the bash lane's rule ("externalCommandEvidence withheld for all non-absolute paths now,
 *  kept only for /unix-rooted and C:\ drive", RESOLUTION-LEDGER) applied to powershell's own
 *  admitted spellings.
 */
/**
 * PSD14 — IS THIS TARGET A FILE THE PROJECT MAY OWN? A relative path with a FILE extension.
 *
 * The rule started as the lane's three ADMITTED spellings (`.ps1`/`.psm1`/`.psd1`) and the reason it
 * exists is not the extension: a relative path is resolved against a directory the analyzer does
 * not know, so whether the project owns the FILE is not this file's question, and an externality
 * claim on it is unanswerable (the arbiter's path branch refuses it — `ext?`, a claim no check can
 * reach). MEASURED: 4 whole-population rows name a native program through a relative directory
 * (`.\\warp-packer.exe`, `.\\warp\\buckaroo-windows.exe`, `.\\test-x86_64-windows-msvc.exe` ×2) and
 * all four read `externalUnverified`. A relative program or assembly is the same shape as a
 * relative script: a file on disk the project may ship.
 */
const isRelativeProjectFilePath = (t: string): boolean => {
  const n = t.length
  if (n < 4) return false
  // THE THREE ADMITTED SPELLINGS, byte-wise and case-insensitive: ".ps1", ".psm1", ".psd1".
  const isPs = (i: number): boolean => {
    const c = t.charCodeAt(i)
    return c === 112 /* p */ || c === 80 /* P */
  }
  const isS = (i: number): boolean => {
    const c = t.charCodeAt(i)
    return c === 115 /* s */ || c === 83 /* S */
  }
  const isDot = (i: number): boolean => t.charCodeAt(i) === 46 /* . */
  const isOne = (i: number): boolean => t.charCodeAt(i) === 49 /* 1 */
  let endsAdmitted = isDot(n - 4) && isPs(n - 3) && isS(n - 2) && isOne(n - 1) // .ps1
  if (!endsAdmitted && n >= 5 && isDot(n - 5) && isPs(n - 4) && isS(n - 3) && isOne(n - 1)) {
    const c = t.charCodeAt(n - 2)
    endsAdmitted = c === 109 /* m */ || c === 77 /* M */ || c === 100 /* d */ || c === 68 /* D */
  }
  if (!endsAdmitted) {
    // THE PROGRAM AND ASSEMBLY SPELLINGS, by the same code-point test.
    const dot = t.lastIndexOf(".")
    if (dot > 0 && dot < t.length - 1) {
      let ext = ""
      for (let i = dot + 1; i < t.length; i++) {
        const c = t.charCodeAt(i)
        if (c >= 65 && c <= 90) { ext += String.fromCharCode(c + 32); continue }
        if (c >= 97 && c <= 122) { ext += String.fromCharCode(c); continue }
        ext = ""; break
      }
      if (ext.length > 0 && (PROGRAM_EXTENSIONS.has(ext) || ext === "dll" || ext === "nupkg" || ext === "zip")) {
        endsAdmitted = true
      }
    }
  }
  if (!endsAdmitted) return false
  // THE PRICE OF THIS RULE, MEASURED, AND PAID DELIBERATELY.
  //
  // A path that begins with a RUNTIME VARIABLE (`$PSScriptRoot\..\..\X.psm1`) is resolved at RUN
  // TIME, against a directory the project does not know, so this file is NOT in a position to judge
  // whether the project owns it. A rule that kept the claim on that shape, and a rule that dropped
  // it, were BOTH measured over the whole population (1,181 files / 30 repos), by RESOLVING each
  // released path against the PROJECT'S ADMITTED FILE LIST and asking the ARBITER's own
  // `pathTargetInProject` what it says about the result:
  //
  //     58  the resolved path IS IN THE PROJECT'S ADMITTED LIST   -> the externality claim is FALSE
  //     18  the resolved path is NOT in the admitted list         -> and THE PROJECT CANNOT TELL AN
  //         EXTERNAL MODULE FROM A DANGLING PATH — the arbiter's own case 2, a REFUSAL, and a
  //         refusal is not a verification: these are NOT known-true claims
  //     30  the variable is $PSHOME — a POWERSHELL BUILT-IN, the INSTALLATION directory, and the
  //         file it names is the installation's own (26 x `pwsh`, 3 x `pwsh.exe`, 1 x
  //         `RegisterManifest.ps1`) — so the claim is TRUE and no project owns the installation
  //     12  the variable IS ASSIGNED IN THE ROW'S OWN FILE — a ONE-FILE question, and therefore
  //         the ANALYZER's question rather than the gate's; and 11 of the 12 name a file that is
  //         NOT A SOURCE FILE (pwsh, pwsh.exe, dotnet.exe, a .dll) while the admitted set is a set
  //         of SOURCE files, so those 11 are not project files BY KIND, and only ONE ($ProjectRoot\
  //         build.ps1) names a source file and so needs a one-file rule
  //      5  the variable is neither the file's own directory nor assigned in the file ($env: x2,
  //         $ShimDirectory, $TestDrive, $testdrive) — a built-in or a received value
  //
  // So dropping the claim on that shape removes 58 FALSE claims and loses 48 claims the ARBITER
  // cannot verify (30 true-but-unverifiable and 18 case-2), and keeping it does the reverse.
  // **THE VERIFIED CLASS IS THE SAME EITHER WAY** — (resolved + extOK) / edges is 60.4361 % under
  // both, and so is the TOTAL wall — and the reason it is the same is WORTH NAMING: these rows are
  // the arbiter's case 2 (or a built-in the admitted list can never hold), so they were never
  // `extOK`-eligible at all, and the rule cannot have been leaving a verified class behind.
  // So the choice is not a rate, it is a question of what a lane is for: **A PUBLISHED FALSE CLAIM IS
  // A LIE, AND A LOST SETTLEABLE CLAIM IS A MISSED OPPORTUNITY, AND THE FLEET'S FIRST REFUTED-CLAIM
  // INCIDENT WAS A LIE.** 58 lies for 48 unverifiable claims is the right trade, and the price is a
  // NUMBER rather than an argument. (AND THE 12 THAT ARE ASSIGNED IN THEIR OWN FILE ARE NOT LOST
  // EITHER: a ONE-FILE rule in this very file could settle them — that is the lane's next
  // token-free item, and it is NAMED here so the next reader does not have to re-derive it.)
  //
  // AND THE 48 ARE NOT LOST FOREVER: the GATE knows the row's own directory AND the project's
  // admitted file list, so IT can resolve a `$PSScriptRoot` path and settle all 76 derivable rows —
  // turning the 58 false claims into VISIBLE refutations, and the 18 into NAMED REFUSALS. The arbiter
  // does not do that today, which is why all 123 rows of the shape read as "unverifiable" (wall W9,
  // the Lead's instrument, filed as a proposal WITH THE PATCH AND ITS MEASURED EFFECT).

  // A PATH THAT NAMES SOMETHING OUTSIDE ANY PROJECT — and so can never be one of the project's
  // own files. The shapes mirror the arbiter's own `WINDOWS_DRIVE` and `URI_SCHEME` tests, because
  // the question is the same one: "can the project's own file list answer this spelling?"
  if (t.charCodeAt(0) === 47 /* / */) return false // /unix-rooted
  if (t.charCodeAt(0) === 92 /* \ */) return false // \\UNC\share
  const colon = t.indexOf(":")
  if (colon > 0) {
    if (colon === 1) return false // C:\ or C:/ — a Windows DRIVE
    // A URI SCHEME is two or more scheme-legal characters before the colon; it names a host.
    for (let i = 0; i < colon; i++) {
      const c = t.charCodeAt(i)
      const legal =
        (c >= 97 && c <= 122) /* a-z */ || (c >= 65 && c <= 90) /* A-Z */ ||
        (c >= 48 && c <= 57) /* 0-9 */ || c === 43 /* + */ || c === 45 /* - */ || c === 46 /* . */
      if (!legal) return true // NOT a scheme — a colon inside a relative path: keep the escape
    }
    return false // a URI scheme
  }
  return true
}
/**
 * W9 — A RUNTIME-VARIABLE TARGET, AND WHETHER THE REST OF IT IS A PATH.
 *
 * A PowerShell path may begin with a variable: `$PSScriptRoot\..\..\X.psm1` is the file's own
 * directory, `$PSHOME\pwsh` is the INSTALLATION, `$publishPath\pwsh` is a directory the file
 * assigns for itself. The variable is the whole difference between "a path the project may own"
 * and "a path it cannot", and this file can see the variable but NOT the project's file list —
 * so what this file CAN do is say which SHAPE the target is, and let the arbiter ask the question
 * the project can answer.
 *
 * THE TWO SHAPES, AND THEY ARE DIFFERENT QUESTIONS:
 *
 *   `$name\rest` / `$name/rest`  A PATH. The rest begins with a separator.
 *   `$env:NAME` / `$TestDrive:x`  A NAMESPACE OR A DRIVE. The rest begins with a COLON, which in
 *                                 PowerShell is the namespace/drive separator and NEVER a path
 *                                 separator. A runtime value is not an external path, so a claim
 *                                 that names nothing that can be a path is not a claim to verify,
 *                                 and this file publishes NONE for it.
 *
 * MEASURED over the same population (1,181 parsed files / 30 repos): of the 123 targets of this
 * shape, 118 are paths (58 resolvable to a project file, 30 to the installation, 12 to a
 * directory the row's own file assigns, 18 to a path the project cannot place) and 5 are
 * namespaces or drives.
 */
const runtimeVariableTarget = (t: string): { name: string; isPath: boolean } | null => {
  if (t.length < 2) return null
  if (t.charCodeAt(0) !== 36 /* $ */) return null
  let i = 1
  while (i < t.length) {
    const c = t.charCodeAt(i)
    const isWord = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (!isWord) break
    i++
  }
  if (i === 1) return null
  const name = t.slice(1, i)
  const sep = t.charCodeAt(i)
  if (sep === 58 /* : */) return { name, isPath: false }
  if (sep === 47 /* / */ || sep === 92 /* \ */) return { name, isPath: true }
  return null
}

/**
 * PSD14 — IS THIS TARGET A NATIVE PROGRAM NAMED WITH ITS EXTENSION (`whoami.exe`, `cmd.exe`)?
 *
 * A program name is a FILE, not a declaration, and PS-B27's qualified reading fires on the dot in
 * `.exe`. The arbiter then asks the OWNER question about `whoami` — and a project that declares ANY
 * symbol of that spelling (a function `Whoami`, a variable `$whoami`) refutes a claim that was never
 * about it. MEASURED over the population: 17 rows refuted for this reason, every one a
 * `calls` row naming a native program (`powershell.exe` 6, `cmd.exe` 5, `whoami.exe` 4, `reg.exe` 2),
 * and each refutation is a FALSE statement about the project — the project does not "own" `whoami`.
 *
 * The claim that fits is the PATH claim: nothing the project ADMITS resolves to this written source
 * string. Its polarity is the inverse of the file claim's, the project's own admitted list is the whole
 * evidence, and adding a file named `whoami.exe` in an independent actor's checkout flips the verdict.
 *
 * ONLY A BARE NAME — a program under a directory (`.	ools\zig.exe`) is a path and keeps the path
 * rules (PS-B18), and a `$var	ool.exe` target is a runtime path (W9).
 */
const PROGRAM_EXTENSIONS = new Set(["exe", "cmd", "bat", "com", "msi"])
const programNameOf = (t: string): string | null => {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 47 /* / */ || c === 92 /* \ */ || c === 36 /* $ */) return null
  }
  const dot = t.lastIndexOf(".")
  if (dot <= 0 || dot === t.length - 1) return null
  const ext = t.slice(dot + 1).toLowerCase()
  return PROGRAM_EXTENSIONS.has(ext) ? t : null
}

/**
 * PSD14 — THE NAMES A C# BODY DECLARES, READ BY KEYWORD SCAN (NO REGEX).
 *
 * `Add-Type -TypeDefinition @' namespace Foo { public class Bar {} } '@` compiles a type at RUN
 * time. The type it creates is not a declaration in the PowerShell name space and no project file
 * can own it, so a type literal or `New-Object` naming one of those names is not a claim the
 * project can answer. The evidence is the C# source the FILE ITSELF carries.
 *
 * The two keywords are the C# declaration keywords that introduce a name PowerShell's type
 * resolver can reach (`namespace Foo`, `class Bar`). The scan is a code-point loop, not a word
 * list with a regex: this file's header forbids a regex that decides a fact. A keyword must be
 * WHOLE (the byte before it is not a word byte, the byte after it is not one), and the name is the
 * run of word bytes after it, so `namespace Foo.Bar` yields `foo` (the root a type literal's owner
 * question is about) and `class Bar` yields `bar`.
 */
const isWordCode = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
  code === 95 || code === 46 /* . — a dotted namespace root is read to its first segment */

/**
 * PSD15 — AND THE TYPES IT DECLARES ARE DECLARATIONS THE FILE MAKES, so they are published as
 * SYMBOLS.
 *
 * PSD14 withheld the externality claim on a type the file compiles, and the lane recorded the price:
 * 62 verified claims withdrawn because those names denote types `Add-Type` creates. Withholding was
 * the honest READING, but it left the row UNRESOLVED — and the row is not a mystery: the file itself
 * states `namespace Contoso.Helpers { public class Gadget }`, so `[Contoso.Helpers.Gadget]::new()`
 * names a declaration this file makes at run time. Publishing that declaration is what turns the
 * claim into a RESOLUTION (clause 1's first half), and it is the same evidence PSD14 already read:
 * the C# bodies are in the file, and so are the `-Namespace`/`-Name` pairs.
 *
 * WHAT IS PUBLISHED, AND WHY THE DOT IS ALLOWED HERE. A PowerShell CLASS name cannot contain a
 * dot, which is why `pushSymbol` refuses a qualified name — but this is not a PowerShell class: it
 * is a .NET type whose name IS dotted (`Ansible.Logon`), and the edge target spells it that way.
 * The symbol is therefore pushed with its `qualifiedName` set to the full dotted name (`metadata.fqn`,
 * the field the index prefers), so the row's target resolves to the declaration instead of hanging.
 *
 * THE PAIRING IS NAMESPACE + CLASS, read in SOURCE ORDER: a `class`/`struct`/`interface`/`enum`
 * belongs to the most recent `namespace` before it, which is how the compiler reads it too. A type
 * declared with no namespace is NOT published (its name would be a bare identifier that can collide
 * with anything) — that residual is named in the lane's doc rather than guessed at.
 */
const addTypeNamesIn = (
  text: string,
  /** the ROOT of every name seen, for the claim-withholding rule (`Contoso` from `Contoso.Helpers`) */
  roots: Set<string>,
  /** full dotted type names, lowercase key -> declared spelling (null when only roots are wanted) */
  types: Map<string, string> | null,
): void => {
  const keywords = ["namespace", "class", "struct", "interface", "enum"]
  let currentNamespace = ""
  for (let i = 0; i < text.length; i++) {
    for (const kw of keywords) {
      if (i + kw.length > text.length) continue
      let ok = true
      for (let j = 0; j < kw.length; j++) {
        if ((text.charCodeAt(i + j) | 0x20) !== kw.charCodeAt(j)) { ok = false; break }
      }
      if (!ok) continue
      if (i > 0 && isWordCode(text.charCodeAt(i - 1))) continue
      let k = i + kw.length
      if (k < text.length && isWordCode(text.charCodeAt(k))) continue
      while (k < text.length && isSpaceCode(text.charCodeAt(k))) k++
      const start = k
      while (k < text.length && isWordCode(text.charCodeAt(k))) k++
      if (k === start) continue
      const name = text.slice(start, k)
      const dot = name.indexOf(".")
      roots.add((dot > 0 ? name.slice(0, dot) : name).toLowerCase())
      if (kw === "namespace") currentNamespace = name
      else if (types !== null && currentNamespace.length > 0) {
        types.set(`${currentNamespace}.${name}`.toLowerCase(), `${currentNamespace}.${name}`)
      }
      i = k - 1
      break
    }
  }
}

const externalReadingOf = (t: string): "cmdlet" | "qualified" | null => {
  if (t.charCodeAt(0) === 34 /* " */ || t.charCodeAt(0) === 39 /* ' */) return null
  // PS-RELATIVE-PATH (fleet baseline 2026-10-19, the two whole-population refutations; WIDENED
  // 2026-10-20 to every ADMITTED spelling): a RELATIVE path naming one of the lane's admitted
  // files (`.\hack\make\.go-autogen.ps1`, `.\eng\common\tools.ps1`,
  // `DSCResources\UserConfigProviderModVersion1\UserConfigProviderModVersion1.psm1`) is a PROJECT
  // FILE reference, not an external target. The "qualified" reading fired on it because a
  // backslash is a qualifier byte, and the gate's case-1 path check correctly found the file in
  // the project and REFUTED the claim — the emission was false. A path-shaped target the project
  // may own is a dependency the arbiter answers by the admitted file list, so no externality
  // reading may attach to it.
  if (isRelativeProjectFilePath(t)) return null
  for (let i = 1; i < t.length; i++) {
    if (t.charCodeAt(i) !== 45 /* - */) continue
    if (isAsciiUpper(t.charCodeAt(0)) && isAsciiUpper(t.charCodeAt(i + 1))) return "cmdlet"
  }
  if (!carriesQualifierByte(t)) return null
  if (hasFileDefinableScopePrefix(t)) return null
  return "qualified"
}

/**
 * PS38 — CAN THE ARBITER CHECK A CLAIM ON THIS TARGET WITHOUT ASKING ABOUT A NAME THE TARGET
 * DOES NOT NAME?
 *
 * `verifyExternalClaim` (script/m14/incoming-rule.ts) verifies an external claim one of two
 * ways, and only one of them is a question this analyzer's own guard answered:
 *
 *   no dotted owner   the arbiter asks about the TARGET ITSELF when the spelling is a plain
 *                     identifier, and answers UNVERIFIABLE when it is not (`Get-ChildItem`
 *                     carries a hyphen, so it is the second case). Either way the thing looked
 *                     up is a string the edge names, and the claim is consulted only where the
 *                     key space answers the target NOTHING (`classifyEdge` reads the count
 *                     first), so this arm can never be refuted BY CONSTRUCTION.
 *   a dotted owner    the arbiter asks about the OWNER — everything before the LAST dot —
 *                     which the edge does NOT name and `declaredInFile(target)` never guarded.
 *                     A project that publishes an unrelated `Text` refutes the claim on
 *                     `[Text.UTF8Encoding]::new()`, and it did: 82 such refutations measured
 *                     over the 978-file corpus, ALL of them on a BARE owner (`Text`,
 *                     `powershell` from `powershell.exe`, `3` from `#requires -Version 3.0`,
 *                     `Test` from `[Test.User32]::GetPlacement`), and ZERO on a qualified one.
 *
 * So the readable key is published where the arbiter asks about the target itself or about an
 * owner that is ITSELF QUALIFIED — a namespace path such as `System.IO`, which is the owner of
 * `System.IO.Path::Combine`. This is a rule about WHICH QUESTION the checker will ask, not
 * about which targets are external: `externalTarget`/`externalVia` keep publishing the reading
 * on the withheld edges, and a withheld claim is one the arbiter was never able to check
 * honestly. It is deliberately NOT "mark only what verifies" — 47 of the 49 withheld edges at
 * `powershell ps1 60` WOULD have verified; they are given up with the 2 the project answers,
 * because no per-file rule can tell `System.Version` (owner `System`) from `Text.UTF8Encoding`
 * (owner `Text`) apart: the difference is what the PROJECT declares, and this analyzer reads
 * one file.
 *
 * Zero regex, like every predicate in this file: the owner split is `lastIndexOf`, the
 * "the arbiter will skip this owner" test is a char-code scan for `:` `/` and whitespace.
 */
const arbiterOwnerOf = (t: string): string | null => {
  const dot = t.lastIndexOf(".")
  if (dot <= 0) return null
  return t.slice(0, dot)
}
const arbiterCanCheckOwner = (t: string): boolean => {
  const owner = arbiterOwnerOf(t)
  if (owner === null) return true
  for (let i = 0; i < owner.length; i++) {
    if (owner.charCodeAt(i) === 46 /* . */) return true
  }
  // A BARE OWNER IS LOOKED UP, so the claim would be checked against a name the edge does not
  // carry — UNLESS the owner itself carries a byte the arbiter refuses to look up (`:` `/`
  // whitespace), in which case the outcome is UNVERIFIABLE and the claim cannot be called
  // false. The byte set mirrors `verifyExternalClaim`'s own `[:/\s]` test EXACTLY, which is
  // why `\` is NOT in it: that regex does not reject a backslash, so an owner like `Foo\Bar`
  // IS looked up and is not safe to publish against.
  for (let i = 0; i < owner.length; i++) {
    const c = owner.charCodeAt(i)
    if (c === 58 /* : */ || c === 47 /* / */ || c === 32 || c === 9 || c === 10 || c === 13) return true
  }
  return false
}

/**
 * PS-B27 — THE SECOND-LEVEL `System.*` NAMESPACES, WHICH A TYPE LITERAL MAY SPELL WITHOUT THE
 * `System.` PREFIX.
 *
 * PowerShell's type resolver takes a name that no loaded assembly answers to and tries it again
 * under `System.` — the rule `[Text.UTF8Encoding]`, `[IO.Path]` and `[Collections.Generic.List[int]]`
 * all rely on, and the rule the runtime's own documentation states for shortened type names. So a
 * bracketed target whose first segment is one of these names denotes the .NET type `System.<that>`,
 * NOT a declaration this project publishes: PowerShell classes do not nest, so no project type can
 * ever be spelled `Text.UTF8Encoding`.
 *
 * WHY THE LIST HAS TO EXIST AT ALL, MEASURED. The namespace claim below certifies a target's ROOT,
 * and its list is the evidence a reviewer diffs. `Text.UTF8Encoding`'s root is `Text`, which is not
 * `System`, so without this table the row fell through to the generic owner claim — and the arbiter
 * asks that claim about the OWNER (`Text`), which the project answers with a VARIABLE of that name
 * (Grace/scripts/capture-artifact-size.ps1). 113 rows read `externalRefuted` for that reason: 85 at
 * the committed analyzer and 28 more added by the depth pass. The refutation is false — a variable
 * is not a type and no file declares a type named `Text` — and the instrument that produces it is
 * the Lead's, so the lane's part of the fix is to stop asking the wrong question about a target
 * whose root only LOOKS like a project name.
 *
 * THE LIST IS THE FRAMEWORK'S, NOT THE CORPUS'S: the direct children of the `System` namespace in
 * the .NET API browser. A root the table does not carry cannot be claimed, so it stays exactly as
 * it was before this rule — `[Test.User32]::new()` (`Test` is created by `Add-Type -Namespace Test`)
 * and `[powershell.exe]` are untouched, and both are pinned as NEGATIVE rows in the fixture.
 */
const DOTNET_SYSTEM_NAMESPACES = new Set([
  "accessibility", "buffers", "codedom", "collections", "componentmodel", "configuration",
  "data", "deployment", "diagnostics", "directoryservices", "drawing", "dynamic", "formats",
  "globalization", "io", "linq", "management", "media", "net", "numerics", "printing",
  "reflection", "resources", "runtime", "security", "servicemodel", "serviceprocess", "text",
  "threading", "transactions", "web", "windows", "xml",
])

/**
 * PSD14 — THE FRAMEWORK'S NESTED NAMESPACES, WHICH IS WHAT A `using namespace` PREFIX NEEDS.
 *
 * `about_Using`: inside `using namespace System.Management.Automation`, a type name is tried as
 * written, then under each using-namespace prefix. So `[Language.VariableExpressionAst]` names
 * `System.Management.Automation.Language.VariableExpressionAst` — but only because `Language` IS a
 * namespace under the prefix. The table below is what makes that a FACT rather than a guess: an
 * expansion fires only when `<prefix>.<first segment>` is a namespace the .NET API browser lists
 * under that parent.
 *
 * WHY IT CANNOT BE DERIVED FROM THE TARGET ALONE. A dotted type literal's root may be a namespace
 * (`Language.`), a TYPE (`Path.Combine` names the type `Path`), or a project class. Expanding every
 * dotted literal would retarget `[SomeProject.Type]` to `System.IO.SomeProject.Type`; the table is
 * the boundary, and every unlisted spelling keeps the treatment it had.
 *
 * THE ENTRIES ARE THE CHILD NAMESPACES OF THE PARENTS THIS CORPUS ACTUALLY WRITES IN A `using
 * namespace` DIRECTIVE (measured: System.Management.Automation, System.Collections.Generic,
 * System.IO, System.Management.Automation.Language, System.Management.Automation.Security,
 * System.Security.Cryptography[.X509Certificates], System.Diagnostics, System.Collections,
 * System.Text), read from the .NET API browser. `System.Text.Encodings.Web` is listed instead of
 * `System.Text.Encodings` because the latter has no documented child type of its own.
 */
const FRAMEWORK_NESTED_NAMESPACES = new Set([
  "system.management.automation.language",
  "system.management.automation.runspaces",
  "system.management.automation.provider",
  "system.management.automation.security",
  "system.management.automation.remoting",
  "system.management.automation.host",
  "system.management.automation.moduleanalysis",
  "system.management.automation.debugging",
  "system.io.compression",
  "system.io.isolatedstorage",
  "system.io.memorymappedfiles",
  "system.io.packaging",
  "system.io.pipes",
  "system.io.enumeration",
  "system.collections.generic",
  "system.collections.concurrent",
  "system.collections.specialized",
  "system.collections.objectmodel",
  "system.collections.immutable",
  "system.collections.frozen",
  "system.security.cryptography.x509certificates",
  "system.security.cryptography.certificates",
  "system.text.json",
  "system.text.regularexpressions",
  "system.text.unicode",
  "system.text.encodings.web",
  "system.diagnostics.codeanalysis",
  "system.diagnostics.tracing",
  "system.diagnostics.eventlog",
  "system.diagnostics.metrics",
  "system.diagnostics.symbolstore",
])

/**
 * PSD12 — THE TYPE LITERALS THE RUNTIME RESOLVES FOR US: the accelerator table, plus the framework
 * types PowerShell resolves by the implicit-namespace rule and the loaded-assembly search.
 *
 * WHY A TABLE, AND WHY IT HAS TO BE CLOSED. `[string]::IsNullOrWhiteSpace($x)` names nothing this
 * project can declare: `string` is a TYPE ACCELERATOR the engine rewrites to `System.String`, and the
 * call is a static member of a framework type. The analyzer knew only the SPELLING, so it published
 * `ownerMemberAbsent {owner: "string"}` — a claim whose owner no admitted file declares, which the
 * arbiter can therefore only answer UNVERIFIED (measured: 2,256 such rows over the whole population,
 * the largest single class in `ext?`). The claim was also FALSE in its own terms: it says "the owner
 * is published and the member is not", and the owner is not published at all.
 *
 * THE FIX IS THE TARGET, NOT THE CLAIM. `[string]::IsNullOrWhiteSpace` IS
 * `System.String.IsNullOrWhiteSpace`, so the row is published under the name of the thing it names —
 * the same shape `[System.Math]::Max` already produces (`System.Math.Max`), and the shape PS-B22
 * settled for in-project types (`DeclaringType.Member`). The root is then `System`, which the
 * namespace pass certifies from its documented-list rule, and the row verifies instead of hanging.
 *
 * EVERY ENTRY IS A DOCUMENTED FACT, and there are exactly two sources:
 *   1. the TYPE ACCELERATOR table (about_Type_Accelerators): `string` -> System.String,
 *      `regex` -> System.Text.RegularExpressions.Regex, `wmi` -> System.Management.ManagementObject, ...
 *   2. for the names that are NOT accelerators, PowerShell's own type resolution — the implicit
 *      `System.` attempt followed by the loaded-assembly search — over the framework types this
 *      population actually names: `[Convert]`, `[Math]`, `[Environment]`, `[Tuple]`, `[Enum]`,
 *      `[Console]`, `[BitConverter]`, `[GC]`, `[WaitHandle]`, `[Version]`, `[Uri]`, and the
 *      `System.Management.Automation` types (`[powershell]`, `[PSSerializer]`, `[ProxyCommand]`, ...).
 *      The resolved name is the type's documented namespace-qualified name, so the entry is a
 *      citation rather than a guess.
 *
 * WHAT THE TABLE DELIBERATELY DOES NOT CARRY, each because the resolution is NOT a documented fact:
 *   `[Path]`, `[File]`, `[Directory]`, `[Process]` — no `System.Path`/`System.File` exists, so the
 *   name goes to the assembly search and can answer a DIFFERENT type of that name (there is more than
 *   one `Path` in the framework). Those rows keep their previous treatment.
 *   `[Parser]`, `[MyCSMU]`, `[NullStringTest]`, `[AnsibleModule]` — project or test types outside the
 *   admitted population; nothing in the framework documents them.
 * A literal the table does not carry is left EXACTLY as it was, so the table can only move rows it
 * can name, and every unlisted spelling is a bounded, measured residual rather than a silent one.
 */
const RESOLVED_FRAMEWORK_TYPES = new Map<string, string>([
  // ── the documented TYPE ACCELERATORS (about_Type_Accelerators) ────────────────────────────────
  ["adsi", "System.DirectoryServices.DirectoryEntry"],
  ["adsisearcher", "System.DirectoryServices.DirectorySearcher"],
  ["alias", "System.Management.Automation.AliasAttribute"],
  ["allowemptycollection", "System.Management.Automation.AllowEmptyCollectionAttribute"],
  ["allowemptystring", "System.Management.Automation.AllowEmptyStringAttribute"],
  ["allow_null", "System.Management.Automation.AllowNullAttribute"],
  ["array", "System.Array"],
  ["bigint", "System.Numerics.BigInteger"],
  ["bool", "System.Boolean"],
  ["byte", "System.Byte"],
  ["char", "System.Char"],
  ["cimclass", "Microsoft.Management.Infrastructure.CimClass"],
  ["cimconverter", "Microsoft.Management.Infrastructure.CimConverter"],
  ["ciminstance", "Microsoft.Management.Infrastructure.CimInstance"],
  ["cimtype", "Microsoft.Management.Infrastructure.CimType"],
  ["cmdletbinding", "System.Management.Automation.CmdletBindingAttribute"],
  ["cultureinfo", "System.Globalization.CultureInfo"],
  ["datetime", "System.DateTime"],
  ["decimal", "System.Decimal"],
  ["double", "System.Double"],
  ["dsclocalconfigurationmanager", "Microsoft.PowerShell.DesiredStateConfiguration.LocalConfigurationManager"],
  ["dscproperty", "System.Management.Automation.DscPropertyAttribute"],
  ["dscresource", "System.Management.Automation.DscResourceAttribute"],
  ["float", "System.Single"],
  ["guid", "System.Guid"],
  ["hashtable", "System.Collections.Hashtable"],
  ["initialsessionstate", "System.Management.Automation.Runspaces.InitialSessionState"],
  ["int", "System.Int32"],
  ["int16", "System.Int16"],
  ["int32", "System.Int32"],
  ["int64", "System.Int64"],
  ["ipaddress", "System.Net.IPAddress"],
  ["ipendpoint", "System.Net.IPEndPoint"],
  ["long", "System.Int64"],
  ["mailaddress", "System.Net.Mail.MailAddress"],
  ["moduleinfo", "System.Management.Automation.PSModuleInfo"],
  ["nullable", "System.Nullable"],
  ["object", "System.Object"],
  ["objectsecurity", "System.Security.AccessControl.ObjectSecurity"],
  ["ordered", "System.Collections.Specialized.OrderedDictionary"],
  ["outputtype", "System.Management.Automation.OutputTypeAttribute"],
  ["parameter", "System.Management.Automation.ParameterAttribute"],
  ["physicaladdress", "System.Net.NetworkInformation.PhysicalAddress"],
  ["psobject", "System.Management.Automation.PSObject"],
  ["pscredential", "System.Management.Automation.PSCredential"],
  ["pscustomobject", "System.Management.Automation.PSCustomObject"],
  ["pslistmodifier", "System.Management.Automation.PSListModifier"],
  ["psprimitivedictionary", "System.Management.Automation.PSPrimitiveDictionary"],
  ["pstypenameattribute", "System.Management.Automation.PSTypeNameAttribute"],
  ["psvariable", "System.Management.Automation.PSVariable"],
  ["ref", "System.Management.Automation.PSReference"],
  ["regex", "System.Text.RegularExpressions.Regex"],
  ["runspace", "System.Management.Automation.Runspaces.Runspace"],
  ["runspacefactory", "System.Management.Automation.Runspaces.RunspaceFactory"],
  ["sbyte", "System.SByte"],
  ["scriptblock", "System.Management.Automation.ScriptBlock"],
  ["securestring", "System.Security.SecureString"],
  ["semver", "System.Management.Automation.SemanticVersion"],
  ["short", "System.Int16"],
  ["single", "System.Single"],
  ["string", "System.String"],
  ["switch", "System.Management.Automation.SwitchParameter"],
  ["timespan", "System.TimeSpan"],
  ["type", "System.Type"],
  ["uint", "System.UInt32"],
  ["uint16", "System.UInt16"],
  ["uint32", "System.UInt32"],
  ["uint64", "System.UInt64"],
  ["ulong", "System.UInt64"],
  ["uri", "System.Uri"],
  ["ushort", "System.UInt16"],
  ["validatecount", "System.Management.Automation.ValidateCountAttribute"],
  ["validatedrive", "System.Management.Automation.ValidateDriveAttribute"],
  ["validatelength", "System.Management.Automation.ValidateLengthAttribute"],
  ["validatenotnull", "System.Management.Automation.ValidateNotNullAttribute"],
  ["validatenotnullorempty", "System.Management.Automation.ValidateNotNullOrEmptyAttribute"],
  ["validatepattern", "System.Management.Automation.ValidatePatternAttribute"],
  ["validaterange", "System.Management.Automation.ValidateRangeAttribute"],
  ["validatescript", "System.Management.Automation.ValidateScriptAttribute"],
  ["validateset", "System.Management.Automation.ValidateSetAttribute"],
  ["version", "System.Version"],
  ["void", "System.Void"],
  ["wildcardpattern", "System.Management.Automation.WildcardPattern"],
  ["wmi", "System.Management.ManagementObject"],
  ["wmiclass", "System.Management.ManagementClass"],
  ["wmisearcher", "System.Management.ManagementObjectSearcher"],
  ["xml", "System.Xml.XmlDocument"],
  // ── NOT accelerators: resolved by the implicit-`System.` attempt, or by the loaded-assembly
  //    search, to the framework type of that name. Cited per line, and only where the resolution is
  //    a documented fact rather than a coin toss (see the block comment's "deliberately not" list).
  ["bitconverter", "System.BitConverter"],                    // System.BitConverter
  ["console", "System.Console"],                               // System.Console (implicit `System.`)
  ["convert", "System.Convert"],                               // System.Convert (implicit `System.`)
  ["datetimeoffset", "System.DateTimeOffset"],                  // System.DateTimeOffset
  ["enum", "System.Enum"],                                     // System.Enum (implicit `System.`)
  ["environment", "System.Environment"],                       // System.Environment (implicit `System.`)
  ["experimentalfeature", "System.Management.Automation.ExperimentalFeature"],
  ["gc", "System.GC"],                                        // System.GC (implicit `System.`)
  ["linebreakpoint", "System.Management.Automation.LineBreakpoint"],
  ["math", "System.Math"],                                     // System.Math (implicit `System.`)
  ["powershell", "System.Management.Automation.PowerShell"],   // assembly search: the PS host object
  ["proxycommand", "System.Management.Automation.ProxyCommand"],
  ["psserializer", "System.Management.Automation.PSSerializer"],
  ["securityprotocoltype", "System.Net.SecurityProtocolType"],
  ["servicepointmanager", "System.Net.ServicePointManager"],
  ["tuple", "System.Tuple"],                                   // System.Tuple (implicit `System.`)
  ["waithandle", "System.Threading.WaitHandle"],
])

/**
 * THE MEMBER SET OF THE CLASS A TYPE LITERAL NAMES, matched the way PowerShell matches it: without
 * regard to case. Returns `undefined` when this file declares no such class.
 *
 * The exact-key lookup this replaces was measured wrong on its own terms: `[counter]::Add()` with
 * `class Counter` in the same file missed, because the literal and the declaration disagree on case
 * — and PowerShell's class lookup is case-insensitive, so the MISS was the analyzer's, not the
 * language's. Two consequences, both real: the call lost its in-file member check (PS-B22's
 * `ownerMemberAbsent` path), and PSD12's accelerator table could shadow a class this file declares.
 */
const classMembersOf = (
  map: Map<string, Set<MemberFact>>,
  literal: string,
): { name: string; members: Set<MemberFact> } | undefined => {
  const exact = map.get(literal)
  if (exact !== undefined) return { name: literal, members: exact }
  const folded = literal.toLowerCase()
  for (const [name, members] of map) if (name.toLowerCase() === folded) return { name, members }
  return undefined
}

/**
 * PSD13 — IS THIS TARGET A `$using:` SCOPE READ (`using:NAME`)?
 *
 * `$using:Name` inside a remote scriptblock reads `$Name` from the CALLER's scope: the engine supplies
 * the binding, and `using` is a reserved scope keyword. No admitted file can declare a name spelled
 * `using:Something` — measured: zero `function using:…` declarations in the population, and the grammar
 * does not accept `using` in a declaration scope position.
 *
 * THE DISTINCTION FROM `global:`/`script:` IS THE WHOLE POINT, and it is not stylistic. Those are
 * scopes a file CAN declare into (`function global:Foo { … }` is ordinary PowerShell), so the lane
 * refuses to call them external and `FILE_DEFINABLE_SCOPE_PREFIXES` exists for exactly that. `using` is
 * in `RUNTIME_TABLE_SCOPE_PREFIXES` beside `env` and `variable` for the same reason in the other
 * direction: the runtime binds it from outside the parse.
 *
 * WHY IT NEEDS A CLAIM OF ITS OWN, MEASURED. The generic externality reading fires on the colon, and the
 * arbiter's owner question is refused for a colon-bearing owner (`[:/\s]`), so 66 rows sat in `ext?`
 * with a claim no check could reach. The namespace claim is the kind built for it: the LIST is the
 * evidence, the root is matched by segment, and the claim can never raise `resolved`. The root is
 * carried AS WRITTEN (PSD11's rule), because `namespaceMatchOf` compares byte for byte.
 */
const usingScopeRootOf = (t: string): string | null => {
  if (t.length <= 6) return null
  if (t.charCodeAt(5) !== 58 /* : */) return null
  for (let i = 0; i < 5; i++) {
    const c = t.charCodeAt(i) | 0x20
    if (c !== "using".charCodeAt(i)) return null
  }
  return t.slice(0, 5)
}

/**
 * PSD13 — IS THIS TARGET A MODULE-QUALIFIED COMMAND (`ModuleName\CommandName`)?
 *
 * PowerShell's DOCUMENTED way to say which module's command you mean is exactly this spelling
 * (about_Command_Precedence, "Use a module-qualified name"): `Microsoft.PowerShell.Management\Get-Item`
 * is *the* `Get-Item` of *that* module, not whichever one the session happens to have loaded. The fact
 * the target states is therefore "a member of the MODULE named before the backslash", which is the
 * fleet's `moduleNamespace` claim — verified against the project's own module space (its file basenames
 * and directory names), never against the symbol table.
 *
 * WHY IT NEEDED DECIDING AT ALL, MEASURED. The qualified externality reading fires on the backslash, and
 * the arbiter then refuses the owner: `targetOwner` on `Microsoft.PowerShell.Management\Join-Path`
 * yields `Microsoft.PowerShell` (`:`/`/`/space` only are refused, and a backslash is not one of them), a
 * name no project declares — so 65 population rows sat in `ext?` with a claim that says "outside" and
 * cannot be checked. The claim that CAN be checked is the module one, and it is the true one.
 *
 * THE THREE REFUSALS, each because the shape is a PATH rather than a module:
 *   · MORE THAN ONE BACKSLASH — `stage3-release\bin\zig` is a directory path (measured: 6 rows).
 *   · A COLON — `TestDrive:\TestModule.psm1`, `c:\Windows\System32\Calc.exe` are drive paths (11 rows).
 *   · A FILE-EXTENSION LEAF — `.\warp-packer.exe`, `.\lib\Helper.psm1` are scripts/programs on disk
 *     (25 rows), and PS-B18's relative-path rule already owns the leading `./`/`.\` forms.
 * A command name may contain a `-` and an underscore (`Set-_InternalPSDscXMachineTR`), so those are NOT
 * used as refusals; the extension test is the only leaf test, and it is a fixed vocabulary rather than a
 * "has a dot" heuristic because a command name may legally contain a dot.
 */
const moduleQualifiedCommandOf = (t: string): string | null => {
  const at = t.indexOf("\\")
  if (at <= 0) return null
  if (t.indexOf("\\", at + 1) >= 0) return null
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 58 /* : */) return null
  const leaf = t.slice(at + 1)
  if (leaf.length === 0) return null
  const dot = leaf.lastIndexOf(".")
  if (dot > 0) {
    let ext = leaf.slice(dot + 1).toLowerCase()
    if (ext === "exe" || ext === "ps1" || ext === "psm1" || ext === "psd1" || ext === "dll" ||
        ext === "cmd" || ext === "bat" || ext === "com" || ext === "msi") return null
  }
  return t.slice(0, at)
}

/**
 * PSD11 — IS THIS TARGET AN ENVIRONMENT-PROVIDER READ (`env:NAME`)?
 *
 * `$env:PSModulePath` names a PROCESS environment variable. PowerShell's Environment PROVIDER is the
 * namespace it lives in, the prefix is case-insensitive (`$ENV:PATH` is the same binding), and no
 * declaration in any project can be spelled `env:Something` — a scope-qualified name is never a
 * declaration (PS8's rule, unchanged since the first wave).
 *
 * WHY IT NEEDS ITS OWN CLAIM, MEASURED. The generic externality reading fires on the `:` and the
 * arbiter then refuses to check it: `externalClaimOf` routes the row to `owner`, and
 * `verifyExternalClaim` refuses an owner that is not identifier-shaped — `env:TEMP` carries a colon,
 * which is also a path/URI byte, so a lookup returning 0 would prove nothing and it answers
 * UNVERIFIABLE. Those rows therefore sat in `ext?`, "a claim no check can reach", which clause 1
 * counts against the lane — on the least doubtful fact in the language.
 *
 * THE A/B, same 1,181-file population and same arbiter, only the analyzer's digest differing:
 *   extOK 53,882 -> **54,737**   ext? 3,362 -> **2,507**   extFAIL **60 -> 60**
 *   resolved 98,975 · ambiguous 17,030 · unresolved 19,988 — ALL UNCHANGED
 * That is +855 rows moved out of the unverifiable column for zero refutations and zero resolutions
 * bought, which is the whole contract of a claim. The namespace claim is the kind built for it: the
 * LIST is the evidence, the root is matched by segment, and the claim can never raise `resolved`.
 */
const envProviderRootOf = (t: string): string | null => {
  if (t.length <= 4) return null
  if (t.charCodeAt(3) !== 58 /* : */) return null
  const a = t.charCodeAt(0) | 0x20, b = t.charCodeAt(1) | 0x20, c = t.charCodeAt(2) | 0x20
  if (!(a === 101 /* e */ && b === 110 /* n */ && c === 118 /* v */)) return null
  // THE ROOT AS WRITTEN, NOT FOLDED — `namespaceMatchOf` compares the target's own segment against
  // the list byte for byte, so a folded `"env"` would REFUTE `$ENV:TEMP` (measured: `namespaceMatchOf
  // ("ENV:TEMP", ["env"]) === null`, and the arbiter's own rule for a namespace claim is "a target
  // whose root the claim did not declare is refused"). PowerShell's provider prefix is case-
  // insensitive, so `ENV`, `Env` and `env` are one namespace — but the claim names the spelling the
  // source uses, which is this file's standing convention for every list root (PS-B27).
  return t.slice(0, 3)
}

/**
 * The root a `[T]::new()` type literal denotes once the engine's implicit-`System` rule has run, or
 * `null` when the target carries no shorthand root.
 *
 * A CHARACTER LOOP, not a regex: this file's header forbids a regex that decides a fact, and the
 * fact here is "the first segment is a documented `System.*` namespace". The split is `indexOf`, and
 * a target with no dot has no shorthand root to resolve (a one-segment `[Text]` is not a namespace
 * spelling at all). Nothing after the root is inspected, because the resolver's question is about
 * the FIRST segment: `Text.RegularExpressions.Regex` is `System.Text.RegularExpressions.Regex` for
 * the same reason `Text.UTF8Encoding` is.
 */
const dotNetShorthandRootOf = (t: string): string | null => {
  const dot = t.indexOf(".")
  if (dot <= 0) return null
  const root = t.slice(0, dot)
  let folded = ""
  for (let i = 0; i < root.length; i++) {
    const c = root.charCodeAt(i)
    // ASCII case fold only, and only letters: `| 0x20` on a non-letter cannot produce a letter
    // code point this set carries, because every entry is a lowercase ASCII word.
    folded += String.fromCharCode(c >= 65 /* A */ && c <= 90 /* Z */ ? c + 32 : c)
  }
  return DOTNET_SYSTEM_NAMESPACES.has(folded) ? root : null
}

/**
 * PSD10 — IS THIS ROW A COMMAND-POSITION CALL RATHER THAN A MEMBER CALL?
 *
 * The externality reading has always been SHAPE-based: a Verb-Noun spelling or a qualifier byte.
 * That is a correct test for "this name cannot be a local declaration", and it is the reason a bare
 * `git`, `mkdir` or `dotnet` carried NO reading at all — 34,158 rows over the admitted population,
 * every one of them naming nothing in its own project, and indistinguishable at the gate from a
 * broken edge. The missing fact is not the spelling: it is which CHANNEL emitted the row.
 *
 *   `calls` from a `command` node            a command name the runtime resolves (a cmdlet, an
 *                                            alias, a native program, or a function)
 *   `calls` with `methodCall: true`          `$obj.Method()` — the leaf is a MEMBER name, and a
 *                                            member read has no command reading
 *   `calls` with `staticMemberCall: true`    `[T]::M()` — handled by `ownerMemberAbsent` above
 *   `calls` from an invocation operator      `& name` / `. name` — a command by construction
 *
 * THE CLAIM THIS UNLOCKS IS PER-FILE AND THE ARBITER ALREADY MODELS IT. `externalTarget` is
 * published only where the file declares no symbol of that spelling (`declaredInFile`, the guard
 * this pass has always had), and the arbiter reads a claim ONLY where the name model has nothing
 * (`classifyEdge` consults `verifyExternalClaim` inside `decls === 0`). Where the PROJECT declares
 * the name, the row keeps its declaration answer — resolved, or ambiguous with disposition
 * `ownFileSilent`, which the arbiter reports and does NOT count as a refutation. MEASURED before
 * wiring: of the 36,916 bare command-position rows, 34,158 name nothing project-wide and the other
 * 2,758 (1,899 declared once + 859 many) are rows the claim never reaches. That is why the price of
 * this widening is ZERO refutations and not the 3,680 the lane's earlier note feared.
 */
const isCommandPositionCall = (rel: { type?: unknown; metadata?: Record<string, unknown> }): boolean => {
  if (rel.type !== ASTEngine.RelationshipType.Calls) return false
  const md = rel.metadata ?? {}
  if (md.methodCall === true) return false
  if (md.staticMemberCall === true) return false
  return true
}

/**
 * THE COMMAND READING, WITH THE THREE EXCLUSIONS `externalReadingOf` ALREADY MAKES.
 *
 * `externalReadingOf` returns `null` for two different reasons — "no shape fired" and "this shape is
 * DELIBERATELY refused" — and a `??` fallback cannot tell them apart. It cannot, and the first run
 * proved it: `& .\lib\Helper.psm1` (a RELATIVE path the lane refuses on purpose, PS-B18) collected
 * `externalVia: "command"` and the fixture went red, which is the exclusion doing its job. So the
 * three refusals are re-stated here in the same order: a quoted literal, a relative script path the
 * project may own, and a scope prefix this file can declare into. What remains is a spelling with
 * no shape cue at all, and the CHANNEL is the only fact left that can speak for it.
 */
const commandReadingOf = (t: string): "command" | null => {
  if (t.charCodeAt(0) === 34 /* " */ || t.charCodeAt(0) === 39 /* ' */) return null
  if (isRelativeProjectFilePath(t)) return null
  if (hasFileDefinableScopePrefix(t)) return null
  return "command"
}

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

/**
 * Type accelerators: `[int]`, `[string]`, `[pscustomobject]` …
 *
 * THE LIST IS THE DOCUMENTED ONE, NOT THE REMEMBERED ONE. The first version carried 30
 * names and was measured, on the whole PowerShell corpus, emitting `uses` for 216 typed
 * declarations of accelerators it had never heard of — `[ref]$tokens` (100 rows, the
 * `[ref]` idiom every Pester mock uses), `[bigint]` (34), `[ulong]` (31), `[uint]` (27),
 * `[ushort]` (24), `[object]` (11), `[type]` (6) — each one an edge to a target that is
 * not a project symbol and cannot be, because PowerShell resolves the name to a .NET type
 * before the parser ever sees a declaration. The names below are the built-in table from
 * `Get-TypeAccelerator` (the cmdlet's own output), including the attribute and `Validate*`
 * accelerators: an attribute's type is metadata and is skipped before this set is
 * consulted, but the set should answer the language's question rather than the lane's
 * current use of it.
 *
 * NOT in this set, deliberately: `ordered` (documented shorthand for
 * `System.Collections.Specialized.OrderedDictionary`) is kept although `Get-TypeAccelerator`
 * does not list it — it is a type accelerator in the language and the lane has shipped
 * edges for it; removing it would be a silent narrowing.
 */
const TYPE_ACCELERATORS = new Set([
  // the primitives and their aliases
  "bool", "byte", "char", "datetime", "decimal", "double", "float", "int", "int16",
  "int32", "int64", "long", "sbyte", "short", "single", "string", "uint", "uint16",
  "uint32", "uint64", "ulong", "ushort", "void", "bigint",
  // collections and the object model
  "array", "hashtable", "ordered", "object", "psobject", "pscustomobject",
  "pslistmodifier", "psprimitivedictionary", "pscredential", "scriptblock", "switch",
  "type", "ref", "reftype", "void", "xml", "regex", "wildcardpattern",
  // values the engine names
  "cultureinfo", "guid", "ipaddress", "mailaddress", "semver", "timespan", "uri",
  "version", "nullstring",
  // CIM / WMI
  "cimclass", "cimconverter", "ciminstance", "cimsession", "cimtype",
  "wmi", "wmiclass", "wmisearcher",
  // attributes (metadata, skipped before this set, listed for completeness)
  "alias", "allowemptycollection", "allowemptystring", "allownull", "argumentcompleter",
  "argumentcompletions", "cmdletbinding", "dscresource", "experimentaction", "experimental",
  "experimentalfeature", "feature", "flags", "nocompatiblecommand", "norunspaceaffinity",
  "parameter", "psdefaultvalue", "pstypenameattribute", "supportswildcards",
  "validatecount", "validatedrive", "validatelength", "validatenotnull",
  "validatenotnullorempty", "validatepattern", "validaterange", "validatescript",
  "validateset", "validatetrusteddata", "validateuserdrive",
])

/**
 * PS26 — one declared class member, as the `overrides` matcher needs to see it.
 *
 * A bare name cannot answer "is the base member overridable", and PowerShell
 * answers that question with two attributes the analyzer already parses. `kind` is
 * `method` or `property`, matching the grammar node the declaration came from.
 */
type MemberFact = {
  name: string
  kind: "method" | "property"
  isStatic: boolean
  isHidden: boolean
}

/**
 * PS26 — can `derived`'s member override `base`'s member of the same name?
 *
 * PowerShell class methods are virtual by default and there is no `override`
 * keyword, so a same-named derived method IS an override — that part is the lane's
 * standing rule and it is unchanged. Three cases are NOT overrides and the name
 * match used to publish all three as `overrides`:
 *
 *   1. the base member is `hidden` — the attribute's documented meaning is that
 *      the member is not inherited by derived classes;
 *   2. the base member is `static` — a static member is not virtually dispatched;
 *   3. the two members are of different KINDS — a method does not override a
 *      property, and `classMembers` held both under one key.
 *
 * What is deliberately NOT excluded: a derived PROPERTY over a base property of
 * the same name. PowerShell resolves that to the derived property for a derived
 * instance, so it shadows in the same observable sense a method overrides, and
 * adding it as an override CANDIDATE would publish edges for a construct this
 * corpus carries 0 of. Narrowing and widening are both fabrications; this rule
 * removes and does not add.
 */
const memberOverrides = (derived: MemberFact, base: MemberFact): boolean => {
  if (base.isHidden) return false
  if (base.isStatic) return false
  return derived.kind === base.kind
}

/**
 * PS27 — the member's REAL name, when the pinned wasm has split it.
 *
 * A PowerShell class member is `[modifiers] [type] Name`, and a modifier is a
 * `class_attribute` BEFORE the type node. The pinned local-rebuild wasm mis-lexes
 * a member with NO leading modifier whose name begins with a modifier's letters:
 *
 *     [int] StaticOpen() { return 40 }
 *       -> attribute "[int]" · class_attribute "Static" · simple_name "Open"
 *
 * so `findFirstChild(node, "simple_name")` answers `Open` and every channel that
 * reads the name — the method SYMBOL, its `contains` edge, and the `overrides` name
 * match — publishes the SUFFIX of a method that exists. Measured on a controlled
 * 10-class probe through `getParser("powershell")`: `static [int] StaticOpen()`
 * is CORRECT and `[int] StaticOpen()` is SPLIT, which isolates the trigger to the
 * ABSENCE of a leading modifier rather than to the identifier's text. `[int]
 * Stat()` is correct, so the trigger is the `static` / `hidden` KEYWORD, not the
 * `Static` letters alone.
 *
 * The discriminator is POSITION, and it has to be position: a real modifier and a
 * split name prefix are the same token text, so `text === "static"` cannot tell
 * them apart, and re-joining on the text alone would turn `static [int] Foo()`
 * into a method named `staticFoo`. A modifier precedes the type node; a split
 * prefix follows it. That is the whole test.
 *
 * **This mitigates the NAMING half only, and it is deliberately not a repair of the
 * grammar.** `[int] Hidden() { … }` and `[int] Static2() { … }` are destroyed
 * outright — the same split leaves an ERROR where the parameter list and body were,
 * and the damage reaches the NEXT class header — and no analyzer can recover a node
 * the tree does not contain. Those are a grammar finding, reported with the
 * reproduction, not something this function pretends to fix. Rebuilding the wasm
 * would move the pin hash, and the pin record and the wasm are verified together.
 *
 * Zero regex: the test is node ORDER, and the join is string concatenation.
 */
/**
 * PS27 — one position scan answering both questions a class member's header asks.
 *
 * Returns the member's REAL name and its REAL modifiers, and they are read together
 * on purpose: the two are the same `class_attribute` node read two ways, so a scan
 * that answered only one of them got the other wrong.
 *
 * **What the pinned wasm does.** `grammars/tree-sitter-powershell/grammar.js:1266`
 * builds `class_attribute` as `token(reservedWord('hidden'))` or
 * `token(reservedWord('static'))`, and `reservedWord` (line 1820) is
 * `alias(reserved(caseInsensitive(word)), word)` — and `caseInsensitive` (line 1839)
 * emits `[sS][tT][aA][tT][iI][cC]` with NO word boundary. So the token matches the
 * first six characters of any identifier beginning `Static` or `Hidden`, and
 * `[int] StaticOpen() { return 40 }` parses as
 *
 *     attribute "[int]" · class_attribute "Static" · simple_name "Open"
 *
 * The analyzer published a method named `Open`, stamped `isStatic: true` on it, and
 * matched `overrides` on the suffix. When the remainder starts with a digit or is
 * empty the split is worse — `[int] Hidden2() { … }` and `[int] Static() { … }` leave
 * an ERROR where the parameter list and body were, and the ERROR swallows the NEXT
 * class declaration. Nothing an analyzer does can recover a node the tree does not
 * contain; that half is a grammar fix and is reported, not repaired here.
 *
 * **The discriminator, and how the first attempt got it wrong.** Text cannot decide
 * it: a genuine modifier and a split name prefix are the same token. The first
 * version of this scan used "a `class_attribute` after a type node is a name
 * prefix", and a corpus probe immediately refuted it —
 * `class C7b { [hashtable] static $x; }` at
 * powershell/test/powershell/Language/Classes/Scripting.Classes.BasicParsing
 * .Tests.ps1:35 is a REAL modifier in that position (the test file's own comment
 * reads "order doesn't matter"), so the rule would have reported one live defect
 * and, acted on, dropped `isStatic` from a real static property.
 *
 * So the scan needs BOTH halves:
 *
 *   · a name prefix is immediately preceded by an `attribute`/`type_literal` — a
 *     real modifier is written BEFORE the type in `class_method_definition`'s own
 *     `seq`, so `static [int] Foo()` and a bare `static Foo()` both have the
 *     modifier at index 0 with nothing before it; and
 *   · a name prefix is immediately followed by a `simple_name`. That is the half
 *     that separates the two `attribute · class_attribute · X` shapes: a method's
 *     name is a `simple_name` and a property's is a `variable`, so
 *     `[hashtable] static $x` stays a modifier and `[int] StaticOpen()` is rejoined.
 *
 * KNOWN LIMIT of this rule, stated because it is a rule and not a proof:
 * `[int] static Foo() { }` — modifier after the type on a METHOD — is structurally
 * identical to the split shape and would be read as a name prefix. It does not occur
 * in the admitted corpus (the whole `class_attribute`-after-a-type population is 1
 * member, the `$x` property above, which the `variable` half handles), so it is
 * recorded here rather than solved.
 */
const memberHeaderFacts = (node: Node, nameNode: Node): { name: string; modifiers: string } => {
  const named: { type: string; text: string }[] = []
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c || !c.isNamed) continue
    named.push({ type: c.type, text: c.text })
  }
  const modifiers: string[] = []
  let prefix = ""
  for (let i = 0; i < named.length; i++) {
    if (named[i].type !== "class_attribute") continue
    const prevType = i > 0 ? named[i - 1].type : ""
    const nextType = named[i + 1]?.type ?? ""
    const isNamePrefix =
      (prevType === "attribute" || prevType === "type_literal") && nextType === "simple_name"
    if (isNamePrefix) prefix = named[i].text
    // Lowercased because PowerShell keywords are case-insensitive: `[int] STATIC
    // Foo()` is the same declaration as `[int] static Foo()`, and every caller
    // tests with `.includes("static")`. The helper this replaced lowercased too, so
    // dropping it here would be a silent behaviour change rather than a cleanup.
    else modifiers.push(named[i].text.toLowerCase())
  }
  const name = prefix ? prefix + nameNode.text : nameNode.text
  return { name, modifiers: modifiers.join(" ") }
}

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
    /**
     * PS-B26 — `lowercased className → the declared spelling`.
     *
     * PowerShell class names are case-insensitive, like every other identifier in the
     * language, and `baseClassByClass` stores the base as it was WRITTEN. Both maps were read
     * back by exact key, so a header `class Kid : base` where the declaration says `Base`
     * resolved to no class: the `overrides` chain stopped at the first hop and the chain
     * lookup below (`baseClassByClass.get(base)`) never found the next one either. The
     * spelling map is the fix and the target of the edge becomes the DECLARED name, which is
     * the symbol the store has.
     */
    const classDeclaredSpelling = new Map<string, string>()
    /**
     * PS26 — `className → its own declared members`, and a member is no longer a
     * bare NAME.
     *
     * The set held `string`, which made the `overrides` matcher a pure name
     * comparison and threw away three facts the analyzer had ALREADY read off the
     * same node: `isStatic` (line 1415) and `isHidden` (line 1416) go onto the
     * symbol, and the node's own type says whether the member is a method or a
     * property. PowerShell uses two of those three to say "this is not an
     * override":
     *
     *   `hidden`  — the documented meaning of the attribute is that the member is
     *               NOT inherited by derived classes. A base member marked `hidden`
     *               whose name a derived class re-declares is, by the language's own
     *               rule, a shadow at most. Publishing `overrides` for it is a
     *               fabricated edge: the language has said no.
     *   `static`  — a static member is not virtually dispatched, so neither a
     *               derived instance method nor a derived static method of the same
     *               name overrides it. Matched on the BASE side, because a base
     *               static method is the member that cannot be overridden.
     *   KIND      — a derived METHOD named like a base PROPERTY is two different
     *               members. `classMembers` was filled from properties as well as
     *               methods, so that pair published an `overrides` edge naming a
     *               method that overrides a property.
     *
     * **The corpus cannot reach any of the three.** Measured over all 1,108
     * admitted files through production `parseFile` plus a parse-tree count of
     * every `class_statement` / `class_method_definition` /
     * `class_property_definition` (`validation/m14/fixtures/powershell/
     * adversarial-probes.ts` P1): class members carrying `hidden` = **0**,
     * carrying `static` = **0**, same-name derived/base pairs whose kinds differ =
     * **0**. The change is therefore a REMOVAL rule with a measured population of
     * zero, pinned by `overrides-modifiers` in the fixture suite rather than by the
     * corpus — and this comment says so, because a fix whose corpus delta is 0 and
     * which is described as corpus-verified would be the exact lie this lane's
     * other two false doc rows were.
     */
    const classMembers = new Map<string, Set<MemberFact>>()
    /** Subclass member declarations, resolved after the whole file is read. */
    const overrideCandidates: { className: string; memberName: string; line: number; fact: MemberFact }[] = []

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
        // `part_of` is read from a DIRECTIVE — the dot-source operator is syntax that
        // names the part, and the edge exists because the directive exists. That is
        // the fleet's `import_based` class (erlang ER-D46: "both are directives"), and
        // it is the class css's plain-file `@import` relabel carries. The branch is
        // LIVE rather than dead: the `isImport` short-circuit above fires only for
        // rows that pass `import: true`, which a `part_of` row does not.
        case ASTEngine.RelationshipType.PartOf:
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
      // THE AUTOMATIC-VARIABLE GUARD IS A VARIABLE RULE, NOT A NAME RULE.
      // `$Error` is session state, so `$Error = @()` must not declare a variable — but
      // `enum LogLevel { Error = 0x2 }` declares an ENUM MEMBER named Error, and
      // `function Host {}` or `class Input {}` are legal declarations of other kinds.
      // This guard was kind-blind, so every declaration whose name happened to match an
      // automatic variable was dropped: measured, `enum LogLevel` lost its `Error`
      // member (contains LogLevel -> Error) while the oracle kept it, which is how the
      // differential surfaced a suppression that had nothing to do with variables.
      if (kind === ASTEngine.SymbolKind.Variable && isAutomatic(clean)) return null
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
    const addContains = (target: string, line: number | null, kind?: ASTEngine.SymbolKind) => {
      const owner = top().owner
      if (!owner || owner === target) return
      // Same rule as `pushSymbol`, and it has to be the same or one of the two will
      // silently re-suppress a declaration the other accepted: the automatic list is a
      // VARIABLE list. An enum member, method, property, class or function named `Error`
      // is a declaration and gets its containment edge.
      if ((kind === undefined || kind === ASTEngine.SymbolKind.Variable) && isAutomatic(target)) return
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
      addContains(name, containsLine, kind)
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
      let leaf = member.text
      if (!leaf) return
      // A QUOTED MEMBER NAME IS THE SAME MEMBER. `$this."config-file"` is how a hyphenated
      // name MUST be written, and the grammar keeps the quotes in `member_name.text`, so
      // `isPlausibleSymbolName` refused the quote characters and the read published NOTHING.
      // Measured on the whole corpus (2026-10-28): `$testFailure.failure."stack-trace"`,
      // `$this."test-framework"`, `$this."run-date"` — 40 rows the harness's own oracle
      // derived and this pass dropped, all of them reads of a class property the file
      // declares. One matched pair is stripped, by code point; the inside must be a STATIC
      // name, because `$obj."$name"` is a dynamic member and its name is not the variable's
      // own spelling.
      let quotedMemberName = false
      if (leaf.length >= 2) {
        const q = leaf.charCodeAt(0)
        if ((q === 34 || q === 39) && leaf.charCodeAt(leaf.length - 1) === q) {
          const inner = leaf.slice(1, -1)
          if (inner.length > 0 && inner.indexOf("$") < 0) { leaf = inner; quotedMemberName = true }
        }
      }
      // A DYNAMIC MEMBER NAME IS A VARIABLE READ, not a member. `$deps.targets.${targetRuntime}`
      // and `$Module.Params.$alias` use the VARIABLE's value as the member name, so the fact to
      // publish is the read of that variable — and the binding pass resolves it exactly like any
      // other read (`uses Clear-NativeDependencies.targetRuntime`). Measured: the corpus derives
      // these reads (`${targetRuntime}`, `$alias`, `$key`) and this pass dropped every one on the
      // `$` guard. The guards are the read pass's own: automatic variables are engine bindings,
      // and a name that is not an identifier is recovery text.
      if (leaf.charCodeAt(0) === 36 /* $ */) {
        const raw = stripDollar(leaf.trim())
        const name = raw.length > 1 && raw.charCodeAt(0) === 64 /* @ */ ? raw.slice(1) : raw
        if (!name || isAutomatic(name) || !isPlausibleSymbolName(name)) return
        addRel(top().scope, name, ASTEngine.RelationshipType.Uses, 0.9,
          member.startPosition.row + 1, {
            powershellSpecific: true,
            isMemberAccess: true,
            isVariableReference: true,
            isDynamicMemberName: true,
            ...(kind === "write" ? { isMemberWrite: true } : { isMemberReference: true }),
          })
        return
      }
      // F9 AT THE MEMBER LEAF, measured 2026-10-27. `$1.2.3.4` and
      // `$intKeys.1.2.3.4` (PSScriptAnalyzer's InvalidMultiDotValue tests) are a
      // numeric dotted chain, and the grammar hands each numeric run to this pass as
      // a `member_name`. The pass published `uses -> 2.3`, `uses -> 3.4` and
      // `uses -> 1.2` — targets no symbol can have, which the incoming gate then
      // counted as external claims its own project REFUTED. `isPlausibleSymbolName`
      // does not catch them: it allows digits and dots, because a DECLARED name may
      // contain both. A MEMBER name may not be numbers only, so the extra test here
      // is that the leaf contains at least one letter or underscore. The receiver is
      // still not published (the family leaf contract), so a numeric chain now
      // publishes nothing rather than a fabricated edge.
      let hasNameChar = false
      for (let i = 0; i < leaf.length; i++) {
        const c = leaf.charCodeAt(i)
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 /* _ */) { hasNameChar = true; break }
      }
      if (!hasNameChar || !isPlausibleSymbolName(leaf)) return
      addRel(top().scope, leaf, ASTEngine.RelationshipType.Uses, kind === "write" ? 0.9 : 0.8,
        member.startPosition.row + 1, {
          powershellSpecific: true,
          isMemberAccess: true,
          // PSD14 — THE MEMBER'S NAME WAS WRITTEN IN QUOTES, so its punctuation is DATA. A quoted
          // name is how PowerShell spells a property whose name no identifier can carry
          // (`$build.triggerInfo.'pr.number'` is ONE property called `pr.number`), and the dot in
          // it is not a qualifier. The externality pass asks the arbiter's OWNER question about the
          // text before that dot — `pr` — which the project answers with a VARIABLE, so the row was
          // REFUTED for a claim the source never made. MEASURED: 2 whole-population rows. The row
          // and its `noDeclarationInFile` fact stay; only the name claim is withheld.
          ...(quotedMemberName ? { isQuotedMemberName: true } : {}),
          ...(kind === "write" ? { isMemberWrite: true } : { isMemberReference: true }),
        })
    }

    /**
     * PS-B26 — a PARAMETER DEFAULT is an expression that RUNS, so it READS.
     *
     * `param([string]$Channel = $dotnetCLIChannel)` reads `$dotnetCLIChannel`; the
     * harness's own read oracle derives that row (measured: `uses -> dotnetCLIChannel`
     * and `-> dotnetCLIQuality` on build.psm1's `Install-Dotnet` and `Start-PSBootstrap`),
     * and this analyzer published none, because the parameter branch only DECLARED the
     * parameter. A default can also CALL a command (`= Get-Date`); the main walk already
     * reaches the call, because the default node is part of the tree — only the VARIABLE
     * reads needed a dedicated pass, since reads are emitted by position-specific cases.
     *
     * `skipBlocks` is true for the same reason every command-argument read uses it: a
     * script block in a default (`= { $x }`) is a SCOPE, and its body is read by the main
     * switch with its own frame, so descending here would attribute its locals to the
     * declaration's owner.
     */
    const emitParameterDefaultReads = (sp: Node) => {
      const def = findFirstChild(sp, "script_parameter_default")
      if (def) emitVariableReads(def, true, "isParameterDefault")
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
        // F9, the here-string PRE-EMPTION. An expandable here-string is read by its
        // OWN case in the switch, which stamps `isHereStringInterpolation` so the
        // here-string half of F9 is independently revertible. This pass is called
        // for a command's arguments and for an assignment's right-hand side BEFORE
        // the switch reaches the here-string node, so without this stop the first
        // row won `addRel`'s source|type|target|line dedupe and the dedicated marker
        // was NEVER published — measured on 2026-10-27: 0 of the 115 `uses` edges
        // across the powershell fixture suite carried it, so the marker's mutant
        // (`here-string-interpolation-unread`) was a no-op that reported SURVIVED.
        // The dedicated case passes the here-string node itself with that marker; a
        // nested here-string cannot occur, so skip only when this is a DESCENT.
        if (n.type === "expandable_here_string_literal" && marker !== "isHereStringInterpolation") continue
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
          //
          // A SCOPE-QUALIFIED NAME IS EXEMPT: `$env:ProgramFiles(x86)` IS an environment
          // variable's name, and the identifier test rejects it for the parentheses that
          // are part of that name. The plausibility guard exists to drop RECOVERY TEXT
          // (`$method()` and the rest of a truncated line), not to decide what an
          // environment variable may be called — the colon already marks the name as
          // external, which is the same argument PS8's note makes for keeping the prefix.
          const isScopedName = isQualified(n.text) || isQualified(`$${name}`)
          if (!isScopedName && !isPlausibleSymbolName(name)) continue
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
          if (!name || isAutomatic(name)) continue
          const isScoped = isScopedName
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

    /**
     * PS36 — a bare assignment's RIGHT-HAND SIDE is a read.
     *
     * `emitVariableReads` with one extra stop: it does NOT descend into a command
     * invocation. `$b = Get-Thing -Name $a` already publishes `uses -> a` from the
     * argument reader, carrying `isArgumentReference` and the argument's own line;
     * reading it again from here republished the same source|type|target|line FIRST
     * (this pass runs on the enclosing `assignment_expression`, which the switch reaches
     * before the command nested inside it) and the dedupe discarded the richer row. For
     * `New-Object` that cost the `isDynamicTypeName`/`viaNewObject` marking that
     * `new-object-variable-psb14` pins on four rows.
     *
     * Nothing is lost by stopping at the command boundary: the command's own case walks
     * the same subtree in the same visit, immediately after this one returns.
     */
    const emitAssignmentReads = (node: Node) => {
      const work: Node[] = [node]
      while (work.length > 0) {
        const n = work.pop()!
        // `command`, not `command_expression`: the node this pinned grammar builds
        // for an invocation is `command`, and `command_expression` appears NOWHERE
        // in it. Written as the wrong name the guard never fired, which is how the
        // `new-object-variable-psb14` rows were still being pre-empted; the correct
        // name fixed that, and the wrong one stayed behind as a disjunct that could
        // never be true. Confirmed 2026-10-08 against the shipped wasm (no such node
        // type) and by a real parse of `Get-Thing -Name x`, whose invocation shape
        // is `pipeline_chain -> command`. Removed so the guard reads as what it is.
        if (n.type === "command") continue
        // AN ELEMENT ACCESS IS OWNED BY ITS OWN CASE, AND ITS RECEIVER IS NOT A READ.
        //
        // `$vAst = $elements[$i+1]` published `uses elements` AND `uses i` from this pass,
        // because the walk stops at `variable` nodes and an element access is not one — so
        // it descended PAST the `element_access` node the read pass knows how to skip, and
        // handed the receiver and the key to `emitVariableReads` one at a time. PS9's ruling
        // is that the readable thing in `$names[$index]` is the KEY, and `member-reads-psb5`
        // forbids the RECEIVER by name; the dedicated `element_access` case already reads
        // the key, with `isElementAccess`, so stopping here loses nothing and removes a row
        // the fixture has already ruled on. Measured on build.psm1: `uses Get-PesterTag ->
        // elements` at 1490, `resultMap` at 4085, `versionParts` at 4911 — three shapes, one
        // branch, and each was scored as an analyzer edge the truth could not explain.
        if (n.type === "element_access") continue
        // The same pre-emption, one pass over: an expandable here-string's reads are
        // emitted by the dedicated `expandable_here_string_literal` case with their
        // own marker. Descending here first would publish them as plain assignment
        // reads and win the dedupe (see `currentParent`/`addRel`).
        if (n.type === "expandable_here_string_literal") continue
        if (n.type === "variable" || n.type === "braced_variable" || n.type === "member_access") {
          emitVariableReads(n, true, "isAssignmentRead")
          continue
        }
        if (n.type === "script_block_expression" || n.type === "named_block") continue
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
     * PS29 — is the node an argument's value came from a `variable`?
     *
     * The question a string cannot answer. `New-Object System.Version` and
     * `New-Object $type` are both `stripQuotes`-ed text, and the first is a type name
     * while the second is a variable holding one — the TEXT alone is `System.Version`
     * and `type`, which look equally like names. Only the node says which.
     *
     * **This predicate was written with THREE arms and now has ONE, and the revert
     * proof is why.** Both extra arms were dead code that survived being reverted:
     *
     *   · an `expandable_string_literal` arm, on the reasoning that `"$t"` is an
     *     interpolation and `'$t'` is a literal. Unreachable — the pinned grammar always
     *     wraps a quoted argument in `array_literal_expression > unary_expression >
     *     string_literal`, so the argument node is never the quoted node itself.
     *   · an `array_literal_expression || unary_expression` arm doing its own
     *     `findDescendantVariable` search. Also unreachable, and for a sharper reason:
     *     **`commandArgs` has already done that search.** It pushes the UNWRAPPED
     *     `variable` node into `sourceNodes`, not the wrapper it was found under, so the
     *     node arriving here is the `variable` and the first arm answers. Reverting this
     *     arm alone left the fixture suite green.
     *
     * So the shape table belongs to `commandArgs`, which is where the unwrapping
     * happens, and this predicate is one node-type test:
     *
     *   `New-Object $t`             -> commandArgs pushes `variable "$t"`          -> uses
     *   `New-Object "$t"`           -> commandArgs pushes `variable "$t"`          -> uses
     *   `New-Object -TypeName $t`   -> commandArgs pushes `variable "$t"`          -> uses
     *   `New-Object -TypeName 'lit'`-> commandArgs pushes `string_literal 'lit'`    -> instantiates
     *   `New-Object System.Version` -> commandArgs pushes `generic_token`           -> instantiates
     *
     * A branch that cannot affect any output is an L2 dead branch, and this file
     * already records two earlier mutants that survived because of one. Both arms were
     * removed rather than commented, and `mutant-proof-psb14.sh` pins what replaced
     * them: a revert of the `commandArgs` unwrapping, and a revert of the node handoff.
     */
    const nodeIsAVariableReference = (node: Node): boolean => node.type === "variable"

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
    const commandArgs = (node: Node, sourceNodes?: Node[], onlyParameters?: Set<string>): string[] => {
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
          // A PARAMETER'S VALUE BELONGS TO THAT PARAMETER (PS-B26). `onlyParameters` is the
          // caller's claim that only these flags name the thing it is reading; a value of any
          // other flag is that flag's business. `Import-Module` is the reason it exists:
          // `-RequiredVersion 1.0` and `-ErrorVariable ErrorImportingModule` are not module
          // names, and the import reader took every value this function returned.
          let flag = ""
          {
            const raw = this.stripQuotes(c.text).trim()
            let s = raw.length > 0 && raw.charCodeAt(0) === 45 /* - */ ? raw.slice(1) : raw
            const colon = s.indexOf(":")
            if (colon >= 0) s = s.slice(0, colon)
            flag = s.toLowerCase()
          }
          if (next && isValueToken(next) && !SWITCH_ARGUMENT_VALUES.has(next.text.toLowerCase()) && (!onlyParameters || onlyParameters.has(flag))) {
            out.push(this.stripQuotes(next.text))
            sourceNodes?.push(next)
          }
          continue
        }
        if (isValueToken(c)) { out.push(this.stripQuotes(c.text)); sourceNodes?.push(c); continue }
        if (c.type === "array_literal_expression" || c.type === "unary_expression") {
          // A QUOTED STRING IS ITS OWN VALUE, AND THE FIRST-VARIABLE SEARCH IS NOT A VALUE READER.
          //
          // The pinned grammar wraps EVERY quoted argument as `array_literal_expression >
          // unary_expression > string_literal`, so a quoted interpolation reaches this branch
          // before the string is ever considered as a string. The branch used to run
          // `findDescendantVariable` first and publish the variable it found, which is right
          // for `-TypeName "$t"` (a variable holding a type name — PS29) and wrong for every
          // quoted value that CONTAINS a variable among other text:
          //
          //     Import-Module "$PSScriptRoot/../../tools/ci.psm1"
          //
          // published `imports -> PSScriptRoot`, `references -> PSScriptRoot` — a VARIABLE
          // name where the module's path belongs. Measured over the authoritative corpus
          // (reconcile-f5.mts, every admitted file): 209 `imports` + 203 `references` rows of
          // exactly this shape, the largest single disagreement class on the lane. The
          // unquoted spelling of the same path (`Import-Module $PSScriptRoot/../x.psm1`) is a
          // `generic_token` and was already published as the whole path, so the analyzer
          // disagreed with ITSELF depending only on quoting.
          //
          // So the quoted node's VALUE is read first, and the variable handoff is kept only
          // when the whole value IS that variable (`"$t"`), which is the one case PS29 acts on:
          // the value stays the bare name there (a `$`-prefixed `uses` target is the F9 defect),
          // and every other quoted value keeps its text with the sigils where the author put
          // them. `sourceNodes` carries the node the value came from, so a consumer can still
          // tell `"$t"` from `'$t'`.
          const lit = this.findQuoted(c)
          if (lit) {
            const value = this.stripQuotes(lit.text)
            const v = findDescendantVariable(c)
            if (v && value.trim() === v.text) {
              out.push(stripDollar(v.text))
              sourceNodes?.push(v)
            } else {
              out.push(value)
              sourceNodes?.push(lit)
            }
            continue
          }
          const v = findDescendantVariable(c)
          if (v) { out.push(stripDollar(v.text)); sourceNodes?.push(v); continue }
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
    /**
     * PS25 — is this export target a POWERShell WILDCARD rather than a name?
     *
     * `Export-ModuleMember -Function *` and `Export-ModuleMember -Function
     * Measure*` are the same kind of declaration: the module publishes every
     * function matching a PATTERN, and the expansion happens at run time. So
     * there is no single name to publish, and an edge whose target is a pattern
     * names a symbol no PowerShell identifier can ever be — `*` is not a legal
     * character in a function name, so `Measure*` resolves against nothing by
     * construction rather than by accident.
     *
     * The guard was `name.startsWith("*")`, which is POSITIONAL: it caught the
     * bare `*` and nothing else. Measured over the whole admitted corpus through
     * production `parseFile` (`validation/m14/fixtures/powershell/
     * adversarial-probes.ts` P3): `exports` edges carrying a wildcard in ANY
     * position = **7**, every one of them the target `Measure*`; edges whose
     * target is exactly `*` = **0**. So the refusal existed and did not fire,
     * and 7 of the lane's 113 `exports` edges named a wildcard.
     *
     * Two places said otherwise and were both wrong, which is why this is a
     * source fix and not a doc fix: the Contract table and the declared
     * limitations both claimed `-Function *` "publishes the literal `*`", and a
     * controlled probe through `parseFile` reads `-Function *` as publishing
     * NOTHING while `-Variable Get-Foo` and `-Alias 'Get-Bar','Get-Foo'` both
     * publish. The doc rows are corrected alongside this change; the code was
     * already right about `*` and wrong about `Measure*`.
     *
     * Zero regex: `*` is code 42 and `?` is 63.
     */
    const isExportWildcard = (name: string): boolean => {
      for (let i = 0; i < name.length; i++) {
        const code = name.charCodeAt(i)
        if (code === 42 /* * */ || code === 63 /* ? */) return true
      }
      return false
    }

    const addExport = (name: string, via: string, line: number) => {
      if (!name || isExportWildcard(name)) return
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
        powershellSpecific: true, viaExportModuleMember: true, via, fileLevel: atFileScope(),
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

    // ------------------------------------------------- PSD14 — the file's OWN type context
    //
    // TWO FACTS ARE READABLE BEFORE THE WALK, and both are about names the file introduces
    // OUTSIDE the PowerShell declaration name space. Neither can be asked after the walk, because
    // the walk emits the type literals as it passes them.
    //
    //   `using namespace U`   PowerShell's DOCUMENTED type-resolution ladder (about_Using) tries
    //                         each such prefix after the name as written, so `[Language.X]` under
    //                         `using namespace System.Management.Automation` names
    //                         `System.Management.Automation.Language.X`. MEASURED: 22 whole-population
    //                         `uses` rows were REFUTED for exactly this reason — the edge carried the
    //                         spelling `Language.X`, whose root the project answers with a VARIABLE,
    //                         while the same file's fully-qualified spelling at another line
    //                         (`System.Management.Automation.Language.X`) verified as a namespace claim.
    //
    //   `Add-Type`            compiles C# at RUN time. `[Foo.Bar]::new()` after
    //                         `Add-Type @' namespace Foo { public class Bar {} } '@` names the type the
    //                         FILE creates; it is not a declaration the project owns, and a claim that
    //                         asks the project's OWNER question about `Foo` is a false statement.
    //                         MEASURED: 3 `instantiates` rows refuted, each with the type source in the
    //                         same file (one via `-TypeDefinition @'…'@`, one via a here-string in a
    //                         variable passed to `-PassThru`, one via `-ArgumentList` into a remote
    //                         `Add-Type`).
    //
    // AND ONE MORE, for the same reason at the other end of the file: the names THIS FILE DECLARES
    // as classes/enums, so a bare type literal can be refused the using-namespace expansion when the
    // file's own declaration is what the engine would find first.
    const usingNamespacePrefixes: string[] = []
    const typeNamesInFile = new Set<string>()
    const addTypeCreatedNames = new Set<string>()
    // PSD15 — the full declarations the file's `Add-Type` makes, lowercase key -> declared spelling.
    // These are the OWNER names a static call through such a type carries, which is what the claim
    // pass needs; they are not published as symbols (see the record below the pre-pass).
    const addTypeDeclarations = new Map<string, string>()
    const recordAddTypeDeclaration = (full: string): void => {
      if (full.length === 0) return
      const key = full.toLowerCase()
      if (!addTypeDeclarations.has(key)) addTypeDeclarations.set(key, full)
    }
    {
      const stack: Node[] = [rootNode]
      const hereStringBodies: string[] = []
      let addTypeSeen = false
      const valueNodeText = (n: Node): string => this.stripQuotes(n.text).trim()
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "class_statement" || n.type === "enum_statement") {
          const nameNode = findFirstChild(n, n.type === "class_statement" ? "class_name" : "enum_name")
          if (nameNode && nameNode.text) typeNamesInFile.add(nameNode.text.toLowerCase())
        }
        // A HERE-STRING IS WHERE AN `Add-Type` C# BODY LIVES. The pinned grammar hands it to the
        // analyzer as a `string_literal` whose text opens with `@` (verbatim or expandable), which
        // is why the marker is the first BYTE and not a node type.
        if (n.type === "string_literal" && n.text.length > 2 && n.text.charCodeAt(0) === 64 /* @ */) {
          hereStringBodies.push(n.text)
        }
        if (n.type === "command") {
          const nameNode = findFirstChild(n, "command_name")
          const leaf = nameNode ? nameNode.text.toLowerCase() : ""
          if (leaf === "using" || leaf === "add-type") {
            const elements = findFirstChild(n, "command_elements")
            const values: Node[] = []
            let addNamespace = ""
            let addName = ""
            if (elements) {
              for (let i = 0; i < elements.namedChildCount; i++) {
                const c = elements.namedChild(i)
                if (!c) continue
                if (c.type === "command_parameter") {
                  const next = elements.namedChild(i + 1)
                  if (!next) continue
                  const flag = stripLeadingDash(this.stripQuotes(c.text)).toLowerCase()
                  if (leaf === "add-type" && (flag === "namespace" || flag === "name")) {
                    const spelled = valueNodeText(next)
                    if (spelled.length > 0) addTypeCreatedNames.add(spelled.toLowerCase())
                    if (spelled.length > 0) {
                      if (flag === "namespace") addNamespace = spelled
                      else addName = spelled
                    }
                  }
                  continue
                }
                if (
                  c.type === "generic_token" || c.type === "string_literal" ||
                  c.type === "expandable_string_literal" || c.type === "array_literal_expression" ||
                  c.type === "unary_expression"
                ) values.push(c)
              }
            }
            if (leaf === "using") {
              // `using namespace U` — the directive and its value are the first two VALUES.
              if (values.length >= 2) {
                const directive = valueNodeText(values[0]).toLowerCase()
                const target = valueNodeText(values[1])
                if (directive === "namespace" && target.length > 0) usingNamespacePrefixes.push(target)
              }
            } else {
              addTypeSeen = true
              // `Add-Type -Namespace N -Name C` states the type's full name directly.
              if (addNamespace.length > 0 && addName.length > 0) {
                recordAddTypeDeclaration(`${addNamespace}.${addName}`)
              }
            }
          }
        }
        for (let i = n.childCount - 1; i >= 0; i--) {
          const child = n.child(i)
          if (child) stack.push(child)
        }
      }
      // THE C# BODIES ARE READ ONLY WHEN THE FILE ACTUALLY COMPILES SOMETHING. A here-string that
      // contains `class`/`namespace` in a file with no `Add-Type` is a string, not a declaration.
      if (addTypeSeen) {
        for (const body of hereStringBodies) {
          addTypeNamesIn(body, addTypeCreatedNames, addTypeDeclarations)
        }
      }
    }
    // PSD15 — THE TYPES ARE DECLARATIONS, AND PUBLISHING THEM IS MEASURED, PRICED AND **NOT TAKEN**.
    // (The paragraph below is the record; the code that did it is not in the tree.)
    //
    // The 62 rows PSD14 withdrew a claim from name types this file compiles, so publishing those
    // types as symbols (name = the dotted .NET name, `metadata.fqn` = the same, which is the key the
    // index resolves a target by) turns the claim into a RESOLUTION — and it does: the whole-population
    // arm moved **62 rows from unresolved to resolved, and nothing else** in the first half.
    //
    // BUT THE SECOND HALF IS WHY IT IS NOT SHIPPED, and it is a property of the ARBITER'S QUESTION, not
    // of the symbol: a published type makes `declCount` answer its own name, and the owner question
    // strips the LAST segment. `[Ansible.AccessToken.Win32Exception]` (a runtime type) asks about
    // `Ansible.AccessToken`, which is now a PUBLISHED CLASS (a different file's `class AccessToken`) —
    // so the project "owns" the owner and the claim is REFUTED. MEASURED on the fully-wired tree:
    // **39 refuted claims appeared** (static calls through the new types, 33 of them, plus these six),
    // and withholding the static-call reading — correct on its own terms, a call into a file-compiled
    // type is not external — left **6** from `catch [Ansible.AccessToken.Win32Exception]` in files that
    // compile nothing at all, where this analyzer has no evidence to act on. Clause 4 would go 0 → 6.
    //
    // So the publication waits for the arbiter's `typeNames` patch (an owner claim may be refuted only
    // by a declaration that could BE an owner — a TYPE), which is already filed with the Lead. The
    // price of that patch on this lane is now MEASURED rather than estimated: **+62 resolved**, and 0
    // refuted once the owner question is type-aware. `addTypeDeclarations` is kept because the
    // static-call rule below needs the names; the symbols are the part that waits.

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
          // PS-B21 — A FUNCTION'S PARAMETERS ARE DECLARATIONS IN THE FUNCTION'S OWN
          // SCOPE, and until now they were only METADATA on the function symbol. The
          // lane's own `contains` contract says "a function its locals and parameters",
          // and the independent F5 oracle derives a parameter as a containment — so
          // every parameter in the corpus was a MISSING row while its reads had no
          // declaration to bind to. Declared AFTER the frame push, because `addContains`
          // takes its owner from the frame: declared before it, they would nest in the
          // enclosing file or class.
          {
            const paramList = inlineList ?? direct ?? blockList
            if (paramList) {
              for (const sp of this.collectChildrenByType(paramList, "script_parameter")) {
                const v = findFirstChild(sp, "variable")
                if (!v) continue
                if (isQualified(v.text)) continue
                declareSymbol(stripDollar(v.text), ASTEngine.SymbolKind.Variable, v, v.startPosition.row + 1, {
                  isParameter: true,
                  type: typeSpecText(sp) || "untyped",
                })
                emitParameterDefaultReads(sp)
              }
            }
          }
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
            // PS-B26: the default is an expression that RUNS. See emitParameterDefaultReads.
            emitParameterDefaultReads(p)
          }
          break
        }

        // ---------------------------------------------------------- classes
        case "class_statement": {
          const names = this.collectChildrenByType(node, "simple_name")
          if (names.length === 0) break
          const className = names[0].text
          // PS-B26: the DECLARED spelling, keyed case-insensitively — see classDeclaredSpelling.
          if (!classDeclaredSpelling.has(className.toLowerCase())) classDeclaredSpelling.set(className.toLowerCase(), className)
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
          // PS28 — create the set ONCE per class name, do not reset it. This line
          // used to be `classMembers.set(className, new Set())` on EVERY
          // class_statement, so a file that declares the same class name twice left
          // only the LAST declaration's members reachable. The corpus measures
          // exactly that: in
          // powershell/test/powershell/Language/Classes/scripting.Classes.inheritance
          // .tests.ps1 — a Pester file that redeclares `A`, `B`, `C`, `bar`, `baz`,
          // `MyIntList` and `TestHost` across ~40 `It` blocks — the last `class B`
          // declares only a constructor, so `classMembers.get("B")` was EMPTY, and
          // the last `class A` declares only properties `i` and `s`, so
          // `classMembers.get("A")` held no methods. The parse tree holds 8
          // same-name derived/base method pairs in that one file; the matcher could
          // see 2, and the lane published 2 `overrides` edges.
          //
          // Accumulating is the honest direction and not the convenient one: every
          // pair the union exposes is a `class B : A` and a `class A` that BOTH
          // appear in the SAME file, so `B.GetName` really does override
          // `A.GetName` under PowerShell's rules. Reset was losing facts, not
          // suppressing fabrications — the opposite of the usual reason to narrow.
          //
          // `baseClassByClass` deliberately does NOT get the same treatment: its
          // `set` is already inside `if (baseClass)` (line 1351), so a base-less
          // redeclaration leaves the earlier base in place. That asymmetry is
          // correct — a redeclaration with no base says nothing about the base of
          // the earlier one — and it is called out here so the two maps are not
          // "fixed" together by the next reader.
          if (!classMembers.has(className)) classMembers.set(className, new Set())
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
          // PS27 — see `memberHeaderFacts`. Without this the symbol, its `contains`
          // edge and the `overrides` match all read the suffix the wasm split off.
          const hdr = memberHeaderFacts(node, nameNode)
          const memberName = hdr.name
          const className = top().owner
          const isCtor = memberName === className
          const line = nameNode.startPosition.row + 1
          const params = collectParameters(this.findMethodParamList(node))
          const attrText = hdr.modifiers // PS27 — the same scan, so the name and the
          // modifiers can never be read with opposite assumptions
          // PS4 — a PowerShell constructor is WRITTEN with the class's own
          // name, so the SYMBOL name is the synthesised `constructor` and the
          // containment edge reads `Class -> constructor`. Naming it after the
          // class made it a self-edge, which the store's M51.A1 guard then
          // refused — so every PowerShell constructor stored ownerless.
          const symName = isCtor ? "constructor" : memberName
          const returnType = typeSpecText(node) || (isCtor ? "void" : "any")
          declareSymbol(symName, isCtor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method, node, line, {
            isStatic: attrText.includes("static"),
            isHidden: attrText.includes("hidden"),
            returnType,
            ...(this.allAttributeTexts(node).length > 0 ? { annotations: this.allAttributeTexts(node) } : {}),
            docstring: this.docstringAbove(nameNode.startPosition.row, lines),
          }, params)
          if (!isCtor) {
            if (classMembers.has(className)) {
              classMembers.get(className)!.add({
                name: memberName, kind: "method",
                isStatic: attrText.includes("static"), isHidden: attrText.includes("hidden"),
              })
            }
            // Resolved after the file is read: a subclass may precede its base.
            overrideCandidates.push({
              className, memberName, line,
              fact: {
                name: memberName, kind: "method",
                isStatic: attrText.includes("static"), isHidden: attrText.includes("hidden"),
              },
            })
          }
          // PS3 — the method is now the SCOPE. Its OWNER stays the class, so a
          // `contains` edge from inside still names the class.
          frames.push({ owner: className, scope: symName, containerLine: line })
          // PS-B21 (the class-method half) — MEASURED AND REFUSED, NOT OVERLOOKED.
          // A class method's parameters are not declarations today, so `$a` in
          // `[void] M([int]$a)` is read with no declaration to bind to: on the
          // controlled corpus that is 2 unresolved of 14 edges. Declaring them the
          // obvious way — in the method's frame — is WRONG, and the twin proves it:
          //
          //   class Twice {
          //       [int] First([int] $x)  { return $x }
          //       [int] Second([int] $x) { return $x + 1 }
          //   }
          //
          // The frame's owner is the CLASS (PS3), and `declareSymbol` dedupes on
          // (owner, name, kind), so the second `$x` is silently dropped and BOTH
          // reads bind to `First`'s parameter — a wrong declaration, which is worse
          // than the unresolved row it replaced. The fix is method-qualified
          // ownership (`Twice.Second.x`), and that is not a local change: the
          // variable-read retarget pass decides visibility from the edge SOURCE,
          // which PS3 deliberately keeps as the method's bare name (`Second`) so
          // `bb_graph Second` works, so a class-qualified scope would be invisible
          // to it. Declaring method-owned LOCALS has the same collision (two
          // methods' `$sum` are one class-owned symbol today), so the honest unit is
          // a method-scope identity on the frame and a retarget pass that reads it —
          // a lane-sized change, recorded rather than half-done. The function half
          // above is unaffected: a function frame's owner IS the function, so its
          // parameters are already method-qualified and unique.
          break
        }

        case "class_property_definition": {
          const varNode = findFirstChild(node, "variable")
          if (!varNode) break
          const line = varNode.startPosition.row + 1
          const attrText = memberHeaderFacts(node, varNode).modifiers // PS27 — a property name is a `variable`, so the split's `simple_name` half never fires here; the scan is shared so the two cannot drift
          const className = top().owner
          const name = stripDollar(varNode.text)
          const declared = typeSpecText(node)
          declareSymbol(name, ASTEngine.SymbolKind.Property, varNode, line, {
            isStatic: attrText.includes("static"),
            isHidden: attrText.includes("hidden"),
            type: declared || "untyped",
            docstring: this.docstringAbove(varNode.startPosition.row, lines),
          })
          if (classMembers.has(className)) {
            classMembers.get(className)!.add({
              name, kind: "property",
              isStatic: attrText.includes("static"), isHidden: attrText.includes("hidden"),
            })
          }
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
            // AN ELEMENT WRITE DECLARES NOTHING EITHER. `$PSDefaultParameterValues["it:skip"]
            // = !$IsWindows` writes a SLOT of an existing value; the variable is not being
            // declared, and this branch declared it anyway because it only looked for
            // `member_access`. Measured on ConsoleHost.Tests.ps1:1007
            // (`contains -> PSDefaultParameterValues`) against an oracle that published no
            // containment there — and the same defect on every `$hash[$key] = …` in the corpus,
            // where the receiver is usually a variable the same function declared a few lines
            // earlier. The dedicated `element_access` case already publishes the KEY, which is
            // the readable name in the construct (PS9), so stopping here loses no edge.
            const elementAccess = findDescendant(left, "element_access", 14)
            if (memberAccess || elementAccess) {
              // The member-write reader is called only for a MEMBER; an element write's
              // readable name is its KEY, and the dedicated case publishes it.
              if (memberAccess) emitMemberUses(memberAccess, "write")
              // NOT a `break`, and that is the whole reason the `else` exists. It used
              // to be a `break`, which silently disabled the right-hand-side read below
              // for EVERY member write: `$cfg.Value = $other` published `uses -> cfg.Value`
              // (the write) and nothing at all for `$other` (the read). The two are
              // independent facts about one line, so both must be published. The `else`
              // preserves exactly what the `break` was protecting: once the member
              // branch has matched there is no `variable` node to declare, so
              // `declareSymbol` stays this branch's job only.
            } else {
              const varNode = findDescendantVariable(left)
              if (varNode && !isQualified(varNode.text)) {
                const line = varNode.startPosition.row + 1
                // PS8 — a suppressed name (an automatic variable) is not a
                // declaration, so it must not become a contained child either.
                // `$this.Name = $x` was publishing `contains Class -> this`.
                declareSymbol(varNode.text, ASTEngine.SymbolKind.Variable, varNode, line, { isVariable: true })
              }
            }
          }
          // PS36 — the RIGHT-HAND SIDE is a read, and it was published nowhere. `$b = $a`
          // declared `$b` and said nothing about `$a`, while `$c = "$a"` published
          // `uses -> a` through the interpolation reader and `$e = Get-Thing -Name $a`
          // published it through the argument reader — so a variable's visibility in the
          // graph depended on which syntax on the same line happened to mention it, which
          // is not a property of the language.
          //
          // Measured before the fix on a deterministic 120-file stride of the 1,181
          // admitted files (`validation/m14/fixtures/powershell/assignment-read-probe.mts`):
          // 699 bare right-hand-side variable reads, of which **61 (8.73%) had a `uses`
          // edge and 638 (91.27%) had none**. Top missing targets: r 47, true 37, null 31,
          // false 27, item 20, actual 19, params 15, _ 10 — the automatic ones are inside
          // `emitVariableReads`' own guard and the rest are ordinary project variables.
          //
          // `skipBlocks` is TRUE, and for the same reason the argument reader passes true:
          // an `element_access` in the right-hand side (`$names[$i]`) must yield the KEY
          // only, because the element-access case publishes that and reading the RECEIVER
          // beside it is the pre-PS9 shape `member-reads-psb5` forbids by name. A script
          // block in the right-hand side is a SCOPE and is read by the frame walker.
          //
          // Overlaps with the interpolation and argument readers are not a hazard, but
          // only where those readers run on the SAME subtree. `addRel` dedupes on
          // source|type|target|line, so two passes publishing the same read produce one
          // row — the FIRST writer's metadata survives and the second is dropped. That
          // makes ordering load-bearing wherever a dedicated reader exists, and it is
          // why this pass reads only the `pipeline` RHS: the `command_expression` inside
          // it is walked by the switch anyway, and its arguments are already read with
          // `isArgumentReference` (and, for `New-Object`, with `isDynamicTypeName`).
          //
          // `skipBlocks` alone is NOT enough for that. `emitVariableReads` recurses
          // GENERICALLY, so handed a `pipeline` it walks straight through
          // `command_expression > command_elements > variable` and republishes the
          // argument as a plain `isAssignmentRead`. Because this switch visits
          // `assignment_expression` BEFORE the `command_expression` nested inside it,
          // this pass writes FIRST, and `addRel`'s dedupe on source|type|target|line
          // then DROPS the dedicated row — so `$d = New-Object "$typeName"` lost
          // `isDynamicTypeName`/`viaNewObject` and kept only `isAssignmentRead`. Caught
          // by `new-object-variable-psb14` losing all four of its expected rows.
          //
          // So the walk stops at the COMMAND boundary. A command invocation's arguments
          // belong to the argument reader, which is where their metadata comes from, and
          // this pass measured no candidate behind that boundary to justify the overlap:
          // `assignment-read-probe.mts` excludes any candidate carrying a
          // `command_elements` ancestor from its own population, for the same reason.
          //
          // NODE IDENTITY IS COMPARED BY BYTE SPAN, NOT BY `===`. `namedChild(i)`
          // returns a FRESH wrapper object on every call, so `child === left` is false
          // even for the identical node — measured, `a === b` is false while `a.id ===
          // b.id` and `a.startIndex === b.startIndex`. Comparing wrappers therefore
          // silently read the LEFT-HAND SIDE as if it were the right: `$a = New-Object
          // $typeName` published `uses -> a` for a variable it is defining, which is a
          // write and not a read. That is a fabricated edge of exactly the kind the
          // contract forbids, and the same `===` mistake would have read every
          // `assignement_operator` as a bare operand.
          const operator = findFirstChild(node, "assignement_operator")
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (!child || child.type === "assignement_operator") continue
            if (child.type === "left_assignment_expression") continue
            if (child.type !== "pipeline") continue
            emitAssignmentReads(child)
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

        // --------------------------- expression reads (conditions, return/throw)
        //
        // A VARIABLE READ IS A READ WHEREVER IT APPEARS, and this lane was reading only
        // five contexts: assignment right-hand sides, command arguments, string
        // interpolation, member/element access and the ++/-- family. Conditions and
        // flow-control statements were not among them, so `if ($x)`, `while ($y)`,
        // `for (…; $i -lt $n; …)`, `switch ($x)`, `return $z` and `throw $e` published NO
        // `uses` edge at all. MEASURED on a six-shape reproduction: analyzer 0 reads,
        // independent oracle 5 (`$x`, `$y`, `$n`, `$z`, `$e`). Over the primary corpus
        // this is the residue the F5 sample kept naming — `uses -> PID` in a condition, a
        // `$null` check, a `return $result` — and it is a drop, not a modelling choice:
        // the same variable in the same position is read whether the statement around it
        // is an assignment or an `if`.
        //
        // Read from the CONDITION WRAPPERS only, and never the statement block: the body
        // is visited by this same switch, so descending into it here would double-read
        // every command argument and every interpolated string with a different marker
        // and lose their per-site attribution (the argument reader's own comment records
        // what that costs). `for_initializer` and `for_iterator` are deliberately NOT in
        // the list: the assignment case owns the initializer (and the `$i` there is a
        // DECLARATION, not a read), and the ++/-- case owns the iterator.
        // A PIPELINE HEAD IS A READ. `$result4 | Should -Be "x"` reads `$result4`, and
        // a bare `$Value` statement (`function f { $Value }`, which is how a PowerShell
        // function RETURNS the parameter) reads it too. Neither is a command: the
        // `command` branch reads only the ARGUMENTS of a command, so the variable at the
        // HEAD of a pipeline had no owner in this switch at all. MEASURED on the
        // ParameterBinding corpus file: nine `$resultN | Should` pipelines plus two bare
        // `$Value` bodies, 15 MISSING `uses` rows on one file; over the primary corpus
        // this was the second-largest recipe in the residue (`uses result` 73,
        // `uses actual` 19, `uses results` 14). A chain that CONTAINS a command is read
        // by the command branch and is skipped here.
        case "pipeline_chain": {
          // A chain is a MIX: `$a | Should -BeExactly $Expected` is one pipeline_chain
          // whose children are `logical_expression($a)`, `|` and `command(Should …)`.
          // Reading the whole chain would pull the command's arguments in with the wrong
          // marker; reading only command-free chains (the first version of this case)
          // dropped the HEAD whenever the chain also carried a command — which is the
          // shape of every `$x | Should -Be …` assertion in a test suite, i.e. most of
          // the corpus.
          //
          // EACH SUBTREE THAT HAS ITS OWN READER IS LEFT TO IT. `$count++`, `$o.M()` and
          // `$(…)` are read by the increment, invokation and sub-expression branches
          // with their own markers (`isCounterUpdate`, `isReceiverReference`,
          // `isSubExpressionRead`), and a generic pipeline read that lands FIRST wins the
          // `addRel` dedupe and replaces the marker — the edge count stays the same and
          // the row silently loses the metadata three fixtures pin by name. So the
          // guard is per subtree, not per node type: a plain `$a` head is read, a head
          // that merely CONTAINS a method call is not.
          const hasOwnReader = (n: Node): boolean => {
            if (
              n.type === "invokation_expression" ||
              n.type === "post_increment_expression" ||
              n.type === "pre_increment_expression" ||
              n.type === "post_decrement_expression" ||
              n.type === "pre_decrement_expression" ||
              n.type === "sub_expression" ||
              n.type === "expandable_string_literal" ||
              n.type === "expandable_here_string_literal" ||
              n.type === "command"
            ) return true
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && hasOwnReader(c)) return true
            }
            return false
          }
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c || c.type === "command" || hasOwnReader(c)) continue
            emitVariableReads(c, true, "isPipelineRead")
          }
          break
        }

        case "if_statement":
        case "elseif_clause":
        case "while_statement":
        case "do_statement":
        case "for_statement":
        case "switch_statement":
        case "flow_control_statement": {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c) continue
            if (
              c.type === "pipeline" ||
              c.type === "switch_condition" ||
              c.type === "while_condition" ||
              c.type === "for_condition"
            ) {
              emitVariableReads(c, true, "isExpressionRead")
            }
          }
          break
        }

        // ----------------------------- a type literal is a TYPE REFERENCE
        //
        // A type named anywhere in an expression is a dependency on that type, and this
        // analyzer only published one when it happened to sit on a DECLARATION: PS12's
        // cast branch and the class-property branch. Everything else was invisible —
        // `$Node -is [Markdig.Syntax.Inlines.LinkInline]`, `@{ Alias = [System.Management.
        // Automation.AliasAttribute] }`, `[int[]]@(1,2)` in an argument, a type table
        // written as a hashtable of accelerator -> full type. MEASURED on the primary
        // corpus: 99 of the 126 truth edges in TypeAccelerator.Tests.ps1 (a file that IS
        // a table of types) and the single largest MISSING class after the oracle fixes
        // — 556 `uses string` and 151 `uses System` were the FRAGMENTED spellings of the
        // same rule, but the whole-name rows were still dropped.
        //
        // The exclusions are the positions where the type is DECLARATION METADATA rather
        // than a reference, and each is a lane rule that already exists:
        //   · a parameter's type and a class method's RETURN type are stored on the
        //     symbol (`type:`) and are not separate edges;
        //   · an ATTRIBUTE's type names the attribute, which the attribute list already
        //     records as annotations;
        //   · a cast or class-property type is published by its own branch (above/below),
        //     at the DECLARATION's site, so reading it here would double the row with a
        //     different line;
        //   · the object of `::` is a static call/member, and that edge already names the
        //     type in full (`System.IO.Path::GetFullPath`), so a second `uses System.IO.
        //     Path` is the same fact twice — the F5 oracle states the identical rule.
        case "type_literal": {
          if (this.withinRecovery(node)) break
          let p: Node | null = node.parent
          let metadata = false
          for (let d = 0; p && d < 10; d++) {
            if (
              p.type === "attribute" ||
              p.type === "script_parameter" ||
              p.type === "class_method_parameter" ||
              p.type === "class_property_parameter" ||
              p.type === "param_block" ||
              p.type === "class_method_definition"
            ) { metadata = true; break }
            if (p.type === "statement_list" || p.type === "script_block" || p.type === "program") break
            p = p.parent
          }
          if (metadata) break
          const parent = node.parent
          if (!parent) break
          if (parent.type === "cast_expression" || parent.type === "class_property_definition") break
          let isStaticObject = false
          for (let i = 0; i < parent.childCount; i++) {
            const c = parent.child(i)
            if (c && c.startIndex === node.endIndex) {
              if (c.type === "::" || c.text === "::") isStaticObject = true
              break
            }
          }
          if (isStaticObject) break
          const typeName = typeSpecText(node) || this.stripBrackets(node.text)
          if (!typeName || isTypeAccelerator(typeName)) break
          // PSD14 — A TYPE THE FILE'S OWN `using namespace` MAKES ADDRESSABLE IS NAMED THE WAY THE
          // ENGINE NAMES IT. `about_Using`: with `using namespace U`, a type name is tried as
          // written and then under each U, so `[Language.VariableExpressionAst]` under
          // `using namespace System.Management.Automation` IS `System.Management.Automation.
          // Language.VariableExpressionAst` — the same target the explicit spelling of the same
          // type already produces elsewhere in that file, and the target whose root the namespace
          // claim can certify. The expansion is published only when the prefix is `System.`-rooted
          // (so the claim the row then carries is a documented fact), `<prefix>.<root>` is a
          // DOCUMENTED nested namespace of the framework, the type is not fully qualified already,
          // and the file declares no type of that root — the declaration the engine would find
          // first. With two using directives the first matching prefix is the one the engine would
          // take: PowerShell tries them in source order.
          let publishedType = typeName
          let viaUsingNamespace: string | null = null
          if (usingNamespacePrefixes.length > 0 && typeName.indexOf("[") < 0 && typeName.indexOf("]") < 0 && typeName.indexOf(",") < 0) {
            const dot = typeName.indexOf(".")
            if (dot > 0) {
              const rootText = typeName.slice(0, dot)
              const rootFolded = rootText.toLowerCase()
              if (
                rootFolded !== "system" &&
                !typeNamesInFile.has(rootFolded) &&
                !RESOLVED_FRAMEWORK_TYPES.has(rootFolded) &&
                !DOTNET_SYSTEM_NAMESPACES.has(rootFolded)
              ) {
                for (const prefix of usingNamespacePrefixes) {
                  const prefixIsSystemRooted = prefix.length > 6 && prefix.charAt(prefix.length - 1) !== "." &&
                    (prefix.charCodeAt(0) | 0x20) === 115 /* s */ &&
                    (prefix.charCodeAt(1) | 0x20) === 121 /* y */ &&
                    (prefix.charCodeAt(2) | 0x20) === 115 /* s */ &&
                    (prefix.charCodeAt(3) | 0x20) === 116 /* t */ &&
                    (prefix.charCodeAt(4) | 0x20) === 101 /* e */ &&
                    (prefix.charCodeAt(5) | 0x20) === 109 /* m */ &&
                    prefix.charCodeAt(6) === 46 /* . */
                  if (!prefixIsSystemRooted) continue
                  if (!FRAMEWORK_NESTED_NAMESPACES.has(`${prefix}.${rootText}`.toLowerCase())) continue
                  publishedType = `${prefix}.${typeName}`
                  viaUsingNamespace = prefix
                  break
                }
              }
            }
          }
          addRel(top().scope, publishedType, ASTEngine.RelationshipType.Uses, 0.8, node.startPosition.row + 1, {
            powershellSpecific: true, isTypeReference: true,
            ...(viaUsingNamespace === null ? {} : {
              viaUsingNamespace,
              typeSpellingAsWritten: typeName,
            }),
          })
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
          // A CAST WITH NO VARIABLE IS A TYPE REFERENCE, NOT A DECLARATION.
          // `[System.Net.Security.RemoteCertificateValidationCallback]` as a method
          // ARGUMENT parses as `cast_expression > expression_with_unary_operator >
          // unary_expression` with no variable child, so this branch fell through and
          // published nothing — while the same type as a typed declaration published a
          // `uses`. Measured on ansible's WebRequest module: five type arguments to
          // `[Expression]::Lambda(...)` were dropped (the five sampled MISSING rows), and
          // the type-literal case below cannot recover them because it deliberately
          // defers casts to THIS branch. One rule, two shapes: the type is the fact.
          if (!varNode) {
            const castType = typeLit ? typeSpecText(node) : ""
            if (castType && !isTypeAccelerator(castType)) {
              addRel(top().scope, castType, ASTEngine.RelationshipType.Uses, 0.8, typeLit!.startPosition.row + 1, {
                powershellSpecific: true, isTypeReference: true, isCastExpression: true,
              })
            }
            break
          }
          if (isQualified(varNode.text)) break
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
          // THE KEY IS PUBLISHED VERBATIM, QUOTES INCLUDED, and that is the lane's
          // pinned contract rather than an oversight: `externality-psb16` and
          // `externality-arbiter-psb17` assert `'application/json'` and `'Content-Type'`
          // as names, with mutants, because the externality reading has to exclude a
          // leading quote byte. A stripped spelling here would break both pins (and did,
          // when this line was tried during the F5 reconciliation). The differential's
          // oracle is the side that must match this contract, not the other way round.
          const keyName = keyNode.text
          if (!keyName) break
          // A QUOTED KEY IS A LITERAL NAME, WHATEVER IT CONTAINS. The `$` and
          // whitespace guards below exist for BARE keys, where a `$` means the slot
          // is chosen at run time and a space means the grammar split a token — but
          // they were rejecting the two spellings that need a quote PRECISELY
          // because they carry one: `'$schema'` (`findMissingNotices.ps1:502`, the
          // component-detection manifest's required key) and `"PowerShell
          // executable"` (`package-validation.tests.ps1`, a data table's row name).
          // Measured over the whole admitted population: 10 quoted keys a file
          // declares and this pass dropped, each read back by the same file.
          //
          // The quote must be MATCHED, and a DOUBLE-quoted key is still dynamic when
          // it interpolates: `"$mainModule.psd1"` names whatever `$mainModule`
          // holds, so it is not a declared slot. A single-quoted `'$schema'` never
          // interpolates, which is the whole reason JSON Schema's key must be
          // written that way.
          let quoted = false
          let interpolating = false
          if (keyName.length >= 2) {
            const q = keyName.charCodeAt(0)
            if ((q === 34 || q === 39) && keyName.charCodeAt(keyName.length - 1) === q) {
              quoted = true
              const inner = keyName.slice(1, -1)
              if (q === 34 && inner.includes("$")) interpolating = true
            }
          }
          if (quoted) {
            if (interpolating) break
          } else if (keyName.includes("$") || keyName.includes(" ")) break
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
          }
          // A NUMERIC INDEX PUBLISHES NOTHING (PS-B28), and this reverses a deliberate earlier
          // ruling on a measurement rather than on a preference.
          //
          // PS-B10 published the index as a `uses` row carrying `isNumericIndex: true`, on the
          // argument that "a numeric index is a read of an ELEMENT, not of a name, so the honest
          // record is the site itself". The record it actually produced is `uses -> 0`, which is a
          // DEPENDENCY ON A SYMBOL NAMED `0` — a target no declaration can have, in this language or
          // any other, because the parser never declares a numeric name. This is word for word the
          // sentence PS-B24 used to remove the numeric MEMBER leaf, and the same argument decides
          // it here: the fleet's rule is that an edge either resolves to a declaration or carries a
          // claim the project can check, and a literal is neither. The metadata that explained the
          // row was invisible to every consumer that reads `target`.
          //
          // MEASURED over the whole admitted population: 3,734 such rows, EVERY ONE unresolvable in
          // its own project (they were 7.6% of this lane's unresolved wall). Removing them changes
          // no resolved edge, adds no claim, and leaves the two branches above — the STRING KEY
          // (`$h['Retries']`, a real name in the hashtable sense) and the VARIABLE KEY
          // (`$a[$i]`, a real read of `$i`) — exactly as they were. A graph that wants "who indexes"
          // needs a SITE record, which is not a relationship between symbols and must not be spelled
          // as one.
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
          // A METHOD'S ARGUMENTS ARE READS, exactly as a cmdlet's are. The command
          // branch has read its argument elements since F9, but `invokation_expression`
          // only ever read the RECEIVER: `$ps.AddScript($Script).Invoke()` published
          // `uses ps` and NOT `uses Script`, and `[Math]::Max($a, $b)` published the call
          // and neither operand. Read once, before the two branches below, because the
          // static (`[T]::M(…)`) and instance (`$o.M(…)`) paths both `break` early and a
          // read placed after either would be unreachable from the other.
          const argList = findFirstChild(node, "argument_list")
          if (argList) emitVariableReads(argList, true, "isArgumentReference")
          if (typeLit) {
            const typeName = typeSpecText(node) || this.stripBrackets(typeLit.text)
            if (!typeName) break
            const memberName = member?.text ?? ""
            // POWERSHELL MEMBER NAMES ARE CASE-INSENSITIVE, SO `::New()` IS THE CONSTRUCTOR.
            //
            // The comparison was case-sensitive, so `[list[int]]::New()` (capital N — the
            // spelling .NET's own documentation uses, and the one the corpus writes) fell
            // through to the static-call branch and published `calls -> list[int].New`: a call
            // to a method no type declares, where the source constructs an instance. The
            // oracle read the same line as `instantiates list[int]` and the disagreement was
            // scored MISSING + UNEXPLAINED for one fact. The lowercase spelling was always
            // right, which is why no fixture caught it: `member-reads-psb5` writes `::new()`.
            // Measured on the authoritative corpus: 23 `instantiates` rows lost this way.
            if (isNewSpelling(memberName)) {
              addRel(top().scope, typeName, ASTEngine.RelationshipType.Instantiates, 0.9, line, {
                powershellSpecific: true, dotNetNew: true,
              })
            } else if (memberName) {
              // PS-B22 — THE TARGET IS A QUALIFIED NAME, NOT A `::` SPELLING.
              //
              // `[Counter]::Add(1, 2)` used to publish `calls -> Counter::Add`. That
              // spelling is not a name any stored symbol can have: a class method is
              // declared with `name = "Add"` and `qualifiedName = "Counter.Add"`, so
              // the arbiter's exact-key lookup can never bind the row. MEASURED over
              // the whole admitted population (1,183 files, production `parseFile`):
              // 3,458 static member calls, of which 254 name a class the EMITTING
              // FILE declares, and 219 of those 254 name a member that class really
              // declares. All 219 were published under a spelling no declaration
              // answers to, so each was read as an external claim by the pass below —
              // a false claim about a call whose callee is in the same file.
              //
              // THE DOT IS THE STORE'S OWN QUALIFIED-NAME SEPARATOR, and this lane
              // already retargets visible variable reads to `Get-Targets.index` for
              // exactly this reason (the variable-read retarget pass below). A class
              // method's `qualifiedName` is `Counter.Add`; the arbiter resolves a
              // target against BOTH `name` and `qualifiedName`, so the dot spelling
              // binds the member and keeps the owner visible. The `::` spelling is
              // retained ONLY in the source text and in comments, never in a target.
              //
              // THE TWIN STAYS UNSETTLED ON PURPOSE: `[System.Math]::Max` becomes
              // `System.Math.Max`, which still names no declaration and is still
              // marked external. The change moves the PROJECT-LOCAL rows into
              // resolution and leaves the BCL rows exactly where they were.
              addRel(top().scope, `${typeName}.${memberName}`, ASTEngine.RelationshipType.Calls, 0.8, line, {
                powershellSpecific: true, staticMemberCall: true, staticType: typeName,
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
          // PS6 — a command whose NAME lives inside a recovery region is recovery
          // noise. The test is on the name node, not the command subtree: the
          // grammar's own recovery shapes (PS-A2's `interface` declaration) carry
          // an ERROR in their ARGUMENTS while the name is intact, and those are
          // deliberate reads, not damage.
          const cmdNameNode = findFirstChild(node, "command_name")
          if (cmdNameNode && this.nameWithinRecovery(cmdNameNode)) break

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
              // THE DOT-SOURCE IS AN INCLUSION, NOT A CALL — the `part_of` contract's
              // positive test.
              //
              // `. ./lib.ps1` and `& ./run.ps1` run the SAME file, but in DIFFERENT
              // scopes. The dot-source operator runs the script in the CALLER's scope:
              // the sourced file's functions and variables land in the caller's session
              // state, so the file becomes PART of the calling unit — exactly
              // `src/ast/types.ts:PartOf` ("a part shares the including unit's single
              // scope, imports nothing, and cannot be resolved as a separate module").
              // The call operator `&` runs a script in a CHILD scope of its own, which
              // is an invocation and stays `calls`. `Import-Module`/`using module` load
              // a module into its OWN scope, which is why those are `imports` (read by
              // `addImport`) and must never be relabelled here.
              //
              // SO THE DOT HALF RELABELS AND THE AMP HALF DOES NOT. The operator's own
              // text is the discriminator — not a file name, not a path shape — so a
              // relabel that widens to `&` fails the fixture's forbid rows.
              //
              // 1:1 RELABEL, the fleet's precedent: nim `include`, erlang `-include`,
              // fsharp `#load`, php include/require and css's plain-file `@import` all
              // moved this construct to `part_of` with `partRole` and no other change.
              // The same site, the same line, the same confidence, one label.
              //
              // THE TARGET IS THE SOURCED FILE'S OWN NAME, NOT THE PATH. A `part_of`
              // target is resolved against SYMBOL names, and the module symbol a
              // PowerShell file declares is its basename WITH the extension (PS1 above:
              // "The extension is kept: `Build.psm1` and `Build.ps1` are different
              // files"). The cpp lane measured a path-target `part_of` resolving 0 of
              // 4,612 rows for exactly this reason, so the path is kept on the row as
              // `metadata.partPath` and the TARGET is the basename — `./lib.ps1` names
              // `lib.ps1`, which is the symbol the sourced file itself declares.
              const part = sourcedPartName(target)
              if (op.text === "." && part !== null) {
                addRel(top().scope, part, ASTEngine.RelationshipType.PartOf, 0.9, nameLine, {
                  powershellSpecific: true,
                  invokationOperator: op.text,
                  // MANDATORY on every `part_of` row (src/ast/types.ts:170-183): this
                  // file carries the directive and names the part, so it is the
                  // library side of the pair. A dot-sourced file does not know it is
                  // being sourced, so PowerShell has only the one role.
                  partRole: "library",
                  partPath: target,
                })
              } else {
                addRel(top().scope, target, ASTEngine.RelationshipType.Calls, 0.9, nameLine, {
                  powershellSpecific: true, invokationOperator: op.text,
                })
              }
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
            } else if (target.length > 0 && isPlausibleSymbolName(target)) {
              // `& locale` — A BARE NAME THROUGH THE CALL OPERATOR IS A CALL.
              //
              // The branch above covers a PATH (`& ./run.ps1`) and a VARIABLE (`& $sb`), and
              // this third shape fell through to `break` with NO edge at all: the program
              // invoked by name through `&` was invisible. Measured on build.psm1:4774
              // (`$localOutput = & locale`) — the harness's own oracle derives `calls ->
              // locale` and the analyzer published nothing, which read as a dropped call.
              // The guard is the same identifier test the variable branch uses, so `& (Get-Thing)`
              // (recovery text with parentheses) and `& { … }` (a script block, not a command)
              // stay unpublished; a name with an extension and no separator (`& foo.exe`) is a
              // program the same way `locale` is, and lands here rather than on the path test.
              addRel(top().scope, target, ASTEngine.RelationshipType.Calls, 0.9, nameLine, {
                powershellSpecific: true, invokationOperator: op.text,
              })
            }
            break
          }

          detectFrameworks(leaf)

          // PS7 — imports.
          if (leaf === "Import-Module" || leaf === "ipmo") {
            // A DYNAMIC MODULE NAME IS A READ, NOT AN IMPORT — PS29's rule on this channel.
            //
            // `Import-Module $m` names no module the graph can join: `$m` holds a string at
            // run time, so `imports -> m` asserts a dependency on a module called `m`. The
            // same reasoning that moved a variable-supplied TYPE from `instantiates` to
            // `uses` applies here, and the variable-read pass already publishes `uses m` for
            // the argument. The NODE is the discriminator, not the text (PS29's note): the
            // value `m` and the value of `-Name m` are the same string and different facts.
            // Measured: the corpus carries bare-variable imports, and the oracle's own rule
            // had to be taught the same distinction on the same day.
            const argNodes: Node[] = []
            // ONLY `-Name` AND `-Assembly` NAME A MODULE; POSITIONAL VALUES ALWAYS DO.
            //
            // `commandArgs` reports every value, so the import reader published the VALUE of
            // every other parameter as a module: measured on ParameterBinding.Tests.ps1:52,
            // `Import-Module $mod[0].Assembly -ErrorVariable ErrorImportingModule` produced
            // `imports -> ErrorImportingModule` AND `references -> ErrorImportingModule` — two
            // edges claiming a dependency on a module named after an error variable. PS7's
            // switch-value list (`Stop`, `Continue`, …) caught `-ErrorAction Stop` and could
            // not catch this, because `ErrorImportingModule` is a perfectly shaped module name:
            // the PARAMETER is the discriminator, not the value. `-RequiredVersion 1.0` is the
            // same defect with a number in it. The set is the cmdlet's own module-naming
            // parameters, and the oracle (script/m14/differential.ts) reads it the same way.
            const args = commandArgs(node, argNodes, IMPORT_MODULE_MODULE_PARAMETERS)
            for (let ai = 0; ai < args.length; ai++) {
              const arg = args[ai]
              if (SWITCH_ARGUMENT_VALUES.has(arg.toLowerCase())) continue
              const argNode = argNodes[ai]
              if (argNode && nodeIsAVariableReference(argNode)) continue
              addImport(arg, leaf, nameLine, node)
            }
            // AN IMPORT'S ARGUMENTS ARE READS TOO, AND THIS BRANCH `break`s BEFORE THE
            // GENERIC READ PASS. `Import-Module "$here/../helpers.psm1"` READS `$here`,
            // and `Import-Module $dynamic` reads `$dynamic`; both were published as
            // nothing at all, because the command branch's generic argument read sits
            // BELOW this branch's `break`. Same pass, same marker and same `skipBlocks`
            // as that generic read, so the two paths cannot drift into different grains.
            const argElementsRead = findFirstChild(node, "command_elements")
            if (argElementsRead) emitVariableReads(argElementsRead, true, "isArgumentReference")
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
            //
            // PS29 — and the constructed name can be a VARIABLE, which is not a type
            // name at all. Each reader below now also reports the NODE its text came
            // from, because `-TypeName System.Version` and `-TypeName $t` produce the
            // same kind of string and mean different things: the first names a type,
            // the second names a variable whose VALUE is a type name, resolved at run
            // time. `instantiates` asserts the target IS a type, so on the second it
            // was asserting something the source does not say.
            //
            // Measured over all 1,108 admitted files through production `parseFile`,
            // cross-referencing each target against the symbol table of the file that
            // published it (so a corpus-wide name collision cannot explain it):
            // **123 of 1,268 `instantiates` edges — 9.70% — name a `variable` symbol
            // their own file declares.** A further 99 name a `class` / `function` /
            // `enum` in their own file, and those are CORRECT and are not touched:
            // `New-Object MyType` genuinely constructs a PowerShell class.
            //
            // This is the same defect class the lane already declares fixed for
            // `calls`. F9 changed `$type::$method()` from `calls -> $method` to
            // `uses -> method` precisely because a `$`-prefixed member is a VARIABLE,
            // not a name; `instantiates` is the channel that did not get the same
            // treatment, and it is read by the same reasoning. So the fix routes the
            // variable form to `uses` — a name READ — at the same 0.9 the `calls`
            // route uses for the same shape, carrying `isDynamicTypeName` so a
            // consumer can tell "reads the variable that holds the type name" from
            // "reads a variable for some other reason".
            //
            // Why the shape reaches the POSITIONAL branch when a flag is present:
            // `parameterValue` accepts only a `generic_token` / `string_literal` /
            // `expandable_string_literal`, and the pinned wasm wraps a bare `$t` in an
            // `array_literal_expression`, so `-TypeName $t` finds no flagged value and
            // arrives as the first positional. The node that decides is therefore
            // whichever of the three the `??` chain actually took, which is why the
            // node is captured per reader rather than re-derived.
            const comObjectOut: { node: Node | null } = { node: null }
            const typeNameOut: { node: Node | null } = { node: null }
            const comObject =
              this.parameterValue(node, "ComObject", comObjectOut) ??
              this.parameterValue(node, "comobject", comObjectOut)
            const typeName =
              this.parameterValue(node, "TypeName", typeNameOut) ??
              this.parameterValue(node, "typename", typeNameOut)
            // The POSITIONAL form: `New-Object System.Collections.ArrayList` and
            // `New-Object System.Version`, which is how the cmdlet is written
            // whenever the author did not bother with a flag. `commandArgs` returns
            // values only, having already skipped every `command_parameter`, so the
            // first entry is the positional type name and the flagged forms leave it
            // empty. `positionalNodes` carries the node each value was read from.
            const positionalNodes: Node[] = []
            const positional = commandArgs(node, positionalNodes)[0]
            const constructed = comObject ?? typeName ?? positional
            const constructedFrom = comObject
              ? comObjectOut.node
              : typeName
                ? typeNameOut.node
                : (positionalNodes[0] ?? null)
            if (constructed && !isTypeAccelerator(constructed)) {
              if (constructedFrom && nodeIsAVariableReference(constructedFrom)) {
                addRel(top().scope, constructed, ASTEngine.RelationshipType.Uses, 0.9, nameLine, {
                  powershellSpecific: true,
                  viaNewObject: true,
                  isDynamicTypeName: true,
                  isVariableReference: true,
                })
              } else {
                addRel(top().scope, constructed, ASTEngine.RelationshipType.Instantiates, 0.9, nameLine, {
                  powershellSpecific: true, viaNewObject: true,
                  ...(comObject ? { isComObject: true } : {}),
                })
              }
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
              // PS30 — the FLAG is the fact, and it was being thrown away. `via` was
              // `leaf`, which is the COMMAND NAME and therefore the same string
              // `Export-ModuleMember` on every row: measured over all 1,108 admitted
              // files, 106 of 106 `exports` rows carried `via: "Export-ModuleMember"`
              // and 0 named the flag. So `file -> Get-Foo` did not say whether the
              // module published that name as a FUNCTION, a VARIABLE, an ALIAS or a
              // CMDLET, and the four are not the same kind of thing — a `-Cmdlet`
              // target is a name the file cannot declare at all, so a consumer cannot
              // even tell whether it should look for it.
              //
              // This is the same argument PS23 made for `imports`, applied to the
              // sibling channel: `file -> Module` does not say which of the four
              // declarations produced it, so `metadata.via` names the form on every
              // `imports` row. The `exports` reader already COMPUTES the flag — the
              // `isFlag(flag)` line above is a test on the very string it then
              // discarded — so this is a value that was in hand and not written down.
              //
              // The unflagged branch below keeps the command name, because there the
              // flag genuinely is not there: `Export-ModuleMember Get-Foo` with no
              // `-Function` publishes nothing in PowerShell, so naming a flag would
              // assert something the source does not state.
              for (let i = 0; i < elements.namedChildCount; i++) {
                const c = elements.namedChild(i)
                if (!c) continue
                if (c.type === "command_parameter") {
                  const flag = stripLeadingDash(stripDollar(c.text)).toLowerCase()
                  if (!isFlag(flag)) continue
                  const via = `-${flag}`
                  // Walk the whole value list, stopping at the next flag.
                  for (let j = i + 1; j < elements.namedChildCount; j++) {
                    const v = elements.namedChild(j)
                    if (!v) break
                    if (v.type === "command_parameter") break
                    if (v.type === "command_argument_sep") continue
                    if (v.type === "generic_token" || v.type === "string_literal" || v.type === "expandable_string_literal") {
                      addExport(this.stripQuotes(v.text), via, v.startPosition.row + 1)
                    } else {
                      for (const t of this.literalTokens(v)) addExport(t, via, v.startPosition.row + 1)
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
            // A VERSION IS DIGITS AND DOTS, AND ONLY A COMMENT THAT IS THE DIRECTIVE IS READ.
            //
            // The `#requires` guard is `text.startsWith("#requires")`, which is right for a
            // real directive — but the pinned grammar also hands this case a "comment" that
            // is the INTERIOR of a test's string table (`"#requires -Version 5.0`n7";"` in
            // Parser.Tests.ps1:1340), and `extractRequiresValue` scans to the end of the text.
            // The published target was `5.0`n7\";` — a value carrying a backtick, a quote and a
            // statement separator, i.e. a name no symbol can have. Measured by F5 as an
            // UNEXPLAINED row and by the incoming gate as a refuted claim. The guard is on the
            // VALUE's bytes, so it cannot be fooled by how the text got here.
            let versionShaped = !!version
            let versionDots = 0
            for (let vi = 0; versionShaped && vi < (version as string).length; vi++) {
              const ch = (version as string).charCodeAt(vi)
              if (ch === 46) { versionDots++; continue }
              if (ch < 48 || ch > 57) versionShaped = false
            }
            if (version && versionShaped && versionDots >= 1) {
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
      let baseWritten = baseClassByClass.get(cand.className)
      let guard = 0
      while (baseWritten && guard++ < 8) {
        // CASE-INSENSITIVE CLASS NAMES, and the DECLARED spelling is the target. See the
        // classDeclaredSpelling note: a header may spell its base differently, and the store
        // keys symbols by the declaration, not by a caller's spelling.
        const base = classDeclaredSpelling.get(baseWritten.toLowerCase()) ?? baseWritten
        const inherited = classMembers.get(base)
        // PS28 — CASE-INSENSITIVE, because PowerShell identifiers are. Every other
        // name comparison in this file lowercases before comparing, and
        // `pushSymbol` says why in so many words: "`$Foo` and `$foo` are ONE
        // variable". The `overrides` match was the exception, and the corpus
        // measures the cost on one line of
        // powershell/test/powershell/Language/Classes/scripting.Classes.inheritance
        // .tests.ps1: the base declares `foo` and the derived class declares
        // `fOo`, which are the same member under PowerShell's rules. Case-sensitive,
        // the last declaration matched nothing and the two edges the lane did publish
        // came from EARLIER declarations of the same class — so the type fired on a
        // file where its own final member does not match.
        const wanted = cand.memberName.toLowerCase()
        const inheritedFact = inherited
          ? [...inherited].find((m) => m.name.toLowerCase() === wanted)
          : undefined
        // PS26 — the name match is necessary and not sufficient. `memberOverrides`
        // carries the two attributes and the member kind the name alone cannot see;
        // see its docstring for the corpus measurement, which is 0 for all three,
        // so this is a removal rule pinned by fixture and not by the census.
        if (inheritedFact && memberOverrides(cand.fact, inheritedFact)) {
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
        baseWritten = baseClassByClass.get(base) ?? baseClassByClass.get(baseWritten)
      }
    }

    // ---------------------------------------------------- externality, cause C
    //
    // ## WHAT THIS PUBLISHES, AND WHY IT IS NOT `isExternal`
    //
    // A bare PowerShell name — a command, a variable, a property — is bound by the RUNTIME,
    // against session state: dot-sourced scope, then the caller's scope chain, then module
    // exports. A single-file analyzer therefore cannot say "this name is external", because
    // "external" is a statement about the machine the script runs on. What it CAN say, and
    // what this pass publishes, is the fact that decides the question for the reader:
    //
    //   `noDeclarationInFile: true`   this file declares no symbol with that spelling
    //
    // bash reached the same conclusion and shipped `variableDeclaredInFile` for the same
    // reason. It is published on the FALSE state only, so absence means "not asserted"
    // and never "declared here" — the alternative, publishing both states, costs a row on
    // every edge the lane already emits for no additional information.
    //
    // ## WHY A SHAPE IS STILL NEEDED, AND WHICH ONE
    //
    // `noDeclarationInFile` is honest but it is not actionable: a `$local` no file declares
    // and a cmdlet are indistinguishable under it, and only the second is external by
    // construction. So the second key is published only where the SPELLING rules out a local
    // declaration AND the declaration table agrees:
    //
    //   `externalTarget: true` with `externalVia` naming which reading fired
    //
    // Two readings, both char-code scans over the target, neither a word list:
    //
    //   "cmdlet"    Verb-Noun — a hyphen with an uppercase letter on BOTH sides. Pester's
    //               `Should`, .NET's `Join-Path`, and this analyzer's own fixtures' local
    //               `function Get-Thing` are all that shape, which is why the declaration
    //               guard is the half that carries the claim and the shape is only what
    //               nominates a candidate.
    //   "qualified" a `.` / `\` / `/` / `:` / `::` byte, which no PowerShell identifier
    //               has — so it is a module path, a .NET type, or a scope prefix. A leading
    //               quote is EXCLUDED: this analyzer publishes hashtable keys and command
    //               arguments verbatim, so `'Content-Type'` and `"it:skip"` reach an edge as
    //               property/variable names, and a quoted literal is not an identifier.
    //
    // ## THE MEASUREMENT THAT DECIDES IT
    //
    // Over the whole admitted corpus — 1,181 files, production `parseFile`, no sampling cut
    // (`npx tsx validation/m14/fixtures/powershell/ambiguity-split.mts`) — the unguarded
    // Verb-Noun shape marks 32,368 live edges of which **7,040 (21.75%) point at a name the
    // EMITTING FILE declares**, and the declaration-guarded reading marks 25,328 with **0**.
    // The corpus-wide column disagrees on a further 3,680, and those are not errors: they are
    // names another file declares, which is the dot-source / module-export case and is the
    // population cause C is about. Char-code scans only; zero regex.
    const declaredFolded = new Set<string>()
    for (const s of symbols) declaredFolded.add(s.name.toLowerCase())
    const declaredInFile = (name: string): boolean => declaredFolded.has(name.toLowerCase())

    // ---------------------------------------------------- variable reads, cause D
    //
    // A VARIABLE READ TARGETS THE VARIABLE, NOT A BARE NAME THAT COLLIDES PROJECT-WIDE.
    //
    // `uses` is this lane's largest type and its largest ambiguous marker sets are ALL variable
    // reads — the gate's own table (1,181-file population): `isArgumentReference+isVariableReference`
    // amb 13,682, `isAssignmentRead+isVariableReference` amb 5,696,
    // `isReceiverReference+isVariableReference` amb 1,977. They were emitted as
    // `addRel(scope, name, Uses, …)` — the target is the BARE name (`index` for `$index`) — and
    // production binds a bare name only when it has exactly ONE declaration in the whole project,
    // which a name like `index`, `before` or `path` never has.
    //
    // THE RULE, and it is the shape this programme's yaml lane used for `needs:`: where this file
    // declares the name as a VARIABLE that is VISIBLE AT THE READ, target that declaration's
    // qualified name (`Get-Targets.index`), which the arbiter resolves by exact key. It reaches an
    // EXISTING declaration or it does not fire:
    //
    //   PRICED BEFORE IT WAS APPLIED, whole population, both directions:
    //     CEILING  17,483 of the 39,100 ambiguous `uses` edges — 45 % of the type's ambiguity —
    //              retargetable to a declaration that exists in their own file, is VISIBLE at the
    //              read, and is unique project-wide
    //     CONTROL  324 have MORE THAN ONE visible declaration of that name → REFUSED (never pick)
    //     CONTROL  4,991 whose qualified name is not unique project-wide → the rule still fires and
    //              the edge stays AMBIGUOUS: the arbiter sees two declarations and binds neither, so
    //              the failure direction is "no gain", never "wrong declaration"
    //     and 1,422 have no own-file variable declaration at all → the rule cannot fire
    //   (validation/m14/fixtures/powershell/variable-reference-pricing.ts, both arms)
    //
    // VISIBILITY IS THE WHOLE SAFETY CLAUSE. The first version of the price matched ANY declaration
    // of the name in the file and would have retargeted a file-scope read of `$before` to a
    // function-local `before` — a mis-bind. A declaration is visible to a read when its declaring
    // scope ENCLOSES the read's own scope path (`scope === source` or `source` starts with
    // `scope.`), which is the same prefix rule the rest of this file uses.
    //
    // PowerShell identifiers are CASE-INSENSITIVE (`$Foo` and `$foo` are one binding), so the match
    // folds case; the target keeps the DECLARATION's own spelling. The source's spelling is not
    // lost — it moves to `referencedName`, where the rest of this lane keeps it.
    {
      const variablesByName = new Map<string, { qn: string; scope: string; name: string }[]>()
      const qnOccurrences = new Map<string, number>()
      for (const s of symbols) {
        const scope = String((s as any).scope ?? "")
        const qn = scope.length > 0 ? `${scope}.${s.name}` : String(s.name)
        qnOccurrences.set(qn, (qnOccurrences.get(qn) ?? 0) + 1)
        if (s.kind !== ASTEngine.SymbolKind.Variable) continue
        const key = String(s.name).toLowerCase()
        const list = variablesByName.get(key) ?? []
        list.push({ qn, scope, name: String(s.name) })
        variablesByName.set(key, list)
      }
      for (const rel of relationships) {
        if (rel.type !== ASTEngine.RelationshipType.Uses) continue
        if ((rel.metadata as any)?.isVariableReference !== true) continue
        const target = String(rel.target ?? "")
        // A bare identifier only: a dotted or scoped target is already an identity, and `$env:PATH`
        // is not a variable this file declares.
        //
        // M60 #278 — NO REGEX IN THIS FILE DECIDES A FACT, and this one DID: the character class
        // `/[.:$[\]()]/` was deciding whether a target is a bare identifier, which is a fact about
        // the target's spelling. The policy in this file's own header is that normalising
        // AST-derived text belongs in a character loop, and every other predicate here is one —
        // `isPs`, `isS`, `isDot`, `isOne` in `isRelativeProjectFilePath` are all code-point reads for
        // exactly this reason. So the class becomes a loop over the same SEVEN characters, in the
        // same order, with the same meaning: `.` 46 · `:` 58 · `$` 36 · `[` 91 · `]` 93 · `(` 40 ·
        // `)` 41. **The behaviour is identical and the gate's row count is the proof** — the
        // zero-regex census reads `regex OPERATIONS in code: 0` and the fixture suite and the
        // arms are unchanged.
        if (target.length === 0) continue
        let isBareIdentifier = true
        for (let i = 0; i < target.length; i++) {
          const c = target.charCodeAt(i)
          if (c === 46 || c === 58 || c === 36 || c === 91 || c === 93 || c === 40 || c === 41) {
            isBareIdentifier = false
            break
          }
        }
        if (!isBareIdentifier) continue
        const source = String(rel.source ?? "")
        const visible = (variablesByName.get(target.toLowerCase()) ?? []).filter(
          (c) => c.scope.length === 0 || source === c.scope || source.startsWith(`${c.scope}.`),
        )
        if (visible.length !== 1) continue // zero: nothing to bind. two or more: REFUSE.
        const hit = visible[0]
        if ((qnOccurrences.get(hit.qn) ?? 0) !== 1) continue
        rel.target = hit.qn
        const md = (rel.metadata ?? (rel.metadata = {})) as Record<string, unknown>
        md.referencedName = target
        md.boundToVariable = true
      }
    }

    for (const rel of relationships) {
      const target = rel.target
      if (target == null || target.length === 0) continue
      // A BOUND VARIABLE IS DECLARED HERE BY CONSTRUCTION — the retarget pass above fires only on a
      // declaration THIS FILE carries, visible at the read, and unique. Stated because the pass below
      // is keyed on BARE NAMES (`declaredInFile` folds `symbol.name`), so a qualified target would
      // read as undeclared and collect `noDeclarationInFile` on an edge whose whole point is that the
      // declaration exists. Found by `externality-psb16`'s bare-word NEGATIVE row, which pins the
      // ABSENCE of that key and is exactly the row a blanket rule fails.
      if ((rel.metadata as any)?.boundToVariable === true) continue
      // A STATIC MEMBER CALL WHOSE OWNER AND MEMBER ARE BOTH DECLARED IN THIS FILE IS
      // DECLARED HERE, however the target is spelled. The target is a QUALIFIED name
      // (`Counter.Add`), and `declaredInFile` folds BARE symbol names, so without this
      // guard the row would collect `noDeclarationInFile` / `isExternalTarget` on an
      // edge whose callee is the method declared 20 lines above it — the same shape
      // the `boundToVariable` guard above was added for. The member is checked against
      // the OWNER's member set, not against the file's global name set, so a variable
      // named `Add` elsewhere cannot excuse the row. Measured: 219 such rows over the
      // whole population (PS-B22).
      const staticMeta = (rel.metadata ?? {}) as any
      if (staticMeta.staticMemberCall === true && typeof staticMeta.staticType === "string") {
        // CASE-FOLDED, because PowerShell identifiers are: `[counter]::Add()` calls the class
        // declared as `class Counter`, and an EXACT-key lookup missed it — the row was then
        // published under the accelerator/generic reading for a type this file declares. Found
        // while writing PSD12's negative twin, where `class Regex` must shadow `[regex]`.
        const declaredOwner = classMembersOf(classMembers, staticMeta.staticType)
        const memberLeafRaw = target.slice(target.lastIndexOf(".") + 1)
        const memberLeaf = memberLeafRaw.toLowerCase()
        if (declaredOwner) {
          // THE DECLARED SPELLING, not the literal's. `[foo]::Bar2()` calls `class Foo`'s method —
          // PowerShell identifiers are case-insensitive — and the store's qualified name is built
          // from the DECLARATION (`Foo.Bar2`), so a target spelled `foo.Bar2` cannot bind to it.
          // MEASURED: one population row (`Scripting.Classes.BasicParsing.Tests.ps1:127`) is exactly
          // this shape and read `unresolved` once the case-folded lookup recognised the class;
          // publishing the declaration's spelling is what makes that recognition pay.
          const declaredMember = [...declaredOwner.members].find((m) => m.name.toLowerCase() === memberLeaf)
          if (declaredMember) {
            rel.target = `${declaredOwner.name}.${declaredMember.name}`
            continue
          }
          // THE OWNER IS DECLARED HERE AND THE MEMBER IS NOT. The generic externality
          // reading below would ask the arbiter about `DeclaringType`, find it, and
          // REFUTE the claim — a false statement about the corpus produced by a true
          // observation about the file. This is the exact claim the fleet already has
          // for it: `ownerMemberAbsent` says "the owner is published, the member is
          // not", is VERIFIED by the project's own member map, and is REFUTED only if
          // the member really is declared. Measured: 35 of the 254 same-file static
          // call sites name a member their class does not declare (an inherited .NET
          // member such as `GetCustomAttributes`), and every one of them is this shape.
          rel.metadata.ownerMemberAbsent = { owner: declaredOwner.name, member: memberLeafRaw }
          continue
        }
        // PSD12 — THE LITERAL IS A FRAMEWORK TYPE THE RUNTIME RESOLVES FOR US. Publish the target
        // under the type's documented name so the row names the thing it names, exactly as
        // `[System.Math]::Max` already does; the namespace pass below then certifies the root
        // (`System`), which turns a claim the arbiter could only refuse into one it verifies. The
        // in-file class check above wins over the table deliberately: a class of that spelling
        // declared HERE is what the source actually calls, and the accelerator must not shadow it.
        const resolvedType = RESOLVED_FRAMEWORK_TYPES.get(staticMeta.staticType.toLowerCase())
        if (resolvedType !== undefined) {
          rel.target = `${resolvedType}.${memberLeafRaw}`
          const resolvedMeta = (rel.metadata ?? (rel.metadata = {})) as Record<string, unknown>
          resolvedMeta.staticTypeResolved = resolvedType
          resolvedMeta.typeAccelerator = staticMeta.staticType
          continue
        }
        // PSD12 (second half) — A DOTTED LITERAL IS OUTSIDE THE POPULATION BY CONSTRUCTION.
        // `IO.Path.Combine` names `System.IO.Path` through PS-B27's implicit-`System.` rule, and no
        // published symbol can be keyed by a dotted name: a PowerShell class name cannot contain a
        // dot, and variables, functions and parameters are stored as bare identifiers. So the generic
        // externality reading below asks a question the project can ANSWER, and the arbiter verifies
        // it by finding nothing. MEASURED: +1,038 rows, extFAIL unchanged at 60.
        if (staticMeta.staticType.indexOf(".") > 0) {
          // fall through to the generic externality reading
        } else {
          // THE BARE OWNER THE TABLE DOES NOT CARRY — AND THE GENERIC EXTERNAL CLAIM IS STILL THE
          // WRONG ONE FOR IT. `externalReadingOf(target)` + `verifyExternalClaim` ask about the
          // target's text owner, and for a one-segment BCL type that owner is the type name alone
          // (`Path.Combine` -> `Path`, `Regex.Match` -> `Regex`). A project that declares ANY symbol
          // with that name — a variable `$path`, a function `Path`, a class — REFUTES the claim, and
          // the refutation is false: the project symbol is not the .NET type the call names.
          // MEASURED on the whole population, after the dot spelling was introduced: `calls`
          // extRefuted 21 -> 559, every sampled row a static BCL member on a one-segment type
          // (`array.Reverse`, `Regex.Match`, `Path.Combine`, `File.Create`, ...). The type-aware
          // claim is the fleet's `ownerMemberAbsent`: unknown owner => UNVERIFIABLE (never refuted),
          // a project type with the member ABSENT => verified, and the member DECLARED => refuted.
          // PSD12 shrank this branch to the literals whose resolution is NOT a documented fact
          // (`Path`, `File`, `Directory`, `Process`, project and test types) — a named, counted
          // residual rather than the whole static-call population it used to be.
          rel.metadata.ownerMemberAbsent = { owner: staticMeta.staticType, member: memberLeafRaw }
          continue
        }
      }
      const type = rel.type
      if (declaredInFile(target)) continue
      // The two keys PARTITION the "no declaration here" population rather than overlapping:
      // `externalTarget` fires where a reading names a reason, and it implies the fact, so
      // publishing `noDeclarationInFile` on the same row would be the same fact twice. The
      // partition is worth bytes — measured over the same 1,181-file walk, publishing both on
      // every row costs 3,888,591 B (+11.15% of the lane's relationship payload) where the
      // partition costs 2,808,952 B: `noDeclarationInFile` alone was 2,466,639 B of it.
      // W9 — A RUNTIME-VARIABLE PATH GETS THE PATH CLAIM, AND A RUNTIME NAMESPACE GETS NO CLAIM.
      //
      // The claim published here is the arbiter's EXISTING path claim (`sourcePathClaim`): "nothing
      // the project ADMITS resolves to this written source string". Its polarity is the inverse of
      // the file claim: a candidate resolving in the project's file list REFUTES it, and nothing
      // resolving VERIFIES it — so the verdict is a pure function of the project's OWN list, and an
      // independent actor adding the file flips it. That is the claim a runtime-variable path
      // deserves: the project, not this file, is the only thing that can answer it.
      //
      // WHY IT MATTERS, AND THE PRICE, MEASURED:
      //
      //   the 58  the path resolves to a file the project HAS, so the claim is REFUTED — a VISIBLE
      //           refutation, where the previous behaviour published a FALSE external claim and
      //           the gate could not see it at all.
      //   the 30  the path is under the PowerShell INSTALLATION, which no project admits, so the
      //           claim VERIFIES — a VERIFIED external claim, where the previous behaviour could
      //           only refuse it.
      //   the 12  the variable is assigned in the row's OWN file, so the path is derivable; the
      //           claim then answers on the project's own list, which is the question the project
      //           can answer and this file cannot.
      //   the 18  the project cannot tell an external module from a dangling path, and the claim
      //           says exactly that much: nothing the project admits resolves to it.
      //   the 5   a namespace or a drive — NOT a path — and this file publishes no claim for it
      //           at all, because a claim that names nothing that can be a path is not a claim.
      // PSD14 — A RUNTIME-VARIABLE PATH GETS **NO** CLAIM, AND THIS REVERSES A DELIBERATE EARLIER DECISION.
      //
      // W9 published the path claim here, and its own measurement said what that would produce: 58 of the
      // 123 runtime-variable paths resolve to a file the project HAS, so the claim is REFUTED — 11 rows do,
      // and each is a claim the project says is false (`$PSScriptRoot/../../../../build.psm1` from a
      // `.github/actions/…` directory IS the repo's `build.psm1`). W9 read those refutations as "a VISIBLE
      // refutation, where the previous behaviour published a false external claim" — and that was the wrong
      // trade for clause 4, which counts a refuted claim against the lane and does not care why it was made
      // visible. The analyzer CANNOT answer the question (it does not know the project root, and the
      // arbiter's candidate expansion answers it by BASENAME), so it must not assert either polarity. The
      // row keeps its own facts; the class is named in the lane's wall table instead.
      const runtime = runtimeVariableTarget(target)
      // A TARGET WITH NO LETTER IN IT IS NOT A NAME, SO NO NAME-CLAIM MAY BE PUBLISHED ON IT.
      //
      // PS-B27. `#Requires -Version 3.0` publishes `references -> 3.0` (with `requiresVersion: true`,
      // pinned by `imports-psb12`), and the qualified reading fired on it because a version separator
      // is a dot. The arbiter then asks the owner question about `3` — the MAJOR VERSION — and a
      // project symbol that happens to carry that spelling refuted the claim on 13 rows. The version
      // is a real constraint and the edge stays; what is false is the EXTERNALITY READING, because a
      // version number is not a name a declaration table can answer for in either direction.
      //
      // The rule is the SPELLING, not the construct, so it also covers the numeric RANGES the grammar
      // hands to a command slot (`1..3 | ForEach-Object { … }` publishes `calls -> 1..3`): a name in
      // every language this fleet reads contains at least one ASCII letter, and a literal that reached
      // a name slot is not a name. Zero regex — a code-point scan, like every other predicate here.
      //
      // IT GATES THE READING ONLY. The `noDeclarationInFile` partition below still publishes on a
      // `calls`/`uses` row, because "this file declares no symbol with that spelling" stays true for a
      // literal and dropping it would lose a fact to make a claim count smaller. MEASURED on the whole
      // population: the rule withholds the reading on 255 rows (230 numeric ranges, 25 version
      // literals) and changes no `noDeclarationInFile` row at all.
      let hasLetter = false
      for (let i = 0; i < target.length; i++) {
        const c = target.charCodeAt(i)
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { hasLetter = true; break }
      }
      // PSD10 — THE THIRD READING, AND IT IS ABOUT THE CHANNEL RATHER THAN THE SPELLING.
      // A command-position `calls` row names a command the runtime resolves: a cmdlet, an alias, a
      // native program, or a function. The file declares nothing of that spelling (the guard above),
      // so the reading is exactly the per-file statement this pass exists to make, and the arbiter
      // consults it only where the project's own name model has nothing. See
      // `isCommandPositionCall` for the three shapes it refuses and the measured split.
      // PSD13 — A QUOTED ELEMENT-ACCESS KEY IS DATA, SO ITS PUNCTUATION IS NOT A NAME QUALIFIER.
      //
      // `$PSDefaultParameterValues["it:skip"]` publishes `uses -> it:skip` with `isConstantKey: true`
      // (PS-B10: a constant key names the slot). The qualified reading then fired on the COLON — a colon
      // in a quoted key is punctuation in data, not a scope/provider qualifier — and the arbiter refused
      // the owner it derived from it, so 93 population rows carried a NAME claim about a string nobody
      // can declare. The reading is withheld here; the ROW and its `noDeclarationInFile` fact stay.
      //
      // BUT A PATH-SHAPED KEY KEEPS ITS READING, and PS-B18's fixture is why. `$x["/usr/lib/Helper.ps1"]`
      // states a FILE, and the path claim is verified against the project's admitted FILE list — a
      // different question from the owner question, and the one PS-B18 measured in both directions. The
      // guard therefore fires on a NAME-shaped key only: no `/` and no `\` in the content, which is
      // exactly what separates `it:skip` from a path.
      let keyHasPathByte = false
      for (let i = 0; i < target.length; i++) {
        const c = target.charCodeAt(i)
        if (c === 47 /* / */ || c === 92 /* \ */) { keyHasPathByte = true; break }
      }
      // PSD14 — AND A QUOTED MEMBER NAME IS DATA FOR THE SAME REASON. `$build.triggerInfo.'pr.number'`
      // publishes `uses -> pr.number` (the property's whole name, quotes stripped so the row names
      // what the source names), and the qualified reading fires on the dot. The owner it derives —
      // `pr` — is a VARIABLE in the project, so the owner question refutes a claim about a name the
      // row does not contain. Only a quoted member name CONTAINING a dot needs the rule: a quoted
      // name without one derives no owner at all, and its per-file claim stays true.
      const isQuotedMemberNameWithDot =
        (rel.metadata as any)?.isQuotedMemberName === true && target.indexOf(".") > 0
      const isDataNameKey = ((rel.metadata as any)?.isConstantKey === true && !keyHasPathByte) ||
        isQuotedMemberNameWithDot
      // PSD14 — A NATIVE PROGRAM NAME IS A FILE, AND THE FILE CLAIM IS THE ONE THAT CAN ANSWER IT.
      // `whoami.exe` is not a declaration and not an owner: the project either admits a file of that
      // name or it does not. Publishing the path claim turns 17 refutations into verifications and
      // states the fact that is actually checkable.
      const programName = (rel.type === ASTEngine.RelationshipType.Calls && isCommandPositionCall(rel))
        ? programNameOf(target)
        : null
      if (programName !== null) {
        rel.metadata.sourcePathClaim = [programName]
        continue
      }
      // PSD14 — A TYPE THIS FILE COMPILES AT RUN TIME IS NOT A DECLARATION THE PROJECT OWNS.
      // The evidence is the file's own `Add-Type` sources (`addTypeCreatedNames`, read before the
      // walk). A type literal or `New-Object` naming one of those roots is a claim no project
      // symbol table can answer: the type does not exist until the script runs. Withholding the
      // reading is the only honest option — the row keeps its facts and the class is named in the
      // lane's wall table.
      // THE RULE IS THE NAME, NOT THE MARKER, on the rows this file can actually answer. A type
      // mention reaches this pass through several emitters, and every one of them publishes the type
      // name with `isTypeReference` (measured on `[T]$x` and on a bare `[T]`); a `catch [T]` clause in
      // another file's compilation is the case this rule CANNOT reach, and that gap is named in the
      // lane's doc rather than papered over.
      let runtimeCreatedType = false
      if (addTypeCreatedNames.size > 0 && (
        rel.type === ASTEngine.RelationshipType.Instantiates || rel.type === ASTEngine.RelationshipType.Uses
      )) {
        const typeDot = target.indexOf(".")
        const typeRoot = (typeDot > 0 ? target.slice(0, typeDot) : target).toLowerCase()
        runtimeCreatedType = addTypeCreatedNames.has(typeRoot) || addTypeCreatedNames.has(target.toLowerCase())
      }
      // PSD15 — AND A CALL THROUGH SUCH A TYPE IS NOT AN EXTERNAL DEPENDENCY EITHER. `[DotNetInterop.
      // CodeMethods]::GetMethod()` targets `DotNetInterop.CodeMethods.GetMethod`, whose OWNER is the
      // type this file compiles. Publishing the type as a declaration (above) is what made the arbiter
      // answer that owner: MEASURED, 39 such claims read `externalRefuted` the moment the symbols
      // existed — and the arbiter was RIGHT, because the type is now published and the claim said it
      // was outside. The members of a C# body are NOT published (no member scan is safe enough to
      // mint declarations), so the row cannot resolve either; what it must not do is assert. The
      // reading is withheld and the row joins the wall unnamed-in-metadata but correctly classified.
      let callIntoCompiledType = false
      if (addTypeDeclarations.size > 0 && rel.type === ASTEngine.RelationshipType.Calls) {
        const callDot = target.lastIndexOf(".")
        if (callDot > 0) {
          callIntoCompiledType = addTypeDeclarations.has(target.slice(0, callDot).toLowerCase())
        }
      }
      const via = isDataNameKey || runtime !== null || runtimeCreatedType || callIntoCompiledType || !hasLetter
        ? null
        : externalReadingOf(target) ?? (isCommandPositionCall(rel) ? commandReadingOf(target) : null)
      if (via) {
        rel.metadata.externalTarget = true
        rel.metadata.externalVia = via
        // PSD13 — AND WHEN THE TARGET IS MODULE-QUALIFIED, SAY WHICH MODULE. The arbiter reads this
        // pair as the fleet's `moduleNamespace` claim and checks the MODULE against the project's own
        // file/directory space, which is a question the project can answer — unlike the owner question
        // the bare marker led to. Fail-closed: if the module root IS project layout the claim demotes to
        // `ext?` and never refutes, so this cannot raise `extFAIL` by construction.
        const moduleName = moduleQualifiedCommandOf(target)
        if (moduleName !== null) {
          rel.metadata.externalReason = "module-namespace"
          rel.metadata.externalSpecifier = moduleName
        }
        // PS38 — THE ARBITER'S SPELLING OF THE SAME CLAIM, and the whole defect it repairs
        // is one key name.
        //
        // `incoming-gate.ts` reads a claim from an EXPLICIT list of keys
        // (`EXTERNAL_KEYS`, script/m14/incoming-rule.ts) and `externalTarget` is not in it.
        // So every edge this pass marks — the cmdlets and the .NET/module spellings, the
        // lane's whole cause-C reading — arrived at the arbiter as an UNMARKED edge, which
        // is indistinguishable there from a broken one. Measured at `powershell ps1 60`:
        // 5,877 unresolved of 9,911 edges, 0 external, and 1,938 of those 5,877 already
        // carried this analyzer's own externality reading.
        //
        // `isExternalTarget` IS in that list and is the same claim word for word, so this is
        // a RE-SPELLING and not a widening: the guard above (`declaredInFile(target)`) and
        // the reading (`externalReadingOf`) are unchanged, `externalVia` still says which
        // reading fired, and NOT ONE EDGE IS ADDED.
        //
        // BUT IT IS NOT PUBLISHED ON EVERY MARKED EDGE, AND THAT RESTRICTION IS THE SECOND
        // HALF OF PS38. `verifyExternalClaim` checks a claim one of two ways: with no dotted
        // owner it asks about the TARGET ITSELF (or cannot ask at all, for a spelling that is
        // not an identifier), and with a dotted owner it asks about the OWNER — a string the
        // edge does NOT name and this analyzer never guarded. That second question can be
        // answered by a declaration of something else entirely. Measured over the whole
        // 978-file corpus with the census beside this lane: 82 marked edges are REFUTED, and
        // every one of the 82 has a BARE owner — `Text.UTF8Encoding` (owner `Text`, from
        // `[Text.UTF8Encoding]::new()` in Grace/scripts/capture-artifact-size.ps1:115),
        // `powershell.exe` (owner `powershell`), the `#requires -Version 3.0` literal (owner
        // `3`), and `Test.User32::GetPlacement` (owner `Test`; the run creates that type with
        // `Add-Type -Name User32 -Namespace Test`, ConsoleHost.Tests.ps1:1012, and an
        // unrelated Pester file declares `class Test` at
        // Scripting.Classes.BasicParsing.Tests.ps1:508). ZERO of the 82 has a qualified owner.
        //
        // So the readable key is published only where the arbiter's question is one this
        // target's own spelling settles (`arbiterCanCheckOwner`, below): no dotted owner (the
        // target itself is asked, or nothing is), or an owner that is ITSELF qualified — the
        // namespace path of a .NET type, which is what `System.IO.Path::Combine`'s `System.IO`
        // is. The claim is not withdrawn from the other edges: `externalTarget`/`externalVia`
        // still publish the reading on them exactly as before PS38.
        //
        // MEASURED, `powershell ps1 60` (analyzer digest 52392fbdd74156f2; census
        // `validation/m14/fixtures/powershell/incoming-split.mts --nf 60 --all`, which
        // re-measures the gate's own numbers exactly):
        //   published 1,889 = 178 verified + 1,711 unverifiable + 0 REFUTED
        //   withheld     49 = 47 would-verify + 2 the project answers, left to the old key
        // and corpus-wide (978 files, 160,306 edges): unresolved 75,964 → 50,558 with 26,773
        // edges carrying the key — 2,296 verified, 23,110 unverifiable, 0 REFUTED — at a
        // payload cost of +642,552 B (1.815% of the lane's relationship JSON).
        //
        // TWO KEYS RATHER THAN A RENAME, and the reason is not compatibility: the m60 mutant
        // suite (`script/m60/powershell-mutants.ts`, `powershell/externality-*`) is written
        // against `externalTarget` and is NOT in this lane's write scope, so dropping the old
        // spelling would silently disarm four mutants whose whole job is to kill the
        // shape-only rule this pass exists to avoid. Cost, measured on the shipped output:
        // one 24-byte `,"isExternalTarget":true` per published edge.
        if (arbiterCanCheckOwner(target)) rel.metadata.isExternalTarget = true
        continue
      }
      // A qualified spelling is not a bare-word name at all: `$env:PATH` and `Foo::Bar` are
      // not spellings a declaration table can answer for, and the scope-prefix exclusion in
      // `externalReadingOf` is why `global:Foo` reaches here rather than above.
      if (type === ASTEngine.RelationshipType.Calls || type === ASTEngine.RelationshipType.Uses) {
        rel.metadata.noDeclarationInFile = true
      }
    }

    const detectedPatterns = [...patterns]
    const detectedFrameworks = [...frameworks]

    // THE NAMESPACE CLAIM (task-34) — `["System"]`, ONE ENTRY, the only root that survived the fleet screen.
    //
    // MEASURED whole population before wiring: `System` is 1,587 claimable `uses` targets with a 3.8%
    // last-segment-declared rate, while EVERY other large root on this lane fails that screen at 100%
    // (`DefaultCommands` 1,272 · `WebCmdlets` 659 · `TabCompletion` 607 · `FileSystem` 531 ·
    // `ModuleConstraint` 326 · `Pester` 320 · `Registry` 290) — those are module and parameter names whose
    // targets the project itself declares, and they are deliberately NOT in the list. `System` is the .NET
    // BCL root: `std`'s shape, and the shape the claim was built for.
    //
    // THE SEGMENT BOUNDARY IS EXPLICIT HERE, and it answers the one question the screen could not:
    //   · `System.IO.Path` IS claimed — the leading segment is exactly `System` (`namespaceMatchOf` checks
    //     segments, not text, so this is what it certifies);
    //   · `SystemFoo.Bar` is NOT claimed — the text-prefix trap is refused by requiring the dot.
    const psDeclaredHere = new Set<string>()
    for (const sym of symbols) {
      if (sym.name) psDeclaredHere.add(sym.name)
      const q = (sym as { qualifiedName?: unknown }).qualifiedName
      if (typeof q === "string" && q.length > 0) psDeclaredHere.add(q)
    }
    let psNamespaceClaims = 0
    let psShorthandClaims = 0
    for (const rel of relationships as Array<{ type?: unknown; target?: unknown; metadata?: Record<string, unknown> }>) {
      // `uses`, `calls` AND `instantiates` — the namespace claim's semantics do not depend on the edge type
      // (it certifies a ROOT, not a relationship kind), and MEASURED: limiting this pass to `uses` moved only
      // 22 edges, because powershell's `System.*` targets are overwhelmingly CALLS
      // (`System.Console.WriteLine`-shaped). The first run of this post-pass is what located that, rather than
      // assuming it.
      //
      // `instantiates` IS THE PS-B27 ADDITION, and leaving it out was the whole reason 113 rows read
      // `externalRefuted`: `[Text.UTF8Encoding]::new($false)` publishes an INSTANTIATES row, so the one edge
      // type that had no namespace claim was the one carrying the .NET constructor targets. The claim asks
      // nothing of the edge kind — the root of `Text.UTF8Encoding` is outside this project whichever
      // relationship names it.
      if (
        rel.type !== ASTEngine.RelationshipType.Uses &&
        rel.type !== ASTEngine.RelationshipType.Calls &&
        rel.type !== ASTEngine.RelationshipType.Instantiates
      ) continue
      const tgt = String(rel.target ?? "")
      const md = rel.metadata
      if (!md || typeof md !== "object") continue
      if (md.isExternal === true) continue
      // THE ROOT, AND ONLY THE ROOT. Two spellings reach here: a fully qualified `System.*` target, and a
      // `[T]::new()` whose root the engine resolves under `System.` (PS-B27 — see
      // `dotNetShorthandRootOf`). The list carries the ROOT AS WRITTEN because `namespaceMatchOf` compares
      // the target's own segments against it; the DOCUMENTED table is what makes the entry a fact rather
      // than a guess, and it is consulted BEFORE the list is written, never after.
      let roots: string[] | null = null
      const envRoot = envProviderRootOf(tgt)
      const usingRoot = usingScopeRootOf(tgt)
      if (tgt === "System" || tgt.startsWith("System.")) roots = ["System"]
      else if (envRoot !== null) roots = [envRoot]
      else if (usingRoot !== null) roots = [usingRoot]
      else if (md.dotNetNew === true) {
        const shorthand = dotNetShorthandRootOf(tgt)
        if (shorthand !== null) {
          roots = [shorthand]
          if (psDeclaredHere.has(tgt)) roots = null
        }
      }
      if (roots === null) continue
      if (psDeclaredHere.has(tgt)) continue
      md.languageNamespace = roots
      if (roots[0] === "System") psNamespaceClaims++
      else psShorthandClaims++
    }

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
    // DAMAGE IS A PROPERTY OF THE NODE'S OWN TEXT, NOT OF ITS ANCESTRY.
    //
    // PS6's wording is exact: "a `command` whose NAME LIVES INSIDE an ERROR/MISSING node is
    // recovery noise". The first implementation asked the ANCESTOR question, which refuses a
    // command parsed from healthy source merely because some enclosing statement failed to
    // parse — measured on the pinned corpus's
    // `test/powershell/Language/Parser/MethodInvocation.Tests.ps1` (44 ERRORs, root node of
    // type ERROR): `It`, `Should`, `Add-Type`, `Write-Verbose`, `BeforeEach` and `AfterEach`
    // were all refused and every call edge in the file vanished. The inverse error is just as
    // bad: a command node built FROM recovery text beside a healthy ancestor would pass.
    //
    // So the test is the node's OWN subtree: does the text this fact would be read from
    // contain an ERROR or a missing token? The F5 oracle's `damaged` uses the same
    // definition, so the comparison and the analyzer apply ONE policy. The command branch
    // is the exception and calls `nameWithinRecovery` instead — see that method.
    const st: Node[] = [node]
    while (st.length > 0) {
      const x = st.pop()!
      if (x.type === "ERROR" || x.isMissing) return true
      for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) st.push(c) }
    }
    return false
  }

  /**
   * PS6 — does this NAME live inside a recovery region?
   *
   * The command branch needs the ANCESTOR question, not the subtree one, because
   * PS6's wording is about where the name sits: a `command` reconstructed from a
   * broken line keeps a clean name token and a clean subtree, accompanied by an
   * ERROR sibling, so a subtree test passes it. The one exemption is the
   * whole-file wrapper: the grammar wraps a CmdletBinding function's body in one
   * ERROR node covering the entire file, and the commands inside it are real
   * (MethodInvocation.Tests.ps1; the oracle expects them).
   */
  private nameWithinRecovery(node: Node): boolean {
    let top: Node = node
    while (top.parent) top = top.parent
    const topEnd = top.endIndex
    let n: Node | null = node.parent
    let d = 0
    while (n && d < 24) {
      if (n.type === "ERROR" || n.isMissing) {
        const wholeFile = n.startIndex === 0 && n.endIndex === topEnd
        if (!wholeFile) return true
      }
      n = n.parent
      d++
    }
    return false
  }

  /** The value of a two-token parameter (`-TypeName Foo`) or `-Name:Foo`. */
  private parameterValue(node: Node, flag: string, out?: { node: Node | null }): string | null {
    const elements = this.findChildByType(node, "command_elements")
    if (!elements) return null
    const wanted = stripLeadingDash(flag).toLowerCase()
    for (let i = 0; i < elements.namedChildCount; i++) {
      const c = elements.namedChild(i)
      if (!c || c.type !== "command_parameter") continue
      if (stripLeadingDash(this.stripQuotes(c.text)).toLowerCase() !== wanted) continue
      const next = this.valueAfterNode(elements, i)
      if (next && (next.type === "generic_token" || next.type === "string_literal" || next.type === "expandable_string_literal")) {
        // PS29 — the VALUE NODE is reported alongside the text, because whether the value
        // is a NAME or a VARIABLE holding a name is a property of the node and not of the
        // string. `-TypeName System.Version` and `-TypeName $t` are both `stripQuotes`-ed
        // text, and only the second is a variable. See the `New-Object` reader.
        if (out) out.node = next
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

  // PS27 REMOVED: `classAttributeTexts` had no callers left. It collected EVERY
  // `class_attribute` on a class member, which is correct for a member and wrong
  // for the pinned wasm's split — where one of those nodes is the front of the
  // NAME — and `memberHeaderFacts` replaces it with the position scan. It is
  // deleted rather than left in place because a private method that reads a
  // member's modifiers the wrong way is a trap for whoever calls it next, and
  // `class-inherit-psa2` will not catch a re-introduction: no fixture reads
  // `isStatic` off a split-shaped member.

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
