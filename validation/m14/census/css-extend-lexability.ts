/**
 * WHERE DOES THE `@extend` AT-KEYWORD LIVE? — the measurement `css-ruled.ts`'s `extends`
 * row rests on, isolated so a reader can check it without running the whole ontology probe.
 *
 * ## Why this file exists
 *
 * The `extends` ruling is the only row in `CSS_RULED` that BOTH instruments bear on, and it is
 * the row pass 6 found asserting a corpus that does not exist. Two of its numbers look, on
 * their face, like they contradict each other:
 *
 *     extends  B:parse-tree-count    0   0   an `@extend` DIRECTIVE (`@extend .base`)
 *     extends  B:parse-tree-count   46  26   the `@extend` at-KEYWORD itself
 *
 * The corpus writes `@extend` 46 times and the ruling reports 0 directives, so one of the two
 * is measuring something other than what its row says. This file answers which, by reporting
 * for every `@extend` at_keyword in the admitted corpus the ANCESTOR CHAIN of the node that
 * contains it. There are only three possible answers and they have different consequences:
 *
 *   1. the at_keyword sits inside an `at_rule` / `postcss_statement`   -> the DIRECTIVE count
 *      of 0 is FALSE, the `extends` ruling is falsified, and `extends` is a GAP this lane owes
 *      an implementation for;
 *   2. it sits inside a selector / declaration / value position       -> the keyword is lexed
 *      as an ordinary token, the directive is genuinely unreadable, and the ruling holds;
 *   3. it sits inside an ERROR node                                   -> the construct is not
 *      recoverable by ANY analyzer over this grammar, which is a stronger version of (2).
 *
 * Pass 6 established that the ruling SURVIVES but did not print the chain, so the reconciliation
 * was asserted rather than shown. This file shows it.
 *
 * ## Instrument
 *
 * B: parse-tree count, on the SAME pinned wasm `parseFile` loads. Node-type and named-child
 * navigation only; there is not one regular expression here, for the reason the gate's header
 * records: a pattern over raw text cannot tell the directive `@extend` from the word "extend"
 * in a comment, in a class name or in a `content:` value.
 *
 * ## Admission rule
 *
 * Transcribed argument-for-argument from `css-ontology-probe.ts`, which is where this lane
 * maintains it: git-tracked, a real directory, <= 512 KB,
 * `detectLanguageFromPath(abs, text) === "css"`. The file count this prints IS the check that
 * the transcription has not drifted — pass 6 found `css-boundary-probe.ts` reading 9 files
 * fewer than the arbiter for exactly this reason.
 *
 * **The first version of this file drifted on its first run, and the printed count is what
 * said so: 1,254 files / 78 repositories against the arbiter's 1,255 / 79.** Three defects,
 * each of which changes the SET rather than shrinking a copy of it:
 *
 *   1. it filtered `rel.endsWith(".css"|".sass"|".less")` before calling
 *      `detectLanguageFromPath`. The gate does not filter by extension — it asks the detector,
 *      which is a content-and-name judgement and admits a file whose extension is not one of
 *      those three. Pre-filtering therefore drops a file the arbiter keeps.
 *   2. it read `git ls-files` newline-split where the probe reads `-z` NUL-split, so a tracked
 *      path containing a newline splits into two bogus paths and both fail to stat.
 *   3. it took the repository list from `readdirSync(withFileTypes)` plus a literal `.git`
 *      skip, where the probe asks git for `--git-dir` — the latter excludes a directory that is
 *      not a repository, which is the rule the arbiter applies.
 *
 * That is the THIRD admission-rule transcription to drift in this lane, and the third to be
 * caught by the same check: compare the printed file count against the arbiter's before
 * believing any number. The rule below is now character-for-character the probe's.
 *
 * ## READ-ONLY
 *
 * Writes nothing. Prints a report.
 *
 * Run: npx tsx validation/m14/census/css-extend-lexability.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")

// ------------------------------------------------------------------ corpus (transcribed)
// Character-for-character `css-ontology-probe.ts`'s block. Do not "tidy" it into a
// withFileTypes walk with an extension pre-filter: that is the drift the header records.
const files: { repo: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "css") continue
    files.push({ repo: e, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
const repos = new Set(files.map((f) => f.repo))

// ---------------------------------------------------------------------------- parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(WASM)))

/** Node types that would make the `@extend` DIRECTIVE readable. Same two the ruling names. */
const DIRECTIVE_PARENTS = new Set(["at_rule", "postcss_statement"])

/** Where an `@extend` keyword sits, bucketed by the type of the node that DIRECTLY contains it. */
const parentTypes = new Map<string, { n: number; files: Set<string>; example: string }>()
/** Full ancestor chains, so a reader can see the shape rather than a label. */
const chains = new Map<string, number>()
let keywordCount = 0
let keywordFiles = 0
let directiveCount = 0
let directiveFiles = 0
let inErrorCount = 0

for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  let sawKeyword = false
  let sawDirective = false

  const walk = (n: any, ancestors: string[]): void => {
    if (n.type === "at_keyword" && n.text.trim().toLowerCase() === "@extend") {
      keywordCount++
      sawKeyword = true
      const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : "(root)"
      const row = parentTypes.get(parent) ?? { n: 0, files: new Set<string>(), example: "" }
      row.n++
      row.files.add(label)
      if (row.example === "") row.example = `line ${n.startPosition.row + 1}: ${label}`
      parentTypes.set(parent, row)
      const chain = ancestors.join(" > ")
      chains.set(chain, (chains.get(chain) ?? 0) + 1)
      if (ancestors.some((a) => a === "ERROR")) inErrorCount++
      if (DIRECTIVE_PARENTS.has(parent)) {
        directiveCount++
        sawDirective = true
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c, [...ancestors, n.type])
    }
  }
  walk(t.rootNode, [])
  if (sawKeyword) keywordFiles++
  if (sawDirective) directiveFiles++
}

// ------------------------------------------------------------------------------ report
console.log("css @extend lexability probe — where the at-keyword lives on the parse tree")
console.log(`corpus: ${files.length} admitted files across ${repos.size} repositories`)
console.log(`\n@extend AT-KEYWORD occurrences: ${keywordCount} in ${keywordFiles} files`)
console.log(`@extend DIRECTIVES (keyword directly inside ${[...DIRECTIVE_PARENTS].join(" / ")}): ${directiveCount} in ${directiveFiles} files`)
console.log(`occurrences inside an ERROR node: ${inErrorCount}`)

console.log("\nBY DIRECT PARENT NODE TYPE:")
console.log("parent node type".padEnd(26) + "occurrences".padStart(12) + "files".padStart(8) + "   example")
console.log("-".repeat(96))
for (const [parent, row] of [...parentTypes.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const verdict = DIRECTIVE_PARENTS.has(parent) ? "  <- READABLE DIRECTIVE" : "  <- not a directive"
  console.log(parent.padEnd(26) + String(row.n).padStart(12) + String(row.files.size).padStart(8) + "   " + row.example + verdict)
}

console.log("\nANCESTOR CHAINS (root-most last), most frequent first:")
for (const [chain, n] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${chain}`)
}

console.log(
  "\nREAD: " +
    (directiveCount === 0
      ? "0 directives, so `extends` STAYS RULED. The keyword is lexed as an ordinary token in a non-at-rule"
        + " position and the pinned grammar has no production that exposes it as a directive, so no analyzer"
        + " over this grammar can read it. Instrument B's 0 is a property of the GRAMMAR."
      : `${directiveCount} directives ARE readable, so the \`extends\` ruling is FALSIFIED and \`extends\` is a GAP.`),
)

/**
 * ## MEASURED, at the corpus this file prints above — the answer is (3), the strongest of the three
 *
 *     @extend AT-KEYWORD occurrences: 46 in 26 files
 *     @extend DIRECTIVES:            0  in 0 files
 *     occurrences inside an ERROR node: 46          <- ALL of them
 *     BY DIRECT PARENT NODE TYPE:     ERROR  46 in 26 files
 *     ANCESTOR CHAINS:                ERROR 32 | ERROR > ERROR 8 | stylesheet > ERROR 5
 *                                     | ERROR > import_statement > binary_expression > ERROR 1
 *
 * So the 46 are not directives written in a position this grammar cannot classify. They are the
 * RECOVERY ARTEFACT of `.sass` partials the pinned grammar has no production for: every single
 * `@extend` token lands inside an ERROR node, and 5 of them are directly under `stylesheet`.
 *
 * That is a stronger statement than pass 6 could make. Pass 6 established that the at-keyword is
 * lexable and the directive is not, and left open whether the directive exists in some other
 * readable position. It does not: there is no position. An analyzer cannot recover `@extend .base`
 * from an ERROR node, because tree-sitter's ERROR node carries the text but assigns it no meaning
 * — the shape is a byte range with no production behind it, and reading it would mean deciding by
 * hand what the bytes mean, which is the text-matching this lane's whole instrument discipline
 * exists to avoid.
 *
 * **The consequence for `overturn` is exact.** `CSS_RULED`'s `extends` row says: "Overturn: any
 * `@extend` at-rule on the tree, or any type-declaration node type in the printed vocabulary."
 * A corpus that writes `@extend` in a file this grammar can parse — a `.scss` file routed to the
 * SCSS lane, or a future grammar revision with an `at_rule` production for it — produces one. This
 * corpus does not, and its 46 are the reason a reader might have believed otherwise.
 */
if (inErrorCount === keywordCount && keywordCount > 0) {
  console.log(
    "\nMEASURED ANSWER: (3) — every `@extend` occurrence on this corpus is inside an ERROR node," +
      `\nso the directive is not recoverable by ANY analyzer over this grammar. ${keywordCount}/${keywordCount}.`,
  )
}