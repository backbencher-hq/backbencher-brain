/**
 * THE EXPOSURE WATCHDOG — every `overrides` row must name a base that EXPOSES the member.
 *
 * WHY THIS EXISTS. `e0b2456f4` closed the last fabricated-override class: Pass 3's
 * first-heritage-parent fallback named `Object.<member>` for members `Object` does not declare
 * (`class LineStarts extends Object with ListMixin<int>` → `Object.length`), 128 rows over dart-sdk
 * that the gate refuted on the one project whose checkout publishes `sdk/lib/core/object.dart`, plus
 * 18 on the projects that do not publish it. The fixture and its seven mutants pin the SHAPE on one
 * file; nothing pinned the CORPUS. A rule that is only pinned on a fixture is a rule that a later
 * change can re-open on 33,738 files with every fixture green — the lane's own record is four
 * defects shipped behind a green suite, and §"The three REFUTED rows are FIXED" is what it costs.
 *
 * WHAT IT ASSERTS, exactly. For every `overrides` row over the gate's population, the target's owner
 * is the base the edge names. This instrument decides — from EVIDENCE THE RUN HAD — whether that base
 * exposes the member, and requires every DECIDABLE row to pass:
 *
 *   (1) owner `Object` — decidable with no file evidence at all. `Object` declares exactly five
 *       members (`DART_OBJECT_INTERFACE_MEMBERS`), so `Object.toString` is fine and `Object.length`
 *       is REFUTED. This is the 128-class, and it must read 0 on every project, forever.
 *   (2) owner declared IN THE EMITTING FILE as a `class`/`mixin` with NO heritage clause — its member
 *       set is its own body plus the five every Dart class inherits, so a member absent from the
 *       blanked body is REFUTED. (A member among the five is always exposed — the implicit root.)
 *   (3) everything else — the owner is out of the file, or has heritage, or is an enum/extension
 *       type/body-less declaration, or an extension `on` it is declared in the same file: NOT
 *       decidable here. COUNTED, never judged. A `baseBeyondRunScope` claim's honesty is the
 *       cause-claim oracle's question (`cause-claim-oracle.ts`), and asking it here would be a second
 *       instrument drifting from the first.
 *
 * THE TRUTH SOURCE IS INDEPENDENT BY CONSTRUCTION: nothing is imported from
 * `real-dart-analyzer.ts`. Comments and string literals are blanked from the source text (`// class
 * Ghost {}` and `'class Ghost {}'` must not read as declarations), declarations are read from what
 * remains, and the member test is an identifier scan of the body. A body that MENTIONS the member
 * anywhere counts as exposing it — over-broad on purpose: a false NEGATIVE costs coverage that the
 * count prints, a false POSITIVE accuses a correct edge, which is the one thing this lane does not do.
 *
 * THE RESIDUAL, NAMED. (2) can be wrong in one direction: an extension declared in an IMPORTED file
 * could add the member to a base with no heritage of its own, and this walk cannot see that file. The
 * refutation is printed with the file, the line, the row and the base's head, so it is adjudicated in
 * one look rather than trusted, and the fixture cross-check below keeps the scan honest.
 *
 * THE CONTROL runs before any corpus file is read, on synthetic sources through THE SAME classifier
 * the walk calls: an absent member must REFUTE, a present one must pass, an inherited one must pass,
 * an extension `on` the base must abstain, a comment or literal must not count as a declaration, and
 * a row with no owner must abstain. A control that cannot reach `refuted` would report a spotless
 * corpus whatever the corpus held. FIVE of the controls exist because the corpus found the
 * classifier wrong without them (2026-10-12), and every one of the five was OVER-REFUTING a CORRECT
 * edge — the one direction this instrument must never fail in: (1) a PRIMARY-CONSTRUCTOR owner's
 * named-parameter brace is not its body; (2) a nested block comment may not leak code (dart nests
 * them); (3) a nested quote inside an interpolation may not close the string early; (4) a member
 * NAMED `operator` is legal Dart (dart's own front-end declares `Operator? get operator;`) and the
 * symbol-shaped operator rule read it as absent; (5) a name declared MORE THAN ONCE is read as the
 * union of its declarations, never as whichever one the scan saw last.
 *
 * POPULATION RE-MEASURED EVERY RUN: files are the gate's (tracked, present, ≤ 1 MB, `.dart`, parsed
 * with `parseFile(f, repo, { projectRoot })` — production's per-file scope), and the counts are
 * printed per project so a project that starts producing the shape shows up as NEW EXPOSURE against
 * the recorded baseline instead of silently widening. Any refuted row — or a control failure — exits
 * non-zero. MEASURED 2026-10-12, the first clean whole-corpus run (`final-full.log`, 09:36-10:33):
 * **316,120 rows over the seven projects, 19,271 decidable (6.10 %), 0 `Object.<member>` outside the
 * five, 0 naming an in-file base whose body does not carry the member, 296,849 counted-not-judged,
 * parse failures 0 · degraded files 2.** The first baseline this instrument recorded read **159**
 * refutations in dart-sdk, and 156 of them were the INSTRUMENT'S OWN false accusations — five classes,
 * each one now a control above — against 3 real ones (the constructor-symbol rows, fixed in the
 * analyzer). The population is re-measured on every run; the numbers above are a result, not a
 * setting, and the baseline carries the analyzer's sha256 so a re-run at unchanged code is comparable
 * and a re-run at changed code is visibly not.
 *
 * Run:  bun run validation/m14/fixtures/dart/override-exposure-watchdog.ts [repo,repo,...]
 *       npx tsx validation/m14/fixtures/dart/override-exposure-watchdog.ts --control-only
 *       npx tsx validation/m14/fixtures/dart/override-exposure-watchdog.ts --write-baseline
 * Spec entry: DT-EXP.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const DEFAULT_REPOS = "pb-reference,nvim-treesitter,dart-http,riverpod,proxicall,flutter-packages,dart-sdk"
const SIZE_CAP = 1024 * 1024
const OBJECT_INTERFACE = new Set(["toString", "hashCode", "runtimeType", "noSuchMethod", "operator =="])
const BASELINE_URL = new URL("./override-exposure-baseline.json", import.meta.url)

const argv = process.argv.slice(2)
const controlOnly = argv.includes("--control-only")
const writeBaseline = argv.includes("--write-baseline")
const repos = (argv.find((a) => !a.startsWith("--")) ?? DEFAULT_REPOS).split(",")

// ---------------------------------------------------------------------------------------------
// THE INDEPENDENT TRUTH SOURCE — source text with comments and literals blanked, then read.
// ---------------------------------------------------------------------------------------------

/** Every comment and string literal replaced by SPACES (newlines kept). Interpolations inside a
 *  literal go too: no declaration lives inside a string, and `'class Ghost {}'` must not read as
 *  one. Handles line/block comments, single/double/triple quotes and the raw prefix.
 *
 *  NESTING IS PART OF THE LANGUAGE, and the first version ignored it in two places, each of which
 *  LEAKS code out of a construct the analyzer never sees it in:
 *    * Dart block comments NEST, so the close of the INNER one does not end the comment. Ending
 *      there leaves the rest of the comment to be read as code, and a leaked `}` truncates the
 *      next body slice, so a member declared after it reads as absent. MEASURED on a synthetic
 *      cut before any corpus file was blamed: the leaked brace refuted a TRUE edge
 *      (`CA.foo -> BaseA.foo`).
 *    * An interpolation may contain a string with the SAME quote (`'${f('x')}'`), so the inner
 *      quote closed the outer string early and the rest of the line became code. A leaked brace
 *      from that region is the same defect one line inside.
 *  Both are now scanned as the language defines them: block comments by depth, strings by quote
 *  with `${...}` bodies walked as their own nested region (braces, comments AND strings inside). */
function blankLiterals(text: string): string {
  const out = text.split("")
  const n = text.length
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " "
  }
  const at = (j: number): string => (j >= 0 && j < n ? text[j] : "")
  const opensString = (j: number): boolean =>
    text[j] === "'" || text[j] === '"' || ((text[j] === "r" || text[j] === "R") && (at(j + 1) === "'" || at(j + 1) === '"'))
  /** Consumes one comment (nesting honoured); returns the index after its close. */
  const skipBlockComment = (start: number): number => {
    let i = start
    let depth = 0
    while (i < n) {
      const c = text[i]
      const d = at(i + 1)
      if (c === "/" && d === "*") { depth++; i += 2; continue }
      if (c === "*" && d === "/") { depth--; i += 2; if (depth === 0) return i; continue }
      i++
    }
    return i
  }
  /** Consumes one `${...}` body (nesting honoured; strings and comments inside it too). */
  const skipInterpolation = (start: number): number => {
    let i = start
    let depth = 1
    while (i < n && depth > 0) {
      const c = text[i]
      if (opensString(i)) { i = skipString(i); continue }
      const d = at(i + 1)
      if (c === "/" && d === "/") { while (i < n && text[i] !== "\n") i++; continue }
      if (c === "/" && d === "*") { i = skipBlockComment(i); continue }
      if (c === "{") depth++
      else if (c === "}") depth--
      i++
    }
    return i
  }
  /** Consumes one string literal (raw prefixes honoured, `${...}` bodies walked, not read). */
  const skipString = (start: number): number => {
    let i = start
    const isRaw = (text[i] === "r" || text[i] === "R") && (at(i + 1) === "'" || at(i + 1) === '"')
    if (isRaw) i++
    const quote = text[i]
    const triple = at(i + 1) === quote && at(i + 2) === quote
    i += triple ? 3 : 1
    while (i < n) {
      if (!isRaw && text[i] === "\\") { i += 2; continue }
      if (!isRaw && text[i] === "$" && at(i + 1) === "{") { i = skipInterpolation(i + 2); continue }
      if (!isRaw && text[i] === "$") { i += 2; continue }
      if (triple ? text[i] === quote && at(i + 1) === quote && at(i + 2) === quote : text[i] === quote) {
        i += triple ? 3 : 1
        return i
      }
      i++
    }
    return i
  }
  let i = 0
  while (i < n) {
    const c = text[i]
    const d = at(i + 1)
    if (c === "/" && d === "/") {
      const start = i
      while (i < n && text[i] !== "\n") i++
      blank(start, i)
      continue
    }
    if (c === "/" && d === "*") {
      const start = i
      i = skipBlockComment(i)
      blank(start, i)
      continue
    }
    if (opensString(i)) {
      const start = i
      i = skipString(i)
      blank(start, i)
      continue
    }
    i++
  }
  return out.join("")
}

type Decl = { kind: "class" | "mixin" | "enum" | "extensionType" | "typedef" | "extension"; head: string; body: string | null }

/** The type declarations a file makes, with each one's HEAD (the text between its name and its body,
 *  where `extends`/`implements`/`with`/`on` live) and its BODY when it has one with braces. */
function declarationsIn(code: string): Map<string, Decl[]> {
  const decls = new Map<string, Decl[]>()
  /** Every declaration of a name is kept: a name may be declared MORE THAN ONCE (dart-sdk's own
   *  `testcases/general/duplicated_declarations.dart` is a testcase FOR exactly that), and a
   *  last-declaration-wins read made the file's member set a function of declaration ORDER. */
  const push = (name: string, d: Decl) => { const l = decls.get(name); if (l) l.push(d); else decls.set(name, [d]) }
  const add = (kind: Decl["kind"], name: string, nameEnd: number) => {
    // The head is everything between the name and the body, and a body may open on a LATER line
    // (`class Foo\n    extends Bar {`), so the scan is bounded by characters, not by lines.
    //
    // THE SCAN IS PARENTHESIS-AWARE, and the corpus is why. A primary/declaring constructor puts a
    // NAMED-PARAMETER brace between the name and the body:
    //
    //   abstract class InternalStatement({required super.fileOffset})
    //       extends InternalNode {
    //     StatementInferenceResult acceptInference(InferenceVisitorImpl visitor);
    //   }
    //
    // The first `{` in that declaration opens `{required super.fileOffset}`, not the class body.
    // Reading it as the body makes the range gap through `})` misread, so BOTH facts this
    // classifier needs go wrong at once: the HERITAGE disappears (the head becomes `(`, and
    // `extends InternalNode` is never seen) and the body becomes the parameter list, so every
    // member of the class reads as absent. MEASURED 2026-10-12: 155 of the 159 rows the first
    // whole-corpus run refuted were exactly this shape (`InternalStatement`, `InternalSwitchCase`,
    // `Argument`, `RecordedUse` over dart-sdk), every one of them a TRUE edge the analyzer had
    // resolved correctly — the false-positive direction this instrument's own header forbids.
    let bodyStart = -1
    const cap = Math.min(code.length, nameEnd + 400)
    let paren = 0
    let bracket = 0
    for (let i = nameEnd; i < cap; i++) {
      const ch = code[i]
      if (ch === "(") paren++
      else if (ch === ")") paren = Math.max(0, paren - 1)
      else if (ch === "[") bracket++
      else if (ch === "]") bracket = Math.max(0, bracket - 1)
      else if (paren === 0 && bracket === 0 && (ch === "{" || ch === ";" || ch === "=")) { bodyStart = i; break }
    }
    if (bodyStart < 0) { push(name, { kind, head: "", body: null }); return }
    const head = code.slice(nameEnd, bodyStart)
    let body: string | null = null
    if (code[bodyStart] === "{") {
      let depth = 0
      for (let i = bodyStart; i < code.length; i++) {
        if (code[i] === "{") depth++
        else if (code[i] === "}") {
          depth--
          if (depth === 0) { body = code.slice(bodyStart + 1, i); break }
        }
      }
    }
    push(name, { kind, head, body })
  }
  for (const m of code.matchAll(/\b(class|mixin|enum|typedef)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    add(m[1] as Decl["kind"], m[2], (m.index ?? 0) + m[0].length)
  }
  for (const m of code.matchAll(/\bextension\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    add("extensionType", m[1], (m.index ?? 0) + m[0].length)
  }
  // `extension on X` publishes no name (dart's one unnamed declaration form) — matched separately so
  // `on` is never read as a type name, the mistake the oracle's control caught before it read a file.
  for (const m of code.matchAll(/\bextension\s+(?!type\b|on\b)([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>{;]*>\s*)?on\b/g)) {
    if (!decls.has(m[1])) push(m[1], { kind: "extension", head: "", body: null })
  }
  return decls
}

/** The owners an extension in this file adds members to — `extension E on Foo, Bar`. A member the
 *  base's own body does not carry may still be reachable through one of these, so they abstain. */
function extensionsOn(code: string): Set<string> {
  const out = new Set<string>()
  for (const m of code.matchAll(/\bextension\s+(?!type\b)(?:[A-Za-z_$][A-Za-z0-9_$]*\s*(?:<[^>{;]*>\s*)?)?on\s+([^{;]+)/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().match(/^[A-Za-z_$][A-Za-z0-9_$]*/)
      if (name) out.add(name[0])
    }
  }
  return out
}

/** Is the member declared anywhere in the body? Over-broad on purpose: an identifier scan, so a
 *  member mentioned in an expression counts as exposed. `operator []`/`[]=`/`==` are matched as the
 *  operator form the body writes, whitespace-tolerant. */
function memberPresentIn(body: string, member: string): boolean {
  if (member.startsWith("operator")) {
    const rest = member.slice("operator".length).trim()
    // A BARE `operator` IS A LEGAL MEMBER SPELLING, and the first version read it as "no operator
    // symbol follows, so absent" — which REFUTED two true edges on dart-sdk. Dart's own front-end
    // declares `Operator? get operator;` on its `Identifier` interface (an ordinary getter that
    // happens to be named `operator`, the spelling the language reserves for the dynamic-invocation
    // protocol), so `Identifier.operator` is a getter and its body carries it. The symbol form
    // (`operator []`, `operator ==`) needs the whitespace-tolerant symbol match; a spelling with no
    // symbol after the keyword FALLS THROUGH to the identifier scan below. Falling through is the
    // safe direction: the identifier scan is over-broad, and over-broad costs coverage the counts
    // print, never an accusation of a correct edge.
    if (rest.length > 0) {
      const pattern = rest.split("").map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")
      return new RegExp(`\\boperator\\s*${pattern}`).test(body)
    }
  }
  const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`).test(body)
}

// ---------------------------------------------------------------------------------------------
// THE CLASSIFIER — its own function so the CONTROL calls the rule the corpus walk calls.
// ---------------------------------------------------------------------------------------------
type Outcome =
  | "objectOk" | "objectFabricated"
  | "inFileChecked" | "inFileFabricated"
  | "undecidableHeritage" | "undecidableExtension" | "undecidableKind"
  | "beyondEvidence" | "unowned"

type Verdict = { outcome: Outcome; owner: string; member: string; why: string }

function classifyOverride(target: string, code: string): Verdict {
  const tgt = String(target ?? "")
  const dot = tgt.lastIndexOf(".")
  if (dot <= 0 || dot === tgt.length - 1) {
    return { outcome: "unowned", owner: "", member: tgt, why: "the target names no owner" }
  }
  const owner = tgt.slice(0, dot)
  const member = tgt.slice(dot + 1)
  if (owner === "Object") {
    return OBJECT_INTERFACE.has(member)
      ? { outcome: "objectOk", owner, member, why: "Object declares it — the five, named with no other evidence" }
      : { outcome: "objectFabricated", owner, member, why: "Object declares exactly five members and not this one" }
  }
  const list = declarationsIn(code).get(owner)
  if (list === undefined || list.length === 0) {
    return { outcome: "beyondEvidence", owner, member, why: "the owner is not declared in the emitting file" }
  }
  // A NAME DECLARED MORE THAN ONCE IS READ AS THE UNION, and the union is the safe direction. The
  // member is exposed when ANY declaration of that name carries it, and the row abstains when ANY of
  // them has heritage, is not a class/mixin, or has no body — the deduction the single-declaration
  // path makes from ONE body does not hold for a set. MEASURED 2026-10-12, the third over-refutation
  // this instrument produced before it was fixed: dart-sdk's `testcases/general/duplicated_-
  // declarations.dart` declares `class C` TWICE (it is a testcase FOR duplicate declarations), `m`
  // in the first and only `C._()` in the second, and a last-declaration-wins read refuted
  // `Sub.m -> C.m` — a true edge. A DUPLICATE name is exactly where a file's own text stops pinning
  // one member set, and the direction to lean is ABSTAIN or PASS, never accuse.
  const dupe = list.length > 1
  const nonContainer = list.find((d) => d.kind !== "class" && d.kind !== "mixin")
  if (nonContainer !== undefined) {
    return { outcome: "undecidableKind", owner, member, why: `the owner is a ${nonContainer.kind} — its member set is not this body's` }
  }
  if (OBJECT_INTERFACE.has(member)) {
    return { outcome: "inFileChecked", owner, member, why: "every class inherits Object's five, so the member is exposed" }
  }
  if (list.some((d) => /\b(?:extends|implements|with|on)\b/.test(d.head))) {
    return { outcome: "undecidableHeritage", owner, member, why: "the owner has heritage of its own, so the member may come from above it" }
  }
  if (extensionsOn(code).has(owner)) {
    return { outcome: "undecidableExtension", owner, member, why: "an extension in this file adds members to the owner" }
  }
  if (list.some((d) => d.body === null)) {
    return { outcome: "undecidableKind", owner, member, why: "a declaration of the owner has no body to scan" }
  }
  const note = dupe ? ` (\`${owner}\` is declared ${list.length} times here, read as the union)` : ""
  return list.some((d) => memberPresentIn(d.body || "", member))
    ? { outcome: "inFileChecked", owner, member, why: `the owner's own body carries the member${note}` }
    : { outcome: "inFileFabricated", owner, member, why: `every in-file declaration of the owner is heritage-free and carries no \`${member}\`${note}` }
}

const REFUTED = new Set<Outcome>(["objectFabricated", "inFileFabricated"])
const DECIDABLE = new Set<Outcome>(["objectOk", "objectFabricated", "inFileChecked", "inFileFabricated"])

// ---------------------------------------------------------------------------------------------
// THE CONTROL — the classifier and the truth-source scan, before any corpus file is read.
// ---------------------------------------------------------------------------------------------
const failures: string[] = []
const control = (what: string, target: string, src: string, want: Outcome) => {
  const got = classifyOverride(target, blankLiterals(src)).outcome
  if (got !== want) failures.push(`control: ${what} — wanted ${want}, got ${got}`)
}
control("the fixed defect, on the constant", "Object.length", "class X {}\n", "objectFabricated")
control("a member Object does declare", "Object.toString", "class X {}\n", "objectOk")
control("an operator among the five", "Object.operator ==", "class X {}\n", "objectOk")
control("a member name the body carries", "Foo.length", "class Foo { int length = 0; }\n", "inFileChecked")
control("a getter the body carries", "Foo.widget", "class Foo { String get widget => 'x'; }\n", "inFileChecked")
control("an operator the body carries", "Foo.operator []", "class Foo { int operator [](int i) => 0; }\n", "inFileChecked")
control("a member name the body does NOT carry", "Foo.missing", "class Foo { int length = 0; }\n", "inFileFabricated")
control("an operator the body does NOT carry", "Foo.operator []=", "class Foo { int operator [](int i) => 0; }\n", "inFileFabricated")
control("Object's five on an in-file root", "Foo.toString", "class Foo { }\n", "inFileChecked")
control("a body that only a comment mentions", "Foo.length", "class Foo { // int length\n }\n", "inFileFabricated")
control("a body that only a literal mentions", "Foo.length", "class Foo { String s = 'int length'; }\n", "inFileFabricated")
control("an owner with heritage", "Foo.length", "class Base { int length = 0; }\nclass Foo extends Base { }\n", "undecidableHeritage")
control("an owner an extension reaches", "Foo.length", "class Foo { }\nextension Ext on Foo { int get length => 0; }\n", "undecidableExtension")
control("an enum owner", "E.length", "enum E { a }\n", "undecidableKind")
control("an owner declared only in a comment", "Ghost.length", "// class Ghost { int length; }\n", "beyondEvidence")
control("a target with no owner", "length", "class Foo {}\n", "unowned")
control("a primary-constructor owner whose body carries the member", "Foo.length", "class Foo({required int seed}) {\n  int get length => 0;\n}\n", "inFileChecked")
control("a primary-constructor owner whose body does NOT carry it", "Foo.missing", "class Foo({required int seed}) {\n  int get length => 0;\n}\n", "inFileFabricated")
control("a primary-constructor owner with heritage after the parameters", "Foo.length", "class Foo({required int seed}) extends Bar {\n  int get length => 0;\n}\n", "undecidableHeritage")
control("a nested comment holding a brace", "Foo.length", "class Foo {\n  /* a /* b */ } */\n  int get length => 0;\n}\n", "inFileChecked")
control("an interpolation holding a nested quote", "Foo.length", "class Foo {\n  String s = '${f('x')}';\n  int get length => 0;\n}\n", "inFileChecked")
control("an OPERATOR GETTER — a member NAMED `operator`, dart's own front-end spelling", "Foo.operator", "class Foo { Operator? get operator => null; }\n", "inFileChecked")
control("the same when the owner is an interface-like abstract class with no heritage", "Identifier.operator", "abstract class Identifier {\n  Operator? get operator;\n}\n", "inFileChecked")
control("a name declared TWICE, the member in the FIRST declaration", "Foo.length", "class Foo { int length = 0; }\nclass Foo { }\n", "inFileChecked")
control("a name declared TWICE, the member in the SECOND declaration", "Foo.length", "class Foo { }\nclass Foo { int length = 0; }\n", "inFileChecked")
control("a name declared TWICE, the member in NEITHER", "Foo.missing", "class Foo { }\nclass Foo { }\n", "inFileFabricated")
control("a name declared TWICE, one of the declarations with heritage", "Foo.length", "class Foo { int length = 0; }\nclass Foo extends Bar { }\n", "undecidableHeritage")
/** the fixture cross-check: the scan must SEE the fixture's real declarations and must not INVENT
 *  the ones it deliberately leaves out — a scan that always answers "not declared here" would abstain
 *  on everything and report a spotless corpus, which is the shape of every watchdog that is decoration. */
try {
  const fx = blankLiterals(readFileSync(new URL("./object-interface-override.dart", import.meta.url), "utf8"))
  const names = new Set(declarationsIn(fx).keys())
  for (const must of ["LineStarts", "PlainRoot", "MentionsOnly", "MultiMix", "Direct", "Ghost", "Widgetish"]) {
    if (!names.has(must)) failures.push(`control: the scan did not find the fixture's own \`${must}\``)
  }
  for (const mustNot of ["UndeclaredBase", "ListMixin", "MixinA", "Exception"]) {
    if (names.has(mustNot)) failures.push(`control: the scan invented \`${mustNot}\`, which the fixture does not declare`)
  }
} catch (e) {
  failures.push(`control: the fixture cross-check could not run (${String(e)})`)
}
if (failures.length > 0) {
  console.error("WATCHDOG SELF-TEST FAILED — the instrument is not measuring what it claims:")
  for (const f of failures) console.error(`  ${f}`)
  process.exit(3)
}
console.log("watchdog self-test: PASS (control fired, and it can reach `refuted`)")
if (controlOnly) process.exit(0)

// ---------------------------------------------------------------------------------------------
// THE WALK — the gate's population, production's per-file scope.
// ---------------------------------------------------------------------------------------------
type Counts = Record<Outcome, number> & { rows: number }
const zero = (): Counts => ({
  rows: 0, objectOk: 0, objectFabricated: 0, inFileChecked: 0, inFileFabricated: 0,
  undecidableHeritage: 0, undecidableExtension: 0, undecidableKind: 0, beyondEvidence: 0, unowned: 0,
})

function admit(name: string): { files: string[]; absent: number; overCap: number } | null {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) return null } catch { return null }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean).filter((r) => r.endsWith(".dart"))
  } catch { return null }
  const files: string[] = []
  let absent = 0
  let overCap = 0
  for (const r of tracked) {
    const abs = path.join(dir, r)
    try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
    files.push(abs)
  }
  return { files, absent, overCap }
}

let parseFailed = 0
let degraded = 0
const total = zero()
const perProject = new Map<string, Counts>()
const refutedExamples: string[] = []

for (const repoName of repos) {
  const admitted = admit(repoName)
  if (admitted === null) continue
  const { files, absent, overCap } = admitted
  const repo = path.join(CR, repoName)
  const counts = zero()
  for (const f of files) {
    let text: string
    try { text = readFileSync(f, "utf8") } catch { continue }
    let out: any
    try { out = await parseFile(f, repo, { projectRoot: repo } as any) } catch { parseFailed++; continue }
    if (out?.fallback === true || out?.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    const rels = Array.isArray(out?.relationships) ? out.relationships : []
    const overrideRows = (rels as any[]).filter((r) => (r.type ?? r.relationshipType) === "overrides")
    if (overrideRows.length === 0) continue
    const code = blankLiterals(text)   // paid only on files that have a row to classify
    for (const r of overrideRows) {
      counts.rows++
      const v = classifyOverride(String(r?.target ?? ""), code)
      counts[v.outcome]++
      if (REFUTED.has(v.outcome) && refutedExamples.length < 15) {
        refutedExamples.push(
          `${repoName}/${path.relative(repo, f)}:${r?.line_number ?? "?"}  ${r.source} -> ${r.target}  ` +
          `[${v.outcome}] ${v.why}`,
        )
      }
    }
  }
  perProject.set(repoName, counts)
  for (const k of Object.keys(counts) as (keyof Counts)[]) total[k] += counts[k]
  const line = (label: string, n: number, note: string) => `  ${label.padEnd(46)}${String(n).padStart(9)}   ${note}`
  console.log(`\n=== ${repoName} — ${files.length} files admitted${absent || overCap ? ` (+${absent} absent, +${overCap} over cap)` : ""} ===`)
  if (counts.rows === 0) { console.log("  no `overrides` rows"); continue }
  console.log(line("overrides rows", counts.rows, ""))
  console.log(line("Object rows naming the five", counts.objectOk, "decidable with no file evidence"))
  console.log(line("Object rows naming anything else", counts.objectFabricated, counts.objectFabricated === 0 ? "the 128-class — must be 0" : "REFUTED"))
  console.log(line("in-file owner, body carries the member", counts.inFileChecked, "decidable from the file's own declarations"))
  console.log(line("in-file owner, body does NOT carry it", counts.inFileFabricated, counts.inFileFabricated === 0 ? "must be 0" : "REFUTED"))
  console.log(line("not decidable: owner has heritage", counts.undecidableHeritage, ""))
  console.log(line("not decidable: extension on the owner", counts.undecidableExtension, ""))
  console.log(line("not decidable: enum/extension type/no body", counts.undecidableKind, ""))
  console.log(line("not decidable: owner out of this file", counts.beyondEvidence, "the oracle owns these — stated causes"))
  console.log(line("no owner in the target spelling", counts.unowned, ""))
  const decidable = counts.objectOk + counts.objectFabricated + counts.inFileChecked + counts.inFileFabricated
  console.log(`  coverage: ${decidable} of ${counts.rows} rows decidable here (${((decidable / counts.rows) * 100).toFixed(2)} %)`)
}

const decidableTotal = total.objectOk + total.objectFabricated + total.inFileChecked + total.inFileFabricated
const refutedTotal = total.objectFabricated + total.inFileFabricated
console.log(`\n=== TOTAL — ${total.rows} override rows over ${perProject.size} project(s) ===`)
console.log(`  DECIDABLE rows                                 ${String(decidableTotal).padStart(9)}   ${((decidableTotal / Math.max(1, total.rows)) * 100).toFixed(2)} % of rows — evidence the run had`)
console.log(`  Object rows naming the five                    ${String(total.objectOk).padStart(9)}   the interface, named with no other evidence`)
console.log(`  in-file owner, body carries the member         ${String(total.inFileChecked).padStart(9)}   checked against the file's own text`)
console.log(`  REFUTED — Object.<member> outside the five     ${String(total.objectFabricated).padStart(9)}   must be 0`)
console.log(`  REFUTED — in-file owner without the member     ${String(total.inFileFabricated).padStart(9)}   must be 0`)
console.log(`  beyond this run's evidence (counted, not judged)${String(total.beyondEvidence).padStart(8)}   where the base is not in the file at all`)
console.log(`  not decidable: heritage/extension/kind         ${String(total.undecidableHeritage + total.undecidableExtension + total.undecidableKind).padStart(9)}   the owner's member set is not this file's to read`)
console.log(`  no owner in the target spelling                ${String(total.unowned).padStart(9)}   counted, never judged`)
console.log(`  parse failures ${parseFailed} · degraded files ${degraded}`)
if (refutedExamples.length > 0) {
  console.log(`\n  REFUTATIONS (up to 15) — a fabricated edge is a defect, not a floor to be ratcheted:`)
  for (const e of refutedExamples) console.log(`    ${e}`)
}

// ---------------------------------------------------------------------------------------------
// THE POPULATION AGAINST ITS RECORDED BASELINE — a project that starts producing the shape shows
// up here instead of silently widening, and a refutation fails the run whatever the baseline says.
// ---------------------------------------------------------------------------------------------
let baseline: any = null
try { baseline = JSON.parse(readFileSync(BASELINE_URL, "utf8")) } catch { baseline = null }
const digest = (() => {
  try {
    return createHash("sha256").update(readFileSync(new URL("../../../../src/ast/real-dart-analyzer.ts", import.meta.url))).digest("hex")
  } catch { return "unavailable" }
})()
if (baseline === null) {
  console.log(`\nno baseline recorded at ${path.basename(BASELINE_URL.pathname)} — run with --write-baseline to record this one`)
} else {
  console.log(`\nbaseline (${baseline.capturedAt}, analyzer ${String(baseline.analyzerSha256).slice(0, 16)}…, this run ${digest.slice(0, 16)}…):`)
  for (const [name, c] of perProject) {
    const b = baseline.projects?.[name]
    if (b === undefined) { console.log(`  NEW PROJECT  ${name}: ${c.rows} rows — not in the baseline`); continue }
    const grew = c.rows - b.rows
    const beyondGrew = c.beyondEvidence - b.beyondEvidence
    const flags: string[] = []
    if (c.objectFabricated + c.inFileFabricated > 0) flags.push("EXPOSURE")
    if (grew > 0) flags.push("POPULATION GREW")
    if (beyondGrew > 0) flags.push("MORE UNCHECKABLE BASES")
    if (grew < 0) flags.push("population shrank")
    console.log(
      `  ${name.padEnd(18)} rows ${String(b.rows).padStart(7)} -> ${String(c.rows).padStart(7)}` +
      `   uncheckable ${String(b.beyondEvidence).padStart(7)} -> ${String(c.beyondEvidence).padStart(7)}` +
      (flags.length ? `   ${flags.join(" · ")}` : ""),
    )
  }
}
if (writeBaseline) {
  const projects: Record<string, Counts> = {}
  for (const [name, c] of perProject) projects[name] = c
  writeFileSync(
    BASELINE_URL,
    JSON.stringify({ note: "recorded by override-exposure-watchdog.ts --write-baseline", capturedAt: new Date().toISOString(), analyzerSha256: digest, population: { repos, rows: total.rows }, projects }, null, 2) + "\n",
  )
  console.log(`\nbaseline written: ${BASELINE_URL.pathname}`)
}

if (refutedTotal > 0 || parseFailed > 0) {
  console.log(`\nWATCHDOG: FAIL — ${refutedTotal} override row(s) name a base that does not expose the member${parseFailed ? `, and ${parseFailed} file(s) could not be parsed` : ""}`)
  process.exit(1)
}
console.log(
  `\nWATCHDOG: PASS — ${total.rows} override rows, ${total.objectFabricated} naming \`Object.<member>\` outside the five ` +
  `on every project (the 128-class is 0), ${total.inFileFabricated} naming an in-file base whose body does not carry the member. ` +
  `${total.rows - decidableTotal} rows are NOT decidable here and are counted, not judged.`,
)
