/**
 * BUCKET 3'S ORACLE — the fourth property `baseBeyondRunScope` was missing.
 *
 * THE CONTRACT (`script/m14/incoming-rule.ts`, `CAUSE_CLAIM_KEY`) requires four properties of a
 * declared cause. Three are checked by the arbiter: it can never raise `resolved` (read only where
 * the target names nothing); it is mutually exclusive with every claim in `EXTERNAL_KEYS` (both is
 * `causeRefuted`); and its stated reason must be the edge's own owner (identifier-shaped AND equal
 * to the target's owner). The FOURTH — a SECOND IMPLEMENTATION agreeing the base really is beyond
 * the run's reach — was not implemented, and the column was therefore a reported count rather than
 * a verified one. This file is that second implementation.
 *
 * WHAT IS FALSIFIABLE, AND WHAT IS NOT. The claim is about the RUN — "the run that wrote this edge
 * could not look the base up" — and one half of it is a fact about the SOURCE that no run can
 * excuse:
 *
 *   (a) THE BASE IS DECLARED IN THE EMITTING FILE. The file's own declarations were in the run's
 *       hands, so the claim is FALSE, and this is the only refutation class: any row in it is a
 *       defect, and the print names the file and the line. THIS IS THE ORACLE'S VERDICT.
 *
 * The other half is a fact about the RUN's configuration (`seesProject`), which no source scan can
 * confirm — the gate's own note says a lookup in a bigger key space cannot deny a run-scope claim,
 * because the gate HAVING the base is not evidence the analyzer did. So those rows are not
 * refuted; they are DECOMPOSED, by an independent project-wide scan, into the classes that say
 * what would close them — and naming them is the roadmap value of this instrument:
 *
 *   (b) named by an import of the emitting file   — the run could have read the file it imports
 *       (it reads files for pubspecs), so this class is closable with NO index at all;
 *   (c) declared elsewhere in the project, not imported — the index class;
 *   (d) declared NOWHERE in the project            — genuinely outside the population, where an
 *       index-assisted run states `isExternalBase` instead (pinned by
 *       `object-interface-override`'s case H/J pair).
 *
 * THE TRUTH SOURCE IS INDEPENDENT BY CONSTRUCTION. The analyzer decides reachability from a
 * tree-sitter walk and its own heritage map; this oracle scans the SOURCE TEXT with the literals
 * and comments blanked out, resolves declarations by a regex over what remains, and resolves an
 * import's path textually against the emitting file's directory. Nothing is imported from
 * `real-dart-analyzer.ts`, so an analyzer bug cannot be invisible to both sides — which is the
 * same reason the mutant batteries run the pre-fix shape instead of the analyzer's own predicate.
 *
 * WHAT IT MEASURES, STATED. The population is the gate's: tracked `.dart` files, present, under
 * `SIZE_CAP`, parsed with `parseFile(f, repo, { projectRoot })`. `{ projectRoot }` does NOT give
 * the analyzer project knowledge (`seesProject` reads `companionForPass2`, which only an index
 * supplies — arm7's 27,479 cause claims on the per-file population are the proof), so this walk
 * measures exactly the claim population production's scope produces.
 *
 * Run: npx tsx validation/m14/fixtures/dart/cause-claim-oracle.ts [repo,repo,...]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const repos = (process.argv[2] ?? "pb-reference,nvim-treesitter,dart-http,riverpod,proxicall,flutter-packages,dart-sdk").split(",")
/** the gate's admission rule, so this walk is the gate's population */
const SIZE_CAP = 1024 * 1024

// ---------------------------------------------------------------------------------------------
// THE INDEPENDENT TRUTH SOURCE — a source-text scan, with comments and string literals blanked.
// ---------------------------------------------------------------------------------------------

/**
 * The source with every comment and string literal replaced by SPACES (newlines kept, so line
 * numbers survive a later pass). Blanking rather than deleting is what makes a declaration scan
 * honest: `// class Ghost {}` and `'class Ghost {}'` must not read as declarations, and neither
 * must the text of a doc comment. Handles line comments, block comments, single-, double- and
 * triple-quoted strings, and the raw-string prefix. Interpolations inside a literal are blanked — this scan answers "which
 * names does this file DECLARE", and no declaration lives inside a string.
 */
function blankLiterals(text: string): string {
  const out = text.split("")
  const n = text.length
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " "
  }
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === "/" && d === "/") {
      const start = i
      while (i < n && text[i] !== "\n") i++
      blank(start, i)
      continue
    }
    if (c === "/" && d === "*") {
      const start = i
      i += 2
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++
      i = Math.min(n, i + 2)
      blank(start, i)
      continue
    }
    const isRaw = (c === "r" || c === "R") && (d === "'" || d === '"')
    if (c === "'" || c === '"' || isRaw) {
      const quote = isRaw ? d : c
      const start = i
      if (isRaw) i++
      const triple = text[i + 1] === quote && text[i + 2] === quote
      i += triple ? 3 : 1
      while (i < n) {
        if (text[i] === "\\" && !isRaw) { i += 2; continue }
        if (triple ? text[i] === quote && text[i + 1] === quote && text[i + 2] === quote : text[i] === quote) {
          i += triple ? 3 : 1
          break
        }
        i++
      }
      blank(start, i)
      continue
    }
    i++
  }
  return out.join("")
}

/**
 * The type names a file DECLARES, from its blanked source. `extension on X` publishes no name
 * (that is dart's one unnamed declaration form, and the analyzer synthesises a name for it
 * elsewhere — the oracle must not invent one here); `extension type Ext` names `Ext` and not
 * "type", which is why the extension form is matched separately rather than by a shared keyword
 * list.
 */
function typeDeclarationsIn(code: string): Set<string> {
  const names = new Set<string>()
  for (const m of code.matchAll(/\b(?:class|mixin|enum|typedef)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) names.add(m[1])
  for (const m of code.matchAll(/\bextension\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) names.add(m[1])
  // `(?!type\b|on\b)` is not decoration: the first version of this line read `extension on String`
  // as declaring a type named `on`, and the CONTROL caught it before any corpus file was read —
  // which is the whole reason the control cases exist rather than being implied by the design.
  for (const m of code.matchAll(/\bextension\s+(?!type\b|on\b)([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<|\b)/g)) names.add(m[1])
  return names
}

/** The import URIs a file names, read from the ORIGINAL text (blanking removes the literals). */
function importUrisIn(text: string): string[] {
  const uris: string[] = []
  for (const m of text.matchAll(/^[ \t]*(?:import|export)[ \t]+['"]([^'"\n]+)['"]/gm)) uris.push(m[1])
  return uris
}

/** A relative import's target, resolved textually against the importing file's directory.
 *  `package:` and `dart:` URIs return null — resolving them needs the project's pubspec map,
 *  which is analyzer machinery, and a second implementation of it would not be independent.
 *  Those rows land in (c)/(d) and the class is stated in the printout. */
function relativeImportTarget(fileAbs: string, uri: string, known: Set<string>): string | null {
  if (uri.startsWith("package:") || uri.startsWith("dart:") || uri.startsWith("http")) return null
  const target = path.resolve(path.dirname(fileAbs), uri.split("#")[0].split("?")[0])
  return known.has(target) ? target : null
}

// ---------------------------------------------------------------------------------------------
// THE CLASSIFIER — its own function so the CONTROL calls the rule the corpus run calls, rather
// than a re-spelling of it. (Five outcomes, and each is one line of the loop below.)
// ---------------------------------------------------------------------------------------------
type Verdict = "malformed" | "refuted" | "importNamed" | "index" | "nowhere"

function classifyClaim(
  base: string,
  owner: string | null,
  own: Set<string>,
  holders: Set<string> | undefined,
  importedTargets: string[],
): Verdict {
  if (owner !== base) return "malformed"
  if (own.has(base)) return "refuted"
  if (holders === undefined || holders.size === 0) return "nowhere"
  return importedTargets.some((t) => holders.has(t)) ? "importNamed" : "index"
}

// ---------------------------------------------------------------------------------------------
// THE CONTROL — the classifier and the truth-source scan, before any corpus file is read.
// ---------------------------------------------------------------------------------------------
const failures: string[] = []

/** THE FALSIFIER FOR CLASS (a): the scan must SAY DECLARED for a file that declares the base and
 *  NOT DECLARED otherwise — a scan that always answers "not declared" would report a spotless
 *  policy and refute nothing, which is the shape of every oracle that has ever been decoration. */
const controlDeclared = typeDeclarationsIn(blankLiterals("class UndeclaredBase {}\n"))
if (!controlDeclared.has("UndeclaredBase")) failures.push("control: the declaration scan missed a plain `class`")
const controlNotDeclared = typeDeclarationsIn(blankLiterals("class OtherBase {}\n"))
if (controlNotDeclared.has("UndeclaredBase")) failures.push("control: the declaration scan invented a name")
/** and the three shapes that must NOT read as declarations */
for (const [what, src] of [
  ["a line comment", "// class UndeclaredBase {}\n"],
  ["a doc comment", "/// class UndeclaredBase {}\n"],
  ["a block comment", "/* class UndeclaredBase {} */\n"],
  ["a single-quoted literal", "final s = 'class UndeclaredBase {}';\n"],
  ["a double-quoted literal", 'final s = "class UndeclaredBase {}";\n'],
  ["a raw literal", "final s = r'class UndeclaredBase {}';\n"],
  ["a triple-quoted literal", 'final s = """class UndeclaredBase {}""";\n'],
  ["an unnamed extension", "extension on String { }\n"],
] as const) {
  if (typeDeclarationsIn(blankLiterals(src)).size !== 0) failures.push(`control: ${what} read as a declaration`)
}
/** the two forms that must read correctly */
if (!typeDeclarationsIn(blankLiterals("extension type Ext(int x) {}\n")).has("Ext")) {
  failures.push("control: `extension type` did not read as a declaration of `Ext`")
}
if (!typeDeclarationsIn(blankLiterals("mixin MixinA on Base {}\n")).has("MixinA")) {
  failures.push("control: a `mixin` with an `on` clause did not read as a declaration")
}
if (!typeDeclarationsIn(blankLiterals("abstract class AbstractOne {}\n")).has("AbstractOne")) {
  failures.push("control: `abstract class` did not read as a declaration")
}
/** imports are read from the original text, so the blanking must not hide them */
if (importUrisIn("import 'src/a.dart';\nimport 'package:x/y.dart' as y;\n").length !== 2) {
  failures.push("control: import URIs are not being read from the source")
}
/** THE FIVE VERDICTS, asserted on synthetic inputs through THE SAME FUNCTION the corpus run calls.
 *  A control that cannot reach `refuted` would report a spotless claim population whatever the
 *  corpus held — the decoration shape this file exists to avoid. */
for (const [what, want, args] of [
  ["base declared in the file", "refuted", ["B", "B", new Set(["B"]), new Set(["a.dart"]), []]],
  ["reason is not the edge's owner", "malformed", ["B", "C", new Set(), new Set(["a.dart"]), []]],
  ["declared nowhere in the project", "nowhere", ["B", "B", new Set(), undefined, []]],
  ["declared in a file the emitting file imports", "importNamed", ["B", "B", new Set(), new Set(["a.dart"]), ["a.dart"]]],
  ["declared elsewhere and not imported", "index", ["B", "B", new Set(), new Set(["a.dart"]), ["b.dart"]]],
] as const) {
  const got = classifyClaim(...(args as [string, string | null, Set<string>, Set<string> | undefined, string[]]))
  if (got !== want) failures.push(`control: ${what} classified \`${got}\`, expected \`${want}\``)
}
/** THE PINNED FIXTURE, cross-checked: case H of `object-interface-override` claims `UndeclaredBase`
 *  is beyond the run, and the fixture's own source is where that claim is checked. If this scan
 *  finds `UndeclaredBase` declared in the fixture the oracle's verdict and the fixture disagree,
 *  and the disagreement is the finding — not something to negotiate away by editing the scan. */
try {
  const fx = new URL("./object-interface-override.dart", import.meta.url)
  const names = typeDeclarationsIn(blankLiterals(readFileSync(fx, "utf8")))
  if (names.has("UndeclaredBase")) failures.push("control: the fixture DECLARES the base its case H calls unreachable — oracle and fixture disagree")
  if (!names.has("Ghost")) failures.push("control: the scan did not find `Ghost`, which the same fixture declares — the scan is blind to real declarations")
} catch (e) {
  failures.push(`control: the fixture cross-check could not run (${String(e)})`)
}
if (failures.length > 0) {
  console.error("ORACLE SELF-TEST FAILED — the instrument is not measuring what it claims:")
  for (const f of failures) console.error(`  ${f}`)
  process.exit(3)
}
console.log("oracle self-test: PASS (control fired)")

// ---------------------------------------------------------------------------------------------
// PASS 1 — the truth source over the population: declarations per file, and per name.
// ---------------------------------------------------------------------------------------------
type Admission = { files: string[]; absent: number; overCap: number }
function admit(name: string): Admission | null {
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

let claims = 0
let malformed = 0
let refuted = 0
let importNamed = 0
let indexClosable = 0
let nowhere = 0
let parseFailed = 0
let degraded = 0
const refutedExamples: string[] = []

for (const repoName of repos) {
  const admitted = admit(repoName)
  if (admitted === null) continue
  const { files, absent, overCap } = admitted
  const repo = path.join(CR, repoName)
  const known = new Set(files)
  const declaredIn = new Map<string, Set<string>>()   // type name -> files declaring it
  const declaredBy = new Map<string, Set<string>>()   // file -> names it declares
  const importsOf = new Map<string, string[]>()       // file -> files its relative imports name
  for (const f of files) {
    let text: string
    try { text = readFileSync(f, "utf8") } catch { continue }
    const names = typeDeclarationsIn(blankLiterals(text))
    declaredBy.set(f, names)
    for (const n of names) {
      if (!declaredIn.has(n)) declaredIn.set(n, new Set())
      declaredIn.get(n)!.add(f)
    }
    const targets: string[] = []
    for (const uri of importUrisIn(text)) {
      const t = relativeImportTarget(f, uri, known)
      if (t !== null) targets.push(t)
    }
    importsOf.set(f, targets)
  }

  let repoClaims = 0
  let repoRefuted = 0
  let repoImportNamed = 0
  let repoIndex = 0
  let repoNowhere = 0
  let repoMalformed = 0
  for (const f of files) {
    let out: any
    try { out = await parseFile(f, repo, { projectRoot: repo } as any) } catch { parseFailed++; continue }
    if (out?.fallback === true || out?.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    const own = declaredBy.get(f) ?? new Set<string>()
    for (const r of (Array.isArray(out?.relationships) ? out.relationships : []) as any[]) {
      const base = r?.metadata?.baseBeyondRunScope
      if (typeof base !== "string" || base.length === 0) continue
      claims++
      repoClaims++
      const tgt = String(r?.target ?? "")
      const owner = tgt.includes(".") ? tgt.slice(0, tgt.lastIndexOf(".")) : null
      const verdict = classifyClaim(base, owner, own, declaredIn.get(base), importsOf.get(f) ?? [])
      if (verdict === "malformed") { malformed++; repoMalformed++; continue }
      if (verdict === "refuted") {
        // THE VERDICT. The emitting file declares the base, so the run had it in hand.
        refuted++
        repoRefuted++
        if (refutedExamples.length < 12) {
          refutedExamples.push(`${repoName}/${path.relative(repo, f)}:${r?.line_number ?? "?"} ${tgt} claims base \`${base}\`, declared in this file`)
        }
        continue
      }
      if (verdict === "nowhere") { nowhere++; repoNowhere++ }
      else if (verdict === "importNamed") { importNamed++; repoImportNamed++ }
      else { indexClosable++; repoIndex++ }
    }
  }
  console.log(`\n=== ${repoName} — ${files.length} files admitted${absent || overCap ? ` (+${absent} absent, +${overCap} over cap)` : ""} ===`)
  console.log(`  baseBeyondRunScope claims          ${String(repoClaims).padStart(9)}`)
  if (repoClaims === 0) continue
  console.log(`  REFUTED (base declared in the file)${String(repoRefuted).padStart(9)}   <- the oracle's verdict; must be 0`)
  console.log(`  reason not this edge's owner       ${String(repoMalformed).padStart(9)}   (the arbiter checks this too; counted here)`)
  console.log(`  (b) named by an import of the file ${String(repoImportNamed).padStart(9)}   closable with no index`)
  console.log(`  (c) declared elsewhere, not imported${String(repoIndex).padStart(8)}   the index class`)
  console.log(`  (d) declared nowhere in the project${String(repoNowhere).padStart(8)}   outside the population`)
}

console.log(`\n=== TOTAL — ${claims} claims over ${repos.length} project(s) ===`)
console.log(`  REFUTED (base declared in the emitting file)  ${String(refuted).padStart(9)}   ${refuted === 0 ? "the claim SURVIVES its oracle" : "THE CLAIM IS FALSE ON THESE ROWS"}`)
console.log(`  reason not this edge's owner                  ${String(malformed).padStart(9)}`)
console.log(`  (b) closable by reading the import it names   ${String(importNamed).padStart(9)}`)
console.log(`  (c) closable by an index of the project       ${String(indexClosable).padStart(9)}`)
console.log(`  (d) declared nowhere in the project           ${String(nowhere).padStart(9)}`)
console.log(`  parse failures ${parseFailed} · degraded files ${degraded}`)
if (refutedExamples.length > 0) {
  console.log(`\n  REFUTATION EXAMPLES (up to 12):`)
  for (const e of refutedExamples) console.log(`    ${e}`)
}
