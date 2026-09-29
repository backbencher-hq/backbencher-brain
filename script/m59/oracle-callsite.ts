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
import { createHash } from "node:crypto"
import { execSync } from "node:child_process"
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
  // #850 closed in M49 W21: the language registry now maps `gradle: groovy`, so
  // `.gradle` is sampled and checked like any other surface instead of being
  // excluded. The exclusion existed because every `build.gradle` was rejected by
  // detectLanguage before a grammar was chosen — with --files-per-lang=6 the walk
  // picked 6 .gradle files first and the groovy lane produced ZERO evidence.
  // Measured after registering it (script/m59/measure-gradle-surface.ts):
  // grails-core 454 files, 86 parse-failure (18.9%), 15,013 relationships, 0
  // without a line, 13,339 attributed to (script).
  { lang: "groovy", ext: [".groovy", ".gradle"] },
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

/** A short content digest — enough to pin WHICH bytes a claim was measured on. */
function sha12(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12)
}

/** The sample's identity: the file list AND the bytes of those files. Paths alone
 *  are not a pin — a corpus repo can be re-cloned at another revision under the
 *  same path, and then "the same 40 files" is a different measurement. */
function sampleHashOf(pins: Array<{ file: string; contentSha: string }>): string {
  return sha12(pins.map((p) => `${p.file}\u0000${p.contentSha}`).sort().join("\u0001"))
}

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
    // SORTED, and the traversal is a stack — so the sample is the FIRST files in
    // that order, not a random draw. readdirSync order is a filesystem property
    // (creation/internal order, not lexical) and changes when a directory's
    // contents change, so an unsorted walk makes the sample a function of the
    // corpus's on-disk history rather than of the corpus's contents. Measured
    // consequence (M59.O1 defect #4): the canonical artifact's typescript sample
    // (element-plus/*) and a re-run at the same 40-file shape (vue-core/*) shared
    // ZERO files, so a before/after comparison between them would compare
    // disjoint file sets while looking like one measurement. Sorting removes the
    // history dependence; the content pin below makes the sample comparable.
    for (const e of [...entries].sort()) {
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
  return found.sort()
}

/** The callee token a relationship names, normalised to its last identifier. */
function calleeToken(rel: any, relType?: string): string | null {
  const raw =
    rel?.target ?? rel?.to ?? rel?.targetExternal ?? rel?.target_external ?? rel?.metadata?.calleeExpression
  if (typeof raw !== "string" || raw.trim().length === 0) return null
  let s = raw.trim()
  s = s.split("(")[0] // drop call arguments
  s = s.split("<")[0] // drop generics
  // M59.O1 defect #3 (found 2026-09-16 by the typescript lane, the first lane to
  // give `imports` edges a line). A TS/JS import target is `module:item`
  // (`vitest:vi`, `@vue/shared:*`), and `:` IS in the accepted token charset
  // (php `A::m`, ruby `A::B`, cpp `ns::n`, xml `ns:attr` all need it), so the token
  // came back as the WHOLE `module:item` — a string written on no source line.
  // Consequence, measured: 22 of 24 INCONSISTENT verdicts on the 40-file
  // typescript lane were this, every one on a CORRECT line (`import { vi } from
  // 'vitest'` at 2 was accused of not containing `vitest:vi`). The rule is narrow
  // by relationship type — `imports` only, never a general `:` strip, because the
  // other languages' `::`/`:` targets are exactly what the charset is for: the
  // token is the imported NAME the source writes, and for a namespace import
  // (`module:*`) the `*` is not a name, so the written token is the module leaf.
  if (relType === "imports" && s.includes(":")) {
    const segs = s.split(":")
    const item = segs[segs.length - 1]
    s = item && item !== "*" ? item : (segs[0].split("/").pop() ?? segs[0])
  }
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
//
// `default` is the family's anonymous-default-export SENTINEL (the js/ts
// collectors record it when a module default-exports an unnamed value). It is a
// reserved word, so no declaration can be named it, and the source writes
// `module.exports = …` / `export default …` where the word `default` appears
// only in the latter form. Measured (M59.O1, web round): the one javascript
// INCONSISTENT on the pinned 40-file sample was
// vue-element-admin/plopfile.js:5 — `module.exports = function(plop) {`, a
// correct line for the edge, unverifiable by a name-token check. Adjudicated by
// hand and then classified as what it is: structurally uncheckable, not a
// failure on either side.
// The synthesis family. `anonymous` (bare) is the same class as `anonymous_*`: the
// cpp lane synthesises it for a struct/union/enum/namespace with no identifier
// (`typedef struct { … } Foo;` has no name token for the aggregate), and the c
// lane spells the same thing `anonymous_struct`/`anonymous_union`. No file writes
// `anonymous`, so no line can be its site — a checkability fact, not an excuse.
// M59 dev instrument (opt-in, OFF in every gated run): the artifact keeps only
// 5 inconsistent rows per file, which is enough to pin a class and not enough to
// COUNT one. `BB_M59_INCONSISTENT_DUMP=<path>` writes every row instead — the
// verdict, the totals and the artifact are untouched, so this cannot change a
// gate's result. Added while classifying the c/cpp residue (#825's remaining
// languages): the question "which class is the 682?" cannot be answered from a
// 3-per-file sample without guessing.
const INCONSISTENT_DUMP = process.env.BB_M59_INCONSISTENT_DUMP
const inconsistentRows: Array<{
  lang: string
  file: string
  type: string
  target: string
  token: string
  claimedLine: number
  sourceLine: string
}> = []

const SYNTHETIC_NAME = /^(constructor|anonymous|anonymous_object|anonymous_[\w$]+|given_\d+|component\d+|default)$/
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

/** The `Self` keyword, as a whole word. Rust's `Self` is a KEYWORD, not an
 *  identifier: an analyzer that resolves it (correctly) emits the ENCLOSING impl
 *  or trait type as the target, and that name is written nowhere on the line —
 *  the source writes `Self`. `-> Self` inside `impl GlobSet` names GlobSet. */
const SELF_WORD = /\bSelf\b/

/**
 * The ENCLOSING-CLASS resolution class (ruby's analog of rust's `Self`).
 *
 * `self.new`, `self.class.new` and a receiverless `new` inside a class construct
 * THAT class, so the claimed line is the correct call site while the class name
 * is never written on it. When — and only when — the analyzer says so itself
 * (`metadata.resolvedTarget === "enclosing-class"`, set at the one site that
 * resolves the target from the enclosing class) the claim is classified as
 * structurally uncheckable-by-token instead of as a failed claim.
 *
 * Narrowed by METADATA MARKER, never by the name string (the xml
 * `role: "xml_namespace"` precedent). It is not a hiding place: the claimed line
 * must itself carry the `new` call, so a claim pointing at a line that names
 * something else still reads INCONSISTENT — asserted both ways in the resolution
 * self-test, like every other exception in this file.
 */
const ENCLOSING_CLASS_NEW = /(?:^|[^\w.])(?:(?:self\.class|self)\.)?new(?:[^\w]|$)/
function isEnclosingClassResolution(rel: any, claimedSourceLine: string): boolean {
  return rel?.metadata?.resolvedTarget === "enclosing-class" && ENCLOSING_CLASS_NEW.test(claimedSourceLine)
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
  // M59.A7 (#825): the CHECKABILITY residual, sampled rather than counted — a
  // target the token check cannot see is a third state, and which targets those
  // are has to be inspectable or "not checkable" becomes a place to hide.
  notCheckableSample: Array<{ type: string; callee: string; claimedLine: number; sourceLine: string; reason: string }>
}

/** The canonical sweep's own shape — read off the committed artifact, not chosen:
 *  validation/m59/results/oracle-callsite.json records `filesPerLang: 40` over all
 *  22 languages. Any run that is not that shape must not overwrite it. */
const CANONICAL_FILES_PER_LANG = 40

async function main() {
  const filesPerLang = argNum("files-per-lang", 6)
  const only = argList("only")
  // M49 W21: a SCOPED run must never replace the canonical artifact — and the
  // drift check below must compare against the file this run will actually
  // write, so the target is decided here rather than at the write.
  const scoped = only !== null || filesPerLang !== CANONICAL_FILES_PER_LANG
  // M59.A7 (#825): a scoped run is named after WHAT IT MEASURED.
  //
  // Found live, not hypothesised: the web family's committed evidence —
  // `oracle-callsite-scoped-typescript-javascript-vue-svelte.json`, 4 lanes at 40
  // files, 0 inconsistent — lived at the single name `oracle-callsite-scoped.json`,
  // and a `--only=scala --files-per-lang=200` run silently wrote a scala-only report
  // over it. The file was restored, but the mechanism was the defect: the guard above
  // protects the CANONICAL artifact from scoped runs, and nothing protected a scoped
  // artifact from a LATER scoped run of another lane. Consequence measured in the
  // working tree: one `git status` away from committing the loss of the web family's
  // line evidence.
  //
  // The name now encodes the lane set and the sample size, so two scoped runs cannot
  // address the same file unless they measured the same languages at the same depth —
  // and the file that answers "what did the web lanes score?" keeps its own name.
  const scopeTag = (only ? [...only].sort().join("-") : "all") + `-f${filesPerLang}`
  const outFile = path.join(OUT_DIR, scoped ? `oracle-callsite-scoped-${scopeTag}.json` : "oracle-callsite.json")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  mkdirSync(OUT_DIR, { recursive: true })

  const languages = only ? LANGUAGES.filter((l) => only.includes(l.lang)) : LANGUAGES
  const perLang: Record<string, FileResult[]> = {}
  const totals: Record<string, { files: number; rels: number; withLine: number; noLine: number; consistent: number; inconsistent: number; notCheckable: number }> = {}
  const skipped: Array<{ lang: string; reason: string }> = []
  // ── SAMPLE PIN: what this claim was measured on ──────────────────────────
  // Paths alone are not a pin (a repo can be re-cloned at another revision under
  // the same path), and neither is a file count (40 of WHICH files?). The pin is
  // the file list plus each file's own content digest, per language, so a
  // comparison can REQUIRE that two runs measured the same bytes — and so a
  // re-run that does not can say so instead of silently reading as a delta.
  const sampleHash: Record<string, string> = {}
  const samplePins: Record<string, Array<{ file: string; contentSha: string }>> = {}
  const prevCanonical = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : null
  const sampleDrift: Record<string, { prev: string | null; now: string; same: boolean }> = {}

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
    // Read each sampled file ONCE: the same bytes feed the pin and the parse, so
    // the pin cannot describe a different read than the measurement did.
    const contents = new Map<string, string>()
    const pins: Array<{ file: string; contentSha: string }> = []
    for (const f of files) {
      let text: string
      try {
        text = readFileSync(f, "utf8")
      } catch (e: any) {
        skipped.push({ lang, reason: `${path.basename(f)}: ${e?.message}` })
        continue
      }
      contents.set(f, text)
      pins.push({ file: path.relative(CORPUS, f), contentSha: sha12(text) })
    }
    samplePins[lang] = pins
    sampleHash[lang] = sampleHashOf(pins)
    const prevHash =    prevCanonical?.sampleHash?.[lang] ?? null
    sampleDrift[lang] = { prev: prevHash, now: sampleHash[lang], same: prevHash === null ? false : prevHash === sampleHash[lang] }
    const results: FileResult[] = []
    for (const f of files) {
      const text = contents.get(f)
      if (text === undefined) continue
      let res: any
      try {
        res = await ASTEngine.parseFile(f, text)
      } catch (e: any) {
        skipped.push({ lang, reason: `${path.basename(f)}: ${e?.message}` })
        continue
      }
      const lines = text.split("\n")
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
        notCheckableSample: [],
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
          if (INCONSISTENT_DUMP) {
            inconsistentRows.push({
              lang,
              file: path.relative(CORPUS, f),
              type: String(rel?.type ?? "?") + "(phantom-target-claims-line)",
              target: String(rel?.target ?? rel?.to ?? ""),
              token: String(rel?.target ?? rel?.to ?? ""),
              claimedLine: ln,
              sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100),
            })
          }
          continue
        }
        const token = calleeToken(rel, relType)
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
          if (r.notCheckableSample.length < 5) {
            r.notCheckableSample.push({ type: String(rel?.type ?? "?"), callee: token ?? "", claimedLine: ln, sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100), reason: "target is not a written token (synthetic or unresolved-name shape)" })
          }
          continue
        }
        if (tierAConsistent(lines, ln, checkToken)) {
          r.consistent++
        } else if (isEnclosingClassResolution(rel, lines[ln - 1] ?? "")) {
          // The target was resolved from the ENCLOSING class (see the predicate),
          // so the claimed line carries the `new` call but not the class name.
          r.notCheckable++
          if (r.notCheckableSample.length < 5) {
            r.notCheckableSample.push({ type: String(rel?.type ?? "?"), callee: token, claimedLine: ln, sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100), reason: "target resolved from the ENCLOSING class (receiverless / self-new) — the class name is not written at the call site; the line does carry the `new` call (metadata.resolvedTarget = enclosing-class)" })
          }
        } else if (SELF_WORD.test(lines[ln - 1] ?? "")) {
          // The `Self`-resolution class, measured on the rust lane: 21 of 65,390
          // claims, every one an edge whose target was resolved from `Self`
          // (`-> Self`, `-> Result<Self, D::Error>`, `&mut Self`, `Self { .. }`)
          // so the LINE is the correct site and only the implied NAME is absent.
          // The rule is narrow on purpose — the claimed line must itself contain
          // the `Self` keyword — so a claim pointing at a line that names
          // something else still reads INCONSISTENT. Nothing is excused silently:
          // the class is SAMPLED with its reason, never just counted.
          r.notCheckable++
          if (r.notCheckableSample.length < 5) {
            r.notCheckableSample.push({ type: String(rel?.type ?? "?"), callee: token, claimedLine: ln, sourceLine: (lines[ln - 1] ?? "").trim().slice(0, 100), reason: "target resolved from the `Self` keyword — written as `Self` on the claimed line" })
          }
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
          if (INCONSISTENT_DUMP) {
            inconsistentRows.push({
              lang,
              file: path.relative(CORPUS, f),
              type: String(rel?.type ?? "?"),
              target: String(rel?.target ?? rel?.to ?? ""),
              token,
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

  // ── TOKEN SELF-TEST: the imports narrowing (M59.O1 defect #3).
  //
  // The defect was a token that no source line writes (`vitest:vi`), so it
  // accreted false failures on CORRECT lines. The fix must fire for every shape
  // a TS/JS import target takes, and must NOT touch any other relationship type
  // — `:`/`::` is a legitimate separator there (php `A::m`, ruby `A::B`, cpp
  // `ns::n`, xml `ns:attr`), and a general strip would silently shorten those
  // tokens until they match almost any line. Both directions are asserted here
  // so the narrowing cannot become either a blind spot or a false-failure
  // suppressor.

  const tokenSelfTest = {
    importModuleItemUsesItem: calleeToken({ target: "vitest:vi" }, "imports") === "vi",
    importNamespaceStarUsesModuleLeaf: calleeToken({ target: "@vue/shared:*" }, "imports") === "shared",
    importRelativePathUsesItem: calleeToken({ target: "./a/b:name" }, "imports") === "name",
    importBareModuleUnchanged: calleeToken({ target: "react" }, "imports") === "react",
    // the protection that is NOT relaxed: a non-imports type keeps its separator
    nonImportCallKeepsSeparator: calleeToken({ target: "Config::get" }, "calls") === "Config::get",
    nonImportReferenceKeepsSeparator: calleeToken({ target: "android:name" }, "references") === "android:name",
  }
  const tokenOk = Object.values(tokenSelfTest).every(Boolean)

  // ── RESOLUTION SELF-TEST: the enclosing-class exception must excuse ONLY the
  // claims it describes. Both directions are asserted, on the same predicate the
  // production path uses, so it cannot become a hiding place for a wrong line.
  const marker = { metadata: { resolvedTarget: "enclosing-class" } }
  const resolutionSelfTest = {
    selfNewIsUncheckable: isEnclosingClassResolution(marker, "    builder = self.new(**options)"),
    selfClassNewIsUncheckable: isEnclosingClassResolution(marker, "      mapped[r] = self.class.new(default_app, &b).to_app"),
    bareNewIsUncheckable: isEnclosingClassResolution(marker, "      new(Params, param_depth_limit, **options)"),
    // the protections that are NOT relaxed:
    wrongLineStillFails: !isEnclosingClassResolution(marker, "      def each"),
    unmarkedClaimIsNotExcused: !isEnclosingClassResolution({ metadata: {} }, "    builder = self.new"),
    writtenReceiverIsNotExcused: !isEnclosingClassResolution(marker, "    builder = Builder.new"),
  }
  const resolutionOk = Object.values(resolutionSelfTest).every(Boolean)

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
        const token = calleeToken(rel, String(rel?.type ?? rel?.relationshipType ?? ""))
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

  // M59 (#859 precedent): the artifact names numbers, so it names the code that
  // produced them. A non-zero `treeModifiedInputs` means a WORKING-TREE
  // measurement rather than a commit's — which is exactly how the web family's
  // scoped artifact was silently replaced (the clobber above) without anyone
  // being able to see which tree the surviving numbers belonged to.
  const atCommit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
  const treeModifiedInputs = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("?? ")).length

  const report = {
    probe: "M59.O1",
    at: new Date().toISOString(),
    atCommit,
    treeModifiedInputs,
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
      notCheckable: "synthesised names (constructor / anonymous_* / given_N), unresolved targets, and targets the source writes as a KEYWORD (rust's `Self`, resolved to the enclosing type by the analyzer) — a THIRD state, never counted as a pass and never as a failure, and sampled per file with its reason so the class is inspectable rather than a place to hide",
      boundarySelfTest,
      tokenSelfTest,
      resolutionSelfTest,
    },
    mutation,
    totals,
    // The sample this claim was measured on: file list AND bytes. Two runs may be
    // compared only when their sampleHash matches; otherwise they are two
    // measurements of different corpora states and no delta may be read off them.
    sampleHash,
    samplePins,
    sampleDrift,
    sampleDriftNote:
      "same:false with prev:null means no prior sample pin existed in the artifact this run writes (every run before M59.O1 defect #4 recorded none). same:false with prev!=null means the sample CHANGED — a before/after across those two artifacts is not a delta of one measurement.",
    perFile: perLang,
    skipped,
  }
  // M49 W21: a SCOPED run must never replace the canonical artifact.
  //
  // Measured failure, not a hypothetical: `--only=groovy --files-per-lang=40`
  // rewrote this file as a 40-file single-language report, deleting 9,693 lines
  // of the 22-language claim (java 1,920 · kotlin 6,807 · scala 1,989 · groovy
  // 1,390 relationships) with no warning. The differential harness already
  // refuses this for M14.0.F5 (`--repo`/`--sample` runs print their result and
  // write nothing, because "writing it here would replace that claim with a
  // smaller one"). The oracle is the instrument that certifies the JVM family's
  // lines, so the same rule applies: a scoped run is for inspecting a lane, and
  // its numbers belong in the terminal, not in the milestone's evidence.
  // "Scoped" means EITHER a language filter OR fewer files than the canonical
  // sweep — a full-language run at --files-per-lang=4 shrinks the claim just as
  // effectively as --only, so the file count is part of the rule rather than an
  // afterthought. Both are legitimate inspection runs; neither is evidence.
  writeFileSync(outFile, JSON.stringify(report, null, 2))
  if (scoped) {
    console.log(
      `\nSCOPED run (--only=${only?.join(",")} --files-per-lang=${filesPerLang}): written to ${path.relative(ROOT, outFile)} — the canonical oracle-callsite.json is NOT touched (a scoped run must not shrink the milestone's claim), and because the name carries the lane set and sample size, no OTHER lane's scoped evidence is touched either.`,
    )
  }

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
  const drifted = Object.entries(sampleDrift).filter(([, d]) => !d.same)
  console.log(
    `\nsample pin: ${Object.entries(sampleHash).map(([l, h]) => `${l}:${h}`).join(" ")}`,
  )
  if (drifted.length > 0) {
    console.log(
      `SAMPLE DRIFT on ${drifted.length} lane(s) vs the previous ${path.basename(outFile)}: ` +
        drifted.map(([l, d]) => `${l} ${d.prev ?? "(none)"}→${d.now}`).join(" "),
    )
    console.log(
      "  → do NOT read a delta across those two artifacts: they measured different files.",
    )
  }
  console.log(`token self-test: ${JSON.stringify(tokenSelfTest)}`)
  console.log(`resolution self-test: ${JSON.stringify(resolutionSelfTest)}`)
  console.log(`mutation self-test: ${mutation ? JSON.stringify(mutation) : "NOT RUN (no line-bearing relationship found)"}`)
  if (skipped.length > 0) console.log(`skipped: ${skipped.length} (see evidence json)`)
  console.log(`evidence: ${path.relative(ROOT, outFile)}`)
  if (INCONSISTENT_DUMP) {
    writeFileSync(INCONSISTENT_DUMP, JSON.stringify(inconsistentRows, null, 1) + "\n")
    console.log(`inconsistent rows dumped (dev instrument): ${inconsistentRows.length} -> ${INCONSISTENT_DUMP}`)
  }

  if (!boundaryOk) {
    console.log("\nFAIL: the Tier A boundary predicate does not behave as recorded — measurements through it are not evidence.")
    process.exit(1)
  }
  if (!tokenOk) {
    console.log("\nFAIL: the callee-token rule does not behave as recorded — measurements through it are not evidence.")
    process.exit(1)
  }
  if (!resolutionOk) {
    console.log("\nFAIL: the enclosing-class exception does not behave as recorded — it may be excusing claims it should convict.")
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
