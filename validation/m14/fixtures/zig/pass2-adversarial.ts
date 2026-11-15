/**
 * ZIG PASS-2 ADVERSARIAL AUDIT — the half of the ontology work pass 1 was not
 * asked to do.
 *
 * ## What this is, and why a second instrument
 *
 * Pass 1 established EMITTED / RULED / GAP for the ten relationship types and
 * answered the six questions at the level "does the aggregate number hold".
 * That level cannot find a wrong edge: a census COUNTS edges, and it counts a
 * false one exactly as readily as a true one. The six questions fail
 * independently, and the interesting case for each is the one where the total is
 * right and a class inside it is wrong.
 *
 * So every probe here takes the production `parseFile` output for a file and
 * then asks a question that output does not answer about itself.
 *
 *   A1  `calls`        — is the target a name the pinned grammar RESERVES, or an
 *                         `@`-prefixed intrinsic? (Labelled)
 *   A2  `calls`        — at the recorded LINE, is the name called at all?
 *                         (Correct. The lane's line-accuracy gate requires the
 *                         name to APPEAR on the line; appearing and being
 *                         called are different questions.)
 *   A3  `uses`         — at the recorded line, is the target a member leaf for a
 *                         `zig_field_access` edge and a BARE word for an
 *                         `identifier_usage` edge? (Correct, per reason code.)
 *   A4  `instantiates` — does the target bind to a symbol THIS analyzer published
 *                         in THIS file? (Resolved. The inventory is built from
 *                         the tree's own container declarations, so an
 *                         unresolvable target is a container the analyzer
 *                         declines to publish — the TARGET-side twin of Z59,
 *                         which fixed the source side only.)
 *   A5  `contains`     — does the owner name bind to exactly one container in
 *                         the file? (Labelled. The edge is keyed on a NAME.)
 *   A6  `exports`      — does the name resolve, uniquely, to a PUBLIC symbol?
 *   A7  `references`   — is every declared-type target really named at a TYPE
 *                         site, and how many sites collapse into one edge?
 *   A8  `imports`      — which spelling backs each import edge, read off the
 *                         line, and is the module path on that line?
 *   A9  SOURCE IDENTITY — the census measures endpoint resolution by NAME. A
 *                         `calls` edge whose source name matches a struct with
 *                         that spelling READS as resolved and is not a caller.
 *   A10 NAMED TESTS    — Z39 makes `test foo { … }` an edge SOURCE while
 *                         publishing no symbol for it. A9 and A10 are the same
 *                         defect measured twice: by whether the name binds to
 *                         something callable, and by whether it is a test name.
 *   A11 SHADOWING      — `bindIdentifiersUnder` binds every identifier under a
 *                         `payload`, so a name that appears only in the subtree
 *                         shadows the real file-scope value. Measured on the tree.
 *
 * ## THE ONE METHODOLOGICAL TRAP, AND WHY THE CODE IS BUILT AROUND IT
 *
 * An edge carries a LINE, not a column. `hash -> hash` at
 * `std.hash.Wyhash.hash(pp.prefix, …)` is a true edge whose target appears
 * three times on that line, only one of which is a call. A probe that reads the
 * FIRST whole-word occurrence reports a defect that does not exist, and a probe
 * written that way would have "found" several hundred false positives in the
 * first run — which is the same mistake this lane's own history records six
 * times (Z24, Z25, Z29, Z34, Z41, Z43: a name rule applied on one side of a
 * comparison and not the other).
 *
 * So every line-level probe here asks the ANY-occurrence question and reports a
 * finding only when NO occurrence on the line satisfies the class. Each probe
 * also publishes the weaker "first occurrence" count beside it, labelled as the
 * weaker thing it is, so the difference between the two is visible rather than
 * asserted.
 *
 * ## Two rules this file obeys
 *
 * 1. NO COUNT WITHOUT A CONTROL. A probe reporting 0 is indistinguishable from a
 *    probe that cannot see. Every line-level predicate is a PURE function of
 *    (line, name) and its controls are direct calls on strings — a positive and
 *    a negative — so a control cannot be satisfied by an unrelated code path.
 *    Every tree-level walker gets a synthetic snippet it must find.
 * 2. ZERO-REGEX. Identifier boundaries are a character-code test. A text regex
 *    is how the ontology gate's first version returned two false positives (a
 *    telnet IAC word list read as `class voice`, a heredoc of `new Map(`).
 *
 * ## Tree facts vs production facts
 *
 * Production facts (symbols, relationships) come from `parseFile` and nothing
 * else. Tree facts come from a SECOND parse of the same bytes through the same
 * pinned wasm, via the same `Language.load` + `Parser.init` the lane's other
 * tree-side instrument uses. The paths are separate on purpose: the point is to
 * ask the analyzer's OUTPUT a question the analyzer did not answer, and a tree
 * walked by the analyzer's own code would agree with it by construction.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/pass2-adversarial.ts [--sample 400]
 *     [--seed pass2-v1] [--out p] [--files-from p]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { stripZigQuoting } from "../../../../src/ast/real-zig-analyzer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "pass2-v1")
const OUT = arg("out", "")
const FILES_FROM = arg("files-from", "")
const WANT = FILES_FROM
  ? new Set(readFileSync(path.resolve(ROOT, FILES_FROM), "utf8").split("\n").map((s) => s.trim()).filter(Boolean))
  : null

// ────────────────────────────────────────────────── corpus walk (the census's own)
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
const LIMIT = 512 * 1024
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > LIMIT) continue } catch { continue }
    all.push({ repo: e, dir, rel, abs })
  }
}
const key = (f: FileRec) => `${f.repo}/${f.rel}`
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  .map((x) => x.f)
let draw = SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
if (WANT) draw = draw.filter((f) => WANT.has(key(f)))
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ────────────────────────────────────────────────── the pinned grammar, tree side
//
// `Parser.init` with an explicit `locateFile` is required: without it the WASM
// loader is undefined in web-tree-sitter 0.25. The engine's `src/ast/engine.ts`
// does this init for the production path; a standalone tree-side instrument must
// do it for its own.
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// ────────────────────────────────────────────────── zero-regex text predicates
const isIdChar = (c: string): boolean => {
  const k = c.charCodeAt(0)
  return (k >= 65 && k <= 90) || (k >= 97 && k <= 122) || (k >= 48 && k <= 57) || k === 95
}
/** Every whole-word occurrence of `name` on `line`, left to right. */
function occurrences(line: string, name: string): number[] {
  const out: number[] = []
  if (!name) return out
  let i = 0
  for (;;) {
    const at = line.indexOf(name, i)
    if (at === -1) return out
    const before = at > 0 ? line[at - 1] : " "
    const after = line[at + name.length] ?? " "
    if (!isIdChar(before) && !isIdChar(after)) out.push(at)
    i = at + 1
    if (i > line.length) return out
  }
}
const backOverSpace = (line: string, at: number): number => {
  let b = at - 1
  while (b >= 0 && (line[b] === " " || line[b] === "\t")) b--
  return b
}
const fwdOverSpace = (line: string, at: number): number => {
  let j = at
  while (j < line.length && (line[j] === " " || line[j] === "\t")) j++
  return j
}
/** A2's predicate. True when AT LEAST ONE occurrence of `name` on `line` is
 *  followed by `(`.
 *
 *  The fourth spelling ambiguity a name carries in Zig, and the fourth false
 *  positive this probe's first run produced: `try expect(@"weird function
 *  name"() == 1234)` — M60 makes the quoting syntax not part of the published
 *  NAME, so the edge's target is `weird function name`, and the character after
 *  that occurrence is the closing `"`, not `(`. */
const someOccurrenceIsACall = (line: string, name: string): boolean =>
  occurrences(line, name).some((at) => {
    let j = fwdOverSpace(line, at + name.length)
    if (line[j] === '"') j = fwdOverSpace(line, j + 1)
    return line[j] === "("
  })
/**
 * A3's predicates, per reason code — and the THREE ambiguities a `.` creates,
 * each of which produced false positives in this probe's first run and is
 * therefore a named rule with its own controls rather than a silent exception:
 *
 *  1. THE RANGE OPERATOR. `many_u32[0..runtime_index]` has a `.` immediately
 *     before `runtime_index`, and it is the second half of `..`. Zig's range
 *     expression made a member-access test report a bare read as a member read;
 *     the analyzer is right and the probe was wrong.
 *  2. THE ERROR-SET LEAF. `return error.CacheCheckFailed;` — the analyzer
 *     deliberately reads an error-set member BY NAME (they live in one global
 *     namespace in Zig, `error.Bad` names the variant regardless of which set
 *     declared it), so the edge's reason code is `identifier_usage` while the
 *     text carries a dot.
 *  3. THE QUOTED MEMBER. `@typeInfo(T).@"struct".backing_integer` and
 *     `cfg.@"gtk-single-instance"` put a `"` between the dot and the name,
 *     because M60 makes the quoting syntax not part of the published NAME.
 *
 * Each is a fact about Zig's spelling, not a relaxation of the test: in all
 * three the analyzer's class is right and the dotted form would have convicted
 * it of being wrong.
 */
const isMemberOccurrence = (line: string, at: number): boolean => {
  const b = backOverSpace(line, at)
  if (line[b] === ".") return true
  if (line[b] === '"') {
    const q = backOverSpace(line, b)
    if (line[q] === "@") return line[backOverSpace(line, q)] === "."
    return false
  }
  return false
}
const isBareOccurrence = (line: string, at: number): boolean => {
  const b = backOverSpace(line, at)
  if (line[b] === '"') {
    // A quoted member is a member, for the same reason it is one above.
    const q = backOverSpace(line, b)
    if (line[q] === "@") return line[backOverSpace(line, q)] !== "."
    return true
  }
  if (line[b] !== ".") return true
  const d = backOverSpace(line, b)
  if (line[d] === ".") return true
  if (line.slice(Math.max(0, b - 5), b) === "error") return true
  return false
}
const someOccurrenceIsAMemberLeaf = (line: string, name: string): boolean =>
  occurrences(line, name).some((at) => isMemberOccurrence(line, at))
const someOccurrenceIsBare = (line: string, name: string): boolean =>
  occurrences(line, name).some((at) => isBareOccurrence(line, at))
/** A8's predicate: the import spelling on this line, read off the text. */
function importSpellingAt(line: string): string {
  const cimp = occurrences(line, "cImport")
  for (const at of cimp) if (line[backOverSpace(line, at)] === "@") return "@cImport"
  const imp = occurrences(line, "import")
  for (const at of imp) {
    const b = line[backOverSpace(line, at)]
    if (b === "@") return "@import"
    if (!isIdChar(b)) return "import (no @ sigil)"
  }
  return "(no import token on the line)"
}
const bump = (m: Map<string, number>, k: string, n = 1): void => { m.set(k, (m.get(k) ?? 0) + n) }

// ────────────────────────────────────────────────── tallies
const CALLABLE_KINDS = new Set(["function", "method"])
const CONTAINER_KINDS = new Set(["struct", "enum", "union", "type", "interface", "class"])
const MARKERS = new Set(["(global)", "(file)", "(declared-type)"])

type Finding = { n: number; examples: string[] }
const F = (): Finding => ({ n: 0, examples: [] })
const hit = (f: Finding, s: string, cap = 12): void => {
  f.n++
  if (f.examples.length < cap) f.examples.push(s)
}

const T = {
  callsEdges: 0,
  callsTargetAtPrefixed: new Map<string, number>(),
  callsTargetReserved: new Map<string, number>(),
  callsLineMissing: F(),
  callsLineNoCallOccurrence: F(),
  callsLineFirstOccurrenceNotACall: 0,
  usesEdges: 0,
  usesLineMissing: F(),
  usesFieldNoMemberOccurrence: F(),
  usesBareNoBareOccurrence: F(),
  usesFieldFirstOccurrenceNotAMember: 0,
  instantiatesEdges: 0,
  instantiatesTargetUnresolved: F(),
  instantiatesUnresolvedByForm: new Map<string, number>(),
  instantiatesUnresolvedInTest: 0,
  containsEdges: 0,
  containsOwnerUnresolved: F(),
  containsOwnerAmbiguous: F(),
  containsDuplicatePairs: 0,
  containsDuplicatePairExamples: [] as string[],
  callsQuotedCallee: 0,
  callsTargetNumeric: 0,
  callsTargetNumericExamples: [] as string[],
  exportsEdges: 0,
  exportsTargetUnresolved: F(),
  exportsTargetNotPublic: F(),
  exportsTargetAmbiguous: 0,
  declaredTypeEdges: 0,
  declaredTypeSites: 0,
  declaredTypeFiles: 0,
  declaredTypeTargetNotASite: F(),
  declaredTypeTargetIsAKeyword: F(),
  declaredTypeTargetStartsWithADigit: 0,
  declaredTypeTargetStartsWithADigitExamples: [] as string[],
  declaredTypeLeafIsAValuePosition: F(),
  declaredTypeTargetVocab: new Map<string, number>(),
  declaredTypeMaxSitesPerEdge: 0,
  declaredTypeMaxEdgeExample: "",
  importEdges: 0,
  importSpellings: new Map<string, number>(),
  importPathNotOnLine: F(),
  callsNamedSource: 0,
  callsSourceKind: new Map<string, number>(),
  callsSourceNotCallable: F(),
  usesNamedSource: 0,
  usesSourceKind: new Map<string, number>(),
  usesSourceNotCallable: F(),
  nonCallableSourceThatIsATestName: 0,
  nonCallableSourceThatIsNotATestName: F(),
  distinctTestNames: new Map<string, number>(),
  edgesSourcedAtATestName: 0,
  testNameSourceExamples: [] as string[],
  identifiersUnderPayloads: 0,
  identifiersUnderPayloadsNotDirect: 0,
  payloadShadowingAFileValue: F(),
  filesParsed: 0,
  filesWithATree: 0,
  symbols: 0,
  relationships: 0,
  parseFailures: 0,
  filesWithAnyFinding: new Set<string>(),
  bareImportCalleeFiles: 0,
}
const mark = (f: string): void => { T.filesWithAnyFinding.add(f) }

/**
 * The pinned grammar's OWN type table, which in web-tree-sitter carries the
 * ANONYMOUS TOKEN types as well as the named ones — so it is simultaneously the
 * node-type inventory and the keyword inventory. A keyword cannot be a Zig
 * declaration name unless it is quoted, so an UNQUOTED keyword target is a
 * mislabel whatever the tree says. Calibrated by a control that asserts a known
 * keyword (`fn`) is present, because a table holding only named types would make
 * the corpus figure vacuously 0.
 */
const declaredTypesAll: string[] = (language.types ?? []).filter((t: unknown) => typeof t === "string" && (t as string).length > 0)
const keywordish = new Set(declaredTypesAll)

// ────────────────────────────────────────────────── tree-side walkers
/** Every `builtin_identifier` text the pinned grammar produces here — the
 *  grammar's OWN inventory of the names it reserves for intrinsics. */
function collectReservedSpellings(root: Node, into: Set<string>): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "builtin_identifier") into.add(String(n.text ?? ""))
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/** A TYPE-NAMING SITE: the last identifier at or under a node the grammar marks
 *  with its `type` FIELD. This decides nothing about whether a site should be
 *  PUBLISHED — that is the analyzer's filter and is deliberately not
 *  re-implemented here — it only says where a type name is written. */
function collectTypeSites(root: Node, into: Map<string, number>): void {
  const leafUnder = (n: Node): string => {
    let found = ""
    // Children are pushed in REVERSE so the pop order is left-to-right, which is
    // what makes `found` the LAST identifier in reading order. Pushing forward
    // and popping makes it the first identifier of the LAST branch — a wrong
    // answer that reads as "0 type sites" for every qualified type, which is
    // exactly the false-positive class this instrument exists not to ship.
    const stack: Node[] = [n]
    let seen = 0
    while (stack.length > 0 && seen++ < 200) {
      const m = stack.pop()!
      // The ANALYZER publishes the stripped name (M60), so the site set must be
      // stripped too. Comparing a raw `@"PE32+"` site against a published `PE32+`
      // target reports a phantom that is not one — the same one-sided-name-rule
      // mistake this lane's own history records six times.
      if (m.type === "identifier") found = stripZigQuoting(String(m.text ?? ""))
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return found
  }
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (
      n.type === "parameter" || n.type === "container_field" ||
      n.type === "variable_declaration" || n.type === "function_declaration" ||
      n.type === "function_signature"
    ) {
      const t = n.childForFieldName?.("type")
      if (t) {
        const leaf = leafUnder(t)
        if (leaf) bump(into, leaf)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/** The leaf name of a type annotation whose LAST identifier is the sole named
 *  child of a `field_expression` — `.@"inline"`, `.@"16"`. There is no base, so
 *  the leaf is a VALUE (an enum literal or a callconv argument) and not a type
 *  name. Keyed by the leaf so the edge loop can ask by target. */
function collectValuePositionLeaves(root: Node, into: Map<string, string>): void {
  const leafUnder = (n: Node): string => {
    let found = ""
    const stack: Node[] = [n]
    let seen = 0
    while (stack.length > 0 && seen++ < 200) {
      const m = stack.pop()!
      if (m.type === "identifier") found = stripZigQuoting(String(m.text ?? ""))
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return found
  }
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (
      n.type === "parameter" || n.type === "container_field" ||
      n.type === "variable_declaration" || n.type === "function_declaration" ||
      n.type === "function_signature"
    ) {
      const t = n.childForFieldName?.("type")
      if (t) {
        let cur: Node | null = t
        let guard = 0
        while (cur && guard++ < 40) {
          if (cur.type === "field_expression" && cur.namedChildCount === 1) {
            const leaf = leafUnder(cur)
            if (leaf) into.set(leaf, "the sole named child of a field_expression (an enum literal or a callconv argument)")
            break
          }
          if (cur.type === "identifier") break
          cur = cur.namedChildCount > 0 ? cur.namedChild(cur.namedChildCount - 1) : null
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

function collectTestNames(root: Node, into: Map<string, number>): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "test_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") { bump(into, String(c.text ?? "")); break }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/** Every `call_expression` / `builtin_function` callee IDENTIFIER text in the
 *  file. The site pass (`collectZigImportSites`) accepts a bare `import` spelling
 *  as well as `@import` / `@cImport`, and that disjunct needs a count of its own:
 *  a live branch nobody has exercised reads exactly like a correct one. */
function collectCalleeIdentifiers(root: Node, into: Set<string>): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression" || n.type === "builtin_function") {
      const first = n.namedChildCount > 0 ? n.namedChild(0) : null
      // Both spellings, because the SITE PASS's own disjunct accepts both
      // (`builtin_identifier` or `identifier`) and a walker that accepted only
      // `identifier` would never see `@import` at all.
      if (first && (first.type === "identifier" || first.type === "builtin_identifier")) {
        into.add(String(first.text ?? ""))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/** A `payload`'s DECLARED capture names are its direct identifier children. Any
 *  other identifier beneath one is a name `bindIdentifiersUnder` binds and the
 *  language never declares there. */
function walkPayloads(root: Node, isFileValue: (n: string) => boolean, out: { ids: number; nonDirect: number; shadowed: Finding; file: string }): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "payload") {
      const direct = new Set<string>()
      const inner: Node[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "identifier") direct.add(String(c.text ?? ""))
        else inner.push(c)
      }
      out.ids += direct.size
      const walk: Node[] = [...inner]
      while (walk.length > 0) {
        const m = walk.pop()!
        if (m.type === "identifier") {
          const txt = String(m.text ?? "")
          out.ids++
          if (!direct.has(txt)) {
            out.nonDirect++
            if (isFileValue(txt)) {
              hit(out.shadowed, `${out.file}: payload binds ${txt}, which is a file-scope value`)
            }
          }
        }
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c) walk.push(c)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

// ────────────────────────────────────────────────── the audit
async function run(files: FileRec[]): Promise<void> {
  for (const f of files) {
    let r: any
    let src = ""
    try {
      r = await parseFile(f.abs, f.dir)
      src = readFileSync(f.abs, "utf8")
    } catch { T.parseFailures++; continue }
    T.filesParsed++
    const symbols: any[] = r.symbols ?? []
    const rels: any[] = r.relationships ?? []
    T.symbols += symbols.length
    T.relationships += rels.length
    const srcLines = src.split("\n")
    const lineOf = (n: unknown): string => {
      const i = typeof n === "number" ? n : 0
      return i >= 1 && i <= srcLines.length ? srcLines[i - 1] : ""
    }

    let tree: Node | null = null
    try { tree = (parser.parse(src) as unknown as { rootNode: Node }).rootNode } catch { tree = null }
    const reserved = new Set<string>()
    const sites = new Map<string, number>()
    const tNames = new Map<string, number>()
    const callees = new Set<string>()
    const literalLeafUnderTypeFields = new Map<string, string>()
    if (tree) {
      T.filesWithATree++
      collectReservedSpellings(tree, reserved)
      collectTypeSites(tree, sites)
      collectValuePositionLeaves(tree, literalLeafUnderTypeFields)
      collectTestNames(tree, tNames)
      collectCalleeIdentifiers(tree, callees)
      if (callees.has("import")) T.bareImportCalleeFiles++
    }

    const byName = new Map<string, any[]>()
    for (const s of symbols) {
      const nm = String(s.name ?? "")
      if (!nm) continue
      if (!byName.has(nm)) byName.set(nm, [])
      byName.get(nm)!.push(s)
    }
    const containersByName = new Map<string, any[]>()
    for (const s of symbols) {
      if (!CONTAINER_KINDS.has(String(s.kind ?? ""))) continue
      const nm = String(s.name ?? "")
      if (!containersByName.has(nm)) containersByName.set(nm, [])
      containersByName.get(nm)!.push(s)
    }
    const fileValues = new Set<string>()
    for (const s of symbols) {
      if (s.ownerName) continue
      const k = String(s.kind ?? "")
      if (k === "constant" || k === "variable" || k === "function" || k === "enum_member") {
        fileValues.add(String(s.name ?? ""))
      }
    }

    const declTypeTargets = new Set<string>()
    const nonCallableSources: string[] = []
    const containsPairLines = new Map<string, number>()

    for (const e of rels) {
      const t = String(e.type ?? "")
      const s = String(e.source ?? "")
      const tgt = String(e.target ?? "")
      const line = typeof e.line_number === "number" ? e.line_number : 0
      const rc = String(e.metadata?.relationshipType ?? "")
      const L = lineOf(line)

      if (t === "calls") {
        T.callsEdges++
        if (tgt.startsWith("@")) bump(T.callsTargetAtPrefixed, tgt)
        if (reserved.has(tgt)) bump(T.callsTargetReserved, tgt)
        const t0 = tgt.charCodeAt(0)
        if (tgt.length > 0 && t0 >= 48 && t0 <= 57) {
          T.callsTargetNumeric++
          if (T.callsTargetNumericExamples.length < 8) {
            T.callsTargetNumericExamples.push(`${key(f)}:${line} calls ${s} -> ${tgt} | ${String(e.metadata?.callExpression ?? "").slice(0, 60)}`)
          }
        }
        if (tgt.includes(" ")) T.callsQuotedCallee++
        if (!L) hit(T.callsLineMissing, `${key(f)}:${line} ${s} -> ${tgt} (no such line)`)
        else {
          const occ = occurrences(L, tgt)
          if (occ.length === 0) hit(T.callsLineMissing, `${key(f)}:${line} ${s} -> ${tgt} | ${L.trim().slice(0, 90)}`)
          else {
            if (L[fwdOverSpace(L, occ[0] + tgt.length)] !== "(") T.callsLineFirstOccurrenceNotACall++
            if (!someOccurrenceIsACall(L, tgt)) {
              hit(T.callsLineNoCallOccurrence, `${key(f)}:${line} calls ${s} -> ${tgt} | ${L.trim().slice(0, 90)}`)
              mark(key(f))
            }
          }
        }
        if (!MARKERS.has(s)) {
          T.callsNamedSource++
          const hs = byName.get(s) ?? []
          if (hs.length === 0) bump(T.callsSourceKind, "(no symbol with this name)")
          else {
            const ks = new Set(hs.map((x) => String(x.kind ?? "")))
            bump(T.callsSourceKind, ks.size === 1 ? [...ks][0] : "(multiple kinds)")
            if (!hs.some((x) => CALLABLE_KINDS.has(String(x.kind ?? "")))) {
              hit(T.callsSourceNotCallable, `${key(f)}:${line} calls ${s} -> ${tgt} | source kinds {${[...ks].join(",")}}`)
              nonCallableSources.push(`${key(f)}|${s}`)
              mark(key(f))
            }
          }
        }
      } else if (t === "uses") {
        T.usesEdges++
        if (!L) hit(T.usesLineMissing, `${key(f)}:${line} ${s} -> ${tgt} (no such line)`)
        else {
          const occ = occurrences(L, tgt)
          if (occ.length === 0) hit(T.usesLineMissing, `${key(f)}:${line} ${s} -> ${tgt} | ${L.trim().slice(0, 90)}`)
          else if (rc === "zig_field_access") {
            if (!isMemberOccurrence(L, occ[0])) T.usesFieldFirstOccurrenceNotAMember++
            if (!someOccurrenceIsAMemberLeaf(L, tgt)) {
              hit(T.usesFieldNoMemberOccurrence, `${key(f)}:${line} uses ${s} -> ${tgt} | ${L.trim().slice(0, 90)}`)
              mark(key(f))
            }
          } else if (rc === "identifier_usage") {
            if (!someOccurrenceIsBare(L, tgt)) {
              hit(T.usesBareNoBareOccurrence, `${key(f)}:${line} uses ${s} -> ${tgt} | ${L.trim().slice(0, 90)}`)
              mark(key(f))
            }
          }
        }
        if (!MARKERS.has(s)) {
          T.usesNamedSource++
          const hs = byName.get(s) ?? []
          if (hs.length === 0) bump(T.usesSourceKind, "(no symbol with this name)")
          else {
            const ks = new Set(hs.map((x) => String(x.kind ?? "")))
            bump(T.usesSourceKind, ks.size === 1 ? [...ks][0] : "(multiple kinds)")
            if (!hs.some((x) => CALLABLE_KINDS.has(String(x.kind ?? "")))) {
              hit(T.usesSourceNotCallable, `${key(f)}:${line} uses ${s} -> ${tgt} | source kinds {${[...ks].join(",")}}`)
              nonCallableSources.push(`${key(f)}|${s}`)
              mark(key(f))
            }
          }
        }
      } else if (t === "instantiates") {
        T.instantiatesEdges++
        const form = e.metadata?.isGenericTypeApplication ? "generic-application"
          : e.metadata?.isConstructorApplication ? "construction" : "(neither)"
        if (!(byName.get(tgt) ?? []).length) {
          hit(T.instantiatesTargetUnresolved, `${key(f)}:${line} ${s} -> ${tgt} (${form})`)
          bump(T.instantiatesUnresolvedByForm, form)
          if (tNames.has(s)) T.instantiatesUnresolvedInTest++
          mark(key(f))
        }
      } else if (t === "contains") {
        T.containsEdges++
        const pk = `${s}|${tgt}`
        const prev = containsPairLines.get(pk)
        if (prev === undefined) containsPairLines.set(pk, line)
        else if (prev !== line && T.containsDuplicatePairExamples.length < 12) {
          const txt = `${key(f)} contains ${s} -> ${tgt} at lines ${prev} and ${line}`
          if (!T.containsDuplicatePairExamples.includes(txt)) T.containsDuplicatePairExamples.push(txt)
          T.containsDuplicatePairs++
        }
        const hs = containersByName.get(s) ?? []
        if (hs.length === 0) {
          hit(T.containsOwnerUnresolved, `${key(f)}:${line} ${s} -> ${tgt}`)
          mark(key(f))
        } else if (hs.length > 1) {
          hit(T.containsOwnerAmbiguous, `${key(f)}:${line} ${s} -> ${tgt} (${hs.length} containers named ${s})`)
        }
      } else if (t === "exports") {
        T.exportsEdges++
        const hs = byName.get(tgt) ?? []
        if (hs.length === 0) {
          hit(T.exportsTargetUnresolved, `${key(f)}:${line} (file) -> ${tgt}`)
          mark(key(f))
        } else {
          if (hs.length > 1) T.exportsTargetAmbiguous++
          if (!hs.some((x) => String(x.visibility ?? "") === "public")) {
            hit(T.exportsTargetNotPublic, `${key(f)}:${line} (file) -> ${tgt} (all ${hs.map((x) => String(x.visibility)).join("/")})`)
            mark(key(f))
          }
        }
      } else if (t === "references") {
        if (rc === "declared_type") {
          declTypeTargets.add(tgt)
          T.declaredTypeEdges++
          bump(T.declaredTypeTargetVocab, tgt)
          // A KEYWORD cannot be a declared type name unquoted, so an unquoted
          // keyword target is a mislabel: `comptime callbackArg: fn ()
          // callconv(.@"inline") void` names the callconv ARGUMENT, not a type.
          if (keywordish.has(tgt)) {
            hit(T.declaredTypeTargetIsAKeyword, `${key(f)}:${line} references (declared-type) -> ${tgt}`)
            mark(key(f))
          }
          // A target starting with a DIGIT is the class the analyzer's own
          // digit-head guard was written to refuse; it survives because the guard
          // reads the QUOTED spelling and canonicalization strips the quotes
          // afterwards (`Aligned(Foo, .@"16")`).
          const c0 = tgt.charCodeAt(0)
          if (tgt.length > 0 && c0 >= 48 && c0 <= 57) {
            T.declaredTypeTargetStartsWithADigit++
            if (T.declaredTypeTargetStartsWithADigitExamples.length < 10) {
              T.declaredTypeTargetStartsWithADigitExamples.push(`${key(f)}:${line} references (declared-type) -> ${tgt}`)
            }
            mark(key(f))
          }
          // The leaf of a type annotation that is an ENUM LITERAL or a bare value
          // (a `field_expression` with no base: `.@"inline"`, `.@"16"`) is a
          // VALUE, not a type name.
          const lit = literalLeafUnderTypeFields.get(tgt)
          if (lit) {
            hit(T.declaredTypeLeafIsAValuePosition, `${key(f)}:${line} references (declared-type) -> ${tgt} (leaf is ${lit})`)
            mark(key(f))
          }
        }
        if (e.metadata?.isImport) {
          T.importEdges++
          bump(T.importSpellings, L ? importSpellingAt(L) : "(no line)")
          if (L && occurrences(L, tgt).length === 0) {
            hit(T.importPathNotOnLine, `${key(f)}:${line} -> ${tgt} | ${L.trim().slice(0, 90)}`)
          }
        }
      } else if (t === "imports") {
        T.importEdges++
        bump(T.importSpellings, L ? importSpellingAt(L) : "(no line)")
        if (L && occurrences(L, tgt).length === 0) {
          hit(T.importPathNotOnLine, `${key(f)}:${line} -> ${tgt} | ${L.trim().slice(0, 90)}`)
        }
      }
      // A10 — an edge whose SOURCE is a named test.
      if (t === "calls" || t === "uses" || t === "instantiates") {
        if (!MARKERS.has(s) && s && tNames.has(s)) {
          T.edgesSourcedAtATestName++
          if (T.testNameSourceExamples.length < 12) {
            T.testNameSourceExamples.push(
              `${key(f)} ${t} ${s} -> ${tgt} (test name; symbols with that name: ${(byName.get(s) ?? []).map((x) => String(x.kind)).join("/") || "none"})`)
          }
        }
      }
    }

    // A7 — sites per declared-type edge, and a target named at no type site.
    if (declTypeTargets.size > 0) T.declaredTypeFiles++
    let siteTotal = 0
    for (const t of declTypeTargets) {
      const n = sites.get(t) ?? 0
      siteTotal += n
      if (n === 0) {
        hit(T.declaredTypeTargetNotASite, `${key(f)}: references (declared-type) -> ${t}, 0 type sites in the file`)
        mark(key(f))
      }
      if (n > T.declaredTypeMaxSitesPerEdge) {
        T.declaredTypeMaxSitesPerEdge = n
        T.declaredTypeMaxEdgeExample = `${key(f)} -> ${t} written ${n} times, 1 edge`
      }
    }
    T.declaredTypeSites += siteTotal

    for (const [n, c] of tNames) bump(T.distinctTestNames, n, c)

    // A9/A10 — is every non-callable source a NAMED TEST? If it is, one defect
    // explains the class; if it is not, there is a second, separate one and the
    // prediction is falsified, which is the point of measuring it.
    for (const rec of nonCallableSources) {
      const nm = rec.slice(rec.lastIndexOf("|") + 1)
      if (tNames.has(nm)) T.nonCallableSourceThatIsATestName++
      else hit(T.nonCallableSourceThatIsNotATestName, rec)
    }

    // A11
    if (tree) {
      const out = { ids: 0, nonDirect: 0, shadowed: { n: 0, examples: [] as string[] }, file: key(f) }
      walkPayloads(tree, (n) => fileValues.has(n), out)
      T.identifiersUnderPayloads += out.ids
      T.identifiersUnderPayloadsNotDirect += out.nonDirect
      T.payloadShadowingAFileValue.n += out.shadowed.n
      for (const x of out.shadowed.examples) {
        if (T.payloadShadowingAFileValue.examples.length < 12) T.payloadShadowingAFileValue.examples.push(x)
        mark(key(f))
      }
    }
  }
}

await run(draw)

// ────────────────────────────────────────────────── CONTROLS
// Line-level predicates are PURE functions of (line, name); their controls are
// direct calls on strings, so a control cannot be satisfied by an unrelated code
// path and a zero it certifies is a zero about the predicate, not about the run.
type Ctl = { name: string; want: number; got: number; detail: string }
const controls: Ctl[] = []
const ctlPush = (name: string, want: number, got: number, detail = ""): void => { controls.push({ name, want, got, detail }) }

const CTL = [
  'const std = @import("std");',
  'const Point = struct { x: i32 };',
  'pub const Exported = u8;',
  'fn helper() void {}',
  'fn caller() void { helper(); const alias = helper; _ = alias; }',
  'fn reader(s: anytype) void { _ = s.field; _ = s; }',
  'fn make() Point { return Point{ .x = 0 }; }',
  'fn loops(items: []const u8) void { for (items) |it| { _ = it; } }',
  'test alpha { }',
  'pub fn hdr(self: Coff) OptionalHeader.@"PE32+" { return undefined; }',
].join("\n")
const ctlFile = path.join("/tmp", `bb-pass2-ctl-${process.pid}.zig`)
writeFileSync(ctlFile, CTL)
let ctlRes: any = null
try { ctlRes = await parseFile(ctlFile, "/tmp") } catch { ctlRes = null }
const ctlRoot = (parser.parse(CTL) as unknown as { rootNode: Node }).rootNode
const ctlRels: any[] = ctlRes?.relationships ?? []
const ctlSyms: any[] = ctlRes?.symbols ?? []
const ctlReserved = new Set<string>()
collectReservedSpellings(ctlRoot, ctlReserved)
const ctlSites = new Map<string, number>()
collectTypeSites(ctlRoot, ctlSites)
const ctlTests = new Map<string, number>()
collectTestNames(ctlRoot, ctlTests)
const ctlNames = new Set(ctlSyms.map((s) => String(s.name)))
const ctlOf = (t: string) => ctlRels.filter((e) => String(e.type) === t)

// A1
ctlPush("A1 POSITIVE the control's @import is a reserved spelling in the grammar's own inventory",
  1, ctlReserved.has("@import") ? 1 : 0, `${ctlReserved.size} reserved spellings: ${[...ctlReserved].join(" ")}`)
ctlPush("A1 NEGATIVE no calls target in the control is a reserved spelling",
  0, ctlOf("calls").filter((e) => ctlReserved.has(String(e.target))).length,
  "the arm that must be able to fire")

// A2
ctlPush("A2 POSITIVE `helper()` is seen as a call", 1, someOccurrenceIsACall("  helper();", "helper") ? 1 : 0)
ctlPush("A2 NEGATIVE `const alias = helper;` is not seen as a call", 0, someOccurrenceIsACall("  const alias = helper;", "helper") ? 1 : 0)
ctlPush("A2 POSITIVE the ambiguity case resolves the TRUE way: `hash -> hash` at `std.hash.Wyhash.hash(a)`",
  1, someOccurrenceIsACall("    return @truncate(std.hash.Wyhash.hash(pp.prefix, pp.sub_path));", "hash") ? 1 : 0,
  "three occurrences, one of them a call; the any-occurrence rule is what makes this correct")
ctlPush("A2 the QUOTED callee leaf is still a call: `@\"weird function name\"()`", 1,
  someOccurrenceIsACall('    try expect(@"weird function name"() == 1234);', "weird function name") ? 1 : 0,
  "M60 strips the quoting from the published name, so the character after the occurrence is the closing quote")
ctlPush("A2 NEGATIVE a quoted name that is not called is still not a call", 0,
  someOccurrenceIsACall('    const p = @"weird function name";', "weird function name") ? 1 : 0)
ctlPush("A2 the control's own call edges all pass the callee test", 0,
  ctlOf("calls").filter((e) => {
    const l = typeof e.line_number === "number" ? e.line_number : 0
    const L = (CTL.split("\n")[l - 1] ?? "")
    return L !== "" && !someOccurrenceIsACall(L, String(e.target))
  }).length, `${ctlOf("calls").length} call edges in the control`)

// A3
ctlPush("A3 POSITIVE `s.field` is seen as a member leaf", 1, someOccurrenceIsAMemberLeaf("    _ = s.field;", "field") ? 1 : 0)
ctlPush("A3 NEGATIVE `const x = field;` is not seen as a member leaf", 0, someOccurrenceIsAMemberLeaf("    const x = field;", "field") ? 1 : 0)
ctlPush("A3 the RANGE OPERATOR does not read as a member: `many_u32[0..runtime_index]`", 1,
  someOccurrenceIsBare("const many_u32_slice_len_runtime = many_u32[0..runtime_index];", "runtime_index") ? 1 : 0,
  "the dot before the name is the second half of `..`; a member test that ignores this convicts a correct edge")
ctlPush("A3 the RANGE OPERATOR does not hide a real member: `a[0..b.c]`", 1,
  someOccurrenceIsAMemberLeaf("const y = a[0..b.c];", "c") ? 1 : 0)
ctlPush("A3 the ERROR-SET LEAF reads as bare: `error.CacheCheckFailed`", 1,
  someOccurrenceIsBare("    return error.CacheCheckFailed;", "CacheCheckFailed") ? 1 : 0,
  "an error-set member resolves by name in Zig; the analyzer's class is right and the dot is not a member")
ctlPush("A3 a real member is still a member: `self.error` is not an error leaf", 0,
  someOccurrenceIsBare("    _ = self.error;", "error") ? 1 : 0,
  "the carve-out is the WORD `error` before the dot, not any dot")
ctlPush("A3 the QUOTED MEMBER reads as a member: `.@\"struct\"`", 1,
  someOccurrenceIsAMemberLeaf("    const BackingInt = @typeInfo(T).@\"struct\".backing_integer.?;", "struct") ? 1 : 0,
  "M60 makes the quoting syntax not part of the name, so the published target is `struct`")
ctlPush("A3 the QUOTED MEMBER is not a bare read", 0,
  someOccurrenceIsBare("    const BackingInt = @typeInfo(T).@\"struct\".backing_integer.?;", "struct") ? 1 : 0)
ctlPush("A3 a quoted NON-member is not read as a member: `@\"weird function name\"()`", 0,
  someOccurrenceIsAMemberLeaf("    try expect(@\"weird function name\"() == 1234);", "weird function name") ? 1 : 0)
ctlPush("A3 POSITIVE `_ = s;` is seen as a BARE read", 1, someOccurrenceIsBare("    _ = s;", "s") ? 1 : 0)
ctlPush("A3 NEGATIVE `_ = s.field;` gives `field` no bare occurrence", 0, someOccurrenceIsBare("    _ = s.field;", "field") ? 1 : 0)
ctlPush("A3 POSITIVE the control produces at least one field-read edge", 1,
  ctlRels.filter((e) => String(e.metadata?.relationshipType) === "zig_field_access").length > 0 ? 1 : 0)
ctlPush("A3 the control's own uses edges all match their reason code", 0,
  ctlRels.filter((e) => String(e.type) === "uses").filter((e) => {
    const l = typeof e.line_number === "number" ? e.line_number : 0
    const L = (CTL.split("\n")[l - 1] ?? "")
    if (L === "") return false
    const rc = String(e.metadata?.relationshipType ?? "")
    return rc === "zig_field_access" ? !someOccurrenceIsAMemberLeaf(L, String(e.target))
      : rc === "identifier_usage" ? !someOccurrenceIsBare(L, String(e.target)) : false
  }).length)

// A4
{
  const inst = ctlOf("instantiates")
  const resolved = inst.filter((e) => ctlNames.has(String(e.target))).length
  ctlPush("A4 POSITIVE the control constructs its in-file type and the target resolves",
    1, inst.length > 0 && resolved === inst.length ? 1 : 0, `${inst.length} instantiation edges, ${resolved} resolved`)
  ctlPush("A4 NEGATIVE an unpublished name reads unresolved", 1, ctlNames.has("NeverDeclared") ? 0 : 1,
    "the membership test itself, on a name the control does not declare")
}

// A5
{
  const dup = ctlSyms.filter((s) => String(s.kind) === "struct" || String(s.kind) === "enum")
    .filter((s, _i, arr) => arr.filter((o) => String(o.name) === String(s.name)).length > 1)
  ctlPush("A5 the control's container names are unique, so the ambiguity arm reads 0", 0, dup.length)
  ctlPush("A5 POSITIVE the control publishes a container", 1, ctlSyms.some((s) => String(s.name) === "Point") ? 1 : 0)
}

// A6
{
  const ex = ctlOf("exports")
  ctlPush("A6 POSITIVE the control exports a name", 1, ex.length > 0 ? 1 : 0, ex.map((e) => String(e.target)).join(","))
  ctlPush("A6 the exported name resolves to a public symbol", 0,
    ex.filter((e) => !ctlSyms.some((s) => String(s.name) === String(e.target) && String(s.visibility) === "public")).length)
}

// A7
{
  ctlPush("A7 POSITIVE the control names Point at a type site", 1, (ctlSites.get("Point") ?? 0) >= 1 ? 1 : 0, `Point at ${ctlSites.get("Point") ?? 0} type sites`)
  const dt = ctlOf("references").filter((e) => String(e.metadata?.relationshipType) === "declared_type")
  ctlPush("A7 POSITIVE the control's declared-type edges all name a type site", 0,
    dt.filter((e) => (ctlSites.get(String(e.target)) ?? 0) === 0).length,
    `${dt.length} declared-type edges: ${dt.map((e) => String(e.target)).join(",")}`)
  ctlPush("A7 the site lookup finds nothing for a name the control does not write", 0, ctlSites.get("NeverDeclared") ?? 0)
}

// A8
{
  const imp = ctlRels.filter((e) => String(e.type) === "imports" || (String(e.type) === "references" && e.metadata?.isImport))
  ctlPush("A8 POSITIVE the control produces an import edge", 1, imp.length > 0 ? 1 : 0, `${imp.length} import edges`)
  ctlPush("A8 the spelling read off the line is @import", 1,
    imp.every((e) => importSpellingAt((CTL.split("\n")[(typeof e.line_number === "number" ? e.line_number : 1) - 1] ?? "")) === "@import") ? 1 : 0)
  ctlPush("A8 NEGATIVE a line with no import token reads as none", 0,
    importSpellingAt("const x = 1;") === "(no import token on the line)" ? 0 : 1)
  ctlPush("A8 NEGATIVE a bare `import` with no sigil is distinguished from `@import`", 1,
    importSpellingAt("const m = import(\"x\");") === "import (no @ sigil)" ? 1 : 0)
}

// A13
{
  const ctlPairs = new Map<string, number>()
  let dup = 0
  for (const e of ctlOf("contains")) {
    const pk = `${String(e.source)}|${String(e.target)}`
    const l = typeof e.line_number === "number" ? e.line_number : 0
    const prev = ctlPairs.get(pk)
    if (prev === undefined) ctlPairs.set(pk, l)
    else if (prev !== l) dup++
  }
  ctlPush("A13 POSITIVE the control publishes a contains edge for the pair test", 1, ctlOf("contains").length > 0 ? 1 : 0)
  ctlPush("A13 the control has no owner/member pair at two lines", 0, dup)
}

// A7 shape arms
ctlPush("A7 the grammar's own type table holds a keyword (`fn`), so the keyword arm is not vacuous", 1,
  keywordish.has("fn") ? 1 : 0, `${declaredTypesAll.length} declared types, of which ${["fn", "const", "var", "pub", "struct", "enum", "union", "opaque", "error", "comptime", "usingnamespace"].filter((k) => keywordish.has(k)).length} of 11 tested zig keywords are present`)
ctlPush("A7 POSITIVE the type-site walk strips quoting, so `@\"PE32+\"` is the site `PE32+`", 1,
  ctlSites.has("PE32+") ? 1 : 0, [...ctlSites.keys()].join(","))
ctlPush("A7 the digit guard's own membership test sees `16` as digit-headed", 1,
  "16".charCodeAt(0) >= 48 && "16".charCodeAt(0) <= 57 ? 1 : 0,
  "the analyzer applies exactly this test to the QUOTED spelling, which is why the class survives it")

// A8 tree side
{
  const ctlCallees = new Set<string>()
  collectCalleeIdentifiers(ctlRoot, ctlCallees)
  ctlPush("A8 the callee walk reads the control's @import", 1, ctlCallees.has("@import") ? 1 : 0, [...ctlCallees].join(" "))
  ctlPush("A8 NEGATIVE the control has no bare `import` callee", 0, ctlCallees.has("import") ? 1 : 0)
}

// A10
ctlPush("A10 POSITIVE the tree walker reads the control's named test", 1, ctlTests.has("alpha") ? 1 : 0, [...ctlTests.keys()].join(","))
ctlPush("A10 the control's test name is NOT a published symbol, so it is a dangling source by construction", 1,
  ctlNames.has("alpha") ? 0 : 1)

// A11
{
  const out = { ids: 0, nonDirect: 0, shadowed: { n: 0, examples: [] as string[] }, file: "ctl" }
  walkPayloads(ctlRoot, () => false, out)
  ctlPush("A11 POSITIVE the control's `|it|` payload yields its capture name", 1, out.ids > 0 ? 1 : 0, `${out.ids} identifiers under payloads, ${out.nonDirect} not direct children`)
  ctlPush("A11 the control's payload has NO identifier that is not a declared capture", 0, out.nonDirect,
    "which is why the corpus figure for that arm must be measured, not assumed")
}

const ctlFailed = controls.filter((c) => c.got !== c.want)

// ────────────────────────────────────────────────── report
const pct = (a: number, b: number): number => (b === 0 ? 0 : Math.round((a / b) * 10000) / 100)
const mapObj = (m: Map<string, number>): Record<string, number> => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))
const finding = (f: Finding, denom: number): Record<string, unknown> => ({ n: f.n, pctOfDenominator: pct(f.n, denom), examples: f.examples })

const report = {
  instrument: "validation/m14/fixtures/zig/pass2-adversarial.ts",
  productionEntryPoint: "parseFile (src/ast/pool-worker.ts)",
  treeEntryPoint: "web-tree-sitter Parser over wasm/tree-sitter-zig.wasm (same pinned bytes)",
  corpusRoot: CR,
  seed: SEED,
  drawHash: `sha256:${drawHash}`,
  filesParsed: T.filesParsed,
  parseFailures: T.parseFailures,
  filesWithATree: T.filesWithATree,
  symbols: T.symbols,
  relationships: T.relationships,
  filesWithAnyFinding: T.filesWithAnyFinding.size,
  A1_calls_target_is_reserved: {
    edges: T.callsEdges, targetStartsWithAt: mapObj(T.callsTargetAtPrefixed), targetIsAReservedSpelling: mapObj(T.callsTargetReserved),
    targetContainsASpace: T.callsQuotedCallee,
    targetStartsWithADigit: T.callsTargetNumeric,
    targetStartsWithADigitExamples: T.callsTargetNumericExamples,
  },
  // Each arm is a NAMED sub-object. Spreading `finding(...)` into the parent put
  // every arm's `examples` at the same key, so a merge of two shards unioned
  // examples from different arms into one list — an artefact that reads like a
  // finding about the wrong class.
  A2_calls_name_is_called_on_its_line: {
    edges: T.callsEdges,
    targetAbsentFromTheLine: finding(T.callsLineMissing, T.callsEdges),
    noOccurrenceIsACall: finding(T.callsLineNoCallOccurrence, T.callsEdges),
    weakerFirstOccurrenceIsNotACall: T.callsLineFirstOccurrenceNotACall,
  },
  A3_uses_name_matches_its_reason_code: {
    edges: T.usesEdges,
    targetAbsentFromTheLine: finding(T.usesLineMissing, T.usesEdges),
    fieldAccessWithNoMemberOccurrence: finding(T.usesFieldNoMemberOccurrence, T.usesEdges),
    bareReadWithNoBareOccurrence: finding(T.usesBareNoBareOccurrence, T.usesEdges),
    weakerFirstOccurrenceIsNotAMember: T.usesFieldFirstOccurrenceNotAMember,
  },
  A4_instantiates_target_binds: {
    edges: T.instantiatesEdges,
    unresolved: finding(T.instantiatesTargetUnresolved, T.instantiatesEdges),
    unresolvedByForm: mapObj(T.instantiatesUnresolvedByForm),
    unresolvedInsideANamedTest: T.instantiatesUnresolvedInTest,
  },
  A5_contains_owner_binds_uniquely: {
    edges: T.containsEdges, ownerUnresolved: finding(T.containsOwnerUnresolved, T.containsEdges),
    ownerAmbiguous: finding(T.containsOwnerAmbiguous, T.containsEdges),
    duplicateOwnerMemberPairsAtDifferentLines: T.containsDuplicatePairs,
    duplicatePairExamples: T.containsDuplicatePairExamples,
  },
  A6_exports_target_binds_to_a_public_symbol: {
    edges: T.exportsEdges, unresolved: finding(T.exportsTargetUnresolved, T.exportsEdges),
    notPublic: finding(T.exportsTargetNotPublic, T.exportsEdges),
    ambiguous: T.exportsTargetAmbiguous, ambiguousPct: pct(T.exportsTargetAmbiguous, T.exportsEdges),
  },
  A7_references_declared_type: {
    edges: T.declaredTypeEdges, filesWithAtLeastOneEdge: T.declaredTypeFiles,
    treeTypeSites: T.declaredTypeSites, sitesPerEdge: pct(T.declaredTypeSites, T.declaredTypeEdges),
    maxSitesOnOneEdge: T.declaredTypeMaxSitesPerEdge, maxSitesExample: T.declaredTypeMaxEdgeExample,
    targetNamedAtNoTypeSite: finding(T.declaredTypeTargetNotASite, T.declaredTypeEdges),
    targetIsAnUnquotedKeyword: finding(T.declaredTypeTargetIsAKeyword, T.declaredTypeEdges),
    targetStartsWithADigit: T.declaredTypeTargetStartsWithADigit,
    targetStartsWithADigitExamples: T.declaredTypeTargetStartsWithADigitExamples,
    leafIsAValuePosition: finding(T.declaredTypeLeafIsAValuePosition, T.declaredTypeEdges),
    distinctTargets: T.declaredTypeTargetVocab.size,
  },
  A8_imports: {
    edges: T.importEdges, spellingsReadOffTheLine: mapObj(T.importSpellings),
    modulePathNotOnTheLine: finding(T.importPathNotOnLine, T.importEdges),
    filesWithABareImportCalleeIdentifier: T.bareImportCalleeFiles,
  },
  A9_source_identity: {
    callsWithNamedSource: T.callsNamedSource, callsSourceKindHistogram: mapObj(T.callsSourceKind),
    callsSourceNotCallable: finding(T.callsSourceNotCallable, T.callsNamedSource),
    usesWithNamedSource: T.usesNamedSource, usesSourceKindHistogram: mapObj(T.usesSourceKind),
    usesSourceNotCallable: finding(T.usesSourceNotCallable, T.usesNamedSource),
    ofWhichTheSourceIsANamedTest: T.nonCallableSourceThatIsATestName,
    ofWhichItIsNot: finding(T.nonCallableSourceThatIsNotATestName, T.callsNamedSource + T.usesNamedSource),
  },
  A10_named_test_sources: {
    distinctTestNames: T.distinctTestNames.size,
    edgesSourcedAtATestName: T.edgesSourcedAtATestName,
    examples: T.testNameSourceExamples,
  },
  A11_payload_subtree_identifiers: {
    identifiersUnderPayloads: T.identifiersUnderPayloads,
    identifiersThatAreNotDirectChildren: T.identifiersUnderPayloadsNotDirect,
    thatShadowAFileScopeValue: finding(T.payloadShadowingAFileValue, T.identifiersUnderPayloads),
  },
  controls: { total: controls.length, failed: ctlFailed.length, rows: controls },
}

if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), JSON.stringify(report, null, 2) + "\n")
  console.log(`wrote ${OUT}`)
}
console.log(`zig pass-2 adversarial audit — ${T.filesParsed} files, draw sha256:${drawHash}`)
console.log(`symbols ${T.symbols}  relationships ${T.relationships}  files with >=1 finding ${T.filesWithAnyFinding.size}`)
console.log("")
console.log("A1  calls target is a name the grammar reserves")
console.log(`      ${T.callsEdges} edges; @-prefixed ${JSON.stringify(mapObj(T.callsTargetAtPrefixed))}; reserved ${JSON.stringify(mapObj(T.callsTargetReserved))}`)
console.log(`      target contains a space (a quoted name) ${T.callsQuotedCallee}; target starts with a DIGIT ${T.callsTargetNumeric}`)
for (const x of T.callsTargetNumericExamples.slice(0, 6)) console.log(`      ${x}`)
console.log("A2  calls name is CALLED on its recorded line")
console.log(`      missing ${T.callsLineMissing.n}   no occurrence is a call ${T.callsLineNoCallOccurrence.n} (${pct(T.callsLineNoCallOccurrence.n, T.callsEdges)}%)   [weaker first-occurrence variant ${T.callsLineFirstOccurrenceNotACall}]`)
for (const x of T.callsLineNoCallOccurrence.examples.slice(0, 8)) console.log(`      ${x}`)
console.log("A3  uses name matches its reason code on its line")
console.log(`      missing ${T.usesLineMissing.n}   field with no member occurrence ${T.usesFieldNoMemberOccurrence.n}   bare read with no bare occurrence ${T.usesBareNoBareOccurrence.n} (of ${T.usesEdges})   [weaker first-occurrence variant ${T.usesFieldFirstOccurrenceNotAMember}]`)
for (const x of T.usesFieldNoMemberOccurrence.examples.slice(0, 6)) console.log(`      ${x}`)
for (const x of T.usesBareNoBareOccurrence.examples.slice(0, 6)) console.log(`      ${x}`)
console.log("A4  instantiates target binds to a symbol this analyzer published")
console.log(`      ${T.instantiatesEdges} edges; unresolved ${T.instantiatesTargetUnresolved.n} (${pct(T.instantiatesTargetUnresolved.n, T.instantiatesEdges)}%) by form ${JSON.stringify(mapObj(T.instantiatesUnresolvedByForm))}; inside a named test ${T.instantiatesUnresolvedInTest}`)
for (const x of T.instantiatesTargetUnresolved.examples.slice(0, 8)) console.log(`      ${x}`)
console.log("A5  contains owner binds to exactly one container")
console.log(`      ${T.containsEdges} edges; owner unresolved ${T.containsOwnerUnresolved.n}; ambiguous ${T.containsOwnerAmbiguous.n} (${pct(T.containsOwnerAmbiguous.n, T.containsEdges)}%)`)
console.log(`      the SAME owner->member pair at two different lines (an identity collision): ${T.containsDuplicatePairs}`)
for (const x of T.containsDuplicatePairExamples.slice(0, 6)) console.log(`      ${x}`)
for (const x of T.containsOwnerAmbiguous.examples.slice(0, 4)) console.log(`      ${x}`)
console.log("A6  exports target binds to a public symbol")
console.log(`      ${T.exportsEdges} edges; unresolved ${T.exportsTargetUnresolved.n}; not public ${T.exportsTargetNotPublic.n}; ambiguous ${T.exportsTargetAmbiguous} (${pct(T.exportsTargetAmbiguous, T.exportsEdges)}%)`)
for (const x of T.exportsTargetNotPublic.examples.slice(0, 6)) console.log(`      ${x}`)
console.log("A7  references(declared-type): sites vs edges")
console.log(`      ${T.declaredTypeEdges} edges over ${T.declaredTypeFiles} files; ${T.declaredTypeSites} tree type sites = ${pct(T.declaredTypeSites, T.declaredTypeEdges)}% sites per edge`)
console.log(`      max ${T.declaredTypeMaxSitesPerEdge} sites on one edge (${T.declaredTypeMaxEdgeExample}); ${T.declaredTypeTargetVocab.size} distinct targets`)
console.log(`      target at NO type site ${T.declaredTypeTargetNotASite.n}; target is an UNQUOTED KEYWORD ${T.declaredTypeTargetIsAKeyword.n}; target starts with a DIGIT ${T.declaredTypeTargetStartsWithADigit}; leaf is a VALUE position ${T.declaredTypeLeafIsAValuePosition.n}`)
for (const x of T.declaredTypeTargetNotASite.examples.slice(0, 6)) console.log(`      ${x}`)
for (const x of T.declaredTypeTargetIsAKeyword.examples.slice(0, 6)) console.log(`      ${x}`)
for (const x of T.declaredTypeTargetStartsWithADigitExamples.slice(0, 6)) console.log(`      ${x}`)
console.log("A8  imports")
console.log(`      ${T.importEdges} edges; spellings read off the line ${JSON.stringify(mapObj(T.importSpellings))}; module path not on the line ${T.importPathNotOnLine.n}`)
console.log(`      files whose tree has a call_expression/builtin_function whose callee is the bare identifier \`import\`: ${T.bareImportCalleeFiles} — the disjunct the site pass accepts and no file exercises`)
for (const x of T.importPathNotOnLine.examples.slice(0, 4)) console.log(`      ${x}`)
console.log("A9  source identity (the axis a name-keyed resolution rate cannot see)")
console.log(`      calls  named sources ${T.callsNamedSource}: ${JSON.stringify(mapObj(T.callsSourceKind))}`)
console.log(`      calls  source not callable ${T.callsSourceNotCallable.n} (${pct(T.callsSourceNotCallable.n, T.callsNamedSource)}%)`)
for (const x of T.callsSourceNotCallable.examples.slice(0, 6)) console.log(`      ${x}`)
console.log(`      uses   named sources ${T.usesNamedSource}: ${JSON.stringify(mapObj(T.usesSourceKind))}`)
console.log(`      uses   source not callable ${T.usesSourceNotCallable.n} (${pct(T.usesSourceNotCallable.n, T.usesNamedSource)}%)`)
for (const x of T.usesSourceNotCallable.examples.slice(0, 6)) console.log(`      ${x}`)
console.log(`      of the non-callable sources, ${T.nonCallableSourceThatIsATestName} are a NAMED TEST and ${T.nonCallableSourceThatIsNotATestName.n} are not`)
for (const x of T.nonCallableSourceThatIsNotATestName.examples.slice(0, 6)) console.log(`      ${x}`)
console.log("A10 named tests used as edge sources")
console.log(`      distinct test names ${T.distinctTestNames.size}; edges sourced at a test name ${T.edgesSourcedAtATestName}`)
for (const x of T.testNameSourceExamples.slice(0, 6)) console.log(`      ${x}`)
console.log("A11 payload subtree identifiers")
console.log(`      identifiers under payloads ${T.identifiersUnderPayloads}; not direct children ${T.identifiersUnderPayloadsNotDirect}; shadowing a file-scope value ${T.payloadShadowingAFileValue.n}`)
for (const x of T.payloadShadowingAFileValue.examples.slice(0, 6)) console.log(`      ${x}`)
console.log("")
console.log(`CONTROLS ${controls.length - ctlFailed.length}/${controls.length} as expected`)
for (const c of controls) console.log(`  ${c.got === c.want ? "ok  " : "FAIL"} ${c.name}: got ${c.got}, want ${c.want}${c.detail ? ` (${c.detail})` : ""}`)

try { rmSync(ctlFile, { force: true }) } catch { /* best effort */ }
if (ctlFailed.length > 0) process.exitCode = 1