/**
 * Restore the perl F5 differential — the oracle, its wiring, and the scoped pin.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * validation/lane-protection/content-invariants.json carries four `perl/*`
 * invariants naming strings that must be present in `script/m14/differential.ts`.
 * They have been failing since merge **16075a5a1** ("merge(m48-recovery): 229
 * commits"), which resolved that file by taking the OTHER parent's copy: the
 * first parent `7ab888b79` carried the whole perl oracle (`derivePerlEdges`), its
 * two allowlist entries and the `--pin-baseline` flag that lets a scoped run write
 * the floor registry. A path-limited `git log -S` does not walk a merge's diff, so
 * the loss was invisible for weeks while `--lang perl` stayed SKIPPED and #419's
 * sections E and F reported "no baseline floor row for mojo:perl".
 *
 * The content was never lost from the repository — the co-agent's line kept it, and
 * `bbb895867` (tagged `backup/pre-update-20261002-110317`) is the LAST commit that
 * carries it. So this script RECOVERS the oracle from that commit rather than
 * re-typing it: nothing here is hand-transcribed, which is the rule
 * `recover-differential-rows.ts` follows for the nine floor rows.
 *
 * ADAPTED, AND ONLY WHERE THE ANALYZER MOVED
 * ------------------------------------------
 * One rule changed between `bbb895867` and HEAD, and a restored oracle that did not
 * follow it would disagree with the analyzer at every site: perl's `&`
 * explicit-call sigil is not part of a sub's name. HEAD's analyzer strips it before
 * the builtin probe and before the emitted target (`real-perl-analyzer.ts`, the
 * `const named = target.startsWith("&") ? target.slice(1) : target` hunk, whose own
 * measurement is 93 `calls` edges in 36 files with targets like `&build_sysctl`
 * that resolve to nothing). The oracle's `isWrittenName` already mirrors the
 * analyzer's `isWrittenCalleeName` — checked identical at both commits — so this is
 * a one-rule adaptation, stated once, in `bareName`, with the count beside it.
 *
 * The analyzer ALSO publishes `uses` (code references) and `references` (type
 * queries) at HEAD. Those rules postdate `bbb895867`, are not derived here, and are
 * therefore not in the lane's compared-label set. That is a declared scope, not an
 * oversight: see the allowlist comment this script writes.
 *
 * IDEMPOTENT, OR LOUD
 * -------------------
 * Every insertion asserts that its anchor occurs EXACTLY once, and the run refuses
 * to touch a file that already carries `export function derivePerlEdges`. At the end
 * it checks the register's own strings and exits non-zero if any is still absent —
 * so this script can only report the state the register describes, never a
 * plausible-looking partial restore.
 *
 * usage: bun script/m14/restore-perl-oracle.ts [--apply]
 */
import { spawnSync } from "child_process"
import fs from "fs"
import path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const TARGET = path.join(ROOT, "script/m14/differential.ts")
const APPLY = process.argv.includes("--apply")

/** The last commit whose tree carries the perl oracle. Recovered, not re-typed. */
// This repository's history does not contain bbb895867 (the co-agent's line that
// originally carried the oracle never merged here). 37dd997a5 is the newest commit
// in THIS history whose tree still carries the complete perl oracle — derivePerlEdges,
// both allowlist entries and the scoped pin — measured by walking the file's own
// commit history for the five register strings.
const ORACLE_SOURCE = "37dd997a5"
const ORACLE_SOURCE_NOTE = "merge of origin/main into the oracle line, last tree carrying it"

const fail = (msg: string): never => {
  console.error(`restore-perl-oracle: ${msg}`)
  process.exit(1)
}

/**
 * Every match of an anchor, with a little context, so a failed assertion says WHAT the
 * second match was instead of only that there were two.
 */
const matchContexts = (text: string, needle: string): string[] => {
  const out: string[] = []
  for (let i = text.indexOf(needle); i >= 0 && out.length < 4; i = text.indexOf(needle, i + 1)) {
    out.push(`${text.slice(0, i).split("\n").length}: ${JSON.stringify(text.slice(Math.max(0, i - 40), i + needle.length + 20))}`)
  }
  return out
}

/** Exactly-one-occurrence insertion. A silent zero-match is the failure this guards. */
const insured = (text: string, anchor: string, label: string): void => {
  const hits = text.split(anchor).length - 1
  if (hits !== 1) fail(`${label}: anchor occurs ${hits} time(s), expected exactly 1 — refusing to guess\n${matchContexts(text, anchor).join("\n")}`)
}
// EVERY replacement below passes a FUNCTION, never a replacement string, and that is not
// style: the perl oracle's own text carries `$`-sequences that are perl's regex variables
// (dollar-backtick, dollar-ampersand, dollar-quote), and a string replacement reads those as
// JS substitution patterns. Measured: passing the recovered text as a replacement string
// spliced a SECOND COPY of the file's first 1,500 lines into the oracle's place — caught only
// because the next step's exactly-once assertion then saw the markdown import twice.
const insertAfter = (text: string, anchor: string, addition: string, label: string): string => {
  insured(text, anchor, label)
  console.log(`  + ${label}`)
  return text.replace(anchor, () => anchor + addition)
}
const insertBefore = (text: string, anchor: string, addition: string, label: string): string => {
  insured(text, anchor, label)
  console.log(`  + ${label}`)
  return text.replace(anchor, () => addition + anchor)
}
const replaceOnce = (text: string, anchor: string, replacement: string, label: string): string => {
  insured(text, anchor, label)
  console.log(`  ~ ${label}`)
  return text.replace(anchor, () => replacement)
}

// ---------------------------------------------------------------------------
// 1. the oracle, read out of the commit that still has it
// ---------------------------------------------------------------------------
// maxBuffer is not decoration: the recovered blob is ~1.35 MB and spawnSync's 1 MB
// default TRUNCATES it, reporting only `status: null` and an empty stderr — a silent
// short read would have spliced a truncated oracle and still passed every anchor.
const blob = spawnSync("git", ["show", `${ORACLE_SOURCE}:script/m14/differential.ts`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (blob.status !== 0) fail(`git show ${ORACLE_SOURCE}:script/m14/differential.ts failed (status ${blob.status}${blob.error ? `, ${(blob.error as Error).message}` : ""}): ${String(blob.stderr).slice(0, 200)}`)
const lines = String(blob.stdout).split("\n")
const start = lines.findIndex((l) => l.startsWith("export function derivePerlEdges("))
if (start < 0) fail(`${ORACLE_SOURCE} carries no derivePerlEdges — the provenance commit is wrong`)

// The block runs to the line before the next top-level declaration. Ending on the
// next `export function` rather than on a brace count is deliberate: the oracle's own
// comments and template literals contain `{`/`}`, so a counter would have to
// understand them, while the file's top-level shape is already unambiguous.
let end = start + 1
while (end < lines.length && !lines[end].startsWith("export function ")) end++
while (end > start && lines[end - 1].trim() === "") end--
if (lines[end - 1] !== "}") fail(`the recovered block does not end on a closing brace (ends on ${JSON.stringify(lines[end - 1])})`)
const oracleLines = lines.slice(start, end)

// ---- the one adaptation -----------------------------------------------------
const SIGIL_DEFINITION = `  /**
   * The name a callee WRITES, with perl's explicit-call sigil removed.
   *
   * \`&foo(1)\` and \`foo(1)\` invoke the same sub, so the \`&\` is sigil and not part
   * of the name — the analyzer writes \`foo\` for both, and an oracle that kept the
   * sigil would report \`&foo\` as a truth row no analyzer edge can cover. The
   * analyzer's own measurement of that rule: 93 \`calls\` edges in 36 corpus files
   * whose target was \`&build_sysctl\`, \`&timediff\` or \`&print_imp\` — names no
   * indexer stores, because the symbol is \`build_sysctl\`.
   *
   * NOT a re-derivation of the code-slot rule: whether an \`&\`-callee with no
   * argument syntax is a reference rather than a call is \`hasArgumentSyntax\`'s
   * decision, applied separately below and unchanged.
   */
  const bareName = (t: string): string => (t.startsWith("&") ? t.slice(1) : t)
`

const ADAPT: { old: string; neu: string; label: string }[] = [
  {
    label: "file-scope calls guard",
    old: `          !(target.startsWith("&") && !hasArgumentSyntax(n)) &&\n          !PERL_BUILTINS.has(target) && target !== "use" && target !== "no"\n        ) {\n          push("calls", src(), leaf(target))`,
    neu: `          !(target.startsWith("&") && !hasArgumentSyntax(n)) &&\n          !PERL_BUILTINS.has(bareName(target)) && target !== "use" && target !== "no"\n        ) {\n          push("calls", src(), leaf(bareName(target)))`,
  },
  {
    label: "in-sub calls guard",
    old: `        !(target.startsWith("&") && !hasArgumentSyntax(n)) &&\n        !PERL_BUILTINS.has(target) && target !== "use" && target !== "no" && target !== "has" && target !== "with" && target !== "extends"\n      ) {\n        push("calls", src(), leaf(target))`,
    neu: `        !(target.startsWith("&") && !hasArgumentSyntax(n)) &&\n        !PERL_BUILTINS.has(bareName(target)) && target !== "use" && target !== "no" && target !== "has" && target !== "with" && target !== "extends"\n      ) {\n        push("calls", src(), leaf(bareName(target)))`,
  },
]

let adaptedBody = oracleLines.join("\n")
const NAMES_A_CLASS_ANCHOR = "\n  const namesAClass = (n: any): boolean => {"
adaptedBody = insertBefore(adaptedBody, NAMES_A_CLASS_ANCHOR, SIGIL_DEFINITION, "bareName helper placement")
for (const a of ADAPT) {
  const hits = adaptedBody.split(a.old).length - 1
  if (hits !== 1) fail(`${a.label}: anchor occurs ${hits} time(s), expected exactly 1 — the oracle text moved`)
  adaptedBody = adaptedBody.replace(a.old, a.neu)
}

const ORACLE_HEADER = `/**
 * M14.6 perl — the lane's tree-truth oracle. RESTORED 2026-10-12 from
 * ${ORACLE_SOURCE} (${ORACLE_SOURCE_NOTE}), the last commit whose tree carries it.
 *
 * Merge 16075a5a1 resolved this file by taking the other parent's copy, and took this
 * function, the lane's two allowlist entries and the \`--pin-baseline\` flag with it.
 * Nothing said so: a lane with no oracle derives ZERO truth edges, and a
 * registration-less lane is skipped before the dead-oracle guard can fire — so the
 * sweep stayed green while #419's sections E/F reported "no baseline floor row" for a
 * lane whose honest figure is 100% coverage, 0 missing, 0 unexplained.
 *
 * The rules below are the oracle's own, written from the pinned tree-sitter-perl
 * grammar's shapes and mirroring the analyzer's RULES rather than its code. The one
 * adaptation made on restore is \`bareName\`; see its comment.
 */
`

// ---------------------------------------------------------------------------
// 2. the wiring
// ---------------------------------------------------------------------------
const IMPORT_ANCHOR = `import { deriveMarkdownEdges } from "./markdown-oracle"\n`
const IMPORT_ADDED = `
// M14.6 perl: the builtin set and the grammar-reading rules are IMPORTED from the
// analyzer — \`PERL_BUILTINS\` is the suppression set both sides must share, and
// \`perlArgumentNodes\`/\`perlWordValues\`/\`hasArgumentSyntax\` are the two hand-written
// copies that had already disagreed (the non-parenthesised \`use Module 'Name'\` form
// cost 47 unexplained rows on mojo). That is the family-contract case: shared
// vocabulary is corroboration, a shared DERIVATION is not — the oracle's own call and
// containment rules are in derivePerlEdges below.
import { PERL_BUILTINS, hasArgumentSyntax, perlArgumentNodes, perlWordValues } from "../../src/ast/real-perl-analyzer"
`

const PIN_ANCHOR = `const REPO = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : undefined\n`
const PIN_ADDED = `/**
 * \`--pin-baseline\`: let a SCOPED run write the floor REGISTRY. It never writes the
 * canonical evidence artifact — that guard stands above and is separate — so the
 * milestone-sized claim stays exactly as its own sweep left it.
 *
 * RESTORED with the oracle, and it is not a convenience flag: the scoped guard
 * RETURNS before the canonical pin, so a scoped run can never reach that statement.
 * Without this, \`--lang perl --pin-baseline\` exited 0 having pinned NOTHING, the perl
 * rows were absent from differential-baseline.json, and #419 sections E and F had
 * nothing to read — with no error anywhere, because a scoped pin that does nothing
 * still prints a plausible line.
 */
const PIN_BASELINE_FROM_SCOPE = process.argv.includes("--pin-baseline")
`

const DISPATCH_ANCHOR = `        for (const e of deriveErlangEdges(root)) {\n          ;(truth as any[]).push(e)\n        }\n      }\n`
const DISPATCH_ADDED = `      if (lang === "perl") {
        // M14.6 perl: dedicated perl calls/instantiates/extends/implements/contains/
        // overrides oracle (derivePerlEdges). The generic tree walker audits NO perl
        // surface: this grammar's declarations are \`package_statement\`,
        // \`class_statement\` and \`role_statement\`, and none of them matches the
        // harness's class/interface/trait regexes.
        //
        // RESTORED 2026-10-12 (see the oracle's header). Without it the differential's
        // own dead-oracle guard says so plainly — "parsed N file(s) and derived ZERO
        // truth edges — the parser or the oracle is dead, not clean (a 0/0 row is a
        // fabricated pass)" — which is why this loss could not hide once the lane was
        // registered again.
        for (const e of derivePerlEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
`

const CALLS_ANCHOR = `lang === "clean" || lang === "fsharp" || lang === "bash" ? ["calls"] : []),`
const CALLS_ADDED = `
          // M14.6 perl, restored with its oracle. The allowlist filters the ANALYZER
          // side, so a lane whose oracle derives a label the list omits has every truth
          // row counted MISSING while \`unexplained\` reads 0 — the symptom of a broken
          // analyzer that is really a comparison never switched on. Measured when this
          // was missing: mojo 1,839 of 11,202 covered (16.4%), MISSING 9,363,
          // analyzer-edges 1,800, unexplained 0, on a lane whose honest figure is
          // 100%/0/0. derivePerlEdges derives calls, contains, extends, implements,
          // instantiates and overrides; the last four are already universal, so calls
          // and contains are the two entries this lane needs.
          ...(lang === "perl" ? ["calls"] : []),`

const CONTAINS_ANCHOR = `          ...(lang === "rust" ? ["contains"] : []),\n`
const CONTAINS_ADDED = `          // M14.6 perl, with the calls entry above. Membership is 22,266 of the lane's
          // edges, and the oracle derives it from the DECLARATION side — so an analyzer
          // that dropped a member is a MISSING row rather than invisible on both sides,
          // the asymmetry that found the bare-\`extends\` defect and the phantom \`DSN\`.
          //
          // NOT derived here, and therefore NOT admitted: HEAD's analyzer also publishes
          // \`uses\` (\\&name code references) and \`references\` (->isa/->DOES/->can
          // literal queries). Both rules POSTDATE the commit this oracle was recovered
          // from, so admitting the labels without truth would report every one of those
          // edges as a fabrication (the G7 shape). They are an open gap in this lane's
          // differential, declared rather than papered over.
          ...(lang === "perl" ? ["contains"] : []),
`

const SCOPED_GUARD_ANCHOR = `    if (process.argv.includes("--update-baseline")) {\n      mergeBaseline()\n    } else if (evaluation.unpinnedLanes.length`
const SCOPED_GUARD_ADDED = `    // The scoped guard RETURNS here, which is why \`--pin-baseline\` has to be honoured
    // HERE and not only at the canonical pin below: a scoped run never reaches that
    // statement. See PIN_BASELINE_FROM_SCOPE's own note.
    if (PIN_BASELINE_FROM_SCOPE) {
      mergeBaseline()
    } else if (process.argv.includes("--update-baseline")) {
      mergeBaseline()
    } else if (evaluation.unpinnedLanes.length`

const ORACLE_ANCHOR = `export function deriveJavaEdges(root: any): { label: string; from: string; target: string }[] {\n`

// ---------------------------------------------------------------------------
// 3. apply, verifying every anchor exactly once
// ---------------------------------------------------------------------------
const current = fs.readFileSync(TARGET, "utf8")
// PARTIAL restore, per wiring step. The oracle body and its allowlist entries can
// survive while the scoped pin is lost (that is exactly the state this tree is in:
// derivePerlEdges is present, PIN_BASELINE_FROM_SCOPE is not), so each step is applied
// only when its own marker is absent. Every anchor still has to match exactly once —
// a moved anchor fails loudly rather than writing a partial wiring.
let next = current
const done: string[] = []
const has = (s: string) => next.includes(s)

if (!has("export function derivePerlEdges")) {
  next = insertBefore(next, ORACLE_ANCHOR, ORACLE_HEADER + adaptedBody + "\n\n", "oracle insertion point")
  done.push("oracle body")
}
if (!has("real-perl-analyzer")) {
  next = insertAfter(next, IMPORT_ANCHOR, IMPORT_ADDED, "perl import")
  done.push("import")
}
if (!has("PIN_BASELINE_FROM_SCOPE")) {
  next = insertAfter(next, PIN_ANCHOR, PIN_ADDED, "PIN_BASELINE_FROM_SCOPE const")
  done.push("PIN const")
}
if (!has('if (lang === "perl")')) {
  next = insertAfter(next, DISPATCH_ANCHOR, DISPATCH_ADDED, "perl truth dispatch")
  done.push("truth dispatch")
}
if (!has('lang === "perl" ? ["calls"]')) {
  next = insertAfter(next, CALLS_ANCHOR, CALLS_ADDED, "perl calls allowlist entry")
  done.push("calls allowlist")
}
if (!has('lang === "perl" ? ["contains"]')) {
  next = insertAfter(next, CONTAINS_ANCHOR, CONTAINS_ADDED, "perl contains allowlist entry")
  done.push("contains allowlist")
}
if (!has("if (PIN_BASELINE_FROM_SCOPE)")) {
  next = replaceOnce(next, SCOPED_GUARD_ANCHOR, SCOPED_GUARD_ADDED, "scoped pin guard")
  done.push("scoped pin guard")
}
if (next === current) {
  console.log("nothing to do: every wiring step is already present")
  process.exit(0)
}

// The register's own strings. This is the acceptance test, not a smoke test.
const REQUIRED = [
  "export function derivePerlEdges",
  'lang === "perl" ? ["contains"]',
  'lang === "perl" ? ["calls"]',
  "PIN_BASELINE_FROM_SCOPE",
  "if (PIN_BASELINE_FROM_SCOPE)",
]
const missing = REQUIRED.filter((s) => !next.includes(s))
if (missing.length > 0) fail(`the register's strings are still absent after the edit: ${missing.join(", ")}`)
console.log(`wiring applied: ${done.join(", ")}`)

console.log(`oracle recovered from ${ORACLE_SOURCE} (${ORACLE_SOURCE_NOTE}): ${oracleLines.length} lines recovered, ${adaptedBody.split("\n").length} as restored`)
console.log("wiring restored: import, PIN_BASELINE_FROM_SCOPE, truth dispatch, calls allowlist, contains allowlist, scoped pin")
console.log(`register strings present: ${REQUIRED.length}/${REQUIRED.length}`)
console.log(`declared scope, NOT admitted: perl's \`uses\` and \`references\` (rules that postdate ${ORACLE_SOURCE})`)
console.log(`lines ${current.split("\n").length} -> ${next.split("\n").length}`)
if (!APPLY) {
  console.log("--dry-run: nothing written (pass --apply)")
  process.exit(0)
}
fs.writeFileSync(TARGET, next)
console.log(`written: ${path.relative(ROOT, TARGET)}`)
