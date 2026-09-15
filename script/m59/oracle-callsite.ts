// script/m59/oracle-callsite.ts — M59.O1
//
// THE ORACLE. Derives the expected answer from SOURCE, independently of the
// analyzer's and the tool's own code, and compares it to what they produced.
// This is the check M48's invariant demanded ("expected value derived
// independently of the tool vs the tool output") and that was skipped.
//
// Independence boundary — stated so the claim is exact:
//   * It does NOT import any analyzer, graph-engine, or store code.
//   * It calls ASTEngine.parseFile() only to READ what the analyzer emitted
//     (that is the thing under test, not the oracle).
//   * The expected value comes from the file's own text.
//   * It shares the tree-sitter *parser* with the analyzers — nothing else.
//     Consequence: tiers, not a single score.
//
// TIER A (necessary condition, all languages): for a relationship that claims
//   line L, the source line L must contain the callee's name as a token. If it
//   does not, L cannot be the call site — a definite defect. A pass is NOT
//   proof the line is the exact call node (a multi-line expression can contain
//   the name on a neighbouring line), so a pass is reported as "consistent",
//   never "correct". Tiers are never conflated.
// TIER B (exact, per language, added incrementally): exact call-node lines from
//   an independent AST query. Not yet implemented — reported as ABSENT, never
//   as a pass.
//
// MUTATION SELF-TEST: the predicate is run against a deliberately wrong line
//   (verified line + 7). If the oracle cannot fail, it is not evidence — so
//   the run prints whether the mutation was caught, and exits non-zero if not.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const OUT_DIR = path.join(ROOT, "validation/m59/results")

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", ".venv", "venv",
  "__pycache__", ".gradle", ".idea", "vendor", "third_party", "tmp", ".next", "coverage",
])

// The 21 onboarded languages (reviews/onboarding.md) → extensions to sample.
const LANGUAGES: Array<{ lang: string; ext: string[]; unsupportedExt?: string[] }> = [
  { lang: "java", ext: [".java"] },
  { lang: "kotlin", ext: [".kt", ".kts"] },
  { lang: "scala", ext: [".scala"] },
  // #850: the product's language registry maps `groovy`/`gsp`, NOT `gradle`, so
  // every `build.gradle` in the corpus is rejected by detectLanguage before a
  // grammar is chosen. Sampling them made the groovy lane produce ZERO evidence
  // (measured: with --files-per-lang=6 the walk picked 6 .gradle files first and
  // all 6 were skipped as "Unsupported file type"). The extension stays listed
  // as the INTENDED surface and the files are excluded explicitly, with the
  // reason recorded in the evidence — never silently dropped.
  { lang: "groovy", ext: [".groovy", ".gradle"], unsupportedExt: [".gradle"] },
  { lang: "typescript", ext: [".ts"] },
  { lang: "javascript", ext: [".js", ".mjs", ".cjs"] },
  { lang: "vue", ext: [".vue"] },
  { lang: "svelte", ext: [".svelte"] },
  { lang: "c", ext: [".c", ".h"] },
  { lang: "cpp", ext: [".cpp", ".cc", ".hpp", ".hh"] },
  { lang: "rust", ext: [".rs"] },
  { lang: "go", ext: [".go"] },
  { lang: "zig", ext: [".zig"] },
  { lang: "csharp", ext: [".cs"] },
  { lang: "dart", ext: [".dart"] },
  { lang: "swift", ext: [".swift"] },
  { lang: "objc", ext: [".m", ".mm"] },
  { lang: "php", ext: [".php"] },
  { lang: "ruby", ext: [".rb"] },
  { lang: "python", ext: [".py"] },
  { lang: "haskell", ext: [".hs"] },
  // xml is not one of the 21 onboarded *language lanes*, but it IS an onboarded
  // language in the registry (`xml`/`xsd`/`dtd`) and — measured — the only other
  // analyzer besides scala that emitted a line before the M59 round (27 of 27
  // relationships on the M59 coverage probe). Its lines had therefore never been
  // checked against source by anything: it was absent from this list, so the
  // milestone's own oracle could not see it. Added so that its every line is
  // source-checked like the four JVM languages.
  { lang: "xml", ext: [".xml"] },
]

const MAX_BYTES = 400_000

function argNum(name: string, dflt: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? Number(a.split("=")[1]) : dflt
}
function argList(name: string): string[] | null {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : null
}

function walkFiles(root: string, exts: Set<string>, cap: number): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0 && found.length < cap) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (found.length >= cap) break
      if (SKIP_DIRS.has(e)) continue
      const p = path.join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(p)
      } else if (st.size > 0 && st.size <= MAX_BYTES && exts.has(path.extname(e))) {
        found.push(p)
      }
    }
  }
  return found
}

/** The callee token a relationship names, normalised to its last identifier. */
function calleeToken(rel: any): string | null {
  const raw =
    rel?.target ?? rel?.to ?? rel?.targetExternal ?? rel?.target_external ?? rel?.metadata?.calleeExpression
  if (typeof raw !== "string" || raw.trim().length === 0) return null
  let s = raw.trim()
  s = s.split("(")[0] // drop call arguments
  s = s.split("<")[0] // drop generics
  const parts = s.split(".")
  let last = parts[parts.length - 1]
  // Escaped identifiers: scala's `` `alt` `` and sql's "name" are the SAME
  // name written with delimiters, so the check must look for the inner form.
  last = last.replace(/^[`"\[]+/, "").replace(/[`"\]]+$/, "")
  return last && /^[\w$#:@-]+$/.test(last) ? last : null
}

/**
 * The left boundary, with the `$` sigil handled correctly.
 *
 * The previous predicate excluded `$` from the boundary class on BOTH sides,
 * which made a `$`-introduced name unmatchable. Measured consequence: scala's
 * extremely common string interpolation `s"... got $v"` reported the use of `v`
 * as inconsistent — 19 false accusations on a 60-file scala sample, and the same
 * class would hide a REAL defect anywhere near a `$`-prefixed identifier (php
 * `$var`, js `$el`).
 *
 * The rule is now: the name must be preceded by start-of-line or a non-word
 * character, ALLOWING a `$` sigil to stand in that position. Two consequences,
 * both measured rather than assumed:
 *
 *   `s"\u$hex"`  → `hex` is the name here and matches. An earlier attempt
 *                   required a non-word char BEFORE the `$`; that still failed,
 *                   because the literal `\u` ends in a word character. The
 *                   local text cannot distinguish this from the case below, so
 *                   the oracle chooses the direction that does not accuse
 *                   correct work.
 *   `val a$b = 1` → token `b` now matches too. ACCEPTED WEAKENING, recorded as
 *                   such: it can only hide a defect if an analyzer splits one
 *                   written identifier into two, which none does (targets are
 *                   emitted as written). It never hides a wrong LINE, since the
 *                   name still has to appear on the claimed line.
 *
 * What is NOT relaxed: the name must still sit on a word boundary of its own.
 * `xv` with token `v` must never match, and the self-test proves it.
 */
function boundaryRe(token: string): RegExp {
  return new RegExp(`(^|[^\\w])\\$?${escapeRe(token)}([^\\w]|$)`)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** TIER A: does the source line at `line` contain the callee name as a token? */
function tierAConsistent(lines: string[], line: number, token: string): boolean {
  if (!Number.isFinite(line) || line < 1 || line > lines.length) return false
  const src = lines[line - 1]
  const head = token.replace(/_+$/, "")
  const variants = token === head ? [token] : [token, head]
  return variants.some((v) => boundaryRe(v).test(src))
}

/**
 * Names that Tier A is STRUCTURALLY UNABLE to check, kept separate from
 * "checked and failed".
 *
 * The analyzer synthesises some node names (`constructor`, `anonymous_Runnable`,
 * `given_N`) and marks unresolvable targets `?`; none of these is ever written
 * in source, so the line check can neither pass nor fail for them. Counting them
 * as `inconsistent` conflated "cannot check" with "checked and failed" — the
 * exact tier conflation this file's header forbids. They are reported in their
 * own column and are never evidence either way.
 *
 * Matching is by SHAPE only, so the allowlist cannot be used to sneak a real
 * undeclared name past the check.
 */
// `component1..N` are kotlin's synthesised data-class accessors: the analyzer
// creates real symbols for them, and they are never written in source, so a
// source check can neither pass nor fail for them (measured: 18 kotlin claims
// were exactly this).
const SYNTHETIC_NAME = /^(constructor|anonymous_object|anonymous_[\w$]+|given_\d+|component\d+)$/
const UNKNOWN_TARGETS = new Set(["?", "<unknown>", "<anonymous>", ""])

function isCheckable(token: string | null, target: unknown): token is string {
  if (!token) return false
  if (SYNTHETIC_NAME.test(token)) return false
  if (typeof target === "string") {
    if (UNKNOWN_TARGETS.has(target)) return false
    if (/[{}\n;]/.test(target)) return false // structural body text, not a name
  }
  return true
}

interface FileResult {
  file: string
  language: string
  rels: number
  withLine: number
  noLine: number
  consistent: number
  inconsistent: number
  notCheckable: number
  inconsistentSample: Array<{ type: string; callee: string; claimedLine: number; sourceLine: string }>
}

async function main() {
  const filesPerLang = argNum("files-per-lang", 6)
  const only = argList("only")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  mkdirSync(OUT_DIR, { recursive: true })

  const languages = only ? LANGUAGES.filter((l) => only.includes(l.lang)) : LANGUAGES
  const perLang: Record<string, FileResult[]> = {}
  const totals: Record<string, { files: number; rels: number; withLine: number; noLine: number; consistent: number; inconsistent: number; notCheckable: number }> = {}
  const skipped: Array<{ lang: string; reason: string }> = []

  for (const { lang, ext, unsupportedExt } of languages) {
    // Walk with the extra headroom the unsupported extensions would consume,
    // then drop them — so a language whose surface contains files the product
    // cannot parse still yields its full sample instead of an empty lane.
    const drop = new Set(unsupportedExt ?? [])
    const pool = drop.size > 0 ? walkFiles(CORPUS, new Set(ext), filesPerLang * 8) : null
    const files = (pool ?? walkFiles(CORPUS, new Set(ext), filesPerLang))
      .filter((f) => !drop.has(path.extname(f)))
      .slice(0, filesPerLang)
    if (pool) {
      const excluded = pool.filter((f) => drop.has(path.extname(f))).length
      if (excluded > 0) {
        skipped.push({
          lang,
          reason: `excluded ${excluded} file(s) with extension ${[...drop].join("/")}: not in the product's language registry (#850) — excluded BEFORE sampling so the lane still measures the supported surface`,
        })
      }
    }
    if (files.length === 0) {
      skipped.push({ lang, reason: `no ${ext.join("/")} files found under ${CORPUS}` })
      continue
    }
    const results: FileResult[] = []
    for (const f of files) {
      let res: any
      try {
        const content = readFileSync(f, "utf8")
        res = await ASTEngine.parseFile(f, content)
      } catch (e: any) {
        skipped.push({ lang, reason: `${path.basename(f)}: ${e?.message}` })
        continue
      }
      const lines = readFileSync(f, "utf8").split("\n")
      const rels: any[] = res?.relationships ?? []
      // SYNTHESISED MEMBERS (the analyzer's own marker, never a name shape):
      // lombok/Spring-Data accessors, kotlin data-class componentN/copy/equals/
      // hashCode/toString. Such a name has NO declaration anywhere in the file —
      // its symbol range is the ENCLOSING declaration's — so a relationship that
      // CLAIMS a line for one is a definite defect, not an uncheckable claim.
      // Before this the name-shape allowlist below made the whole class invisible:
      // the oracle reported kotlin 6,787/6,787 "carrying a line, 0 inconsistent"
      // while 32 of those lines named a class/interface that the target name is
      // written nowhere on (found instead by probe-phantom-contains.ts). A
      // synthetic name with NO line stays the honest unknown state (noLine).
      // Keyed by OWNER+NAME, and applied only to `contains` edges, because a
      // synthesised NAME is shared with real members all over a file: keying on
      // the bare name flagged every `calls toString()` site in a file that merely
      // happened to contain a data class (measured: 4 false positives on Exposed,
      // line 270 / 506 / 373 / 729 — ordinary call sites, correctly lined). The
      // defect is exactly a containment edge that names the enclosing
      // declaration's line for a member no declaration produces.
      const phantomMembers = new Set<string>()
      for (const s of res?.symbols ?? []) {
        if (s?.metadata?.isPhantom !== true) continue
        if (typeof s?.name !== "string" || typeof s?.ownerName !== "string") continue
        phantomMembers.add(`${s.ownerName}\u0000${s.name}`)
      }
      const r: FileResult = {
        file: path.relative(CORPUS, f),
        language: res?.language ?? lang,
        rels: rels.length,
        withLine: 0,
        noLine: 0,
        consistent: 0,
        inconsistent: 0,
        notCheckable: 0,
        inconsistentSample: [],
      }
      for (const rel of rels) {
        const ln = rel?.line_number
        if (typeof ln !== "number" || ln <= 0) {
          r.noLine++
          continue
        }
        r.withLine++
        const relType = String(rel?.type ?? rel?.relationshipType ?? "")
        if (
          relType === "contains" &&
          phantomMembers.has(`${String(rel?.source ?? rel?.from ?? "")}\u0000${String(rel?.target ?? rel?.to ?? "")}`)
        ) {
          // Definite: the target names a synthesised member, so no line in this
          // file can be its site. Reported with its own reason so the two
          // failure kinds are never conflated in the sample.
          r.inconsistent++
          if (r.inconsistentSample.length < 5) {
            r.inconsistentSample.push({
              type: String(rel?.type ?? "?") + "(phantom-target-claims-line)",
              callee: String(rel?.target ?? rel?.to ?? ""),
              claimedLine: ln,
              sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100),
            })
          }
          continue
        }
        const token = calleeToken(rel)
        // An xml NAMESPACE edge names a namespace, and the DEFAULT namespace has
        // no written prefix: for `xmlns="…"` the analyzer synthesises the
        // element name `default`, which appears nowhere in the source, so the
        // element-name token can never be found on any line. The ATTRIBUTE name
        // IS written (`xmlns`, `xmlns:asmv3`), so the claim is checked against
        // that rather than being skipped — measured: 7 such claims on a 40-file
        // xml sample, all on the correct line. Narrow by METADATA MARKER (the
        // analyzer sets role: "xml_namespace"), never by the name string, so no
        // real claim of a wrongly-lined `default` can hide behind it.
        const isNsEdge = rel?.metadata?.role === "xml_namespace"
        const nsAttr = isNsEdge ? rel?.metadata?.attributeName : undefined
        const checkToken = typeof nsAttr === "string" && nsAttr.length > 0 ? nsAttr : token
        if (!isCheckable(checkToken, isNsEdge ? checkToken : (rel?.target ?? rel?.to))) {
          r.notCheckable++
          continue
        }
        if (tierAConsistent(lines, ln, checkToken)) {
          r.consistent++
        } else {
          r.inconsistent++
          if (r.inconsistentSample.length < 5) {
            r.inconsistentSample.push({
              type: String(rel?.type ?? "?"),
              callee: token,
              claimedLine: ln,
              sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100),
            })
          }
        }
      }
      results.push(r)
    }
    perLang[lang] = results
    totals[lang] = results.reduce(
      (a, r) => ({
        files: a.files + 1,
        rels: a.rels + r.rels,
        withLine: a.withLine + r.withLine,
        noLine: a.noLine + r.noLine,
        consistent: a.consistent + r.consistent,
        inconsistent: a.inconsistent + r.inconsistent,
        notCheckable: a.notCheckable + r.notCheckable,
      }),
      { files: 0, rels: 0, withLine: 0, noLine: 0, consistent: 0, inconsistent: 0, notCheckable: 0 },
    )
  }

  // ── BOUNDARY SELF-TEST: the predicate must match `$`-introduced names and
  // must NOT match a name inside a longer `$`-joined identifier. Both
  // directions are asserted, so the `$` fix cannot be a silent relaxation.
  const boundarySelfTest = {
    interpolationMatches: tierAConsistent([String.raw`      case _ => fail(s"got $v")`], 1, "v"),
    interpolationAfterWordCharMatches: tierAConsistent([String.raw`      s"esc: \u$hex"`], 1, "hex"),
    plainIdentifierMatches: tierAConsistent(["  val v = 1"], 1, "v"),
    // the protection that is NOT relaxed: a name inside a longer word
    subwordStillFails: !tierAConsistent(["  val xv = 1"], 1, "v"),
    suffixOfLongerWordFails: !tierAConsistent(["  val activeProfiles = 1"], 1, "Profiles"),
    wrongLineStillFails: !tierAConsistent(["  val v = 1", "  val w = 2"], 2, "v"),
    // documented accepted weakening (see boundaryRe): recorded, not asserted away
    sigilJoinedIdentifierAccepted: tierAConsistent([String.raw`val a$b = 1`], 1, "b"),
    // xml namespace edges: the synthesised element name `default` is NEVER in
    // source (so it would be an unfixable "failure"), while the attribute name
    // the claim is checked against IS. Both directions asserted, so the
    // narrowing cannot silently pass a wrong line either.
    xmlNamespaceSyntheticNameFails: !tierAConsistent(['<project xmlns="http://maven.apache.org/POM/4.0.0"'], 1, "default"),
    xmlNamespaceAttributeMatches: tierAConsistent(['<project xmlns="http://maven.apache.org/POM/4.0.0"'], 1, "xmlns"),
    xmlNamespacePrefixedAttributeMatches: tierAConsistent(['<asmv3:windowsSettings xmlns="x" xmlns:asmv3="y">'], 1, "xmlns:asmv3"),
    xmlNamespaceWrongLineStillFails: !tierAConsistent(['<project>', '<project xmlns="u">'], 1, "xmlns"),
  }
  const boundaryOk = Object.values(boundarySelfTest).every(Boolean)

  // ── MUTATION SELF-TEST: prove the Tier A predicate can fail ────────────────
  //
  // The mutation must be CONSTRUCTED, not guessed: this used to take the first
  // relationship's line and shift it by +7, which is only a counterexample if
  // line+7 happens not to contain the name. On the kotlin sample it landed on a
  // line that did contain it, so the self-test reported `caught: false` and
  // failed a run whose verdicts were fine — a flaky gate is worse than none.
  // Now the wrong line is chosen BECAUSE the name is absent from it, and both
  // directions are checked (the true line must pass, the wrong line must fail).
  let mutation:
    | { file: string; token: string; trueLine: number; trueLineConsistent: boolean; mutatedLine: number; mutatedLineHasToken: boolean; caught: boolean }
    | null = null
  const skippedForMutation: string[] = []
  for (const [lang, results] of Object.entries(perLang)) {
    for (const r of results) {
      const abs = path.join(CORPUS, r.file)
      if (!existsSync(abs)) continue
      const text = readFileSync(abs, "utf8")
      const lines = text.split("\n")
      const res: any = await ASTEngine.parseFile(abs, text)
      const rels: any[] = res?.relationships ?? []
      for (const rel of rels) {
        if (typeof rel?.line_number !== "number" || rel.line_number <= 0) continue
        const token = calleeToken(rel)
        if (!token) continue
        const trueLine = rel.line_number
        if (trueLine > lines.length) continue
        if (!tierAConsistent(lines, trueLine, token)) continue // not a clean control
        const wrong = lines.findIndex((l, i) => i + 1 !== trueLine && !boundaryRe(token).test(l))
        if (wrong < 0) continue
        mutation = {
          file: `${lang}:${r.file}`,
          token,
          trueLine,
          trueLineConsistent: true,
          mutatedLine: wrong + 1,
          mutatedLineHasToken: boundaryRe(token).test(lines[wrong]),
          caught: !tierAConsistent(lines, wrong + 1, token),
        }
        break
      }
      if (mutation) break
      skippedForMutation.push(`${lang}:${r.file}`)
    }
    if (mutation) break
  }

  const report = {
    probe: "M59.O1",
    at: new Date().toISOString(),
    corpus: CORPUS,
    filesPerLang,
    oracleIndependence: {
      importsAnalyzerCode: false,
      importsGraphOrStoreCode: false,
      readsEmittedRelationshipsVia: "ASTEngine.parseFile (the thing under test)",
      expectedValueSource: "the file's own text",
      sharedWithAnalyzers: "the tree-sitter parser only",
      tierA: "necessary condition — a pass means 'consistent', not 'correct'",
      tierB: "exact call-node lines via independent AST query — NOT IMPLEMENTED, reported absent",
      notCheckable: "synthesised names (constructor / anonymous_* / given_N) and unresolved targets — a THIRD state, never counted as a pass and never as a failure",
      boundarySelfTest,
    },
    mutation,
    totals,
    perFile: perLang,
    skipped,
  }
  const outFile = path.join(OUT_DIR, "oracle-callsite.json")
  writeFileSync(outFile, JSON.stringify(report, null, 2))

  // ── Human-readable verdict ────────────────────────────────────────────────
  console.log("\n=== M59 ORACLE — Tier A (necessary condition) ===")
  console.log(
    "lang".padEnd(12), "files".padStart(5), "rels".padStart(7), "withLine".padStart(9),
    "noLine".padStart(7), "consistent".padStart(11), "INCONSISTENT".padStart(13), "notCheckable".padStart(13),
  )
  for (const [lang, t] of Object.entries(totals)) {
    console.log(
      lang.padEnd(12),
      String(t.files).padStart(5),
      String(t.rels).padStart(7),
      String(t.withLine).padStart(9),
      String(t.noLine).padStart(7),
      String(t.consistent).padStart(11),
      String(t.inconsistent).padStart(13),
      String(t.notCheckable).padStart(13),
    )
  }
  const T = Object.values(totals).reduce(
    (a, t) => ({
      files: a.files + t.files, rels: a.rels + t.rels, withLine: a.withLine + t.withLine,
      noLine: a.noLine + t.noLine, consistent: a.consistent + t.consistent, inconsistent: a.inconsistent + t.inconsistent,
      notCheckable: a.notCheckable + t.notCheckable,
    }),
    { files: 0, rels: 0, withLine: 0, noLine: 0, consistent: 0, inconsistent: 0, notCheckable: 0 },
  )
  console.log(
    "TOTAL".padEnd(12),
    String(T.files).padStart(5), String(T.rels).padStart(7), String(T.withLine).padStart(9),
    String(T.noLine).padStart(7), String(T.consistent).padStart(11), String(T.inconsistent).padStart(13),
    String(T.notCheckable).padStart(13),
  )
  console.log(`\nboundary self-test: ${JSON.stringify(boundarySelfTest)}`)
  console.log(`mutation self-test: ${mutation ? JSON.stringify(mutation) : "NOT RUN (no line-bearing relationship found)"}`)
  if (skipped.length > 0) console.log(`skipped: ${skipped.length} (see evidence json)`)
  console.log(`evidence: ${path.relative(ROOT, outFile)}`)

  if (!boundaryOk) {
    console.log("\nFAIL: the Tier A boundary predicate does not behave as recorded — measurements through it are not evidence.")
    process.exit(1)
  }
  if (!mutation || !mutation.caught) {
    console.log("\nFAIL: the oracle did not prove it can fail — it is not evidence yet.")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
