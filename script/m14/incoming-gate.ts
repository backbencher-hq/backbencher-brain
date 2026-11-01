/**
 * INCOMING GATE — the arbiter that decides whether a lane's incoming side is real.
 *
 * ## Why this file exists
 *
 * `incoming-check.ts` MEASURES the incoming side and is correct about what it measures.
 * But it cannot fail: it has no `exitCode` assignment and no threshold, so it printed
 * `339,750 ambiguous+unresolved edges across 23 lanes` and the programme carried on.
 * That number is the deepest remaining work in the whole ontology, and nothing read it.
 * A measurement with no arbiter is not a gate; it is a log line.
 *
 * So this file is the arbiter. It answers ONE question per lane and it can answer NO:
 *
 *   does every edge this lane emits resolve to exactly ONE declaration, with the
 *   exceptions that are legitimate and DECLARED as such?
 *
 * ## The three findings that shaped the metric
 *
 * 1. **`incoming-check`'s `ambiguous` counts DISTINCT KINDS, not declarations.**
 *    It builds `published: Map<name, kind[]>` and pushes a kind only if not already
 *    present, so `hits.length > 1` means "this bare name is published under two or more
 *    SymbolKinds". Three `.btn` rules in three SCSS files are all kind `class`, so the
 *    fleet reported `scss 0 ambiguous` — while the same lane measures 747 ambiguous by
 *    DECLARATION count, and make's `test` target is declared in 53 files, all kind
 *    `function`, all reading 0 ambiguous.
 *
 *    Two lanes say this in their own words: `validation/m14/fixtures/nim/ambiguity-classify.ts:38`
 *    and `validation/m14/fixtures/zig/ambiguity-split.ts:30` ("ambiguous does NOT mean 'N
 *    declarations share this name'"), and `docs/analyzers/scss.md:1741`
 *    reports both numbers side by side — 3 by kind, 284 by declaration.
 *
 *    A count that reads zero on a graph where a name denotes 53 declarations does not
 *    protect anything. So this gate counts DECLARATIONS, and reports the kind-count
 *    beside it so the two are never confused again.
 *
 * 2. **EXTERNAL TARGETS ARE A DECLARED EXCEPTION, NOT A DEFECT.** A stdlib symbol, a
 *    cmdlet, an FSharp.Core name, a file path — legitimately outside the corpus. They
 *    pollute `unresolved` unless the lane MARKS them, and the marking is what this gate
 *    requires: an additive `metadata` key on the relationship. An unmarked external edge
 *    is indistinguishable from a broken one, so it counts against the lane.
 *
 * 3. **A PROBE THAT CANNOT FAIL IS NOT A MEASUREMENT.** This file carries a POSITIVE
 *    CONTROL that must fire: it plants a known-ambiguous and a known-unresolvable target
 *    and asserts the detector reports them. If the control does not fire, the gate exits
 *    3 and says the instrument is broken — it does NOT print a clean lane. This is the
 *    defence against the failure this programme has hit repeatedly: CSS's pass-1
 *    containment probe read `symbol.range.start.line` on a `parseFile` result that has no
 *    `range`, so 0 violations was also what a broken probe returned; PHP's `define()`
 *    probe compared an `argument` node against `encapsed_string` and could never fire, so
 *    no corpus could falsify its ruling.
 *
 * ## The population rule, enforced structurally
 *
 * Every count here is over a file set DISCOVERED from the corpus root at run time and
 * printed with its size. Nothing is hard-coded: a `FILES = [...]` array is a defect the
 * moment a file is added beside it, and the instrument will keep reporting a confident 0
 * forever. `docs/M14-HONESTY-CONTRACT.md` §"an instrument must declare the population".
 *
 * ## PROJECT SCOPE, and why the verdict is scoped
 *
 * "Resolved" is not a property of an edge on its own. It is a property of an edge against a
 * KEY SPACE, and this gate spent its first life using the wrong one: every symbol of every
 * repository this run touched, pooled into a single name table. Under that table a dart
 * target `_controller` reads AMBIGUOUS because some other checkout, in another repository
 * that will never be indexed together with this one, declares `_controller` too.
 *
 * Production does not work that way. `parallel-indexer.resolveRelationships` resolves each
 * edge against its OWN PROJECT (`WHERE s.project_id = ?`): by exact `qualified_name` match
 * (strategy 1), or by a bare `name` only when that name occurs EXACTLY ONCE in the project
 * (`_res_name.cnt = 1`, strategy 2), then by the import-target form, then structurally. A
 * name that is unique in its project RESOLVES, no matter how many other projects declare it.
 *
 * So this gate reports both key spaces and decides on the project one:
 *
 *   TABLE 1  per project — the file's own repository. Production's scope, and the verdict's.
 *   TABLE 2  pooled corpus — the number this gate reported before, kept because every dart
 *            figure in this programme's history was measured with it and a run that silently
 *            changed its unit would be incomparable to its own past.
 *
 * The scoping is STRICTER than production in one direction and looser in none: production's
 * strategy 2 also accepts a bare name whose project-wide count is 1 (this gate agrees), and
 * where several declarations share a `qualified_name` production takes the lowest id while
 * this gate calls it ambiguous. A gate is not allowed to be more forgiving than the thing it
 * measures, and this one is not.
 *
 * ## What a PASS does and does not mean
 *
 * PASS = over this file set, this analyzer digest, every emitted edge either resolves to
 * exactly one declaration IN ITS OWN PROJECT or carries a declared external marker the
 * project confirms. It is a statement about THIS population at THIS commit, and the output
 * prints both so a reader can tell it apart from a claim about the language.
 *
 * It does NOT mean the analyzer is correct. Edges can resolve to the WRONG declaration.
 * That is what `script/m14/differential.ts` and the mutation suites are for, and this gate
 * does not touch them. One arbiter per question.
 *
 * ## Usage
 *
 *   npx tsx script/m14/incoming-gate.ts <lang> <extension> [maxFiles]
 *   npx tsx script/m14/incoming-gate.ts --all            # every laptop-B lane
 *   npx tsx script/m14/incoming-gate.ts --json <lang> <ext> [maxFiles]
 *
 * ## `--selftest` IS NOT A CONTROL-ONLY MODE
 *
 * The instrument's own control runs on EVERY arm and is reported at the end of every run
 * ("instrument self-test: PASS (control fired)"), and `--selftest` is accepted for compatibility — **it does
 * NOT skip the arm.** This is stated because the clojure lane expected a control-only mode, ran one without
 * holding the arm token, and thereby started a whole-population arm on the DEFAULT corpus root, concurrently
 * with another lane's arm. It disclosed that itself, which is the right conduct, and the disclosure is why the
 * flag is now documented rather than left to be guessed at.
 *
 * **A CONTROL-ONLY MODE THAT PRINTS A PASS LINE WITH NO ARM BEHIND IT IS EXACTLY THE TRAP THE toml LANE FOUND IN
 * ITS OWN DEAD MUTATION SUITE** — a dead suite reads like a green one. The control belongs WITH the measurement,
 * on the population the measurement is about, so that "the instrument is broken" and "this population is
 * unresolved" can never be confused for one another.
 *
 * Exit: 0 pass · 1 fail (a real unresolved/ambiguous edge class) · 2 usage/environment ·
 *       3 THE INSTRUMENT'S OWN CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"


// ⇒⇒⇒ THE ROUTER'S EXTENSION TABLE LIVES IN ITS OWN MODULE NOW (2026-10-22), AND THIS IS WHY.
// The heritage blind-spot probe carried its OWN hand-written extension map, and the cpp lane
// MEASURED that the map had no `cpp` entry — so the probe's population was EMPTY, and it printed
// "population: 0 GIT-TRACKED admitted files", "heritage clauses 0", "UNCOVERED 0" and "no
// base_class_clause clause was found in the population", EXIT 0. ⇒⇒⇒ **A CLEAN-LOOKING ZERO OVER
// AN EMPTY POPULATION**, and the gate's population and the probe's population were DIFFERENT
// POPULATIONS UNDER THE SAME NAME.
//
// ⇒⇒⇒ THE TABLE COULD NOT BE IMPORTED FROM HERE, BECAUSE **THIS FILE RUNS ITS WHOLE BODY ON
// IMPORT** — so importing the table from here would run the fleet's entire gate as a side effect of
// importing a constant. ⇒⇒⇒ THE MAPS MOVED TO `script/m14/language-extensions.ts` AND ARE
// RE-EXPORTED HERE, so every existing consumer keeps working and no consumer keeps a second copy.
// ⇒⇒⇒ **A TABLE DUPLICATED IN TWO PLACES IS ONE TABLE THAT WILL DIVERGE**, and it did.
import {
  LANES_A,
  LANES_B,
  FLEET_LANES,
  extensionsFor,
} from "./language-extensions"

export { LANES_A, LANES_B, FLEET_LANES, extensionsFor }
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { parseFile } from "../../src/ast/pool-worker"
// THE ROUTER'S OWN DETECTION, imported rather than re-spelled: the basename clause below has to
// agree with what production admits, and production admits by `detectLanguageFromPath`.
import { detectLanguageFromPath } from "../../src/ast/language-detection"
// The separator a binding's target carries. Imported from the FAMILY constant rather than
// re-spelled here: the analyzer writes it (src/ast/types.ts) and this gate checks it, and two
// copies of a spelling would be two rules.
import { BINDING_SEP } from "../../src/ast/types"
// The empty-result kind lives in ONE module because it was written twice and the two copies diverged
// on their first run — see `script/m14/empty-result-kind.ts`. The classification is imported, never
// re-implemented, so the instrument and its control cannot disagree about what "empty" means.
import { classifyEmptyResults } from "./empty-result-kind"
// THE OWNER CHANNEL'S MODEL. Production's `claimOwnerCarryingTargets` is authoritative over every
// calls/uses row carrying `metadata.owner` (it withdraws the name binding and re-binds from the
// receiver's class + ancestors); this gate modelled none of it, so it misreported those rows in BOTH
// directions. The rule lives in ONE module with its own clause-by-clause citations so the two
// implementations cannot drift silently — see script/m14/owner-channel.ts.
import {
  buildOwnerProjectPools,
  ownerChannelVerdict,
  EMPTY_OWNER_POOLS,
  OWNER_CLASS_LIKE,
  type OwnerProjectPools,
  type OwnerSymbolRecord,
} from "./owner-channel"

// ============================================================
// PER-EDGE DUMP (`--dump`)
//
// This gate classifies EVERY edge (classifyEdge) and then prints only per-type
// aggregate columns. That is enough to rank work and useless for diagnosing it:
// an agent told "3355 of 4222 `uses` edges are unresolved" cannot tell whether the
// cause is a wrong target spelling, a missing cross-file index, a tie-break, or a
// genuinely undeclared name WITHOUT SEEING THE ROWS.
//
// So `--dump` prints the rows themselves -- one TSV line per NON-RESOLVED edge:
//   label · outcome · target · srcFile:line · claimKind
// Bounded by BB_DUMP_LIMIT (default 40) so a whole-corpus run cannot flood a report,
// and the bound is PRINTED when reached, so a short list is never mistaken for the set.
// Read-only: it changes no count, no tally and no exit code.
// ============================================================
const BB_DUMP = process.argv.includes("--dump")
const BB_DUMP_LIMIT = Number(process.env.BB_DUMP_LIMIT ?? 40)
// THE BOUND MARKER'S STATE (2026-10-20, the powershell lane). THE HEADER PROMISED "the bound is
// PRINTED when reached, so a short list is never mistaken for the set" — AND NO SUCH PRINT EXISTED:
// `BB_DUMP_LIMIT` appeared in exactly three places (that comment, this constant, and the guard below)
// and no `console.log` mentioned it. **A TRUNCATED DUMP WAS THEREFORE INDISTINGUISHABLE FROM A COMPLETE
// ONE** — and every lane's row-level reconciliation reads this dump, so a truncated one would under-count
// the movement AND look complete. The marker is printed when the bound is first reached ✓ and the
// skipped count is printed with the verdict ✓.
let bbDumpTruncated = false
let bbDumpSkipped = 0
// RESTRICT THE DUMP TO ONE LABEL. Without this the limit is consumed by whichever type happens to have the
// most unresolved edges (typescript `calls` alone has 1,688), so a `--dump | grep extends` returns NOTHING and
// reads as "no unresolved extends edges" when the truth is "the bound was reached before extends was seen".
// A filter that is applied AFTER a bound is not a filter. `BB_DUMP_LABEL=extends` filters BEFORE the bound.
const BB_DUMP_LABEL = process.env.BB_DUMP_LABEL ?? ""
let bbDumped = 0
// THE RULE IS IMPORTED, NOT COPIED. A census that counts WHY about the same edges must
// count them the same way, so the classification lives in incoming-rule.ts and this file
// consumes it. Re-exported below so a caller of this module keeps working unchanged.
import {
  EXTERNAL_KEYS, NAMESPACE_CLAIM_KEY, NAMESPACE_POLICY_KEY, NAMESPACE_SLASH_KEY, PACKAGE_SCOPE_CLAIM_KEY, isMarkedExternal, externalClaimOf, targetOwner, verifyExternalClaim, classifyEdge, tally,
  NAME_CAP,
  FILE_CLAIM_KEY, REMOTE_REF_CLAIM_KEY,
  emptyOutcomes, verifyImportClaim, verifyBindingClaim, BINDING_CLAIM_KEY, isContainsEdge, modulePathsOfFile,
  type ExternalClaim, type ProjectFacts,
  type Outcome, type Classified, type Outcomes,
} from "./incoming-rule"
export {
  EXTERNAL_KEYS, isMarkedExternal, externalClaimOf, targetOwner, verifyExternalClaim, classifyEdge, tally,
  FILE_CLAIM_KEY, REMOTE_REF_CLAIM_KEY,
  emptyOutcomes, verifyImportClaim, verifyBindingClaim, BINDING_CLAIM_KEY, isContainsEdge,
}
export type { ExternalClaim, ProjectFacts, Outcome, Classified, Outcomes }

/** Laptop B's 23 lanes — asserted, not inferred. THIS LITERAL IS THE AUTHORITY. It used to cite
 *  `docs/analyzers/PROMPT-LAPTOP-B.md:15`, which was deleted 2026-10-28 as stale: the assignment doc
 *  was written before a wave of work and had stopped describing the tree. The live tracker is
 *  `script/m14/completion-gate.ts`, which measures the lanes rather than listing them. */


/**
 * LAPTOP-A LANES — the other 23 analyzers, added 2026-10-12.
 *
 * THE EXTENSION LISTS ARE VERIFIED AGAINST THE ROUTER, NOT WRITTEN FROM MEMORY: every extension below was run
 * through `detectLanguageFromPath` and all 23 lanes report ZERO unrouted extensions. That check exists because
 * THREE router gaps were found in one day (.cts, .graphqls, .sbt/.phpt) and each one was an extension nobody had
 * noticed was missing from a list like this one.
 *
 * TWELVE OF THESE TWENTY-THREE ARE MEASURED as of 2026-10-12, on 400-file strides, and every one is tough:
 * javascript 84.5, rust 78.5, java 77.4, python 76.9, typescript 73.4, csharp 65.7, go 64.4, swift 44.6,
 * scala 38.6, kotlin 23.9, php 23.2 and cpp/c/perl/groovy assigned. THE RATES IN THAT SENTENCE ARE NOT ALL THE
 * SAME FRACTION — the first seven come from the gate's own columns and the rest from a resolved-per-edge read —
 * so quote edges, resolved, amb and unresolved and let the reader form the rate.
 *
 * NOTE FOR ANYONE EDITING THIS FILE: the parser rule stated above LANES_B applies here too. This literal is read
 * quote-aware but NOT comment-aware, so a comment must not contain a key-colon-quote shape and must not contain
 * a backtick.
 */


/**
 * THE FLEET'S LANE SET — the UNION of the two maps above.
 *
 * The two maps exist because the programme began on two machines ("laptop A" and "laptop B"), and
 * every sweep path iterated `LANES_B` ONLY. So the 23 lanes in `LANES_A` — java, typescript,
 * javascript, python, cpp, c, dart, go, groovy, haskell, html, kotlin, scala, clojure, csharp,
 * elixir, erlang, rust, svelte, swift, vb, vue, objective-c, perl — were MEASURABLE BY NAME but
 * never swept, and the population gate could not see them either (it compared only the lanes an
 * instrument declared, and the instrument declared one map).
 *
 * `FLEET_LANES` is the union, and every sweep path now iterates it, so the fleet sweep covers
 * every lane the engine has an analyzer for. `LANES_A` and `LANES_B` stay as the two named maps
 * they have always been — the union is derived, never hand-maintained a third time.
 */



const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
  // EXTENDED 2026-10-18. A stored label this table does not name is INVISIBLE to the gate:
  // `ontologyName` returns null and the row is skipped before any count — the same
  // filter-before-the-question defect this file's `--dump` header records. So the four values the
  // ten could not spell honestly are listed the moment the enum carries them, even before a lane
  // emits one; a type with 0 edges reads as `0 edges`, which is a measurement, not a silence.
  "decorates", "renders", "mixes_in", "part_of",
] as const
type Type = (typeof ALL_TYPES)[number]

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  // `part_of` MOVED 2026-10-18. It used to collapse to `contains`, on the pre-ruling ontology claim
  // that "part-of is containment". That claim is measured false for the construct the spelling
  // denotes (a Dart `part` directive includes a compile unit; it contains no symbol), and the
  // canonical value now exists. Leaving the collapse would make every emitted `part_of` read as a
  // `contains` edge — a wrong measurement that still adds up.
  contains: "contains", composition: "contains",
  // BOTH spellings: src/ast/types.ts says `brain_import`, src/ast/engine.ts says `imports`,
  // and analyzers import from engine. A table keyed on one of them reads 0 in EVERY
  // language while the edges are emitted — a confident zero from a table that can never
  // match, which is worse than no table.
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
  // The extended values, spelled once each and given NO legacy alias: a raw spelling no analyzer ever
  // produced must not be handed a meaning here, or the gate would report an edge class nothing can fire.
  decorates: "decorates", renders: "renders", mixes_in: "mixes_in", part_of: "part_of",
}
const ontologyName = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

/** The engine's own full-AST bound (`pool-worker.ts` FULL_AST_LIMIT). Above it the analyzer
 *  extracts structurally; above 5 MB `parseFile` returns an empty fallback with zero symbols.
 *  A gate that admits files the analyzer will not measure is measuring its own patience. */
const SIZE_CAP = 1024 * 1024

const DEFAULT_CORPUS_ROOT = "$HOME/fixtures/repositories"
const CR = process.env.BB_CORPUS_ROOT ?? DEFAULT_CORPUS_ROOT

/**
 * The file set. DISCOVERED, never listed.
 *
 * Walked to a whole-corpus git checkout, exactly as `ontology-coverage-gate.ts` does, so
 * the population this gate measures is the population that gate measures and the two are
 * comparable. `find | head -N` was the previous approach and it has a measured defect in
 * this programme: the dart census documented a 2,735-file table beside a command that
 * sampled 1,250, so the number and the command that produced it disagreed by half with
 * nothing in the output saying so.
 */
/**
 * WHICH FILES ARE THIS LANE'S POPULATION — now a SET of extensions, because the caller's single
 * argument was silently acting as a population filter.
 *
 * HANDOFF §5.2, measured: `firing-check.mjs` admits BOTH `.yml` and `.yaml`, while this gate
 * admitted the one extension it was handed. On ansible that is 2,082 files against **13** — the
 * same language, the same lane, two populations, and the smaller one was reported as if it were
 * the lane's incoming result. A gate whose population depends on a spelling is measuring the
 * spelling.
 *
 * `yaml,yml` now admits both. A single extension keeps its old exact behaviour, so no existing
 * invocation changes meaning; and the admitted set is PRINTED with the population, so the two
 * numbers can no longer disagree without the disagreement being visible in the output.
 */
/**
 * IS THIS FILE IN THE LANE'S POPULATION?
 *
 * A trailing `.ext` OR a BARE BASENAME equal to an ext. The second clause exists because some
 * languages name their files with no extension at all, and the extension-only test could not admit
 * them however the extension list was written: `make: "mk,mak,makefile"` matches `foo.mk` and
 * `GNUmakefile` but **never a bare `Makefile`** — there is no dot to match.
 *
 * MEASURED CONSEQUENCE, found by make-lane: over the same tree the gate admitted **129** files where
 * the production router admits **697 — 18.5%**. Every incoming make figure in this programme was
 * therefore a statement about 129 files presented under the lane's name. The gate printed its own
 * population and agreed with itself ("129 parsed of 129 sampled"), which is exactly why a population
 * defect is invisible from inside: the number is consistent with the rule that produced it.
 *
 * Same class as xml's `.xml`-only admission, which was `68138a1c8` — a lane measured over 18% of its
 * own corpus. **A population that depends on a spelling is measuring the spelling.**
 *
 * The basename clause cannot admit anything the extension test would not, EXCEPT a file whose whole
 * name equals an admitted ext — which is precisely the case it is for. It is not a widening of the
 * lane's population; it is the population the lane already claimed to have.
 *
 * AND THE CLAUSE NEEDS THE ROUTER'S AGREEMENT, NOT A SPELLING MATCH. It was written as
 * `base === e`, and for `Makefile` that coincides with the router's own basename table — but for
 * dart it admitted `dart-sdk/sdk/bin/dart`, a 1,462-byte BASH SCRIPT whose basename happens to
 * equal the extension spelling. Measured 2026-10-12 (arm12, whole corpus): that ONE file added
 * **34 edges the bash analyzer emitted** to the dart table (19 uses · 11 contains · 4 calls),
 * because production's predicate (`parallel-indexer.ts:694`,
 * `detectLanguageFromPath(filePath) !== null`) routes it as `bash` and never puts it in the dart
 * population. The widening exists for a NAME the ROUTER maps to a language, so the faithful test
 * is the router's own: a bare basename is admitted only when detection attributes it to THIS lane.
 * `Makefile` still passes (the basename table maps it to `make`); the script does not (detection
 * names no language for a spelling-only probe, and with its content names `bash`).
 */
function admitByExtension(rel: string, exts: string[], lang: string, absPath?: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) {
    // ⇒⇒⇒ **`.m` IS TWO LANGUAGES AND THE EXTENSION TEST CANNOT TELL THEM APART.** MATLAB and
    // Objective-C both write `.m`, so an extension-only admission gives the matlab lane the whole
    // union — measured 2026-10-31: `matlab 1 parsed of 1 … corpus has 259 .m files`, and the sampled
    // file was routed to the OBJECTIVE-C grammar (`NSTextView`, `objc_getAssociatedObject` in its
    // unresolved targets), i.e. the lane would have published an Objective-C analyzer's edges under
    // a MATLAB declaration. The router has always disambiguated by CONTENT
    // (`language-detection.ts:405`: first 64 KB containing `function ` / `classdef ` is MATLAB,
    // otherwise Objective-C), so the faithful admission is the router's own test, applied to the
    // head of the file. BOTH lanes are filtered — objc loses the MATLAB half exactly as production
    // does — and a file whose head cannot be read is NOT admitted (an unreadable file is not
    // evidence that it belongs to this lane).
    if (low.endsWith(".m") && (lang === "matlab" || lang === "objective-c") && absPath) {
      const head = readHeadText(absPath, 65536)
      if (head === null) return false
      return detectLanguageFromPath(rel, head) === lang
    }
    return true
  }
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

/**
 * The first `bytes` of a file as UTF-8, or null when it cannot be read. Bounded by construction:
 * the router's own content sniffer reads the first 64 KB, so nothing beyond that can change the
 * answer and nothing beyond it is read here.
 */
function readHeadText(absPath: string, bytes: number): string | null {
  try {
    const fd = openSync(absPath, "r")
    try {
      const buf = Buffer.alloc(bytes)
      const n = readSync(fd, buf, 0, bytes, 0)
      return buf.subarray(0, n).toString("utf8")
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

function discoverFiles(lang: string, ext: string, exts: string[], maxFiles: number, onlyRepos?: Set<string>, offset = 0, hasOffset = false): {
  files: string[]; total: number; repos: number
  /** THE CHUNK'S OWN BOUNDS in the admitted list — [sliceStart, sliceEnd). ZERO means the whole
   *  admitted population, which is the only case in which the run is not a chunk. */
  sliceStart: number; sliceEnd: number
  /** THE UNSAMPLED ADMITTED POPULATION — `files` before the stride. A project fact (is this
   *  path in the population at all?) must be answered from THIS, not from the sample, or a
   *  claim would be verified against the run's budget instead of against the project. */
  admitted: string[]
  /** tracked paths of THIS lane that could not be read at all (absent from the working tree) */
  absent: number
  /** tracked paths of this lane over SIZE_CAP — never parsed, so never measured */
  overCap: number
  overCapLargest: number
} {
  const found: string[] = []
  const repos = new Set<string>()
  const excluded = { absent: 0, overCap: 0, overCapLargest: 0 }
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], admitted: [], total: 0, repos: 0, absent: 0, overCap: 0, overCapLargest: 0, sliceStart: 0, sliceEnd: 0 }
  }
  for (const name of entries.sort()) {
    // A REPO FILTER is a SUBSET of the corpus, and the header says so. It exists because a
    // stride sample cannot measure a FILE-SCOPED target: an import that names a path in the
    // same project resolves only if that project's other files are in the key space, so a
    // sampled run understates import resolution by construction (measured: 0.4 % sampled vs
    // 46.8 % whole-corpus on the same revision). A whole single project is the honest unit for
    // any question about file-scoped targets.
    if (onlyRepos && !onlyRepos.has(name)) continue
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    // Only real git checkouts are corpus. A stray directory is not evidence.
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!admitByExtension(rel, exts, lang, path.join(dir, rel))) continue
      const abs = path.join(dir, rel)
      try {
        // THE SIZE CAP IS PART OF THE POPULATION CLAIM, so it is counted and printed.
        //
        // It was 512 KB, which admitted 33,692 of this lane's 33,755 tracked .dart files
        // and said nothing about the 63 left out. 46 of those sat between 512 KB and
        // 1 MB — inside the range where `pool-worker.ts` still builds a FULL AST
        // (FULL_AST_LIMIT = 1 MB) — so the gate was not measuring files the analyzer could
        // measure. The cap is now that engine limit, because that is the line the analyzer
        // itself draws: above 1 MB it extracts structurally, above 5 MB it returns an empty
        // fallback with zero symbols. What remains excluded is reported in the header.
        const size = statSync(abs).size
        if (size > SIZE_CAP) { excluded.overCap++; excluded.overCapLargest = Math.max(excluded.overCapLargest, size); continue }
      } catch {
        // A path `git ls-files` lists and the working tree does not have. Two such .dart
        // files exist in this corpus (`pb-reference/examples/{add,list}_people.dart`), and
        // a population that counts them is claiming files it cannot open.
        excluded.absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  // STRIDE, not head: a head-N walk measures one repository and calls it a language.
  // Deterministic either way, so a re-run with the same N reproduces the same set.
  //
  // `maxFiles <= 0` means NO CAP. It exists because the previous call form passed the
  // corpus size measured under the OLD cap, and a stride computed against a grown corpus
  // silently truncates it back — the population number would look unchanged while 46 real
  // files went unmeasured, which is the defect this file keeps having to fix.
  let files = found
  let sliceStart = 0
  let sliceEnd = found.length
  if (hasOffset) {
    // ★ THE CHUNK PATH. A SLICE, NOT A STRIDE — see the `--offset` block above for why the
    // difference is the whole point. The admitted list is SORTED (the `found.sort()` above), so the
    // same `--offset` over the same `--repo` filter always yields the same chunk, and two chunks
    // with different offsets are DISJOINT by construction.
    sliceStart = Math.min(offset, found.length)
    sliceEnd = maxFiles > 0 ? Math.min(sliceStart + maxFiles, found.length) : found.length
    files = found.slice(sliceStart, sliceEnd)
  } else if (maxFiles > 0 && total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  void lang
  return { files, admitted: found, total, repos: repos.size, sliceStart, sliceEnd, ...excluded }
}

/**
 * THE PROJECT'S OWN FACTS, for verifying an import claim — built by THIS file, from the
 * filesystem, and never handed to the analyzer.
 *
 * That separation is the whole point: the analyzer asserts "this specifier names a file that
 * is not in this project", and a claim whose evidence came from its author would be a
 * restatement. So the arbiter looks for itself: the project's `pubspec.yaml` files say
 * which packages it declares, and the ADMITTED population says which paths exist in it.
 * The package reader is deliberately the same rule the analyzer applies (`name:` at column
 * 0, value up to whitespace or `#`) so the two sides cannot read one pubspec differently.
 */
const DART_FACT_WALK_SKIP = new Set([
  ".git", ".hg", ".svn", "node_modules", ".dart_tool", ".symlinks", "build", "coverage", ".pub-cache", "out",
  // THE SAME FARM UNDER ANOTHER PLATFORM'S NAME. `windows/flutter/ephemeral/.plugin_symlinks/*`
  // are Flutter's links INTO the pub cache — one per plugin dependency — and following them
  // (d13b999c0 taught this walk to follow symlinked directories, for sql-lane's whole repository
  // behind `repositories/proxicall`) took ProxiCall's `packages` fact set from **2 to 62**.
  // Measured 2026-10-12 (arm12, whole corpus): `verifyImportClaim` refutes a `package:<pkg>/…`
  // claim when the project declares `<pkg>`, so **173 claims that are TRUE —
  // `package:firebase_core/firebase_core.dart` IS outside ProxiCall, whose own pubspec never
  // declares it — read REFUTED and were counted against the lane.** A dependency reached through
  // a build symlink is not the project's own pubspec, which is what `.symlinks` and `build` are
  // already in this set to say.
  ".plugin_symlinks",
])

/**
 * THE PROJECT'S OWN FILE LIST, for the lanes whose imports name FILES rather than packages.
 *
 * Built from the UNSAMPLED admitted list (a fact about the project, not about this run's budget)
 * and keyed repo-relative with POSIX separators, which is the spelling a claim must use. No walk
 * of the tree: the admitted list IS the answer, and a walk would answer a different question
 * ("what is on disk", including files this programme refuses to parse).
 */
/**
 * W9 — THE EDGE'S OWN FILE, IN THE SPELLING `facts.files` HOLDS.
 *
 * `edgeFile` carries the ABSOLUTE path (the per-file manifest evidence is keyed by it), while the
 * admitted file list is REPO-RELATIVE, so a runtime-variable path has to be resolved against the
 * REPO-RELATIVE spelling of the edge's own file. `undefined` means the edge has no file of its
 * own, and the row is then answered exactly as it is today.
 */
function edgeRelFile(repo: string, srcFile: string | undefined): string | undefined {
  if (typeof srcFile !== "string" || srcFile.length === 0) return undefined
  const rel = path.relative(path.join(CR, repo), srcFile)
  if (rel.length === 0 || rel.startsWith("..")) return undefined
  return rel.split(path.sep).join("/")
}

async function projectFactsForFiles(repoRoot: string, admitted: string[]): Promise<ProjectFacts> {
  const files = new Set<string>()
  for (const abs of admitted) {
    const rel = path.relative(repoRoot, abs)
    if (rel.length > 0) files.add(rel.split(path.sep).join("/"))
  }
  // THE PER-FILE MANIFEST EVIDENCE — the dependency names declared by the manifest that GOVERNS each
  // file (the nearest ancestor manifest), keyed by the file's ABSOLUTE path, because that is the
  // spelling `edgeFile` carries (the same keying the imported-binding and imported-name claims use).
  //
  // It exists because a repo-level manifest answers a DIFFERENT question in a monorepo: 843 tracked
  // `package.json` files, 414 `pubspec.yaml`, 744 `Cargo.toml`, 222 `pom.xml` and 395 `build.gradle`
  // files live in SUBDIRECTORIES, while only 38 / 3 / 4 / 2 / 2 repos carry one at the ROOT. A file in
  // `packages/foo/` is governed by `packages/foo/package.json`, so a claim checked against the root's
  // manifest is checked against ANOTHER PACKAGE's dependency list — in both directions.
  //
  // A FILE WITH NO GOVERNING MANIFEST GETS NO ENTRY, and its claim is then UNVERIFIABLE (never quietly
  // accepted) — exactly as it is today for a project with no manifest at all.
  const byFile = new Map<string, Set<string>>()
  // THE PROJECT-FACT map, kept APART: the union of the package manifests and the CMake forms. It is
  // what a NEGATIVE project-fact claim grounds itself on. A CMake name is in HERE and NOT in the
  // package map, so it can never verify a package-scope claim (whose reach over the C++ wall is
  // measured at ZERO rows).
  const byFileFacts = new Map<string, Set<string>>()
  for (const abs of admitted) {
    const governed = await manifestResolutionForFile(repoRoot, abs)
    if (governed === undefined) continue
    byFile.set(abs, governed.packages)
    byFileFacts.set(abs, governed.projectFacts)
  }
  return {
    packages: new Set<string>(), files, sdkLib: false,
    packageDependencies: manifestDependencies(repoRoot),
    packageDependenciesByFile: byFile,
    projectFactDependencies: await projectFactDependencies(repoRoot),
    projectFactDependenciesByFile: byFileFacts,
  }
}

/**
 * THE PROJECT'S OWN DECLARED DEPENDENCIES, read from its MANIFEST — the evidence the
 * `packageScope` claim is verified against.
 *
 * WHY THIS IS THE INSTRUMENT FOR THE FLEET'S BIGGEST REMAINING CLASS: the dart lane priced 84.9% of
 * its 16,395 unresolved `uses` rows as "members of types the PROJECT DOES NOT DECLARE" (only 155 =
 * 0.9% is addressable by any evidence class, because for the other 84.9% there is NO DECLARATION for
 * an evidence class to point at), and the C++ lane's bucket D (122,227 of 614,081) is the same class.
 * The only true statement available for those rows is "this name belongs to a package this project
 * depends on" — and a MANIFEST is what can check it. A lane-maintained vocabulary could not: it
 * grows to cover whatever the corpus contains, and a name from a package the project does not depend
 * on could be claimed. A manifest can only confirm what the checkout itself declared.
 *
 * THE MANIFESTS, and what each names:
 *   go.mod                    `require`/`replace` lines -> the module path (`github.com/pkg/errors`)
 *   package.json              `dependencies`/`devDependencies`/`peerDependencies` keys (`json_annotation`)
 *   pubspec.yaml              `dependencies:` keys (`json_annotation`, `freezed`)
 *   Cargo.toml                `[dependencies]` keys (`serde`)
 *   composer.json             `require`/`require-dev` keys (`monolog/monolog`)
 *   pyproject.toml / requirements*.txt  distribution names (`requests`)
 *
 * READ, NOT GUESSED: the values are the manifest's own keys, and the set is empty when the project
 * has no manifest — so a claim in a project with no manifest is UNVERIFIABLE, never quietly
 * accepted.
 */
import { manifestDependenciesIn } from "./manifest-reader"

/**
 * THE PROJECT'S DEPENDENCIES, read from its ROOT manifest — the repo-level set.
 *
 * Unchanged in meaning: the root's manifest, and an empty set when the project has no manifest (so
 * every claim against it is UNVERIFIABLE, never quietly accepted). It now also reads the manifest
 * KINDS the gate could not read before (Gemfile, pom.xml, build.gradle, Package.swift, *.csproj) —
 * see `manifestDependenciesIn` for why each was added and what it cost.
 */
function manifestDependencies(repoRoot: string): Set<string> {
  return manifestDependenciesIn(repoRoot) ?? new Set<string>()
}

/**
 * THE MANIFEST THAT GOVERNS A FILE — the nearest ancestor manifest, walking UP from the file's own
 * directory to the repository root.
 *
 * WHY, MEASURED 2026-10-20: the corpus is full of MONOREPOS, and a root-only manifest answers a
 * different question than the one a claim asks. 843 tracked `package.json` files, 414 `pubspec.yaml`,
 * 744 `Cargo.toml`, 222 `pom.xml` and 395 `build.gradle` files live in SUBDIRECTORIES, while only
 * 38 / 3 / 4 / 2 / 2 repositories carry one at the ROOT. A file in `packages/foo/` is governed by
 * `packages/foo/package.json` — so a claim checked against the root's manifest is checked against a
 * DIFFERENT PACKAGE's dependency list, in both directions: a dependency the package genuinely declares
 * can read REFUTED (counted against the lane), and a dependency only the ROOT declares can read
 * VERIFIED (which is the monorepo's laundering, and the claim exists to stop exactly that).
 *
 * THE NEAREST-ANCESTOR RULE: the first manifest found walking up. A file with no manifest anywhere
 * above it has NO governing manifest, and its claim is UNVERIFIABLE — never quietly accepted.
 *
 * CACHED PER DIRECTORY, because a monorepo has thousands of files per package and the same manifest
 * governs all of them.
 */
const manifestByDirCache = new Map<string, Set<string> | null>()
/**
 * THE CMAKE MANIFEST'S DECLARED DEPENDENCY NAMES — read by the LANE'S OWN reader, which implements
 * exactly the field list it published (a WHITELIST of (form, field) pairs, not a scan for
 * name-shaped strings): `find_package(<Name>)` argument 1 only · `pkg_check_modules(<PREFIX> … <module>…)`
 * the MODULES · `target_link_libraries(… Ns::Tgt)` the NAMESPACE AS CORROBORATION ONLY, never as an
 * introducer. Everything else is REFUSED: `find_library`/`find_path` NAMES (a file stem),
 * `add_library`/`add_executable` (a project target), `add_subdirectory` (a directory of this project),
 * `FetchContent_*`/`ExternalProject_Add` (a fetched dependency, whose sources are IN the checkout),
 * a `#` COMMENT (the measured trap: ghostty's root CMakeLists.txt carries
 * `#   find_package(ghostty-vt REQUIRED)`), and every other token.
 *
 * The reader is the lane's instrument and is verified by its own `cpp-cmake-names-verify.ts` (35/35,
 * `--prove-red` exits 3). The gate CALLS it; it does not re-implement it, and it does not widen it.
 *
 * WHY THE GATE READS IT AT ALL: the C++ lane's NEGATIVE project-fact claim needs the manifest's NAME
 * SET to ground itself for a CMake-governed file, and 1,029 files are misjudged today because a
 * CMakeLists.txt sits NEARER than the manifest the gate reads. The reader is the REQUEST; the
 * package-scope claim is not (its reach over the C++ wall is measured at ZERO rows).
 */
const cmakeNamesByDirCache = new Map<string, Set<string> | null>()
async function manifestCmakeNamesIn(dir: string): Promise<Set<string> | null> {
  const cached = cmakeNamesByDirCache.get(dir)
  if (cached !== undefined) return cached
  let out: Set<string> | null = null
  try {
    const text = readFileSync(path.join(dir, "CMakeLists.txt"), "utf8")
    const mod: any = await import("./cpp-cmake-names")
    const read = mod.cmakeDependencyNames(text)
    out = new Set<string>(read.names as string[])
  } catch {
    out = null // no CMakeLists.txt here, or the reader is unavailable
  }
  cmakeNamesByDirCache.set(dir, out)
  return out
}

/**
 * THE GOVERNING MANIFEST for one file: the NEAREST ancestor directory that holds ANY manifest the
 * gate can read — INCLUDING a CMakeLists.txt.
 *
 * TWO SETS COME BACK, and they are kept apart on purpose. `packages` is the PACKAGE-manifest set and
 * is what the package-scope claim consults; it is package-only, so a CMake name can never verify a
 * package-scope claim. `projectFacts` is the union, and it is what a NEGATIVE project-fact claim
 * grounds itself on.
 *
 * A CMakeLists.txt ALSO COUNTS AS A MANIFEST FOR THE WALK, which is the point: a file under a
 * CMake-only directory is governed by THAT directory, not by a root manifest belonging to another
 * ecosystem. That is the 1,029 misjudged files, and the fix is here rather than in the claim.
 */
type ManifestResolution = { dir: string; packages: Set<string>; projectFacts: Set<string> }
async function manifestResolutionForFile(repoRoot: string, absFile: string): Promise<ManifestResolution | undefined> {
  let dir = path.dirname(absFile)
  const root = path.resolve(repoRoot)
  for (;;) {
    const packages = manifestDependenciesIn(dir)
    const cmake = await manifestCmakeNamesIn(dir)
    if (packages !== null || cmake !== null) {
      const projectFacts = new Set<string>(packages ?? [])
      for (const n of cmake ?? []) projectFacts.add(n)
      return { dir, packages: packages ?? new Set<string>(), projectFacts }
    }
    if (path.resolve(dir) === root) return undefined
    const up = path.dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
}

/**
 * THE REPO-LEVEL PROJECT-FACT SET: the root manifest's package names UNION the root's CMake names.
 * It is the fallback for a file with no governing manifest, exactly as the repo-level package set is
 * — and it is the ONLY set that carries CMake names.
 */
async function projectFactDependencies(repoRoot: string): Promise<Set<string>> {
  const out = new Set<string>(manifestDependencies(repoRoot))
  for (const n of (await manifestCmakeNamesIn(repoRoot)) ?? []) out.add(n)
  return out
}

function manifestDependenciesForFile(repoRoot: string, absFile: string): Set<string> | undefined {
  let dir = path.dirname(absFile)
  const root = path.resolve(repoRoot)
  for (;;) {
    const cached = manifestByDirCache.get(dir)
    const found = cached !== undefined ? cached : manifestDependenciesIn(dir)
    if (cached === undefined) manifestByDirCache.set(dir, found)
    if (found !== null) return found
    if (path.resolve(dir) === root) return undefined
    const up = path.dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
}

/**
 * SYMLINKED DIRECTORIES FOLLOWED by the dart fact walk, printed with the population.
 *
 * Module-level because `ProjectFacts` is a shared shape and widening it for a diagnostic would put a
 * walk statistic in the type of a project fact. Reset at the top of the walk so a second repo cannot
 * inherit the first one's count.
 */
let symlinkedDirsFollowed = 0

function projectFactsForDart(repoRoot: string, admitted: string[]): ProjectFacts {
  symlinkedDirsFollowed = 0
  const files = new Set<string>()
  for (const abs of admitted) {
    const rel = path.relative(repoRoot, abs)
    if (rel.length > 0) files.add(rel.split(path.sep).join("/"))
  }
  const packages = new Set<string>()
  const stack: string[] = [repoRoot]
  // A SYMLINKED DIRECTORY IS A DIRECTORY. `Dirent.isDirectory()` is FALSE for a symlink, so this walk
  // silently skipped every symlinked subtree. Found by sql-lane, whose LANE CENSUS dropped an ENTIRE
  // REPOSITORY the same way — `repositories/proxicall -> $HOME/ProxiCall` — and measured the
  // loss on one unchanged population with only the walk fixed: **1,526 -> 1,965 files, 16,273 ->
  // 31,051 edges**, imports 38->53, references 2,092->5,966, contains 5,400->12,024. Every figure its
  // spec's gap prose carried was short by one whole repository.
  //
  // HERE the loss is quieter and lands on the EXTERNAL-CLAIM columns: this walk exists to establish
  // which packages the project itself declares, so a package declared UNDER a symlinked subtree is not
  // seen — and a claim the project genuinely carries reads as one no check can reach. That is a
  // `ext?` in the place of an `extOK`, i.e. it makes a lane look LESS verifiable than it is.
  //
  // FOLLOWING LINKS REQUIRES BOUNDING THEM. A walk that follows links with no cycle guard can spin
  // forever, so every real path is visited at most once via `seen`. The count is kept and PRINTED:
  // a walk that silently follows links is as unauditable as one that silently skips them.
  const seen = new Set<string>()
  try { seen.add(realpathSync(repoRoot)) } catch { /* an unresolvable root is reported by the caller */ }
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const child = path.join(dir, entry.name)
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        // `statSync` FOLLOWS the link, which is the whole point; a broken link throws and is skipped.
        try { isDir = statSync(child).isDirectory() } catch { isDir = false }
      }
      if (isDir) {
        if (DART_FACT_WALK_SKIP.has(entry.name)) continue
        let real = child
        try { real = realpathSync(child) } catch { /* keep the path; the cycle guard is best-effort */ }
        if (seen.has(real)) continue
        seen.add(real)
        if (entry.isSymbolicLink()) symlinkedDirsFollowed++
        stack.push(child)
        continue
      }
      if (entry.name !== "pubspec.yaml") continue
      let text: string
      try { text = readFileSync(path.join(dir, entry.name), "utf8") } catch { continue }
      for (const line of text.split("\n")) {
        if (!line.startsWith("name:")) continue
        const raw = line.slice(5)
        let v = 0
        while (v < raw.length && (raw[v] === " " || raw[v] === "\t")) v++
        let end = v
        while (end < raw.length) {
          const c = raw[end]
          if (c === " " || c === "\t" || c === "\r" || c === "#") break
          end++
        }
        const value = raw.slice(v, end)
        if (value.length > 0) packages.add(value)
        break
      }
    }
  }
  return { packages, files, sdkLib: existsSync(path.join(repoRoot, "sdk", "lib")) }
}


/** A type's edge count plus its two scopes. `Outcomes` itself lives in `incoming-rule.ts`,
 *  because a census has to count with the same tally this verdict does. */
/** One marker set's PROJECT-scope outcomes — see `Row.marks`. */
type MarkBucket = {
  resolved: number; amb: number; unres: number; ext: number; bind: number
  /** BUCKET 3 — edges whose marker set declares a cause (`baseBeyondRunScope`). Its own count
   *  for the same reason bindings have one: it is neither a resolution nor a gap, and a reader
   *  choosing the next round needs to see HOW MUCH of the remainder rests on the analyzer's
   *  stated reason rather than on a resolution. */
  cause: number
}

/**
 * THE INTENT OF A BINDING — the exact test, beside the name-keyed count model.
 *
 * `resolvedAmongCollision` is an UPPER BOUND on arbitrary bindings: `classifyEdge` sees a
 * name-keyed count and no file, so it fires on "the PROJECT holds more than one declaration",
 * which is a superset of "the row production wrote is the wrong one". This is the exact test, and
 * it needs positions, which the gate now keeps: a declaration is `(file, line)` as well as a key.
 *
 *   intended            a declaration in the EDGE'S OWN FILE, on the edge's own line, answers to
 *                       the target. For `contains`/`exports` the analyzer writes the edge on the
 *                       target symbol's own start line, so the line test is EXACT: measured on
 *                       terragrunt-900, 1,075 of 1,075 same-file `exports` bindings were on their
 *                       own line and 0 were off it.
 *   sameFileUnproven    a declaration in the edge's own file, but not on the edge's line, OR the
 *                       type's edge line is the READ SITE and not the target's (`references`), so
 *                       intent is NOT measurable this way and this class must not be read as
 *                       "wrong" or as "right".
 *   arbitraryTwin       NOTHING IN THE EDGE'S OWN FILE answers to the name, but a declaration in
 *                       ANOTHER file does. THAT IS THE WHOLE PREDICATE — `classifyIntent` returns it
 *                       on `sameFile.length === 0` and asks no further question.
 *
 *                       THE CORRELATION THIS COMMENT USED TO ASSERT WAS WRONG, AND IT WAS THE
 *                       SENTENCE A READER WOULD ACT ON. It read: "— exactly when the store's `s.id`
 *                       tie-break (a TEXT comparison of `${fileId}:${name}:${line}`) picks a foreign
 *                       declaration." NO COLLISION IS REQUIRED. The tie-break is counted by a
 *                       DIFFERENT function over DIFFERENT inputs — `classifyEdge` produces the
 *                       OUTCOME that `resolvedAmongCollision`/`ofWhich` counts, while this tally comes
 *                       from `classifyIntent`; the one input they share is `ownFileDeclares`, which is
 *                       why line ~1119 can say the two "agree by construction".
 *
 *                       THE NAME IS THE RESIDUAL HAZARD AND IT IS NOT FIXED HERE. For a `references`
 *                       edge — deliberately absent from `LINE_IS_TARGET_LINE` because its line is the
 *                       READ SITE — this class means CROSS-FILE REFERENCE, which is neither arbitrary
 *                       nor a twin, and which is the NORMAL shape for that type. Measured on toml:
 *                       `references` reads arbitraryTwin 1,085 beside `ofWhich 0`, i.e. 1,085 ordinary
 *                       cross-file references and ZERO arbitration by the tie-break. A reader who
 *                       trusts the name reads 1,085 as a hazard, because "arbitrary" is exactly the word
 *                       the completion test's clause 4 uses for the class it wants at zero.
 *                       **BEFORE READING A NON-ZERO `arbitraryTwin` AS A DEFECT, CHECK `ofWhich`.** That
 *                       column is the tie-break; this one is not.
 *   noDeclaration       nothing in the project answers to it — the unresolved class.
 *
 * Validated against the STORE by validation/m14/fixtures/hcl/tools/store-binding-truth.mts, which
 * is the reference implementation: its own-file+own-line column is this class read off
 * `brain_relationship.target_symbol_id` instead of off the key space.
 */
type IntentTally = { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }
const emptyIntent = (): IntentTally => ({ intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 })
/** Types whose edge line IS the target symbol's own start line — the only ones where own-line is an
 *  intent test. `references` publishes the READ SITE, so it is deliberately absent. */
const LINE_IS_TARGET_LINE: ReadonlySet<string> = new Set(["contains", "exports"])
function classifyIntent(
  tgt: string,
  srcFile: string,
  line: number | null,
  label: string,
  declPos: Map<string, { file: string; line: number }[]>,
): keyof IntentTally {
  const decls = declPos.get(tgt)
  if (!decls || decls.length === 0) return "noDeclaration"
  const sameFile = decls.filter((d) => d.file === srcFile)
  if (sameFile.length === 0) return "arbitraryTwin"
  if (LINE_IS_TARGET_LINE.has(label) && line !== null && sameFile.some((d) => d.line === line)) return "intended"
  return "sameFileUnproven"
}

type Row = {
  type: Type
  edges: number
  /** resolution against the file's OWN PROJECT — what production does; the verdict's scope */
  project: Outcomes
  /** resolution against every file in this run pooled into one key space — the old number */
  pooled: Outcomes
  /** the PROJECT-scope outcome of every edge this type emitted, grouped by the sorted set of
   *  metadata KEYS it carries. KEYS ONLY, never values: the claim mechanism itself reads the
   *  KEY that marked an edge (`externalClaimOf`), and a value would shatter one marker into a
   *  signature per symbol it names (`firstHeritageParent=StatelessWidget` for one line).
   *  Printed as a worklist — WHICH markers the unwalkable edges carry, not merely how many. */
  marks: Map<string, MarkBucket>
  /** the EXACT intent of this type's bindings — see `classifyIntent`; beside the count model */
  intent: IntentTally
  /**
   * EDGES OF THIS TYPE THAT CARRIED NO TARGET AT ALL. They are COUNTED into `edges` (so the identity
   * against the table holds) but they cannot be classified by intent or resolved by any resolver —
   * they name nothing. Until this field existed they were counted and then `continue`d, which is what
   * left `INTENT CLOSURE` reporting "1 ROW DOES NOT CLOSE" (TS lane: references 1, extends 1) while
   * the gate's own identity held: the row was not missing a class from the CLASSIFIER, it was missing
   * a class from the GATE. An empty-target edge is a LANE DEFECT (the analyzer published a relationship
   * with no operand) and it is now counted, printed, and included in the closure sum so it can neither
   * hide in the edge count nor be mistaken for a resolution class.
   */
  noTarget: number
}

/**
 * THE PROJECT INDEX, and what `--index` really is.
 *
 * This gate used to walk the corpus file by file with NO context — `parseFile(f, dirname(f))`
 * — while `pool-worker.ts` `parse_batch` CAN deserialise a `ProjectIndex` the parent built and
 * hand `{ projectIndex }` to every parse. Two dart passes read it: the override pass resolves a
 * base declared in ANOTHER file of the same repository, and the expression pass gates which type
 * mentions it emits at all. So a no-context walk is not a measurement of the analyzer, it is a
 * measurement of a DEGRADED INVOCATION of it.
 *
 * WHERE PRODUCTION ACTUALLY STANDS, measured rather than assumed: `parallel-indexer.ts:1443`
 * sets `PROJECT_INDEX_EXTENSIONS = { ".sol": "solidity" }`, so a dart batch is parsed with NO
 * index and production's dart numbers today are the `--index`-LESS arm of this gate. `--index`
 * therefore measures an INDEX-ASSISTED population — the analyzer at full capability, resolved in
 * production's per-project scope — and it is the arm to compare against a future production that
 * builds the index, not against production as it runs now. The header of every report says which
 * arm it is, because a number is only comparable to one measured the same way.
 *
 * Measured on one repository (`validation/m14/fixtures/dart/project-index-effect.ts`,
 * dart-http, 333 files, same files and order, one process):
 *
 *     overrides   326 edges / 198 unresolved  ->  198 edges / 13 unresolved
 *     references  476 edges /   0 unresolved  -> 1227 edges /  0 unresolved
 *     TOTAL      18,598 edges / 7,914 unresolved -> 19,221 / 7,729
 *
 * The override edge COUNT falls because the cross-file index refutes fallbacks the per-file
 * walk had to guess at — fewer edges, and the ones that remain are the true externals. The
 * reference count RISES because the analyzer can see the types it is mentioning. Both
 * directions are the analyzer working as designed, which is why the index is opt-in here
 * rather than assumed: the two populations are different, and a number is only comparable
 * to another number measured the same way. The header says which one it is.
 */
/**
 * THE PER-LANGUAGE INDEX SPEC, AS A LOOKUP RATHER THAN A CHAIN OF TERNARIES.
 *
 * It used to be `lang === "dart" ? mod.DART_DECLARATION_SPEC : mod.SOLIDITY_DECLARATION_SPEC` at the
 * point of use, which is how the next language gets added wrongly: a chain has no place to say "this
 * language has no spec yet", so a new entry silently inherits Solidity's — and a spec that does not
 * match the grammar indexes the right SHAPE and holds NOTHING. MEASURED, protobuf, whole corpus (847
 * `.proto` files): the Solidity default yields **0 names and 0 types**, while the lane's own spec
 * yields 8,048. `spec` is a LAZY loader because the protobuf spec lives in that language's analyzer,
 * and a static import would pull the whole engine into this gate for a value used once.
 *
 * A language with an entry but NO `spec` falls back to Solidity exactly as before, which is what every
 * pre-existing entry did.
 */
const INDEX_SPECS: Record<string, { spec?: () => Promise<any>; wasm: string }> = {
  dart: { spec: async () => (await import("../../src/ast/project-index")).DART_DECLARATION_SPEC, wasm: "tree-sitter-dart/tree-sitter-dart.wasm" },
  protobuf: { spec: async () => (await import("../../src/ast/real-protobuf-analyzer")).PROTOBUF_DECLARATION_SPEC, wasm: "tree-sitter-protobuf.wasm" },
  // SCSS had NO entry, so `--index` built 0 indexes for the lane and the arm that exercises the
  // cross-file mechanism could not be produced: the gate reported `project index: USED — 0 repo
  // index(es) (0 built, 0 from cache, 0 damaged) over 0 file(s)` while production's
  // PROJECT_INDEX_EXTENSIONS already carried `.scss`. The spec lives in project-index.ts and is
  // exported as of this change.
  scss: { spec: async () => (await import("../../src/ast/project-index")).SCSS_DECLARATION_SPEC, wasm: "tree-sitter-scss.wasm" },
  // CLOJURE — the lane's own spec, in the shared index's clojure region (the java/dart precedent).
  // THE GATE HAD NO CLOJURE ENTRY, and `projectIndexesFor` returns ZERO indexes for a language with
  // no entry — so every recorded clojure arm was a NO-INDEX arm, and the 768 could not have been
  // asked of a project index. The spec answers 1 of the 768 (the probe's own arm); the other 767 are
  // accounted for by three reasons no index can reach. See CLOJURE-VERDICT-2026-10-20.md §4.
  clojure: { spec: async () => (await import("../../src/ast/project-index")).CLOJURE_DECLARATION_SPEC, wasm: "tree-sitter-clojure.wasm" },
  // SOLIDITY — the OPPOSITE of the cpp gap: production ALREADY builds this index (`PROJECT_INDEX_EXTENSIONS`
  // carries `.sol: "solidity"` and `parallel-indexer.ts` wires `SOLIDITY_DECLARATION_SPEC` + wasm),
  // and the analyzer CONSUMES it (SOL-21: 507 undecided kinds → 0, 99 mis-typed fixed, external
  // 1,677→190). This table had no entry, so `--index` would build 0 indexes and the arm that measures
  // the analyzer's real indexed behaviour could not be produced — a fake non-arm, unlike cpp where the
  // production list genuinely has no C++ spelling. Both halves are wired; the gate now measures them.
  solidity: { spec: async () => (await import("../../src/ast/project-index")).SOLIDITY_DECLARATION_SPEC, wasm: "tree-sitter-solidity.wasm" },
  // JAVA, and the spec is the point rather than the wasm: `JAVA_DECLARATION_SPEC` carries
  // `qualifyTypeWithFile`, which is what lets the analyzer decide whether an import is LOCAL —
  // a qualified lookup instead of the package-prefix heuristic that scored 0.84 precision.
  java: { spec: async () => (await import("../../src/ast/project-index")).JAVA_DECLARATION_SPEC, wasm: "tree-sitter-java.wasm" },
  // JAVASCRIPT — absent like `.scss` was, and with the same consequence: `--index` built 0 repo indexes
  // for the lane, so the arm that exercises its cross-file claim mechanism could not be produced. The
  // analyzer's module claims are fail-closed on `complete===true`, so this is the ONLY arm where the
  // JS claim columns can mean anything.
  javascript: { spec: async () => (await import("../../src/ast/project-index")).JAVASCRIPT_DECLARATION_SPEC, wasm: "tree-sitter-javascript/tree-sitter-javascript.wasm" },
  // TYPESCRIPT AND PYTHON. Both were wired in PRODUCTION (`parallel-indexer.ts` carries `.ts`/`.tsx` and
  // `.py` with their specs) while this table was missing them, so `--index` built 0 repo indexes and
  // parsed the analyzer with NO context -- the same instrument-gap shape as `.scss` above, where the gate
  // reported "0 repo index(es) over 0 file(s)" while production was already wired. The indexed arm
  // therefore could not be measured AT ALL, and a fix proven only by unit test is not measured.
  typescript: { spec: async () => (await import("../../src/ast/project-index")).TYPESCRIPT_DECLARATION_SPEC, wasm: "tree-sitter-typescript.wasm" },
  python: { spec: async () => (await import("../../src/ast/project-index")).PYTHON_DECLARATION_SPEC, wasm: "tree-sitter-python.wasm" },
  // FSHARP — ADDED 2026-10-20 (Lead). Production ALREADY builds this index: `PROJECT_INDEX_EXTENSIONS`
  // carries `.fs: "fsharp"` and `parallel-indexer.ts` wires `FSHARP_DECLARATION_SPEC` + the
  // `wasm/tree-sitter-fsharp.wasm` asset. This table had NO entry, so `--index` built 0 repo indexes
  // for the lane and the arm that measures the analyzer's real indexed behaviour could not be
  // produced — the SAME "fake non-arm" shape the `.scss` and `.solidity` notes above record, and
  // the gate's own output names the rule: "a language in that list with no INDEX_SPECS entry here is
  // a gap in THIS instrument, not in production". The fsharp baseline recorded in the ledger
  // (11,807 files / 26 repos / TOTAL 1,305,221 / vc 42.57%) is therefore a NO-INDEX number, and the
  // gate could not say so. With the entry present, the lane's indexed arm becomes measurable and
  // the difference between the two populations is a per-column pair (R1), not a guess.
  fsharp: { spec: async () => (await import("../../src/ast/project-index")).FSHARP_DECLARATION_SPEC, wasm: "tree-sitter-fsharp.wasm" },
  // CPP — the lane the index instrument was PROPOSED for. Its analyzer reads the project index only
  // behind BB_CPP_INDEX_CONSUME=1 (task-22), and the W1 wall's claim (`projectIndexDeclaration`,
  // task-24) is verified from the index's facts; without this entry `--index` builds 0 indexes for the
  // lane and the arm that exercises either mechanism cannot be produced at all.
  cpp: { spec: async () => (await import("../../src/ast/project-index")).CPP_DECLARATION_SPEC, wasm: "tree-sitter-cpp/tree-sitter-cpp.wasm" },
  // RUBY (task-22): the lane's index facts; without this entry `--index` builds 0 indexes for ruby and
  // the arm that exercises the consumption cannot be produced at all.
  ruby: { spec: async () => (await import("../../src/ast/project-index")).RUBY_DECLARATION_SPEC, wasm: "tree-sitter-ruby.wasm" },
  // VB (2026-10-28): absent like `.scss` and `.js` were, and with the same consequence — `--index` built
  // 0 indexes for the lane, so EVERY recorded vb arm was a per-file arm and the cross-file mechanism could
  // not be measured at all. MEASURED on the no-index arm: 325 rows whose target IS declared in the same
  // repository (imports 54 · uses 160 · calls 101 · references 3 · instantiates 2 · implements 5). The
  // spec is `VB_DECLARATION_SPEC`, read off the pinned vendored grammar's own declaration productions.
  vb: { spec: async () => (await import("../../src/ast/project-index")).VB_DECLARATION_SPEC, wasm: "tree-sitter-vbnet/tree-sitter-vbnet.wasm" },
}
const INDEX_CACHE = process.env.BB_INDEX_CACHE ?? "/tmp/bb-project-index"

/**
 * Build (or reuse) one index per repository, the unit production builds for.
 *
 * `whole` SAYS WHETHER `files` IS THE PROJECT'S WHOLE ADMITTED SET OR A STRIDE SAMPLE OF IT, and it is
 * stamped onto every index this returns as `ProjectIndex.complete`. It exists because of one measured
 * question a per-file analyzer cannot answer: **is this bare name external, or merely declared in a file
 * this run did not read?** Several lanes correctly refuse to publish "probably the platform type" without
 * the project key space; the key space now exists (`JAVA_DECLARATION_SPEC` and five siblings in
 * `src/ast/project-index.ts`), but an index built from a cap-400 sample of a 4,000-file repository is NOT
 * that project. A claim verified against the fragment is refuted the moment an unsampled sibling file
 * declares the name — which raises `extFAIL`, the column this fleet treats as must-not-rise. So the claim
 * may only be made when the index is whole, and the analyzer must read `complete === true`, never infer it.
 *
 * THE CACHE IS WHY THIS IS SET AFTER THE BRANCH RATHER THAN AT CONSTRUCTION: an index built by an earlier
 * WHOLE run is cached and can be reused by a SAMPLED one, so a payload's own `complete: true` would leak
 * across runs and let a sample vouch for a project it never read. The caller's `whole` is the authority,
 * so it overwrites whatever the cache said.
 */
/**
 * THE FILE SET'S IDENTITY — a sha256 over the SORTED paths.
 *
 * ★ IT EXISTS BECAUSE A COUNT IS NOT AN IDENTITY, AND THE DART LANE'S CHUNKED ARM FOUND IT. The
 * index cache was keyed on `repoFiles.length` and the newest mtime in the set. TWO DIFFERENT SLICES OF
 * THE SAME REPOSITORY HAVE THE SAME COUNT AND, VERY OFTEN, THE SAME NEWEST MTIME — so chunk 5 of a
 * repository was served chunk 3's index, and a population arm would have measured a MIXTURE of
 * slices while every chunk reported itself as indexed. ⇒ THE IDENTITY IS THE FILE SET, so it is
 * digested. Cheap next to parsing the files, and exact for the thing the cache holds.
 */
function sha256Of(paths: string[]): string {
  const h = createHash("sha256")
  for (const p of [...paths].sort()) { h.update(p); h.update("\u0000") }
  return h.digest("hex")
}

async function projectIndexesFor(
  lang: string, files: string[], whole: boolean,
): Promise<{ byRepo: Map<string, any>; built: number; cached: number; damaged: number; indexed: number }> {
  const byRepo = new Map<string, any>()
  const entry = INDEX_SPECS[lang]
  if (!entry) return { byRepo, built: 0, cached: 0, damaged: 0, indexed: 0 }
  const mod: any = await import("../../src/ast/project-index")
  // ONE LOOKUP, and an entry with no loader keeps Solidity's spec exactly as before.
  const spec = entry.spec === undefined ? mod.SOLIDITY_DECLARATION_SPEC : await entry.spec()
  const { resolveWasmAsset } = await import("../../src/util/wasm")
  const wasm = resolveWasmAsset(entry.wasm)
  const perRepo = new Map<string, string[]>()
  for (const f of files) {
    const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
    const repo = path.join(CR, rel.split(path.sep)[0])
    if (!perRepo.has(repo)) perRepo.set(repo, [])
    perRepo.get(repo)!.push(f)
  }
  let built = 0
  let cached = 0
  let damaged = 0
  let indexed = 0
  mkdirSync(INDEX_CACHE, { recursive: true })
  for (const [repo, repoFiles] of perRepo) {
    // A cache is keyed on the file set AND the newest mtime in it. A count alone would
    // return yesterday's index for a repository that edited a file in place, which is the
    // one case where a stale index silently changes an answer instead of failing.
    let newest = 0
    for (const f of repoFiles) { try { newest = Math.max(newest, statSync(f).mtimeMs) } catch { /* counted by the gate */ } }
    // ★★ THE FILE SET'S IDENTITY, NOT ITS COUNT — AND THE COUNT WAS A DEFECT THE DART LANE'S CHUNKED
    // ARM FOUND. The cache was keyed on `repoFiles.length` and the newest mtime in the set. TWO
    // DIFFERENT SLICES OF THE SAME REPOSITORY HAVE THE SAME COUNT AND, VERY OFTEN, THE SAME NEWEST
    // MTIME — the repository's newest file lands in one slice and the max over a different slice can
    // be the same file. ⇒ SO CHUNK 5 OF A REPOSITORY WAS SERVED CHUNK 3'S INDEX, and the population
    // arm would have measured a MIXTURE of slices while every chunk reported itself as indexed.
    // ⇒ A COUNT IS NOT AN IDENTITY. The identity is the FILE SET, so it is digested: a sha256 over
    // the SORTED paths, which is cheap next to parsing them and is exact for the thing the cache
    // actually holds.
    const fileSetDigest = sha256Of(repoFiles)
    // ★ THE PATH CARRIES THE DIGEST TOO, or a slice's index OVERWRITES the whole repository's index
    // and the next whole-repo run reads a SLICE back — the mirror of the defect above, and just as
    // silent. The path is built AFTER the digest is known, so the file name names the FILE SET it
    // holds.
    const cachePath = path.join(INDEX_CACHE, `${lang}-${path.basename(repo)}-${fileSetDigest.slice(0, 16)}.json`)
    try {
      const raw = JSON.parse(readFileSync(cachePath, "utf8"))
      if (raw?.files === repoFiles.length && raw?.newest === newest && raw?.fileSetDigest === fileSetDigest) {
        const back = mod.deserializeProjectIndex(raw.index)
        if (back !== null) {
          // THE CALLER'S `whole` WINS OVER THE PAYLOAD'S OWN FLAG. A whole-run index reused by a sampled
          // run must NOT claim to be the project it was built from.
          back.complete = whole === true
          byRepo.set(repo, back); cached++; indexed += raw.files; continue
        }
      }
    } catch { /* no usable cache: build below */ }
    const index = await mod.buildProjectIndexStreaming(wasm, repoFiles, spec)
    damaged += index.stats.damaged
    indexed += index.stats.files
    // The builder never states completeness (it cannot see the run); the caller does.
    index.complete = whole === true
    byRepo.set(repo, index)
    built++
    try {
      writeFileSync(cachePath, JSON.stringify({
        files: repoFiles.length, newest, fileSetDigest, index: mod.serializeProjectIndex(index),
      }))
    } catch { /* a cache that cannot be written is not a failed measurement */ }
  }
  return { byRepo, built, cached, damaged, indexed }
}

async function measure(lang: string, ext: string, maxFiles: number, useIndex: boolean, onlyRepos?: Set<string>) {
  // `yaml,yml` → ["yaml","yml"]; a bare `yaml` keeps its exact old meaning, so no existing
  // invocation changes population. The admitted set travels into the report and is printed.
  const exts = ext.split(",").map((e) => e.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
  const { files, admitted, total, repos, absent, overCap, overCapLargest, sliceStart, sliceEnd } = discoverFiles(lang, ext, exts, maxFiles, onlyRepos, OFFSET, HAS_OFFSET)
  // OPT-IN DISCOVERY DISCLOSURE (task-86). Form chosen deliberately: AN ENV VAR, printing to STDERR and exiting
  // BEFORE any parsing — so it cannot alter any existing consumer's stdout, table, numbers or exit code, and it is
  // fast because it stops at discovery. It closes the tooling gap that kept CAUSE 2 open: the runner's own file set
  // was previously unobtainable, so a file marked by another instrument could not be checked against it by name.
  if (process.env.BB_LIST_FILES) {
    console.error(`BB_LIST_FILES: lane=${lang} ext="${ext}" discovered=${files.length} total=${total} repos=${Array.isArray(repos) ? repos.length : String(repos)}`)
    for (const f of files) console.error(`BB_LIST_FILES_FILE: ${f}`)
    process.exit(0)
  }

  // name -> how many DECLARATIONS publish it, and the distinct kinds among them.
  // Both, because the whole point of this gate is that the kind-count is not the
  // declaration-count and a reader must never have to guess which one they are reading.
  //
  // TWO key spaces, filled from the same symbol loop. `pooled` is every file this run
  // parsed; `project` is the repository the file belongs to. Which one the verdict uses is
  // not a preference — see `PROJECT SCOPE, and why the verdict is scoped`.
  const pooledDecl = new Map<string, number>()
  const pooledKinds = new Map<string, Set<string>>()
  const projectDecl = new Map<string, Map<string, number>>()
  /**
   * A CASE-INSENSITIVE LANGUAGE'S NAME SPACE, FOLDED — the language's convention, not the store's.
   *
   * `$obj.Count` and a declaration `[int]$count` are ONE binding in PowerShell and two keys here, and
   * the analyzer can only fold the ones in its own file (PSD20: 2,259 rows). The rest need the
   * PROJECT's key space, which only this instrument holds: per repo, lowercased name → how many
   * declarations carry it and the single spelling if there is exactly one.
   *
   * ONE-WAY BY CONSTRUCTION. A fold is consulted ONLY where the exact key has no declaration, and
   * only when the folded key names EXACTLY ONE declaration — so it can turn `unresolved` into
   * `resolved` and can never refute, never make an ambiguous row ambiguous for a new reason, and
   * never move a row whose exact spelling is declared.
   */
  const projectFolded = new Map<string, Map<string, { count: number; spelling: string | null }>>()
  /** The languages whose identifiers are case-insensitive. Opt-in per lane: a language that is not
   *  listed here reads byte-identical numbers. */
  const CASE_INSENSITIVE_LANGUAGES = new Set(["powershell"])
  /**
   * THE FILE's NAMESPACE, from the ANALYZER's own `(ns …)` MODULE SYMBOL — the symbol whose
   * NAME is the namespace the analyzer saw at that form.
   *
   * WHY THIS SOURCE AND NOT THE PER-SYMBOL `scope`: the namespace is NOT a file-level fact. A file
   * may declare SEVERAL (`in-ns` switches the namespace mid-file), the analyzer's `scope` is derived
   * from a RUNNING value, and for the nested type forms it is a DOT-qualified nested name
   * (`clojure.core.VecNode`) rather than a namespace at all. The `(ns …)` module symbol carries
   * the namespace exactly, and the FIRST one in the file is the file's FIRST namespace form —
   * which is what the production's own `clojureFileNamespace` returns.
   *
   * A file that declares no namespace at all has NO entry here, and the join then answers nothing
   * for it — the row is left exactly as it was.
   */
  const nsByFile = new Map<string, string>()
  /**
   * THE QUALIFIED-NAME JOIN, COMPUTED WHERE THE KEY SPACES ARE.
   *
   * THE SHAPE TEST IS "THE TARGET CONTAINS A `/`" — a target that is already qualified IS its own
   * qualification, and a bare target is qualified by ITS FILE's namespace. (A join gated on "the
   * target is bare" would answer ONE row instead of 841 — MEASURED.)
   *
   * `count` is read from the gate's OWN `projectDecl` map — the same map the name model uses —
   * so the answer is a lookup, not a second count and not a second key space.
   */
  const qualifiedJoinFor = (
    repo: string, target: string, file: string | undefined,
  ): { qualified: string; count: number; branch: "slash" | "namespace" } | undefined => {
    let qualified: string
    // THE BRANCH, NAMED, BECAUSE A COUNT OF ZERO IS ONLY MEANINGFUL WITH THE BRANCH IT CAME FROM.
    //  "slash"     — the target ALREADY carries a `/`: it is its own qualification, and the key
    //                space is asked for that exact spelling.
    //  "namespace" — the target is BARE, and the file's namespace qualifies it: the key space is
    //                asked for `ns/target`. A file that declares no module-kind symbol (the
    //                `(ns …)` form is the fleet's one) cannot be asked at all, and the row is left
    //                exactly as it was.
    const branch: "slash" | "namespace" = target.includes("/") ? "slash" : "namespace"
    if (branch === "slash") {
      qualified = target
    } else {
      if (file === undefined) return undefined
      const ns = nsByFile.get(file)
      if (ns === undefined || ns === "") return undefined
      qualified = `${ns}/${target}`
    }
    const count = projectDecl.get(repo)?.get(qualified) ?? 0
    return { qualified, count, branch }
  }
  const projectKinds = new Map<string, Map<string, Set<string>>>()
  /**
   * THE SYMBOLS THE OWNER CHANNEL NEEDS, per project — kept as a COMPACT record per relevant symbol,
   * not per symbol: only class-like declarations (owner identity + heritage), symbols carrying an
   * owner (members) and symbols with a heritage payload are retained, so a whole-corpus run does not
   * pay an object per parsed symbol. The pass's rule is in script/m14/owner-channel.ts; the pools are
   * built AFTER the walk, in the deferred classification pass, where the key space is complete.
   */
  const projectOwnerRecords = new Map<string, OwnerSymbolRecord[]>()
  /** project -> key -> the set of NON-EMPTY qualifiedNames answering to it (`--binding-collapse`) */
  const projectBindSet = new Map<string, Map<string, Set<string>>>()
  /** project -> key -> how many of the key's declarations carry a qualifiedName at all */
  const projectBindQual = new Map<string, Map<string, number>>()
  /**
   * project -> key -> EVERY declaration's (kind, genuine qualifiedName). The binding collapse only
   * needs counts, but the `implements` class-like rule needs the KIND of each declaration: the key
   * `toString` answers 2 class declarations AND 38 members, and a count can say "40" while being
   * unable to say that the two classes are one entity and the 38 members are what the instances
   * themselves published. Compact on purpose (two short strings per declaration), and only the
   * project scope keeps it — the pooled scope is a diagnostic. */
  const projectDeclFacts = new Map<string, Map<string, { kind: string; qual: string }[]>>()
  const rows = new Map<Type, Row>()
  // FALLBACK ROWS, counted separately and NEVER folded into the columns above.
  //
  // `pool-worker.ts` emits relationships from `extractFallback()` — regex extraction used when a
  // file's parse fails — carrying `metadata: { line, method: "regex" }` (`:372`, `:388`, `:414`).
  // Those rows are NOT the analyzer's edges: they come from a different instrument, they are a
  // property of the RUN (how many files aborted under load) rather than of the language, and a
  // fallback row rarely resolves — so counting them INFLATES the residual and DEFLATES every rate.
  //
  // Found by markdown-lane, which followed ontology-coverage-gate.ts:945-956's `DEGRADED (regex
  // fallback, not the analyzer)` and measured 5,452 of its 15,525 residual as fallback rows
  // (`calls` 5,528 + `instantiates` 399) on a lane whose analyzer emits NEITHER type and whose
  // sequential census read `calls 0 · instantiates 0 · 0 degraded` — while this gate's own run
  // logged 9,057 `Aborted()` wasm parse errors and silently retried.
  //
  // THIS IS A SEPARATE MAP ON PURPOSE. `residual-gate.ts` parses TABLE 1 POSITIONALLY, so inserting
  // a column would shift every field after it — the exact defect fixed in `05bf9953d` and
  // `085317cea`. The count is therefore reported in its own block, and the columns above keep both
  // their order and their meaning: they are the ALL-IN figure, and the block states how much of it
  // is a different instrument's.
  const fallbackRows = new Map<Type, number>()
  for (const t of ALL_TYPES) {
    rows.set(t, { type: t, edges: 0, project: emptyOutcomes(), pooled: emptyOutcomes(), marks: new Map(), intent: emptyIntent(), noTarget: 0 })
  }

  let parsed = 0
  let failed = 0
  let degraded = 0
  const degradedFiles: string[] = []
  // Files whose result carried NOTHING — possibly a timeout (see the note at `parsed++`), possibly
  // genuinely empty. Reported, never silently counted as evidence.
  const emptyResults: string[] = []
  /** how many qualified-name aliases were indexed — printed, so the reader knows the
   *  endpoint population is name + qualifiedName and not name alone. */
  let aliasedKeys = 0

  // Built BEFORE the walk, because production's index is built before its batch runs too.
  // `maxFiles <= 0` is the gate's "no cap" form: `discoverFiles` strides only when a cap is set, so
      // this is exactly the condition under which `files` is the whole admitted population.
      const indexInfo = useIndex ? await projectIndexesFor(lang, files, maxFiles <= 0) : null
  const repoOf = (f: string): string => {
    const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
    return path.join(CR, rel.split(path.sep)[0])
  }

  // THE EVIDENCE FOR AN IMPORT CLAIM, built once per repository and ONLY for a lane whose
  // analyzer makes that claim (`importOutsideProject`). Built from the UNSAMPLED admitted
  // list, because "is this path in the project?" is a fact about the project, not about
  // how many files this run had budget for.
  const projectFacts: Map<string, ProjectFacts> | null = await (async () => {
    const admittedByRepo = new Map<string, string[]>()
    for (const f of admitted) {
      const repo = repoOf(f)
      const list = admittedByRepo.get(repo)
      if (list) list.push(f)
      else admittedByRepo.set(repo, [f])
    }
    // TWO FACT BUILDERS, ONE PER QUESTION. Dart's `imports` name packages and SDK libraries, so
    // its facts come from walking the checkout for `pubspec.yaml` files; a lane whose imports
    // name FILES (yaml's `!include`) needs only the admitted list, which costs a `path.relative`
    // per file and no walk at all. Until 2026-10-09 this returned `null` for every lane but dart,
    // so a file claim from any other lane could only ever be UNVERIFIABLE — which blocks a PASS
    // — and that is the shape the yaml lane hit with two `!include` edges it was right about.
    const out = new Map<string, ProjectFacts>()
    for (const [repo, list] of admittedByRepo) {
      out.set(repo, ext.toLowerCase() === "dart" ? projectFactsForDart(repo, list) : await projectFactsForFiles(repo, list))
    }
    return out
  })()

  // ==========================================================================================
  // THE KEY SPACE MUST BE COMPLETE BEFORE ANY EDGE IS CLASSIFIED.
  //
  // This loop used to classify each edge AS IT STREAMED, against whatever part of the key
  // space had been parsed so far. Measured on `dart-http` (one whole project, 333 files, both
  // revisions, same edges, same key space, two-pass probe vs this gate):
  //
  //     imports+exports edges in the key space : 713 of 1406   (two passes, complete space)
  //     the same edges as this gate counted   : 384 of 1406   (one pass, streaming space)
  //
  // 329 edges — 46 % of the resolvable ones — read as unresolved because their target file
  // happened to sort AFTER the file that imports it. That is not a property of the code being
  // measured; it is a property of this file's loop order. Production cannot have it:
  // `parallel-indexer.resolveRelationships` runs as a pass over the finished `symbols` table
  // (`WHERE s.project_id = ?`), so every key of the project is in scope for every edge of it.
  //
  // The direction of the error is what makes it worth this much comment: the gate under-
  // reported resolution — it printed a WORSE number than the truth — so a lane reading the
  // table would chase gaps that do not exist, and a whole-corpus arm would publish them.
  //
  // The fix keeps the streaming parse (re-parsing to get two passes measured at 2× a 70-minute
  // run) and defers only the CLASSIFICATION: each edge is reduced here to the fields the
  // decision needs — target, claim, marker signature, project — and classified after the walk,
  // against both key spaces complete. The separator tripwire below already worked this way for
  // the same reason; it was the table that had not been brought in line with it.
  type PendingEdge = {
    label: Type
    tgt: string
    claim: ExternalClaim | null
    /**
     * THE RECEIVER'S CLASS, when the analyzer recorded one (`metadata.owner`) — the existing key
     * production's owner channel reads (`claimOwnerCarryingTargets`). It travels with the edge and is
     * resolved AFTER the walk, against the complete owner pool, because the channel is a
     * project-scoped rule and classifying it during the walk would measure a half-built key space.
     */
    owner: string | null
    /** the marker-set signature, interned in `row.marks` at push time so the diagnostic and
     *  the classification cannot disagree about which marker set an edge belongs to */
    sig: string
    /** the PROJECT the edge was emitted in — the key space that decides its outcome */
    repo: string
    /** the FILE the edge was emitted from and its own line — the exact intent test's two inputs */
    srcFile: string
    line: number | null
    /**
     * THE ANALYZER's OWN BIND REASON - `metadata.bindReason` on the relationship, carried VERBATIM.
     * THIS IS THE BINDING VOCABULARY: it answers "WHY COULD THE ARBITER NOT BIND THIS TARGET", and
     * it is the field that can NAME a wall row. THE GO LANE MEASURED WHY IT IS ITS OWN FIELD: every
     * one of the 3,820 wall rows that carried no `reasonCode` was confidence 1.0, and the go
     * analyzer's reasonCode loop skips `conf >= 1.0` (a confidence-1.0 row must carry NO code - the
     * invariant script/m14/go9-census.ts checks). So a bind reason carried in the reasonCode field
     * would either be empty on exactly the rows that need naming, or would break the analyzer's own
     * invariant.
     *
     * DUMP FIELD INDEX 7 - the position `script/m14/go-wall-census.ts` ALREADY READS. That reader was
     * written BEFORE the column existed; this column is the one that makes its contract true.
     */
    bindReason: string
    /**
     * THE ANALYZER's OWN CONFIDENCE REASON - `metadata.reasonCode` on the relationship, carried
     * VERBATIM. THIS IS A DIFFERENT QUESTION FROM THE BIND REASON: it answers "WHY IS THIS EDGE
     * SUB-1.0", not "why could the arbiter not bind the target". ONE VOCABULARY, TWO QUESTIONS, TWO
     * FIELDS, TWO POSITIONS - they are never collapsed into one column, because a collapsed column
     * forces the reader to guess which question a value answers.
     *
     * DUMP FIELD INDEX 8.
     */
    reasonCode: string
  }
  const pending: PendingEdge[] = []
  /** file -> specifier -> local names bound, from the run's own IMPORT edges. The evidence the
   *  imported-binding claim is verified against (charter §18.10). */
  const importEvidence = new Map<string, Map<string, Map<string, Set<string>>>>()
  /** WHERE each declaration lives — see `classifyIntent`. Filled by `countKey` in both key spaces. */
  const declPos = new Map<string, { file: string; line: number }[]>()


  // PROGRESS ON STDERR, because a whole-corpus run is hours and a run whose only output is
  // its last line cannot be told apart from a wedged one. stdout stays exactly the report:
  // every consumer of this gate reads stdout and the exit code.
  const PROGRESS_EVERY = 2000
  const t0 = Date.now()

  for (const f of files) {
    // ── PER-FILE WALL TIMER (BB_GATE_SLOW_MS). DIAGNOSTIC ONLY; silent unless asked. ──────────────
    // MEASURED 2026-10-23: dart-sdk's admitted offset 17,656 (`tests/corelib/regexp/
    // ranges-and-escaped-hyphens_test.dart`, 4,068 B) makes this run produce NOTHING for over nine
    // minutes, while the grammar parses it in 13 ms, `RealDartAnalyzer.analyze` runs it in 214-349 ms,
    // and `pool-worker.parseFile` — THIS gate's own parse path — returns in 527 ms. So the cost is in
    // the per-file work BELOW this line, not in the parse. This timer names the file and the phase
    // boundary without changing behaviour: it is silent unless BB_GATE_SLOW_MS is set.
    const __slowMs = Number(process.env.BB_GATE_SLOW_MS ?? "0")
    const __fileStart = Date.now()
    if (parsed > 0 && parsed % PROGRESS_EVERY === 0) {
      process.stderr.write(
        `  … ${parsed}/${files.length} parsed (${failed} failed, ${degraded} degraded) ` +
        `${Math.round((Date.now() - t0) / 1000)}s — ${path.basename(f)}\n`,
      )
    }
    let r: any
    try {
      // M60 yaml lane (2026-10-09): the population is fed the file's PROJECT ROOT, not its
      // own directory. Two reasons, and the second is the one that forced it:
      //
      //   * this gate resolves every endpoint against "the file's OWN PROJECT (production's
      //     scope)" and groups files by repository, so `repoOf(f)` IS the project the
      //     verdict is about. Handing the analyzer `dirname(f)` described a project the
      //     gate does not measure;
      //   * a file-scoped identity needs the root to be computed AT ALL. With no root a
      //     lane can only fall back to the filesystem basename, which is the collision this
      //     gate counts — so an unrooted population would measure the defect and not the
      //     fix, on the same input.
      const idx = indexInfo?.byRepo.get(repoOf(f))
      r = idx === undefined
        ? await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
        : await parseFile(f, repoOf(f), { projectIndex: idx, projectRoot: repoOf(f) } as any)
    } catch {
      failed++
      continue
    }
    if (!r) {
      failed++
      continue
    }
    parsed++
    if (__slowMs > 0) {
      const __elapsed = Date.now() - __fileStart
      if (__elapsed >= __slowMs) {
        process.stderr.write(`  SLOW FILE ${__elapsed} ms after parse: ${f}\n`)
      }
    }
    // THE POPULATION HOLE, counted because it is otherwise INVISIBLE.
    //
    // `engine.ts:1991` is the analyzer-timeout path and it returns
    // `{ language, symbols: [], relationships: [], … }` — an EMPTY result, not an error. So a
    // timed-out file neither fails nor degrades: it reaches `parsed++` above and contributes
    // **NO EDGES AT ALL**. Every count stays internally consistent and describes an INCOMPLETE
    // population, which is the opposite failure from the regex fallback —
    //   * regex fallback (`pool-worker.ts` `extractFallback`) EMITS ROWS -> INFLATES the residual;
    //   * basic parse result (`engine.ts:1991`, on timeout) EMITS NOTHING -> DEFLATES the population.
    // — and the second is the more dangerous because there is nothing in the columns to catch.
    //
    // Found when toml-lane reported 2 analyzer timeouts in 4,386 files that returned a basic parse
    // result: "the coverage gate draws that line; the residual gate does not." It still does not
    // REFUSE on this (a genuinely empty file is legitimate), so it is REPORTED with the count and
    // the file names, and the reader decides.
    if (r.symbols.length === 0 && r.relationships.length === 0 && f !== undefined) {
      emptyResults.push(String(f))
    }
    // A degraded parse substitutes a regex extractor whose symbols carry no `kind` and
    // whose edges sit below 0.7 confidence. Counting it publishes a number about the
    // fallback, not about the analyzer — so it is named and the run is REFUSED (exit 1).
    // TWO crash signatures, and only one of them is a `fallback` field:
    //   - a WASM trap      -> `pool-worker`'s catch -> `extractFallback`, `fallback: true`
    //   - the analyzer dying (a 120 s crossing, or a blown JS stack) -> `engine.ts` returns
    //     `metadata.analysisVersion: "2.0-basic-fallback"` with 0 symbols and NO `fallback`.
    // Measured 2026-10-07 on the dart corpus: both deep_nesting_*_test.dart files take the
    // second path (`Maximum call stack size exceeded`). Counting them as parsed would let
    // this gate PASS on a population that includes files no analyzer ever read — and this
    // gate's whole purpose is that a PASS means "over THIS population".
    if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") {
      degraded++
      degradedFiles.push(f)
    }

    const repo = repoOf(f)
    let pDecl = projectDecl.get(repo)
    if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
    let pKinds = projectKinds.get(repo)
    if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
    // the binding-collapse evidence: which qualifiedNames answer to a key, and how many of the key's
    // declarations carry one at all (see BINDING_COLLAPSE)
    let pBindSet = projectBindSet.get(repo)
    if (!pBindSet) projectBindSet.set(repo, (pBindSet = new Map()))
    let pBindQual = projectBindQual.get(repo)
    if (!pBindQual) projectBindQual.set(repo, (pBindQual = new Map()))
    let pDeclFacts = projectDeclFacts.get(repo)
    if (!pDeclFacts) projectDeclFacts.set(repo, (pDeclFacts = new Map()))
    let pFold = projectFolded.get(repo)
    if (!pFold) projectFolded.set(repo, (pFold = new Map()))
    /** the same increment in both key spaces, so a symbol can never be counted in one only.
     *  ALSO records WHERE the declaration lives: the exact intent test needs (file, line), and a
     *  count cannot answer "is the declaration the edge meant in the edge's own file?". */
    const countKey = (key: string, kind: string, file: string, line: number | null, bindingOf: string) => {
      const at = declPos.get(key)
      const pos = { file, line: line ?? -1 }
      if (!at) declPos.set(key, [pos])
      else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
      pooledDecl.set(key, (pooledDecl.get(key) ?? 0) + 1)
      let ps = pooledKinds.get(key)
      if (!ps) pooledKinds.set(key, (ps = new Set()))
      ps.add(kind)
      pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
      let keyFacts = pDeclFacts!.get(key)
      if (!keyFacts) pDeclFacts!.set(key, (keyFacts = []))
      keyFacts.push({ kind, qual: bindingOf })
      let qs = pKinds!.get(key)
      if (!qs) pKinds!.set(key, (qs = new Set()))
      qs.add(kind)
      {
        const folded = pFold!.get(key.toLowerCase())
        if (!folded) pFold!.set(key.toLowerCase(), { count: 1, spelling: key })
        else {
          folded.count++
          if (folded.spelling !== key) folded.spelling = null
        }
      }
      if (bindingOf) {
        let bs = pBindSet!.get(key)
        if (!bs) pBindSet!.set(key, (bs = new Set()))
        bs.add(bindingOf)
        pBindQual!.set(key, (pBindQual!.get(key) ?? 0) + 1)
      }
    }

    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const symKind = String(s?.kind ?? "")
      const symLine = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
      // read BEFORE the key is counted: `--binding-collapse` needs to know, per declaration, whether
      // this symbol carries a qualifiedName at all
      const symQual = String((s as any)?.qualifiedName ?? "")
      // A QUALIFICATION, NOT A FALLBACK. `pool-worker.ts:1228` normalises every symbol to
      // `qualifiedName: s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : s.name)`
      // — so a FILE-SCOPE declaration arrives with `qualifiedName === name`, which is non-empty and
      // says nothing about a binding. Testing only "non-empty" let the name-coincidence class through
      // and collapsed 30,190 edges when the method-table class is a small fraction of that; the
      // requirement is a spelling that actually QUALIFIES, so it must differ from the symbol's name.
      const genuineQual = symQual && symQual !== name ? symQual : ""
      countKey(name, symKind, f, symLine, genuineQual)

      // THE FILE's NAMESPACE — the ANALYZER's `(ns …)` MODULE SYMBOL's NAME. The FIRST module symbol
      // in the file is the file's FIRST namespace form ✓✓. `Module = "module"` in the engine's
      // `SymbolKind`, so the kind string is compared case-insensitively, as the probe does.
      if (symKind.toLowerCase() === "module" && !nsByFile.has(f)) {
        nsByFile.set(f, name)
      }

      // THE QUALIFIED-NAME ALIAS, and this gate's first version omitted it — which is
      // worth recording, because the omission did not produce a small error. It produced
      // `json 22,153 unresolved` against a fleet measurement of `json 0 unresolved`, and
      // the whole table looked like a finding about twenty-three languages when it was a
      // finding about one line of this file.
      //
      // Why it matters: a lane that publishes a file-scoped `qualifiedName` and targets
      // that path (`json` does exactly this — `target: String(symbol.qualifiedName ||
      // symbol.name)`, real-json-analyzer.ts:703-745) emits endpoints that are NOT any
      // symbol's `name`. Keyed on `name` alone, every one of them reads unresolved.
      //
      // Counted as the SAME declaration, not a second one: a symbol's `qualifiedName` is
      // another spelling of that symbol, so incrementing both keys keeps the
      // declaration-count honest. This is also what `incoming-check.ts:182-188` does,
      // which is why its json row reads 0.
      const q = symQual
      if (q.length > 0 && q !== name) {
        countKey(q, symKind, f, symLine, q)
        aliasedKeys++
      }

      // THE OWNER CHANNEL'S SYMBOLS, collected for the deferred classification pass. Only what the
      // rule in script/m14/owner-channel.ts reads is kept: class-like declarations (owner identity
      // and heritage), symbols carrying an owner (members), and symbols with a heritage payload.
      // Collected in the same loop as the name key spaces so a symbol can never be counted in one and
      // missing from the other.
      const symOwner = String((s as any)?.ownerName ?? (s as any)?.scope ?? "").trim()
      const symSuperTypes = Array.isArray((s as any)?.superTypes)
        ? ((s as any).superTypes as unknown[])
        : Array.isArray((s as any)?.metadata?.superTypes)
          ? ((s as any).metadata.superTypes as unknown[])
          : []
      const symSupers = symSuperTypes.filter((x): x is string => typeof x === "string" && x.length > 0)
      if (OWNER_CLASS_LIKE.has(symKind) || symOwner.length > 0 || symSupers.length > 0) {
        const symEndLine = Number((s as any)?.range?.endLine ?? (s as any)?.endLine ?? (s as any)?.line_end ?? 0) || (symLine ?? 0)
        let ownerRecords = projectOwnerRecords.get(repo)
        if (!ownerRecords) projectOwnerRecords.set(repo, (ownerRecords = []))
        ownerRecords.push({
          file: f,
          name,
          kind: symKind,
          line: symLine ?? 0,
          endLine: symEndLine,
          ownerName: symOwner.length > 0 ? symOwner : null,
          superTypes: symSupers,
        })
      }
    }

    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const row = rows.get(label)!
      row.edges++
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) {
        // Counted above and COUNTED HERE — the class the intent table was missing. See Row.noTarget.
        //
        // ★ AND IT LANDS IN `unres`, BECAUSE THE CLOSURE HAS TO ADD UP. MEASURED 2026-10-23: the
        // typescript arm reported `contains` at 94,114 edges against 94,113 in its buckets — ONE
        // EDGE SHORT, and the row carrying it also carried the largest `collRes` in the fleet. The
        // missing edge was an edge with NO TARGET: it was counted in `edges`, counted again in
        // `noTarget`, and then `continue`d PAST every resolution bucket, so it existed in the total
        // and in no part of it.
        //
        // ⇒ AN EDGE WITH NOTHING TO RESOLVE IS UNRESOLVED — that is what the word means, and it is
        // the honest bucket rather than a fourteenth term nobody reads. `noTarget` survives as a
        // SUB-COUNT beside it, exactly like `amb(kind)` and `collRes` survive beside their parents:
        // reported, never added twice. THE CLOSURE IS NOW `edges = resolved + amb + unres + ext +
        // bind` WITH NOTHING OUTSIDE IT, and `noTarget` says how much of `unres` has no target at all.
        row.noTarget++
        row.project.unresolved++
        row.pooled.unresolved++
        continue
      }
      const claim = externalClaimOf(rel)
      // A `projectFacts` claim is verified against the PROJECT'S OWN files, which this file
      // builds and the analyzer never sees — the claim and its evidence must not come from
      // the same author, or "verified" would mean "the analyzer said so twice".
      // WHICH MARKERS AN EDGE CARRIES, counted by KEY. This is the same unit the claim
      // mechanism reads — `externalClaimOf` decides from the KEY that marked an edge, not from
      // the shape of its target — so the table it feeds is a worklist of markers a rule could
      // act on, not a second opinion about the counts above.
      // The row is still COUNTED above — this only records how much of that count is not the
      // analyzer's. Excluding it silently would be worse than counting it: a reader could no longer
      // reproduce the published figure.
      if (String((rel as any)?.metadata?.method ?? "") === "regex") {
        fallbackRows.set(label, (fallbackRows.get(label) ?? 0) + 1)
      }
      const md = (rel as any)?.metadata ?? {}
      const markKeys = Object.keys(md).filter(
        (k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null,
      )
      markKeys.sort()
      const sig = markKeys.length ? markKeys.join("+") : "(no marker)"
      if (!row.marks.has(sig)) row.marks.set(sig, { resolved: 0, amb: 0, unres: 0, ext: 0, bind: 0, cause: 0 })
      // DEFERRED, not classified here — see `PendingEdge`. The three fields that decide the
      // outcome travel with the edge; everything else (the counts, the marks, the name lists)
      // is written in the classification pass below, so no column can be filled from a
      // half-built key space even by accident.
      // IMPORTED-BINDING EVIDENCE: the analyzer publishes, on every IMPORT edge, the local names
      // that import binds (`metadata.importedBindings`). The arbiter verifies an `importedBinding`
      // claim against THIS map, not against the use edge's own word.
      if (label === "imports") {
        const relMdEarly = (rel as any)?.metadata
        const names = Array.isArray(relMdEarly?.importedBindings) ? relMdEarly.importedBindings : null
        // THE IMPORTED-NAME EVIDENCE rides the same module→names map: an imports edge's target is
        // `module:item` in most lanes, so the ITEM is a name this file imports (python `typing:Optional`,
        // dart `dart:core:Object`, c++ qualified rows). Recorded whether or not the lane publishes
        // importedBindings, so the imported-name claim has evidence in every lane that spells items.
        const itemMatch = tgt.lastIndexOf(":")
        const tgtItem = itemMatch > 0 && itemMatch < tgt.length - 1 ? tgt.slice(itemMatch + 1) : ""
        // THE ALIAS THE IMPORT BINDS — `from a import b as c` binds `c`, and this map holds only the
        // ITEM `b`, so a claim about `c` was REFUTED against a map that never held it ✓✓. The analyzer
        // publishes the alias on the import edge as `metadata.importedAs` (the python lane's own
        // contract ✓✓), so the gate needs no analyzer change for this shape ✓✓. The claim is a
        // statement about the FILE'S OWN SCOPE — "this name is the binding my import introduces" ✓✓ —
        // and an alias is exactly that statement ✓✓. (the python lane's proposal §2 ✓✓, Lead ✓✓)
        const importedAs = (relMdEarly as any)?.importedAs
        const aliasName = typeof importedAs === "string" && importedAs.length > 0 ? importedAs : ""
        if (names || aliasName || (tgtItem.length > 0 && tgtItem !== "*")) {
          const repo = repoOf(f)
          let byFile = importEvidence.get(repo)
          if (!byFile) importEvidence.set(repo, (byFile = new Map()))
          let bySpec = byFile.get(f)
          if (!bySpec) byFile.set(f, (bySpec = new Map()))
          // THE SPECIFIER KEY IS THE MODULE, NOT THE EDGE's target: an imports edge spells its target
          // `module:item` (`@glimmer/component:Component`), while the claim carries the specifier as
          // written. `metadata.module` is the analyzer's own field; fall back to the target's module
          // half (never the whole `module:item`, which no claim would match — measured 389 refutations
          // when the whole target was used).
          const specKey = typeof relMdEarly?.module === "string" && relMdEarly.module.length > 0
            ? relMdEarly.module
            : (itemMatch > 0 ? tgt.slice(0, itemMatch) : tgt)
          let bindSet = bySpec.get(specKey)
          if (!bindSet) bySpec.set(specKey, (bindSet = new Set()))
          for (const nm of names ?? []) if (typeof nm === "string" && nm.length > 0) bindSet.add(nm)
          if (tgtItem.length > 0 && tgtItem !== "*") bindSet.add(tgtItem)
          if (aliasName) bindSet.add(aliasName)
        }
      }
      const edgeLine = Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null
      const ownerRaw = md.owner
      const owner = typeof ownerRaw === "string" && ownerRaw.length > 0 ? ownerRaw : null
      // THE ANALYZER's OWN TWO REASONS, VERBATIM, ON THE EDGE - the dump's eighth and ninth
      // columns. The values are CARRIED, not derived: the gate does not decide what a reason MEANS,
      // it only makes the analyzer's own reason visible to whoever has to dispose of the row. The two
      // come from two different metadata fields because they answer two different questions (the
      // BIND reason names a wall; the CONFIDENCE reason explains a sub-1.0 edge), and one column
      // cannot carry both without making every reader guess which one it is holding.
      const edgeBindReason = String((rel as any)?.metadata?.bindReason ?? "")
      const edgeReasonCode = String((rel as any)?.metadata?.reasonCode ?? "")
      pending.push({ label, tgt, claim, owner, sig, repo: repoOf(f), srcFile: f, line: edgeLine, bindReason: edgeBindReason, reasonCode: edgeReasonCode })
      continue
    }
  }

  // IMPORTED-BINDING EVIDENCE IS ATTACHED TO THE PROJECT FACTS the claims are verified against.
  // Built from the run itself (the analyzer's parsed imports), never from the claim it verifies.
  if (projectFacts) {
    for (const [repo, byFile] of importEvidence) {
      const base = projectFacts.get(repo)
      if (base) projectFacts.set(repo, { ...base, importsByFile: byFile })
    }
  }
  // OWNER-MEMBER EVIDENCE (ownerMemberAbsent claim): built from the SAME symbols the owner channel
  // reads, and INHERITANCE-CLOSED so an inherited member can never be cited as absent. Map:
  // owner name -> the member names declared by that type OR any ancestor namable from the run.
  // Unknown owners are simply absent from the map (claim => UNVERIFIABLE, never accepted).
  if (projectFacts && projectOwnerRecords.size > 0) {
    const leaf = (n: string): string => {
      const t = n.replace(/[<[].*$/, "").trim()
      const segs = t.split(/[.:]/).filter((x) => x.length > 0)
      return segs.length > 0 ? segs[segs.length - 1] : t
    }
    for (const [repo, recs] of projectOwnerRecords) {
      const base = projectFacts.get(repo)
      if (!base) continue
      // class-like name -> heritage names; members keyed by the owner spelling the analyzers publish
      const supers = new Map<string, string[]>()
      const membersByName = new Map<string, Set<string>>()
      const addKey = (m: Map<string, string[]>, k: string, v: string[]) => {
        const cur = m.get(k)
        // APPEND IN PLACE. This used to be `m.set(k, [...cur, ...v])` — a full COPY of the
        // accumulated array on every add, which is O(N^2) when many records share one key. MEASURED
        // 2026-10-23 by the dart lane: dart-sdk's `ranges-and-escaped-hyphens_test.dart` (4 KB,
        // admitted offset 17,656) made the gate never return (>560 s with the index, >150 s without)
        // while the grammar parsed it in 13 ms and the analyzer ran it in 214 ms — and the gate
        // finishes that SAME file in seconds when it is run ALONE, because the cost is the
        // ACCUMULATED record set and not the file. Its content is character-class literals, so many
        // emitted names begin with `[`, `leaf()` strips at `[`, and they collapse onto one key.
        // => A ONE-LINE ALGORITHMIC DEFECT IN A SHARED INSTRUMENT LOOKS EXACTLY LIKE A HANG IN
        // SOMEONE ELSE'S ANALYZER.
        if (cur) { for (const x of v) cur.push(x) }
        else m.set(k, v.slice())
      }
      for (const r of recs) {
        if (r.ownerName) {
          const keys = new Set([r.ownerName, leaf(r.ownerName)])
          for (const k of keys) {
            let set = membersByName.get(k)
            if (!set) membersByName.set(k, (set = new Set()))
            set.add(r.name)
          }
          continue
        }
        for (const k of new Set([r.name, leaf(r.name)])) {
          const sup = (r.superTypes ?? []).map(leaf).filter((x) => x.length > 0)
          if (sup.length > 0) addKey(supers, k, sup)
        }
      }
      const closed = new Map<string, Set<string>>()
      for (const start of membersByName.keys()) {
        const out = new Set<string>()
        const seen = new Set<string>([start])
        const stack = [start]
        while (stack.length > 0) {
          const cur = stack.pop() as string
          const own = membersByName.get(cur)
          if (own) for (const m of own) out.add(m)
          for (const up of supers.get(cur) ?? []) {
            if (seen.has(up)) continue
            seen.add(up)
            stack.push(up)
          }
        }
        closed.set(start, out)
      }
      projectFacts.set(repo, { ...base, ownerMembers: closed })
    }
  }
  // THE BINDING COLLAPSE, applied to the per-project count ONCE, here, where the key space is
  // complete — so `classifyEdge` and every downstream reader keep seeing a plain declaration count,
  // and no shared rule function changes. A key collapses to ONE declaration only when EVERY
  // declaration answering to it carries a qualifiedName AND they are all the same one.
  let collapsedKeys = 0
  if (BINDING_COLLAPSE) {
    for (const [repo, decl] of projectDecl) {
      const bs = projectBindSet.get(repo)
      const bq = projectBindQual.get(repo)
      if (!bs || !bq) continue
      for (const [key, n] of decl) {
        if (n < 2) continue
        const names = bs.get(key)
        if (!names || names.size !== 1) continue
        // EVERY declaration of the key must carry a qualifiedName; a key whose declarations share
        // only a SPELLING keeps its count, because that is a name coincidence and not a binding
        // (JUL-D19: 95.8% of the naive collapse on this lane was exactly that).
        if ((bq.get(key) ?? 0) !== n) continue
        decl.set(key, 1)
        collapsedKeys++
        if (collapsedKeys <= Number(process.env.BB_COLLAPSE_SHOW ?? 0)) {
          console.log(`  collapsed[${collapsedKeys}] key=${JSON.stringify(key)} decls=${n} qualifiedNames=${JSON.stringify([...names])}`)
        }
      }
    }
  }

  // ── THE CLASS-LIKE RESOLUTION FOR `implements` ROWS (2026-10-29) ───────────────────────────────
  /**
   * Kinds that can be the TARGET of an `implements` row. Deliberately narrower than
   * `OWNER_CLASS_LIKE`: `enum` is something that can implement an interface (java's enum does), not
   * something an `implements` row can name as its target, and `module`/`namespace` name containers.
   * `struct` stays because Swift structs conform to protocols and a TypeScript/C# implements clause
   * may name a struct-like type.
   */
  const IMPLEMENTS_TARGET_KINDS = new Set(["class", "interface", "trait", "protocol", "struct", "type_class", "generic", "abstract_class"])
  /**
   * HOW MANY CLASS-LIKE ENTITIES one spelling of a key holds:
   *   "none" — no class-like declaration of that spelling (the key's declarations are members, or absent)
   *   "one"  — every class-like declaration carries the SAME non-empty qualifiedName that differs from
   *            the key: ONE entity, including the `.dcl`/`.icl` twin
   *   "many" — two qualified identities, or a class-like declaration with no qualification at all
   *            (a fallback is not a qualification — the same rule `--binding-collapse` applies)
   */
  const classLikeStatus = (facts: { kind: string; qual: string }[] | undefined, key: string): "none" | "one" | "many" => {
    if (!facts || facts.length === 0) return "none"
    const classLike = facts.filter((f) => IMPLEMENTS_TARGET_KINDS.has(f.kind.toLowerCase()))
    if (classLike.length === 0) return "none"
    const quals = new Set(classLike.map((f) => (f.qual.length > 0 && f.qual !== key ? f.qual : "")))
    return quals.size === 1 && !quals.has("") ? "one" : "many"
  }
  /**
   * Does an `implements` row's target resolve to ONE class in ITS project? The BARE spelling first
   * (`toString`, `~`), then — ONLY when the bare spelling holds no class-like declaration at all —
   * the DECLARATION's spelling `(target)` (`(==)`, `(<)`). It never falls through from "many": a key
   * with two classes is a genuine ambiguity, and the parenthesised key is a different spelling, not
   * a narrower reading of the same one.
   *
   * Measured on the clean arm before it was written: 284 of 333 ambiguous `implements` rows — 153 by
   * the parenthesised spelling, 131 by the bare one — with 49 left (47 another project's class, 2
   * declared nowhere). See `validation/m14/proposals/implements-class-like-resolution.md`.
   */
  const implementsClassLike = (repo: string, target: string): boolean => {
    const facts = projectDeclFacts.get(repo)
    if (!facts) return false
    const bare = classLikeStatus(facts.get(target), target)
    if (bare === "one") return true
    if (bare === "many") return false
    const parens = `(${target})`
    return classLikeStatus(facts.get(parens), parens) === "one"
  }

  // ------------------------------------------------------------------------------------------
  // CLASSIFICATION, over the finished key spaces. Project scope first because that is the one
  // the verdict reads; pooled beside it because that is the one every earlier dart number in
  // this programme was measured with, and dropping it silently would make this run
  // incomparable to its own history — and BOTH are complete here, which is the point.
  // CLAUSE 2's NAMED PART. A declared cause is the analyzer's stated REASON for an edge it could not
  // resolve; the bar says every such edge must be "attributed to a NAMED cause with a measured count".
  // The gate counted them (`causeDeclared`) but never kept the NAME, so the only thing a reader could
  // check was a total. Collected here, printed by `printReport`, and required to carry a ruling by
  // clause 3 below.
  const causeNames = new Map<string, number>()

  // THE OWNER CHANNEL'S POOLS, built once per project over the finished symbol set — the same
  // position production's pass runs in (after every name strategy, over the complete table). The rule
  // and its citations live in script/m14/owner-channel.ts.
  const ownerPools = new Map<string, OwnerProjectPools>()
  for (const [repo, records] of projectOwnerRecords) ownerPools.set(repo, buildOwnerProjectPools(records))

  // HOW MUCH OF THE TABLE THE OWNER CHANNEL DECIDED, and in which direction. Printed to stderr so no
  // parser of stdout can mistake it for a column: a row this channel RESOLVED is a resolution the
  // name count could not see, and a row it DECLINED is a binding production WITHDREW — the second is
  // the one a reader must not have to guess about, because it can turn a name-looking `resolved` into
  // an honest NULL. Counted by reason so the channel's mechanisms are priced, not just totalled.
  /**
   * THE QUALIFIED-NAME JOIN's PRICE, IN THIS ARM'S OWN LANGUAGE. Counted here because the join is
   * NOT clojure-scoped: ANY target that carries a `/` can answer it, so a language that publishes
   * path-shaped targets (go, c, cpp, java, javascript, powershell) can have rows moved by it, and
   * an arm that cannot SHOW the count cannot claim that its numbers did not move.
   */
  let joinResolved = 0
  /** of `resolved`: rows the class-like `implements` rule answered (its own disclosure) */
  let classLikeResolved = 0
  let caseFolded = 0
  let moduleQualified = 0
  let moduleQualifiedChannel = 0
  let moduleQualifiedAbsent = 0
  let moduleQualifiedMany = 0
  let joinAskedSlash = 0
  let joinAskedNamespace = 0
  let joinResolvedSlash = 0
  let joinResolvedNamespace = 0
  let ownerRows = 0
  let ownerResolved = 0
  let ownerDeclined = 0
  let ownerDeclinedButNameWouldResolve = 0
  let ownerResolvedButNameSaidAmbiguous = 0
  const ownerReasons = new Map<string, number>()
  for (const e of pending) {
    const row = rows.get(e.label)!
    const marks = row.marks.get(e.sig)!
    // The evidence for a `projectFacts` claim is the project's own files, and it is looked up
    // HERE, from the same map phase 1 built from the admitted list — never from the analyzer.
    //
    // A `projectFile` CLAIM NEEDS THE SAME EVIDENCE, and until 2026-10-10 it did not get it:
    // the lookup was gated on `projectFacts` alone, so every `projectFile` claim was classified
    // with `facts === undefined` and therefore returned `externalUnverified` — which blocks a
    // PASS. The gate's own control passes facts explicitly for this claim kind, so the CONTROL
    // was green while the live path could never verify one. The json lane found it with a
    // falsifier rather than a complaint: 82 file-shaped `$ref` edges carry `importProjectFile`,
    // 81 of them naming a file that EXISTS in the project, and all of them read `ext?`.
    // A `sourcePath` CLAIM NEEDS THE SAME EVIDENCE, and until 2026-10-14 it did not get it — the THIRD
    // instance of this exact gate (json found the `projectFile` one with a falsifier). The kind verifies
    // the written source string against the project's admitted file list and returns `externalUnverified`
    // when `facts` is absent, BY DESIGN — never a quiet acceptance — so gating the lookup on two kinds
    // left toml's 5 path-shaped rows reading `ext?` with no way to be verified. MEASURED after the fix:
    // 5 of 5 verified, 0 refuted, `extFAIL` 0 — the 0.0% refutation risk the claim was admitted on.
    const needsFacts =
      e.claim?.kind === "projectFacts" || e.claim?.kind === "projectFile" || e.claim?.kind === "sourcePath"
    // TASK-156 — AND AN `owner` CLAIM NEEDS THEM TOO, which is the whole reason the three-way split
    // over path-like targets was INERT when it landed. `needsFacts` lists only the three claim kinds
    // whose VERIFICATION reads the file list, so a plain `owner` claim — the kind a path-shaped
    // external target actually carries — was classified with `facts === undefined` and fell back to
    // the old single refusal. The file list itself is built for every repo (:827) and was simply not
    // passed. Every other consumer of `facts` guards on its own claim kind before reading it, so the
    // only behaviour this changes is the path branch of `verifyExternalClaim`, which is the point:
    // a path-like target whose file IS in the project now REFUTES the external marker instead of
    // reading as a claim no check can reach.
    const facts = projectFacts?.get(e.repo)
    // CONTAINS GOES THROUGH A DIFFERENT RESOLVER — see `classifyEdge`'s `containsLike`. Production
    // binds it with `resolveContainsTargetStmt`, which prefers the edge's own file and returns
    // LIMIT 1, so a name collision is not an ambiguity for this type. Measured by xml-lane: 94.1%
    // ambiguous under the count model against 98.4% bound in the real store.
    const isContains = isContainsEdge(e.label)
    // DOES THE EDGE'S OWN FILE DECLARE THE TARGET? The claim disposition needs it, because a PER-FILE
    // claim cannot be refuted by ANOTHER file's declaration — `real-css-analyzer.ts:115` says css's
    // `isExternalTarget` means "THIS FILE declares no `--x`", while the arbiter checked the PROJECT key
    // space and called all 180 of css's ambiguous edges contradicted. Same `d.file === srcFile` test
    // `classifyIntent` uses, so the two agree by construction rather than by convention.
    // PSD21 — THE CASE FOLD, PROJECT-WIDE. See `projectFolded`: consulted only where the exact key
    // has no declaration, and only when the folded name has exactly one declaration, so the row moves
    // `unresolved → resolved` and nothing else can move.
    if (CASE_INSENSITIVE_LANGUAGES.has(lang) && (projectDecl.get(e.repo)!.get(e.tgt) ?? 0) === 0) {
      const folded = projectFolded.get(e.repo)?.get(e.tgt.toLowerCase())
      if (folded !== undefined && folded.count === 1 && folded.spelling !== null && folded.spelling !== e.tgt) {
        e.tgt = folded.spelling
        caseFolded++
      }
    }
    // PSD22 / HSA12 — the module-qualified resolution. See `moduleQualifiedLeaf` for why it is one-way,
    // and `moduleQualifiedRead` for the refusal that is PRICED rather than silent: a name the module's
    // file declares once while the project declares it more than once is a resolution only a module
    // channel could make (retargeting it lands in ambiguity), so it is counted here and left as it was.
    let moduleVerdict: { outcome: "resolved" } | undefined
    if (e.label !== "imports") {
      const read = moduleQualifiedRead(e.tgt, e.claim, e.repo, projectDecl.get(e.repo), declPos, repoOf)
      if (read !== null) {
        if (read.projectCount === 1 && read.siteCount === 1 && read.inModuleSites === 1) {
          e.tgt = read.leaf
          moduleQualified++
        } else if (read.inModuleSites === 1) {
          // the module's file declares the name once, but the leaf is not unique project-wide: the
          // name model would report a genuine ambiguity, and the qualifier is what decides it.
          moduleVerdict = { outcome: "resolved" }
          moduleQualifiedChannel++
        } else if (read.inModuleSites === 0) {
          // THE MODULE'S FILE DECLARES THE NAME NOWHERE. Three things produce this shape and none of
          // them is decidable here: a re-export (the module publishes the name from another module), a
          // RECORD SELECTOR the analyzer does not publish as a declaration, or a name carried by a
          // class instance. Counted so the next mechanism is priced before it is built.
          moduleQualifiedAbsent++
        } else {
          moduleQualifiedMany++
        }
      }
    }
    const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
    // THE OWNER CHANNEL'S VERDICT for this row, when the row states its receiver and the type is one
    // the store channel touches (calls/uses). For those rows the channel is AUTHORITATIVE: the store
    // withdraws the name binding, so a name-count outcome is not what production holds — it is what
    // production deliberately discarded. `undefined` means the row is not the channel's input and the
    // name model applies unchanged.
    const ownerVerdict = e.owner !== null && (e.label === "calls" || e.label === "uses")
      ? ownerChannelVerdict(ownerPools.get(e.repo) ?? EMPTY_OWNER_POOLS, {
          type: e.label,
          target: e.tgt,
          owner: e.owner,
          srcFile: e.srcFile,
          line: e.line,
        })
      : undefined
    const qj = qualifiedJoinFor(e.repo, e.tgt, e.srcFile)
    const implClassLike = IMPLEMENTS_CLASS_LIKE && e.label === "implements" && implementsClassLike(e.repo, e.tgt)
    const pc = classifyEdge(
      projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, facts, isContains, ownFileDeclares,
      ownerVerdict === undefined ? undefined : { outcome: ownerVerdict.outcome }, e.srcFile,
      qj, edgeRelFile(e.repo, e.srcFile), implClassLike, moduleVerdict,
    )
    if (qj !== undefined) {
      if (qj.branch === "slash") joinAskedSlash++
      else joinAskedNamespace++
    }
    if (pc.classLike) classLikeResolved++
    if (pc.joined) {
      joinResolved++
      if (qj?.branch === "slash") joinResolvedSlash++
      else joinResolvedNamespace++
    }
    if (ownerVerdict !== undefined) {
      ownerRows++
      ownerReasons.set(ownerVerdict.reason, (ownerReasons.get(ownerVerdict.reason) ?? 0) + 1)
      if (ownerVerdict.outcome === "resolved") ownerResolved++
      else ownerDeclined++
      // THE TWO CROSS-CHECKS THAT MAKE THIS DISCLOSURE WORTH HAVING: how many rows the channel moved
      // in each direction relative to the name model alone. Not used for any count in the table — a
      // diagnostic, so a reader can see the size of the correction instead of trusting that it is small.
      const nameOnly = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, facts, isContains, ownFileDeclares, undefined, e.srcFile, qualifiedJoinFor(e.repo, e.tgt, e.srcFile))
      if (ownerVerdict.outcome === "declined" && nameOnly.outcome === "resolved") ownerDeclinedButNameWouldResolve++
      if (ownerVerdict.outcome === "resolved" && (nameOnly.outcome === "ambBoth" || nameOnly.outcome === "ambDeclOnly" || nameOnly.outcome === "unresolved")) ownerResolvedButNameSaidAmbiguous++
    }
    if (BB_DUMP && pc.outcome !== "resolved" && (BB_DUMP_LABEL === "" || e.label === BB_DUMP_LABEL)) {
      if (bbDumped >= BB_DUMP_LIMIT) {
        // THE BOUND WAS REACHED — THIS ROW IS NOT Dumped, AND THE DUMP IS NOT THE WHOLE SET.
        bbDumpSkipped++
        if (!bbDumpTruncated) {
          bbDumpTruncated = true
          // THE BOUND MARKER CARRIES THE SAME FIELD COUNT AS A DATA ROW - a reader that parses by
          // POSITION must see ONE SHAPE on every line, and a marker with a shorter shape makes the
          // marker's last column look like a data field.
          console.log(`DUMP\tBOUND\tREACHED\t${BB_DUMP_LIMIT}\t-\t-\t-\t-\t-`)
          console.log(`DUMP TRUNCATED at the ${BB_DUMP_LIMIT}-row bound — THIS DUMP IS NOT THE WHOLE NON-RESOLVED SET, and a reconciler over it will under-count the movement.`)
        }
        tally(row.project, pc, e.tgt, e.label)
        continue
      }
      bbDumped++
      // THE 7TH COLUMN IS THE CLAIM'S OWN SPECIFIER (java lane's request, 2026-10-19): a lane could
      // not name a residual class of ext? rows because the live claim's specifier was invisible; a
      // dump that hides the claim turns a classifiable row into a mystery.
      const claimSpec = e.claim && typeof (e.claim as any).specifier === "string" ? String((e.claim as any).specifier) : "-"
      // THE 8TH COLUMN IS THE BIND REASON (`metadata.bindReason`, VERBATIM) AND THE 9TH IS THE
      // CONFIDENCE REASON (`metadata.reasonCode`, VERBATIM). The go lane's census ALREADY READS INDEX
      // 7 (script/m14/go-wall-census.ts), and its stated purpose - splitting a wall row into a NAMED
      // class - is served by the BIND reason, because the go lane MEASURED that the 3,820 wall rows
      // carry no reasonCode at all. The confidence reason sits BESIDE it, not inside it: one column
      // per question, so no reader ever has to guess which vocabulary a value belongs to.
      const dumpBindReason = e.bindReason.length > 0 ? e.bindReason : "-"
      const dumpReasonCode = e.reasonCode.length > 0 ? e.reasonCode : "-"
      console.log(`DUMP\t${e.label}\t${pc.outcome}\t${e.tgt}\t${e.srcFile}:${e.line}\t${e.claim?.kind ?? "-"}\t${claimSpec}\t${dumpBindReason}\t${dumpReasonCode}`)
    }
    tally(row.project, pc, e.tgt, e.label)
    row.intent[classifyIntent(e.tgt, e.srcFile, e.line, e.label, declPos)]++
    // The pooled table is the historical comparison key space, but the owner channel's verdict is a
    // property of the ROW, not of the key space — passing it here keeps the two tables from telling
    // different stories about the same edge.
    tally(row.pooled, classifyEdge(pooledDecl, pooledKinds, e.tgt, e.claim, facts, isContains, undefined, ownerVerdict === undefined ? undefined : { outcome: ownerVerdict.outcome }, e.srcFile, undefined, edgeRelFile(e.repo, e.srcFile)), e.tgt, e.label)
    switch (pc.outcome) {
      case "resolved": marks.resolved++; break
      case "ambDeclOnly": case "ambBoth": marks.amb++; break
      case "externalVerified": case "externalUnverified": marks.ext++; break
      // A binding is its own bucket HERE TOO, for the same reason it has its own column in
      // TABLE 1: it is neither a resolution (there is nothing to resolve to) nor a gap
      // (nothing is missing). Folding it into `unres` would make the diagnostic disagree
      // with the table it exists to explain.
      case "bindingVerified": case "bindingRefuted": case "bindingUnverified": marks.bind++; break
      // BUCKET 3, in its own count here too — and note what it does NOT do: it never reaches
      // `marks.resolved`, so a marker set carrying a declared cause cannot read as handled in
      // the diagnostic that orders the remaining work.
      case "causeDeclared": case "causeRefuted": {
        marks.cause++
        // THE NAMED CAUSE, retained. `base` is the analyzer's stated reason (`baseBeyondRunScope`'s
        // value); `null` is a real state and is named as such rather than dropped, because a cause
        // with no name cannot be ruled and clause 3 must be able to say so.
        const cn = e.claim?.kind === "cause" ? (e.claim.base ?? "(unnamed cause)") : "(unnamed cause)"
        causeNames.set(cn, (causeNames.get(cn) ?? 0) + 1)
        break
      }
      // `unresolved` AND `externalRefuted`: a refuted claim is not clean, and folding it in
      // with the verified ones would hide the one outcome that is a lane's own defect.
      default: marks.unres++
    }
  }

  // THE SEPARATOR TRIPWIRE. Every binding claim is verified by the TARGET'S SPELLING
  // (`verifyBindingClaim`), and that verification is worth something only while no published
  // declaration name contains the separator — if one did, a target carrying it could name a
  // declaration and the claim would still read clean. Asserted ONCE over the FINISHED key
  // space rather than per edge, because the walk classifies edges while the key space is still
  // being built. Counted over the pooled space and over each project's own space, so a name
  // counts once per space it appears in; the number is a tripwire, and `> 0` is its whole
  // message.
  let separatorKeys = 0
  const separatorExamples: string[] = []
  const scanSeparator = (keys: Iterable<string>) => {
    for (const k of keys) {
      if (!k.includes(BINDING_SEP)) continue
      separatorKeys++
      if (separatorExamples.length < 5) separatorExamples.push(k)
    }
  }
  scanSeparator(pooledDecl.keys())
  for (const m of projectDecl.values()) scanSeparator(m.keys())

  // THE OWNER CHANNEL'S DISCLOSURE — on STDERR on purpose. stdout is the report, every consumer
  // parses it positionally, and this is the difference between the name model and what production
  // actually holds for owner-carrying rows. BOTH directions are printed, because one of them is the
  // uncomfortable one: `declined` rows are bindings the store WITHDREW, so a run where that number is
  // large is a run whose name model would have over-credited resolution.
  if (ownerRows > 0) {
    const reasons = [...ownerReasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")
    process.stderr.write(
      `  owner channel (production rule, modelled): ${ownerRows} row(s) carried metadata.owner · ` +
      `resolved ${ownerResolved} · declined ${ownerDeclined} (${reasons})\n` +
      `  owner channel vs name model: ${ownerResolvedButNameSaidAmbiguous} row(s) the name count called ambiguous/unresolved and the channel resolves; ` +
      `${ownerDeclinedButNameWouldResolve} row(s) the channel DECLINED whose name would have resolved — production holds those NULL (withdrawn binding)\n`,
    )
  }
  // THE JOIN's OWN PRICE, PRINTED EVEN WHEN IT IS ZERO — a reader must be able to see "0" rather
  // than infer it from an absent line, and an arm that shows a number can be compared with another
  // arm that shows a number.
  process.stderr.write(
    `  qualified-name join: ${joinResolved} row(s) resolved by the qualified-name join (the name model alone would not have resolved them) — ` +
    `slash branch: ${joinResolvedSlash} of ${joinAskedSlash} row(s) asked · ` +
    `namespace branch: ${joinResolvedNamespace} of ${joinAskedNamespace} row(s) asked` +
    (joinAskedNamespace === 0 ? " (the namespace branch is STRUCTURALLY IMPOSSIBLE in this language: no file publishes a module-kind symbol, so no bare target can be qualified)" : "") +
    `\n`,
  )
  // THE CASE FOLD'S OWN PRICE, on every arm for the join's reason — and it prints ZERO on every lane
  // that has not opted in, so a reader can see that the rule did not move their numbers.
  process.stderr.write(
    `  case fold (project key space): ${caseFolded} row(s) moved from unresolved to a declaration whose spelling differs only in case` +
    (CASE_INSENSITIVE_LANGUAGES.has(lang) ? "" : " (this language is not opt-in: the fold is inert)") +
    `\n  module-qualified resolution: ${moduleQualified} row(s) retargeted from '<Module>.<name>' to the leaf, because the claimed module's file is the ONE file in the repo declaring that name` +
    `\n  module channel: ${moduleQualifiedChannel} row(s) resolved through it — the claimed module's file declares the name once, so the qualified spelling names that declaration even where the bare name is NOT unique project-wide` +
    `\n  module channel refusals: ${moduleQualifiedAbsent} row(s) where the module's file declares the name NOWHERE (a re-export, an unpublished record selector, or a class-instance name) and ${moduleQualifiedMany} where it declares it more than once` +
    `\n`,
  )
  // THE CLASS-LIKE RULE'S OWN PRICE, printed on every arm for the join's reason: an arm that does not
  // say the number cannot honestly claim that this rule moved nothing in its language.
  process.stderr.write(
    `  implements class-like resolution: ${classLikeResolved} row(s) resolved by the class-like rule ` +
    `(the key's CLASS declarations under the bare, then the parenthesised, spelling; a member of the same ` +
    `name is not a rival for an \`implements\` row)\n`,
  )

  return {
    lang, ext: exts.join(","), admittedExts: exts, files, total, repos, parsed, failed, degraded, degradedFiles, aliasedKeys, bindingCollapse: BINDING_COLLAPSE, bindingCollapsedKeys: collapsedKeys, rows, fallbackRows, emptyResults,
    // ★ THE POPULATION'S SOURCE, AND THE TABLE'S OWN SET BESIDE IT. `extSource` says WHERE the
    // admitted spellings came from, and `tableExts` says what the ONE TABLE says the lane's
    // spellings are — so a run over a subset can be READ as a run over a subset, and the two can
    // never disagree without the disagreement being visible in the output.
    extSource: "", tableExts: [] as string[],
    // ★ THE CHUNK'S OWN BOUNDS, so the report can say WHETHER IT IS A CHUNK. `sliceStart === 0 &&
    // sliceEnd === total` means the run measured the WHOLE admitted population; anything else means it
    // measured a CHUNK of it, and the numbers are a chunk's. A reader who cannot tell is a reader who
    // will publish a sample as a population.
    sliceStart, sliceEnd, isWholePopulation: sliceStart === 0 && sliceEnd === total,
    // CLAUSE 2's NAMED causes with their measured counts — collected in the classification loop and
    // consumed by `clauseResults`. A Map, so the same cause named by many edges is one entry with a
    // count rather than many entries.
    causeNames,
    bindingSpelling: { separator: BINDING_SEP, keys: separatorKeys, examples: separatorExamples },
    // THE EXCLUSIONS TRAVEL WITH THE POPULATION. A reader comparing two runs has to be able
    // to see whether the population moved under them, and a lane returning to a number it
    // recognizes should not have to wonder which cap produced it.
    excluded: { absent, overCap, overCapLargest, sizeCapBytes: SIZE_CAP },
    index: indexInfo === null
      ? null
      : {
        repos: indexInfo.byRepo.size, built: indexInfo.built,
        cached: indexInfo.cached, damaged: indexInfo.damaged, indexed: indexInfo.indexed,
      },
  }
}

type Report = Awaited<ReturnType<typeof measure>>

/**
 * THE POSITIVE CONTROL. Runs the SAME counting logic over a hand-built map, so if the
 * detector is broken this fails instead of the gate printing a clean lane.
 *
 * A control that only proves the happy path is decoration. This one plants one of each
 * outcome the gate can report and asserts each is counted where it belongs.
 */
/**
 * A QUALIFIED TARGET WHOSE MODULE THE PROJECT CARRIES NAMES A PROJECT DECLARATION, AND THE MODULE
 * CLAIM COULD ONLY DEMOTE IT.
 *
 * The claim is verified against the project's module PATHS, so a module the project carries can only
 * become `ext?`: `<Module>.<fn>` is not a symbol the store keys, and retargeting the bare leaf on its
 * own was measured and REFUSED because it is a guess — a `Schema.column` call must not bind a `column`
 * declared in `Other.hs`.
 *
 * The arm itself holds the fact that makes it provable: the leaf's DECLARATION SITE. When the leaf has
 * exactly one declaration in the repo, and the file carrying it answers to the claimed module path (via
 * `modulePathsOfFile`, the SAME derivation the module space uses), the qualified target names that
 * declaration and nothing else. Returns the leaf to retarget to, or null.
 *
 * ONE-WAY BY CONSTRUCTION, like the case fold: consulted only where the qualified target has no
 * declaration of its own, and only at exactly one declaration AND one declaration site, so the row can
 * only move from `ext?`/`unresolved` to `resolved` — never to ambiguity, never to a refutation. `imports`
 * is excluded at the call site on purpose: an import names a MODULE, and a module path is not a
 * declaration even when a symbol shares its leaf.
 */
function moduleQualifiedRead(
  tgt: string,
  claim: ExternalClaim | null,
  repo: string,
  pDecl: Map<string, number> | undefined,
  declPos: Map<string, { file: string; line: number }[]>,
  repoOfFile: (f: string) => string,
): { leaf: string; siteCount: number; inModuleSites: number; projectCount: number } | null {
  if (claim?.kind !== "moduleNamespace") return null
  const dot = tgt.indexOf(".")
  if (dot <= 0) return null
  const leaf = tgt.slice(dot + 1)
  if (leaf.length === 0 || leaf.indexOf(".") >= 0) return null
  // the qualified spelling itself must have NO declaration
  if ((pDecl?.get(tgt) ?? 0) > 0) return null
  const sites = (declPos.get(leaf) ?? []).filter((d) => repoOfFile(d.file) === repo)
  const inModuleSites = sites.filter((d) => modulePathsOfFile(d.file).indexOf(claim.module) >= 0).length
  return { leaf, siteCount: sites.length, inModuleSites, projectCount: pDecl?.get(leaf) ?? 0 }
}

/**
 * The RESOLUTION `moduleQualifiedRead` licenses: the leaf is declared exactly once in the repo, at
 * exactly one site, and that site is in the file that answers to the claimed module.
 */
function moduleQualifiedLeaf(
  tgt: string,
  claim: ExternalClaim | null,
  repo: string,
  pDecl: Map<string, number> | undefined,
  declPos: Map<string, { file: string; line: number }[]>,
  repoOfFile: (f: string) => string,
): string | null {
  const r = moduleQualifiedRead(tgt, claim, repo, pDecl, declPos, repoOfFile)
  if (r === null) return null
  if (r.projectCount !== 1 || r.siteCount !== 1 || r.inModuleSites !== 1) return null
  return r.leaf
}

function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  // name -> declarations, kinds
  const declCount = new Map<string, number>([
    ["alpha", 1], ["beta", 3], ["gamma", 2],
    // `Object` IS published — dart-sdk `sdk/lib/core/object.dart` publishes `Object.hashCode`
    // among its 12 symbols, measured with `pool-worker.parseFile` — so an external claim
    // about anything owned by `Object` is REFUTABLE and must be refuted, while an owner the
    // corpus does not have survives. The two cases differ only by this entry.
    ["Object", 1],
  ])
  const kinds = new Map<string, Set<string>>([
    ["alpha", new Set(["function"])],
    // 3 declarations, ONE kind — the make/scss shape that reads 0 ambiguous by kind.
    ["beta", new Set(["function"])],
    // 2 declarations, TWO kinds — must count under BOTH metrics.
    ["gamma", new Set(["function", "module"])],
  ])
  // ONE OF EACH OUTCOME, including the two the original control could not reach: an external
  // claim that survives a lookup and one that does not. A control that cannot plant a
  // refuted claim cannot detect the laundering it exists to prevent.
  //
  // AND ONE OF EACH CLAIM KIND, because `verifyExternalClaim` and `verifyImportClaim` are two
  // checks and a control that exercises only the first would let the second accept anything.
  // THE FILE CLAIM — verified by the project's OWN file list, refuted by it, and unverifiable with
  // no list. `sdk/lib/async/async.dart` is the one path this control's facts admit, so the first
  // plant verifies on its SECOND candidate (the shape a loader-ambiguous `!include` produces), the
  // second is refuted by the same list, and the third is the claim with no evidence to check it.
  // AN ARRAY, NOT A MAP, and the first version of this control was a map — which collapsed the
  // refuted and no-facts plants into one entry because they share a target, and the control's own
  // count assertion (expected 4 REFUTED, got 3) is what caught it before any lane number was
  // reported. A control that silently drops its own cases is the failure this programme keeps
  // paying for, one layer up.
  const filePlants: { tgt: string; candidates: string[]; withFacts: boolean }[] = [
    // VERIFIED on the SECOND candidate: the shape a loader-ambiguous `!include` produces (Hasura's
    // spelling first, which this control's facts do not admit, then the admitted one).
    { tgt: "s1/functions/functions.yaml", candidates: ["databases/s1/functions/functions.yaml", "sdk/lib/async/async.dart"], withFacts: true },
    // REFUTED: every candidate denied by the project's file list.
    { tgt: "absent/dir/missing.yaml", candidates: ["absent/dir/missing.yaml"], withFacts: true },
    // UNVERIFIABLE: the same claim with no evidence supplied at all.
    { tgt: "absent/dir/missing.yaml", candidates: ["absent/dir/missing.yaml"], withFacts: false },
  ]
  const ownerClaims = new Set([
    "AbsentThing.build",              // owner not published -> verified
    "Object.hashCode",                // owner published     -> REFUTED
    "package:flutter/material.dart:*", // no identifier owner -> unverified
    "NoSuchBareThing",                // BARE identifier, unpublished -> verified via the TARGET
  ])
  // The project's own facts, planted here exactly as `projectFactsForDart` builds them from a
  // real checkout: one package it declares, one SDK library it carries, one path it admits.
  const facts: ProjectFacts = {
    packages: new Set(["declared_pkg"]),
    files: new Set(["sdk/lib/async/async.dart"]),
    sdkLib: true,
  }
  const factClaims = new Map<string, boolean>([
    ["package:declared_pkg/x.dart:*", true],   // package IS declared -> REFUTED
    ["package:absent_pkg/x.dart:*", true],     // not declared         -> verified
    ["dart:async:*", true],                    // SDK file IS here     -> REFUTED
    ["dart:missinglib:*", true],               // SDK file is not here -> verified
    ["package:nofacts_pkg/x.dart:*", false],   // A CLAIM WITH NO EVIDENCE, checked below
  ])
  const got: Record<Outcome, number> = {
    resolved: 0, ambBoth: 0, ambDeclOnly: 0, unresolved: 0,
    externalVerified: 0, externalRefuted: 0, externalUnverified: 0,
    bindingVerified: 0, bindingRefuted: 0, bindingUnverified: 0,
    causeDeclared: 0, causeRefuted: 0,
  }
  let verifiedByOwner = 0
  // The bare-name path is a SECOND mechanism producing `externalVerified`, and it gets its own
  // counter for the same reason `verifiedByRefSpelling` exists: one counter for two mechanisms
  // reports a bug in whichever mechanism it happens to assert about.
  let verifiedByTarget = 0
  let verifiedByFacts = 0
  let verifiedBySpelling = 0
  // A SEPARATE COUNTER for the reference claim's spelling checks. Sharing one counter split the
  // binding assertion above in half — it read 4 against an expected 2 while both claims were
  // working — and a control that cannot tell two mechanisms apart reports a bug in whichever one
  // it happens to assert about.
  let verifiedByRefSpelling = 0
  for (const t of [
    "alpha", "beta", "gamma", "delta",
    "AbsentThing.build", "Object.hashCode", "package:flutter/material.dart:*",
    // Added WITH the bare-name path, not after it: a plant that is in `ownerClaims` but
    // missing from this list is never classified, so the counter it feeds stays 0 and the
    // assertion below fails — which is how this omission was caught, by the gate refusing
    // to report any lane rather than by a reviewer noticing.
    "NoSuchBareThing",
  ]) {
    const c = classifyEdge(declCount, kinds, t, ownerClaims.has(t) ? { kind: "owner" } : null)
    got[c.outcome]++
    if (c.verifiedBy === "owner") verifiedByOwner++
    if (c.verifiedBy === "target") verifiedByTarget++
  }
  for (const [t, withFacts] of factClaims) {
    const c = classifyEdge(declCount, kinds, t, { kind: "projectFacts" }, withFacts ? facts : undefined)
    got[c.outcome]++
    if (c.verifiedBy === "projectFacts") verifiedByFacts++
  }
  // THE FILE CLAIM's three cases, classified through THE ONE RULE like every other plant, so the
  // control exercises the branch the yaml lane's `!include` edges take rather than a copy of it.
  for (const p of filePlants) {
    const c = classifyEdge(
      declCount, kinds, p.tgt,
      { kind: "projectFile", candidates: p.candidates },
      p.withFacts ? facts : undefined,
    )
    got[c.outcome]++
    if (c.verifiedBy === "projectFacts") verifiedByFacts++
  }
  // THE DIRECTORY HALF of the same claim: a local GitHub action (`./dir`) names a DIRECTORY, and
  // this control's facts admit `sdk/lib/async/async.dart`, so the directory above it must verify by
  // prefix while a directory nothing sits under must be refuted. One of each, because the rule's
  // two branches are what a wrong implementation would collapse into one.
  for (const dir of ["sdk/lib/async", "absent/dir"]) {
    const c = classifyEdge(declCount, kinds, `./${dir}`, { kind: "projectFile", candidates: [dir] }, facts)
    got[c.outcome]++
    if (c.verifiedBy === "projectFacts") verifiedByFacts++
  }
  // THE REFERENCE CLAIM, and the ways to abuse it. THE PLANT IS THE WHOLE TARGET, and this line is
  // where the control caught its author: refutation looks the TARGET up in the key space, so
  // planting a shorter name (`ci/action`) left `ci/action@v1` unseen, verified it by spelling, and
  // the count assertion reported 8 verified / 5 refuted against an expected 7 / 6. The rule was
  // right and the plant was wrong, which is the useful direction for a control to fail in.
  declCount.set("ci/action@v1", 1)
  const refPlants: string[] = [
    "actions/checkout@v6",           // VERIFIED by the spelling
    "docker://alpine:3.21",          // VERIFIED — the container shape
    "ci/action@v1",                  // REFUTED — the key space answers it
    "Foo.Bar",                       // UNVERIFIABLE — not a reference shape at all
    "./local/action",                 // UNVERIFIABLE — a PROJECT path, which the file claim covers
  ]
  for (const t of refPlants) {
    const c = classifyEdge(declCount, kinds, t, { kind: "remoteRef" })
    got[c.outcome]++
    if (c.verifiedBy === "spelling") verifiedByRefSpelling++
  }

  // THE BINDING CLAIM, and the one case that must be caught is the one this round was built
  // on: a target MARKED as a binding whose spelling a declaration answers. `counter` is
  // planted in `declCount` for it — that is the whole defect, reproduced in the control as
  // well as in `local-read-phantom.ts`, so a future edit that consults the count before the
  // claim fails HERE instead of silently reading `resolved`.
  const bindingPlants = new Map<string, boolean>([
    [`run${BINDING_SEP}counter`, true],   // spelled as a binding, nothing answers it -> VERIFIED
    [`lonely${BINDING_SEP}x`, true],      // same, second site                          -> VERIFIED
    ["counter", true],                    // marked, but a declaration answers it       -> REFUTED
    [`binder${BINDING_SEP}`, true],       // separator with nothing after it            -> UNVERIFIED
  ])
  declCount.set("counter", 1)
  for (const [t] of bindingPlants) {
    const c = classifyEdge(declCount, kinds, t, { kind: "binding" })
    got[c.outcome]++
    if (c.verifiedBy === "binding") verifiedBySpelling++
  }
  // THE MARKER -> KIND ROUTING. `externalClaimOf` decides the check from the KEY, and a
  // mutation that let a binding marker fall through to the owner check would verify every
  // binding by looking up `run#counter` as an owner (which also reads `verified`, for the
  // wrong reason). Asserted on the routing function itself because that is where the choice
  // is made.
  if (externalClaimOf({ metadata: { [BINDING_CLAIM_KEY]: true } })?.kind !== "binding") {
    failures.push("control: `localBinding` did not route to the binding claim")
  }
  // THE NAMESPACE CLAIM IS THE CITATION MECHANISM (charter §18.8 ruling, 2026-10-19): a lane declares
  // the roots it certifies (`metadata.languageNamespace`), the arbiter checks the target's root against
  // THAT LIST (prefix or exact symbol), and a non-listed root is REFUTED so a citation can never become
  // a blanket excuse. Plants: a reserved namespace prefix, a library namespace prefix, a bare symbol
  // (Dart SDK annotation shape), and — the important one — an UNDECLARED root that must refute.
  if (externalClaimOf({ metadata: { [NAMESPACE_CLAIM_KEY]: ["java", "override"] } })?.kind !== "namespace") {
    failures.push("control: `languageNamespace` did not route to the namespace citation claim")
  }
  // STRICT-ABSENT NAMESPACE POLICY (cpp citation narrowing 2026-10-19): a claim carrying
  // `languageNamespacePolicy: "strict-absent"` verifies ONLY where the run declares nothing for the
  // target; with a declaration answer it falls through (the claim may not displace the name model).
  {
    const strictClaim = externalClaimOf({ metadata: { [NAMESPACE_CLAIM_KEY]: ["move"], [NAMESPACE_POLICY_KEY]: "strict-absent" } })
    if (!(strictClaim?.kind === "namespace" && (strictClaim as any).strictAbsent === true)) {
      failures.push("control: strict-absent namespace policy did not route on the claim")
    }
    const empty = new Map<string, number>()
    const free = classifyEdge(empty, kinds, "move", strictClaim, undefined, undefined, undefined, undefined, "src/x.cpp")
    if (free.outcome !== "externalVerified") failures.push(`control: strict-absent namespace claim on a declaration-free target read ${free.outcome}, expected externalVerified`)
    const answered = classifyEdge(declCount, kinds, "alpha", { kind: "namespace", roots: ["alpha"], strictAbsent: true }, undefined, undefined, undefined, undefined, "src/x.cpp")
    if (answered.outcome === "externalVerified") failures.push("control: strict-absent namespace claim displaced a declaration-answered target (must fall through)")
  }
  // THE PACKAGE-SCOPE CLAIM (2026-10-20): "this name belongs to a DEPENDENCY this project
  // declares", verified against the PROJECT'S OWN MANIFEST. It exists because the fleet's largest
  // remaining class is a VOCABULARY wall (dart: 84.9% of its 16,395 unresolved `uses` rows name
  // members of types the project does not declare; C++ bucket D: 122,227 of 614,081), and for those
  // rows there is no declaration for ANY evidence class to point at.
  //
  // FOUR DIRECTIONS, because a claim that cannot be refuted is a blanket excuse:
  //   1. the manifest DECLARES the dependency -> VERIFIED;
  //   2. the manifest does NOT declare it -> REFUTED (the claim is false — this is the check that
  //      makes the claim safe where a lane-maintained vocabulary could not be);
  //   3. the target has a DECLARATION answer -> the claim FALLS THROUGH (a claim may never
  //      displace the name model — the cpp lane's 12,883-decoy precedent);
  //   4. NO manifest evidence at all -> UNVERIFIABLE, never quietly accepted.
  {
    const pkgClaim = externalClaimOf({ metadata: { [PACKAGE_SCOPE_CLAIM_KEY]: { package: "json_annotation", name: "JsonKey" } } })
    if (!(pkgClaim?.kind === "packageScope" && (pkgClaim as any).package === "json_annotation")) {
      failures.push("control: `packageScope` did not route to the package-scope claim")
    }
    // A claim with no package is NOT a claim — the dependency is part of the statement.
    const noPkg = externalClaimOf({ metadata: { [PACKAGE_SCOPE_CLAIM_KEY]: { name: "JsonKey" } } })
    if (noPkg?.kind === "packageScope") {
      failures.push("control: a package-scope claim with no package was accepted (the list is part of the claim)")
    }
    const deps = new Set<string>(["json_annotation", "github.com/pkg/errors"])
    const facts: ProjectFacts = { packages: new Set<string>(), files: new Set<string>(), sdkLib: false, packageDependencies: deps }
    const empty = new Map<string, number>()
    // 1. DECLARED -> VERIFIED
    const declared = classifyEdge(empty, kinds, "JsonKey", { kind: "packageScope", package: "json_annotation", name: "JsonKey" }, facts, undefined, undefined, undefined, "lib/x.dart")
    if (declared.outcome !== "externalVerified") failures.push(`control: package-scope claim on a manifest-declared dependency read ${declared.outcome}, expected externalVerified`)
    // 2. NOT DECLARED -> REFUTED (the claim is false; the row is counted as the defect it is)
    const undeclared = classifyEdge(empty, kinds, "JsonKey", { kind: "packageScope", package: "not_a_dependency", name: "JsonKey" }, facts, undefined, undefined, undefined, "lib/x.dart")
    // A MANIFEST THAT DOES NOT NAME THE PACKAGE -> UNVERIFIABLE, NOT REFUTED (the semantics ruling,
    // 2026-10-20): a manifest's silence about a package is not evidence about that package's membership.
    // The clojure lane measured 977 rows where the old REFUTED verdict charged the LANE for the
    // PROJECT's incompleteness -- clj-kondo's test fixtures require libraries its manifest does not list.
    if (undeclared.outcome !== "externalUnverified") failures.push(`control: package-scope claim on a manifest-UNDECLARED dependency read ${undeclared.outcome}, expected externalUnverified (a manifest's silence is not evidence about the package's membership)`)
    // 3. A DECLARATION ANSWER -> THE CLAIM FALLS THROUGH (it may not displace the name model)
    const answered = classifyEdge(declCount, kinds, "alpha", { kind: "packageScope", package: "json_annotation", name: "alpha" }, facts, undefined, undefined, undefined, "src/x.ts")
    if (answered.outcome === "externalVerified") failures.push("control: package-scope claim displaced a declaration-answered target (must fall through)")
    // 4. NO MANIFEST EVIDENCE -> UNVERIFIABLE, never quietly accepted
    const noFacts: ProjectFacts = { packages: new Set<string>(), files: new Set<string>(), sdkLib: false }
    const unverifiable = classifyEdge(empty, kinds, "JsonKey", { kind: "packageScope", package: "json_annotation", name: "JsonKey" }, noFacts, undefined, undefined, undefined, "lib/x.dart")
    if (unverifiable.outcome !== "externalUnverified") failures.push(`control: package-scope claim with no manifest evidence read ${unverifiable.outcome}, expected externalUnverified`)
    // THE SCOPED SPELLING: a manifest names `github.com/pkg/errors`, and the claim may name either the
    // full path or its leaf — but only at a PATH BOUNDARY (`json` must NOT match `jsonc`).
    const scoped = classifyEdge(empty, kinds, "errors.New", { kind: "packageScope", package: "github.com/pkg/errors", name: "errors.New" }, facts, undefined, undefined, undefined, "main.go")
    if (scoped.outcome !== "externalVerified") failures.push(`control: package-scope claim on a scoped manifest name read ${scoped.outcome}, expected externalVerified`)
  }
  // THE PACKAGE-SCOPE CLAIM IN A MONOREPO (2026-10-20): the manifest that GOVERNS THE FILE, not the
  // repository root's. MEASURED: 843 tracked `package.json`, 414 `pubspec.yaml`, 744 `Cargo.toml`,
  // 222 `pom.xml` and 395 `build.gradle` files live in SUBDIRECTORIES, while only 38 / 3 / 4 / 2 / 2
  // repos carry one at the ROOT — so a root-only manifest answers a DIFFERENT PACKAGE's question, in
  // BOTH directions, and both directions are pinned here.
  {
    const empty = new Map<string, number>()
    // The root declares `root-dep`; the sub-package declares `pkg-dep`. Neither declares the other.
    const rootSet = new Set<string>(["root-dep"])
    const pkgSet = new Set<string>(["pkg-dep"])
    const mono: ProjectFacts = {
      packages: new Set<string>(), files: new Set<string>(), sdkLib: false,
      packageDependencies: rootSet,
      packageDependenciesByFile: new Map<string, Set<string>>([
        ["/repo/packages/foo/src/x.ts", pkgSet],
      ]),
    }
    const own = classifyEdge(empty, kinds, "Widget", { kind: "packageScope", package: "pkg-dep", name: "Widget" }, mono, undefined, undefined, undefined, "/repo/packages/foo/src/x.ts")
    if (own.outcome !== "externalVerified") {
      failures.push(`control: a claim on the sub-package's OWN manifest-declared dependency read ${own.outcome}, expected externalVerified (the governing manifest is the nearest ancestor, not the root)`)
    }
    // A CLAIM WHOSE PACKAGE THE GOVERNING MANIFEST DOES NOT NAME IS **UNVERIFIABLE**, NOT REFUTED
    // (the semantics ruling, 2026-10-20): a manifest's silence about a package is not evidence about
    // that package's membership, so the project's evidence CANNOT answer the claim. The old expectation
    // here was `externalRefuted`, and the clojure lane measured 977 rows where that refutation charged
    // the LANE for the PROJECT's incompleteness — clj-kondo's test fixtures require libraries its
    // manifest does not list. **UNVERIFIABLE IS ALSO THE SAFER VERDICT AGAINST LAUNDERING**: the row does
    // not resolve, so a lane gains nothing by publishing a claim it cannot support.
    const rootOnly = classifyEdge(empty, kinds, "Widget", { kind: "packageScope", package: "root-dep", name: "Widget" }, mono, undefined, undefined, undefined, "/repo/packages/foo/src/x.ts")
    if (rootOnly.outcome !== "externalUnverified") {
      failures.push(`control: a claim on a dependency only the REPO ROOT declares read ${rootOnly.outcome}, expected externalRefuted (a sibling package's manifest must not launder another package's dependency)`)
    }
    // ── THE CMAKE READER'S WIRING, IN BOTH DIRECTIONS (2026-10-20, Lead) ──────────────────────────
    // The C++ lane's NEGATIVE project-fact claim needs the manifest's NAME SET to ground itself for a
    // CMake-governed file, and 1,029 files are misjudged today because a CMakeLists.txt sits NEARER
    // than the manifest the gate reads. The reader is the REQUEST; the package-scope claim is NOT —
    // its reach over the C++ wall is measured at ZERO rows.
    //
    // SO THE CONTROL IS: a CMake name is in the PROJECT-FACT set and NOT in the PACKAGE set, and a
    // package-scope claim naming it is therefore NOT verified by it. A reader that put CMake names
    // into the package set would VERIFY a claim the checkout cannot support — the exact false claim
    // the C++ lane's hand-read falsifier is about.
    {
      const cmakeOnly: ProjectFacts = {
        packages: new Set<string>(), files: new Set<string>(), sdkLib: false,
        packageDependencies: new Set<string>(["root-dep"]),
        packageDependenciesByFile: new Map<string, Set<string>>([
          ["/repo/src/x.cpp", new Set<string>()], // governed by its CMakeLists.txt, which declares no PACKAGE
        ]),
        projectFactDependencies: new Set<string>(["root-dep", "Boost"]),
        projectFactDependenciesByFile: new Map<string, Set<string>>([
          ["/repo/src/x.cpp", new Set<string>(["Boost"])],
        ]),
      }
      const cmakeNamed = classifyEdge(empty, kinds, "Widget", { kind: "packageScope", package: "Boost", name: "Widget" }, cmakeOnly, undefined, undefined, undefined, "/repo/src/x.cpp")
      if (cmakeNamed.outcome === "externalVerified") {
        failures.push("control: a CMAKE name VERIFIED a package-scope claim — the package set must never carry a CMake name")
      }
      const cmakeFact = classifyEdge(empty, kinds, "Widget", { kind: "packageScope", package: "root-dep", name: "Widget" }, cmakeOnly, undefined, undefined, undefined, "/repo/src/x.cpp")
      if (cmakeFact.outcome !== "externalUnverified") {
        failures.push(`control: a file governed by a CMAKE-ONLY manifest read ${cmakeFact.outcome} for a root-only package, expected externalUnverified (the governing manifest is the CMAKE one, and a manifest's silence is not evidence about the package's membership)`)
      }
    }
    // A FILE WITH NO GOVERNING MANIFEST has no entry, and its claim is UNVERIFIABLE — never quietly
    // accepted, exactly as for a project with no manifest at all.
    const orphan = classifyEdge(empty, kinds, "Widget", { kind: "packageScope", package: "root-dep", name: "Widget" }, mono, undefined, undefined, undefined, "/repo/docs/x.ts")
    if (orphan.outcome !== "externalUnverified") {
      failures.push(`control: a claim on a file with NO governing manifest read ${orphan.outcome}, expected externalUnverified`)
    }
    // THE ROOT-LEVEL FILE, in a map that does not cover it, has NO GOVERNING MANIFEST — and a
    // per-file map, when it exists, is AUTHORITATIVE. A repo with no per-file map at all keeps the
    // old behaviour (the repo-level set), which is what the four directions above already pin.
    const atRoot = classifyEdge(empty, kinds, "Widget", { kind: "packageScope", package: "root-dep", name: "Widget" }, mono, undefined, undefined, undefined, "/repo/x.ts")
    if (atRoot.outcome !== "externalUnverified") {
      failures.push(`control: a file a per-file map does not cover read ${atRoot.outcome}, expected externalUnverified (the map is authoritative: an uncovered file has no governing manifest)`)
    }
    // AND THE REPO-LEVEL SHAPE IS UNCHANGED: no per-file map at all -> the repo-level set answers.
    const repoLevel: ProjectFacts = { packages: new Set<string>(), files: new Set<string>(), sdkLib: false, packageDependencies: rootSet }
    const legacy = classifyEdge(empty, kinds, "Widget", { kind: "packageScope", package: "root-dep", name: "Widget" }, repoLevel, undefined, undefined, undefined, "/repo/x.ts")
    if (legacy.outcome !== "externalVerified") {
      failures.push(`control: a repo with NO per-file map read ${legacy.outcome}, expected externalVerified (the repo-level set still answers when no per-file evidence exists)`)
    }
  }
  // SLASH-SEPARATOR OPT-IN (go stdlib multi-segment imports, §21.21): a namespace claim carrying
  // `languageNamespaceSlash` splits the target on `/`; the SAME claim without the marker must NOT
  // verify (every other lane is byte-identical), and a wrong root must REFUTE.
  {
    const slashClaim = externalClaimOf({ metadata: { [NAMESPACE_CLAIM_KEY]: ["encoding"], [NAMESPACE_SLASH_KEY]: true } })
    if (!(slashClaim?.kind === "namespace" && (slashClaim as any).slash === true)) {
      failures.push("control: languageNamespaceSlash did not route to the slash opt-in")
    }
    const emptyD = new Map<string, number>()
    const slashOk = classifyEdge(emptyD, kinds, "encoding/json", slashClaim, undefined, undefined, undefined, undefined, "src/a.go")
    if (slashOk.outcome !== "externalVerified") failures.push(`control: slash claim on encoding/json read ${slashOk.outcome}, expected externalVerified`)
    const noMarker = classifyEdge(emptyD, kinds, "encoding/json", { kind: "namespace", roots: ["encoding"] }, undefined, undefined, undefined, undefined, "src/a.go")
    if (noMarker.outcome === "externalVerified") failures.push("control: namespace claim WITHOUT the slash opt-in verified a slash path (global behaviour must be unchanged)")
    const wrongRoot = classifyEdge(emptyD, kinds, "github.com/x/y", { kind: "namespace", roots: ["encoding"], slash: true }, undefined, undefined, undefined, undefined, "src/a.go")
    if (wrongRoot.outcome !== "externalRefuted") failures.push(`control: slash claim with a wrong root read ${wrongRoot.outcome}, expected externalRefuted`)
  }
  // EXPORT-SURFACE CLAIMS (charter §18.16, JS lane contract): `defaultExport`/`moduleExports` rows
  // name an export SURFACE, not a declaration. Controls: a valid named default verifies; a
  // FABRICATED PUBLIC NAME (`export default foo` -> target foo) refutes; an unknown form refutes; an
  // unbacked localName refutes; an anonymous default verifies on its form; a CJS property name the
  // project DECLARES refutes (a real declaration wins); a valid CJS property verifies.
  if (externalClaimOf({ metadata: { defaultExport: { form: "named-declaration", localName: "alpha" } } })?.kind !== "exportSurface") {
    failures.push("control: `defaultExport` did not route to the export-surface claim")
  }
  if (externalClaimOf({ metadata: { moduleExports: { property: "mod", form: "exports-object" } } })?.kind !== "exportSurface") {
    failures.push("control: `moduleExports` did not route to the export-surface claim")
  }
  {
    const defArms: Array<[string, ExternalClaim, Outcome, string]> = [
      ["default", { kind: "exportSurface", surface: "default", form: "named-declaration", localName: "alpha" }, "bindingVerified", "a named default with a declared localName verifies"],
      ["default", { kind: "exportSurface", surface: "default", form: "anonymous" }, "bindingVerified", "an anonymous default verifies on its form"],
      ["foo", { kind: "exportSurface", surface: "default", form: "named-declaration", localName: "alpha" }, "bindingRefuted", "a FABRICATED public name (the identifier beside export default) must REFUTE"],
      ["default", { kind: "exportSurface", surface: "default", form: "made-up-form", localName: "alpha" }, "bindingRefuted", "an unknown form must REFUTE"],
      // A LOCALNAME IS NOT A PUBLISHED DECLARATION (measured: requiring the run to declare it produced
      // 24 bindFAIL rows — the `const cfg = …; export default cfg` expression form, where locals are not
      // symbols). The claim's public assertion is target===default + form; a missing localName on a form
      // that requires one is what refutes.
      ["default", { kind: "exportSurface", surface: "default", form: "expression", localName: "nope" }, "bindingVerified", "an expression default whose localName the run does not publish still verifies (locals are not declarations)"],
      ["default", { kind: "exportSurface", surface: "default", form: "expression" }, "bindingRefuted", "an expression default with NO localName must REFUTE"],
    ]
    for (const [t, claim, want, why] of defArms) {
      const c = classifyEdge(declCount, kinds, t, claim)
      if (c.outcome !== want) failures.push(`control: defaultExport target ${t} read ${c.outcome}, expected ${want} — ${why}`)
    }
    const cjsArms: Array<[string, ExternalClaim, Outcome, string]> = [
      ["mod", { kind: "exportSurface", surface: "moduleExports", property: "mod", form: "module-exports-object" }, "bindingVerified", "a surface property the project does not declare verifies"],
      // CROSS-FILE DECLARATIONS ARE NOT THE SURFACE'S TARGET (measured: the old refutation produced 245
      // bindFAIL rows on the JS arm — clause 4 FAIL — because JS modules are file-scoped; a same-file
      // declaration is already excluded by the analyzer's emission gate).
      ["alpha", { kind: "exportSurface", surface: "moduleExports", property: "alpha", form: "exports-object" }, "bindingVerified", "a CJS surface whose NAME another project file declares still verifies"],
      ["mod", { kind: "exportSurface", surface: "moduleExports", property: "other", form: "exports-object" }, "bindingRefuted", "a target that is not the claimed property must REFUTE"],
    ]
    for (const [t, claim, want, why] of cjsArms) {
      const c = classifyEdge(declCount, kinds, t, claim)
      if (c.outcome !== want) failures.push(`control: moduleExports target ${t} read ${c.outcome}, expected ${want} — ${why}`)
    }
  }
  // RECEIVER-POSITION CLAIM (JS contract 2026-10-19): same imported-binding evidence, position
  // discriminator. Controls: verified receiver claim; UNBACKED binding REFUTES; target===binding
  // REFUTES; non-name member spelling REFUTES.
  {
    const recvFacts: ProjectFacts = {
      packages: new Set(),
      files: new Set(["src/a.js"]),
      sdkLib: false,
      importsByFile: new Map([["src/a.js", new Map([["pkg-x", new Set(["api"])]])]]),
    }
    const ok = classifyEdge(declCount, kinds, "fetchThing", { kind: "importedBinding", specifier: "pkg-x", binding: "api", position: "receiver" }, recvFacts, undefined, undefined, undefined, "src/a.js")
    if (ok.outcome !== "bindingVerified") failures.push(`control: receiver-position claim on a file-bound receiver read ${ok.outcome}, expected bindingVerified`)
    const unbacked = classifyEdge(declCount, kinds, "fetchThing", { kind: "importedBinding", specifier: "pkg-y", binding: "api", position: "receiver" }, recvFacts, undefined, undefined, undefined, "src/a.js")
    if (unbacked.outcome !== "bindingRefuted") failures.push(`control: receiver claim with NO import evidence read ${unbacked.outcome}, expected bindingRefuted`)
    const same = classifyEdge(declCount, kinds, "api", { kind: "importedBinding", specifier: "pkg-x", binding: "api", position: "receiver" }, recvFacts, undefined, undefined, undefined, "src/a.js")
    if (same.outcome !== "bindingRefuted") failures.push(`control: receiver claim whose target IS the binding read ${same.outcome}, expected bindingRefuted`)
    const badName = classifyEdge(declCount, kinds, "a b", { kind: "importedBinding", specifier: "pkg-x", binding: "api", position: "receiver" }, recvFacts, undefined, undefined, undefined, "src/a.js")
    if (badName.outcome !== "bindingRefuted") failures.push(`control: receiver claim with a non-name member spelling read ${badName.outcome}, expected bindingRefuted`)
  }
  // IMPORTED-NAME CLAIM (2026-10-19): same import evidence map, name-level. Controls: verified name,
  // name-not-imported refutes, wrong specifier refutes, no evidence = unverified.
  {
    const nameFacts: ProjectFacts = {
      packages: new Set(),
      files: new Set(["src/a.py"]),
      sdkLib: false,
      importsByFile: new Map([["src/a.py", new Map([["typing", new Set(["Optional", "Union"])]])]]),
    }
    // The claim is a WALL-CLASS CONVERTER: it speaks only where the name model has no declaration
    // answer (declCount === 0). With a declaration answer it must FALL THROUGH to the name model —
    // otherwise the claim column displaces extOK/resolved rows (measured python extOK −16,277).
    const nArms: Array<[string, ExternalClaim, Outcome, string]> = [
      ["Optional", { kind: "importedName", specifier: "typing", name: "Optional" }, "bindingVerified", "an imported name the file imports verifies"],
      ["List", { kind: "importedName", specifier: "typing", name: "List" }, "bindingRefuted", "a name the import does not bring in refutes"],
      ["Optional", { kind: "importedName", specifier: "os", name: "Optional" }, "bindingRefuted", "a specifier the file does not import refutes"],
    ]
    const zeroDecls = new Map<string, number>()
    for (const [t, claim, want, why] of nArms) {
      const c = classifyEdge(zeroDecls, kinds, t, claim, nameFacts, undefined, undefined, undefined, "src/a.py")
      if (c.outcome !== want) failures.push(`control: importedName ${t} read ${c.outcome}, expected ${want} — ${why}`)
    }
    // NEGATIVE PRECEDENCE control: the SAME claim on a row WITH declarations must NOT become a claim.
    const withDecl = classifyEdge(declCount, kinds, "alpha", { kind: "importedName", specifier: "typing", name: "alpha" }, nameFacts, undefined, undefined, undefined, "src/a.py")
    if (withDecl.outcome === "bindingVerified") failures.push("control: importedName claim displaced a row that HAS declarations (must fall through to the name model)")
    const noFacts = classifyEdge(zeroDecls, kinds, "Optional", { kind: "importedName", specifier: "typing", name: "Optional" }, undefined, undefined, undefined, undefined, "src/a.py")
    if (noFacts.outcome !== "bindingUnverified") failures.push("control: an imported-name claim with no evidence must be UNVERIFIED")
  }
  // OWNER-MEMBER-ABSENCE CLAIM (2026-10-19): a verifiable ABSENCE read only where the name model has
  // nothing. Controls: owner known + member absent verifies; member declared refutes; unknown owner is
  // UNVERIFIED (never accepted); a declaration-answered row FALLS THROUGH (claim may not displace).
  {
    const omFacts: ProjectFacts = {
      packages: new Set(),
      files: new Set(["src/a.py"]),
      sdkLib: false,
      ownerMembers: new Map([["Widget", new Set(["render"])]]),
    }
    const verified = classifyEdge(new Map(), kinds, "paint", { kind: "ownerMemberAbsent", owner: "Widget", member: "paint" }, omFacts, undefined, undefined, undefined, "src/a.py")
    if (verified.outcome !== "externalVerified") failures.push(`control: ownerMemberAbsent absent member read ${verified.outcome}, expected externalVerified`)
    // THE QUALIFIED SPELLING (PS-B22): PowerShell targets a static member by its store
    // qualified name, `Widget.paint`, not by the bare leaf. The claim's own owner + member
    // must match that spelling exactly; a target qualified by a DIFFERENT owner is not this
    // claim's target and stays refuted, so the widening is not a blanket acceptance.
    const qualifiedVerified = classifyEdge(new Map(), kinds, "Widget.paint", { kind: "ownerMemberAbsent", owner: "Widget", member: "paint" }, omFacts, undefined, undefined, undefined, "src/a.py")
    if (qualifiedVerified.outcome !== "externalVerified") failures.push(`control: ownerMemberAbsent qualified absent member read ${qualifiedVerified.outcome}, expected externalVerified`)
    const qualifiedRefuted = classifyEdge(new Map(), kinds, "Widget.render", { kind: "ownerMemberAbsent", owner: "Widget", member: "render" }, omFacts, undefined, undefined, undefined, "src/a.py")
    if (qualifiedRefuted.outcome !== "externalRefuted") failures.push(`control: ownerMemberAbsent qualified declared member read ${qualifiedRefuted.outcome}, expected externalRefuted`)
    const foreignQualified = classifyEdge(new Map(), kinds, "Other.paint", { kind: "ownerMemberAbsent", owner: "Widget", member: "paint" }, omFacts, undefined, undefined, undefined, "src/a.py")
    if (foreignQualified.outcome !== "externalRefuted") failures.push(`control: ownerMemberAbsent foreign-owner qualified target ${foreignQualified.outcome}, expected externalRefuted`)
    const refuted = classifyEdge(new Map(), kinds, "render", { kind: "ownerMemberAbsent", owner: "Widget", member: "render" }, omFacts, undefined, undefined, undefined, "src/a.py")
    if (refuted.outcome !== "externalRefuted") failures.push(`control: ownerMemberAbsent declared member read ${refuted.outcome}, expected externalRefuted`)
    const unknown = classifyEdge(new Map(), kinds, "paint", { kind: "ownerMemberAbsent", owner: "Ghost", member: "paint" }, omFacts, undefined, undefined, undefined, "src/a.py")
    if (unknown.outcome !== "externalUnverified") failures.push(`control: ownerMemberAbsent unknown owner read ${unknown.outcome}, expected externalUnverified`)
    const noFacts = classifyEdge(new Map(), kinds, "paint", { kind: "ownerMemberAbsent", owner: "Widget", member: "paint" }, undefined, undefined, undefined, undefined, "src/a.py")
    if (noFacts.outcome !== "externalUnverified") failures.push("control: ownerMemberAbsent with no evidence must be UNVERIFIED")
    const answered = classifyEdge(declCount, kinds, "alpha", { kind: "ownerMemberAbsent", owner: "Widget", member: "alpha" }, omFacts, undefined, undefined, undefined, "src/a.py")
    if (answered.outcome === "externalVerified") failures.push("control: ownerMemberAbsent displaced a declaration-answered row (must fall through)")
    if (externalClaimOf({ metadata: { ownerMemberAbsent: { owner: "Widget", member: "paint" } } })?.kind !== "ownerMemberAbsent") {
      failures.push("control: ownerMemberAbsent did not route to its claim kind")
    }
  }
  // IMPORTED-BINDING CLAIM (charter §18.10): verified from the RUN'S OWN import evidence, never from
  // the use edge's word. Plants: a name the file's import binds (VERIFIED), a name it does not bind
  // (REFUTED), a specifier the file does not import (REFUTED), another file's import (REFUTED), a
  // name the key space declares (REFUTED — the claim is false there), and no facts (UNVERIFIED).
  if (externalClaimOf({ metadata: { importedBinding: { specifier: "mod-x", binding: "foo" } } })?.kind !== "importedBinding") {
    failures.push("control: `importedBinding` did not route to the imported-binding claim")
  }
  {
    const impFacts: ProjectFacts = {
      packages: new Set(),
      files: new Set(["src/a.js"]),
      sdkLib: false,
      importsByFile: new Map([["src/a.js", new Map([["mod-x", new Set(["foo", "bar"])]])]]),
    }
    const impArms: Array<[string, string, string, Outcome, string]> = [
      ["foo", "mod-x", "src/a.js", "bindingVerified", "a name the file's import binds verifies"],
      ["baz", "mod-x", "src/a.js", "bindingRefuted", "a name the import does NOT bind refutes"],
      ["foo", "mod-y", "src/a.js", "bindingRefuted", "a specifier the file does not import refutes"],
      ["foo", "mod-x", "src/b.js", "bindingRefuted", "another file's import does not verify this one"],
    ]
    for (const [binding, specifier, file, want, why] of impArms) {
      const c = classifyEdge(declCount, kinds, binding, { kind: "importedBinding", specifier, binding }, impFacts, undefined, undefined, undefined, file)
      if (c.outcome !== want) failures.push(`control: imported binding ${binding} from ${specifier} in ${file} read ${c.outcome}, expected ${want} — ${why}`)
    }
    const cDeclared = classifyEdge(declCount, kinds, "alpha", { kind: "importedBinding", specifier: "mod-x", binding: "alpha" }, impFacts, undefined, undefined, undefined, "src/a.js")
    if (cDeclared.outcome !== "bindingRefuted") failures.push("control: an imported-binding claim on a name the key space DECLARES must refute")
    const cNoFacts = classifyEdge(declCount, kinds, "foo", { kind: "importedBinding", specifier: "mod-x", binding: "foo" }, undefined, undefined, undefined, undefined, "src/a.js")
    if (cNoFacts.outcome !== "bindingUnverified") failures.push("control: an imported-binding claim with no import evidence must be UNVERIFIED")
  }
  {
    const citationClaim: ExternalClaim = { kind: "namespace", roots: ["java", "jakarta", "override", "pathlib"] }
    const citationArms: Array<[string, Outcome, string]> = [
      ["java.util.List", "externalVerified", "a reserved-platform root must verify"],
      ["jakarta.servlet.Filter", "externalVerified", "a cited library-namespace root must verify"],
      ["override", "externalVerified", "a cited bare symbol (Dart SDK annotation shape) must verify"],
      ["kotlinx.coroutines.Job", "externalRefuted", "an UNDECLARED root must REFUTE — the citation is not a blanket excuse"],
      // COLON-AWARE SPLIT (python lane measurement, 2026-10-19): a `module:item` target must reach
      // its root, or the stdlib citation cannot verify the 11,167 import rows it exists to cite.
      ["pathlib:Path", "externalVerified", "a module:item target must split on the colon and match its root"],
      ["django:Model", "externalRefuted", "a module:item target whose root is undeclared must REFUTE"],
    ]
    for (const [t, want, why] of citationArms) {
      const c = classifyEdge(declCount, kinds, t, citationClaim)
      if (c.outcome !== want) failures.push(`control: citation target ${t} read ${c.outcome}, expected ${want} — ${why}`)
    }
  }
  // THE MODULE CHANNEL (PSD22/HSA12): the qualified target whose module this project carries and whose
  // module's file declares the name once. BOTH arms are planted — with the caller's verdict it must
  // resolve and NAME the mechanism, and without it the same row must not resolve (the claim can only
  // demote). A channel that always resolved would pass the first arm alone.
  {
    const ch = classifyEdge(
      declCount, kinds, "Widget.run", { kind: "moduleNamespace", module: "Widget" },
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { outcome: "resolved" },
    )
    if (ch.outcome !== "resolved" || ch.verifiedBy !== "moduleChannel") {
      failures.push(`control (module channel): a channel verdict read ${ch.outcome}/${ch.verifiedBy ?? "-"}, expected resolved/moduleChannel`)
    }
    const off = classifyEdge(declCount, kinds, "Widget.run", { kind: "moduleNamespace", module: "Widget" })
    if (off.outcome === "resolved") {
      failures.push("control (module channel): a qualified target resolved WITHOUT the channel's verdict — the claim may only demote it")
    }
  }

  if (externalClaimOf({ metadata: { isExternalBase: true } })?.kind !== "owner") {
    failures.push("control: `isExternalBase` no longer routes to the owner claim")
  }
  if (externalClaimOf({ metadata: { [REMOTE_REF_CLAIM_KEY]: true } })?.kind !== "remoteRef") {
    failures.push("control: `remoteRef` did not route to the reference claim")
  }
  if (externalClaimOf({ metadata: { [FILE_CLAIM_KEY]: ["a/b.yaml"] } })?.kind !== "projectFile") {
    failures.push("control: `importProjectFile` did not route to the file claim")
  }
  // AND THE WEAKER MARKER ON THE SAME EDGE MUST NOT WIN. `importProjectFile` is a statement the
  // project's file list can CHECK; `isExternalBase` is one it cannot check at all for a path
  // target. If the external marker routed first, a lane could attach both and be excused by the
  // unverifiable one — the same laundering the binding claim's ordering prevents.
  if (externalClaimOf({ metadata: { [FILE_CLAIM_KEY]: ["a/b.yaml"], isExternalBase: true } })?.kind !== "projectFile") {
    failures.push(
      "control: an edge carrying BOTH a file claim and an external marker routed to the external " +
      "marker — the checkable claim is being excused by the unverifiable one",
    )
  }

  // BUCKET 3 — THE DECLARED CAUSE, and its two anti-laundering properties are PLANTED here rather
  // than argued: (a) the stated reason must be the edge's own owner, and (b) the marker may not
  // sit on an edge that ALSO claims to be outside the population. Each plant below is one of
  // those two properties broken, except the first, which is the shape that must pass.
  const causePlants: { tgt: string; claim: ExternalClaim }[] = [
    { tgt: "BeyondThing.build", claim: { kind: "cause", base: "BeyondThing", conflict: false } },
    { tgt: "BeyondThing.build", claim: { kind: "cause", base: "OtherThing", conflict: false } },
    { tgt: "BeyondThing.build", claim: { kind: "cause", base: "", conflict: false } },
    { tgt: "BeyondThing.build", claim: { kind: "cause", base: "BeyondThing", conflict: true } },
  ]
  for (const p of causePlants) got[classifyEdge(declCount, kinds, p.tgt, p.claim).outcome]++
  if (externalClaimOf({ metadata: { baseBeyondRunScope: "BeyondThing" } })?.kind !== "cause") {
    failures.push("control: `baseBeyondRunScope` did not route to the declared-cause claim")
  }
  const twoBooks = externalClaimOf({ metadata: { baseBeyondRunScope: "X", isExternalBase: true } })
  if (twoBooks?.kind !== "cause" || !twoBooks.conflict) {
    failures.push(
      "control: an edge carrying BOTH a declared cause and an external claim did not route to the " +
      "conflicted cause — bucket 3 could be used to be verified AND excused at once",
    )
  }
  // THE PROPERTY THAT MAKES IT SAFE TO REPORT: a declared cause can never raise `resolved`, which
  // it achieves by being read ONLY where the target names nothing. A marker on a target the key
  // space DOES answer must therefore still read `resolved` — never `causeDeclared`.
  const causeOnResolvable = classifyEdge(
    declCount, kinds, "counter", { kind: "cause", base: "Counter", conflict: false },
  ).outcome
  if (causeOnResolvable !== "resolved") {
    failures.push(
      `control: a declared cause on a resolvable target read \`${causeOnResolvable}\` — the marker ` +
      `is being consulted before the count and can move a resolution number`,
    )
  }
  // Built from the constant, not typed as a literal: this control hardcoded `run#counter`, so
  // when the separator moved (see BINDING_SEP in src/ast/types.ts — nine lanes publish keys
  // containing `#`, which made every binding claim in their runs unverifiable) the control
  // would have kept testing the OLD spelling and passed a claim path that no longer worked.
  if (verifyBindingClaim(`run${BINDING_SEP}counter`) !== "bindingVerified") {
    failures.push("control: a correctly spelled binding target did not verify")
  }
  if (verifyBindingClaim("run.counter") !== "bindingRefuted") {
    failures.push("control: a DOTTED target verified as a binding — the check is not testing the separator")
  }

  // THE PROJECT-ABSOLUTE REFINER VS RESERVED PLATFORM NAMESPACES (java lane defect, 2026-10-19).
  // The refiner demotes a verified owner claim whose specifier ROOT is a directory the project
  // carries. `src/main/java` is such a directory in essentially every java checkout, so
  // `java.util.List` (specifier `java.util`, root `java`) was demoted from verified to ext?
  // although the reserved-namespace citation had already verified it — measured on the java arm
  // as 15,419 reserved-prefixed targets plus 19,540 bare targets whose files import a `java.*`
  // root. The fix exempts ONLY the reserved platforms; the non-reserved control proves the
  // demotion still fires for a real project module. Both arms are asserted here so a future edit
  // that widens or removes the exemption fails the gate instead of silently changing a lane's
  // ext? number.
  {
    const refinerFacts: ProjectFacts = {
      packages: new Set(["declared_pkg"]),
      files: new Set(["sdk/lib/async/async.dart", "src/main/java/Foo.java", "src/com/Foo.java"]),
      sdkLib: false,
    }
    const refinerArms: Array<[string, Outcome, string]> = [
      ["java.util", "externalVerified", "a reserved platform specifier must stay verified even though the project has a directory named `java`"],
      ["java", "externalVerified", "the bare reserved root must stay verified"],
      ["com.sun.net", "externalVerified", "a multi-segment reserved namespace (com.sun.) must stay verified"],
      ["async.thing", "externalUnverified", "a NON-reserved specifier root that is a real project module must still demote (the control)"],
    ]
    for (const [spec, want, why] of refinerArms) {
      const c = classifyEdge(declCount, kinds, "AbsentThing.build", { kind: "owner", specifier: spec }, refinerFacts)
      if (c.outcome !== want) failures.push(`control: refiner for specifier ${spec} read ${c.outcome}, expected ${want} — ${why}`)
    }
    // RESERVED CITATION MUST BE READ BEFORE THE PATH-LIKE REFUSAL (java lane's 243-row residual class,
    // 2026-10-19): `java.io.File`, `...Lock`, `...Path` are package paths whose leaf looks like a file
    // extension, so the path-like test used to swallow them before the reserved-namespace citation
    // branch ran. A reserved prefix is decisive; a non-reserved path-like target must still refuse.
    const reservedPathArms: Array<[string, Outcome, string]> = [
      ["java.io.File", "externalVerified", "reserved package path whose leaf is extension-like must verify by citation"],
      ["java.util.concurrent.locks.Lock", "externalVerified", "second extension-like reserved leaf"],
      ["java.nio.file.Path", "externalVerified", "third extension-like reserved leaf"],
      ["libs/File", "externalUnverified", "a NON-reserved path-like target must still refuse (the control)"],
    ]
    for (const [t, want, why] of reservedPathArms) {
      const c = classifyEdge(declCount, kinds, t, { kind: "owner" }, refinerFacts)
      if (c.outcome !== want) failures.push(`control: reserved/path-like target ${t} read ${c.outcome}, expected ${want} — ${why}`)
    }
  }

  // THE SCOPE IS APPLIED, and this asserts it rather than trusting the caller. `gamma` is
  // declared twice in the pooled key space and once in a project's — the shape seven
  // unrelated repositories produce constantly, and the whole reason the two tables exist.
  // If a future edit collapses the scopes back into one, this fails and the control exits 3.
  const oneProject = new Map<string, number>([["gamma", 1]])
  const oneProjectKinds = new Map<string, Set<string>>([["gamma", new Set(["function"])]])
  const scoped = classifyEdge(oneProject, oneProjectKinds, "gamma", null).outcome
  const pooled = classifyEdge(declCount, kinds, "gamma", null).outcome
  if (scoped !== "resolved" || pooled !== "ambBoth") {
    failures.push(
      `control: the same target classified ${scoped} in project scope and ${pooled} pooled; ` +
      `expected resolved/ambBoth — the two key spaces are not distinct`,
    )
  }

  // THE INTENT TEST'S OWN CONTROL. Each arm plants a key space with POSITIONS and asserts the class
  // `classifyIntent` returns — including the arm that must NOT fire: a type whose edge line is the
  // READ SITE can never read `intended`, however well the file matches.
  {
    const planted = new Map<string, { file: string; line: number }[]>([
      ["alpha", [{ file: "a.tf", line: 5 }]],
      ["beta", [{ file: "b.tf", line: 9 }]],
    ])
    const intentArms: Array<[string, string, string, number | null, Parameters<typeof classifyIntent>[3], string]> = [
      ["own file, own line, line-valid type", "alpha", "a.tf", 5, "exports", "intended"],
      ["own file, wrong line, line-valid type", "alpha", "a.tf", 7, "exports", "sameFileUnproven"],
      ["own file, own line, line-INVALID type is not asserted", "alpha", "a.tf", 5, "references", "sameFileUnproven"],
      ["only a foreign twin answers", "beta", "a.tf", 9, "exports", "arbitraryTwin"],
      ["nothing answers", "delta", "a.tf", 1, "exports", "noDeclaration"],
    ]
    for (const [name, tgt, src, line, label, want] of intentArms) {
      const gotIntent = classifyIntent(tgt, src, line, label, planted)
      if (gotIntent !== want) failures.push(`control (intent): ${name} classified ${gotIntent}, expected ${want}`)
    }
  }

  // ------------------------------------------------------------------------------------------
  // THE CONTAINS RULE — FOUR PLANTS, because this rule had NONE until this round and the cost is
  // written in `isContainsEdge`'s comment. `gamma` is the right target for it: 2 declarations over
  // 2 kinds, so the count model reads `ambBoth` and ONLY the contains rule may say `resolved`.
  //
  // (1) the predicate the GATE calls, asserted rather than re-spelled, so a caller that stops
  //     recognising `contains` fails here instead of silently reverting 97,797 edges to ambiguous;
  // (2) the rule's effect: the collision still RESOLVES, and the flag that says a collision
  //     existed survives it — lose the flag and a reader takes a tie-broken binding for a certain
  //     one, which is the whole subject of `boundAmongCollision`;
  // (3) the MIRROR: the same target under a non-contains label must still read `ambBoth`, so a
  //     mutant that applies the rule to every type cannot pass;
  // (4) the bound: an UNPUBLISHED contains target may not read resolved, so a mutant that makes
  //     the rule unconditional (the laundering shape) cannot pass either.
  if (!isContainsEdge("contains") || isContainsEdge("calls")) {
    failures.push(
      "control: the caller's own `contains` predicate no longer separates `contains` from `calls` " +
      "— the rule is being applied to the wrong edges, or to none",
    )
  }
  const containsHit = classifyEdge(declCount, kinds, "gamma", null, undefined, isContainsEdge("contains"))
  if (containsHit.outcome !== "resolved") {
    failures.push(`control: a colliding \`contains\` target classified ${containsHit.outcome}, expected resolved — production binds it with its own statement`)
  }
  if (containsHit.boundAmongCollision !== true) {
    failures.push("control: a colliding `contains` target resolved with NO collision flag — a tie-broken binding is being reported as a certain one")
  }
  const containsMiss = classifyEdge(declCount, kinds, "gamma", null, undefined, isContainsEdge("calls"))
  if (containsMiss.outcome !== "ambBoth") {
    failures.push(`control: the same colliding target under \`calls\` classified ${containsMiss.outcome}, expected ambBoth — the contains rule is leaking onto other types`)
  }
  const containsAbsent = classifyEdge(declCount, kinds, "delta", null, undefined, isContainsEdge("contains"))
  if (containsAbsent.outcome !== "unresolved") {
    failures.push(`control: an UNPUBLISHED \`contains\` target classified ${containsAbsent.outcome}, expected unresolved — the rule is laundering a gap into a resolution`)
  }
  // AND THE COLUMN IT FEEDS, because the rule's effect is only useful if it reaches the table: a
  // `contains` resolution must land in `resolved` and be counted in `resolvedAmongCollision` —
  // never in `ambiguousByDecl`, which is the number the verdict reads.
  const collRow = emptyOutcomes()
  tally(collRow, containsHit, "gamma", "contains")
  if (collRow.resolved !== 1 || collRow.resolvedAmongCollision !== 1 || collRow.ambiguousByDecl !== 0) {
    failures.push(
      `control: the contains resolution tallied as resolved=${collRow.resolved} ` +
      `collision=${collRow.resolvedAmongCollision} ambiguousByDecl=${collRow.ambiguousByDecl} — ` +
      `the rule fires but its outcome is not reaching the table the verdict reads`,
    )
  }

  // ── THE OWNER CHANNEL'S CONTROLS. The channel (script/m14/owner-channel.ts) is authoritative over
  // owner-carrying calls/uses rows in production, so a model that only proves the happy path would be
  // decoration. These plants drive the REAL rule function and then the REAL `classifyEdge` branch, so
  // every clause of the production pass has a pin that can go red:
  //   (1) a direct member resolves; (2) two SAME-KIND candidates are one member published twice and
  //   resolve; (3) candidates of DIFFERENT kinds decline (a method vs a property is a guess);
  //   (4) an ancestor's member resolves through the chain; (5) a QUALIFIED target never reaches the
  //   chain; (6) an absent owner and an AMBIGUOUS owner name both decline — never pick between
  //   same-named classes; (7) rule-0 identity: a call inside one of two same-named classes resolves
  //   by identity while a call elsewhere declines; (8) the `classifyEdge` branch itself: a channel
  //   DECLINE on a name-unique target must read `unresolved`, because the store WITHDREW that binding
  //   — the mutant that would otherwise credit a resolution production removed.
  const ownerRecords: OwnerSymbolRecord[] = [
    { file: "a.ts", name: "Alpha", kind: "class", line: 1, endLine: 60, ownerName: null, superTypes: [] },
    { file: "a.ts", name: "run", kind: "method", line: 5, endLine: 8, ownerName: "Alpha", superTypes: [] },
    { file: "a.ts", name: "dupe", kind: "method", line: 10, endLine: 12, ownerName: "Alpha", superTypes: [] },
    { file: "a.ts", name: "dupe", kind: "method", line: 14, endLine: 16, ownerName: "Alpha", superTypes: [] },
    { file: "a.ts", name: "twice", kind: "method", line: 20, endLine: 22, ownerName: "Alpha", superTypes: [] },
    { file: "a.ts", name: "twice", kind: "constructor", line: 30, endLine: 32, ownerName: "Alpha", superTypes: [] },
    { file: "b.ts", name: "Base", kind: "class", line: 1, endLine: 40, ownerName: null, superTypes: [] },
    { file: "b.ts", name: "inherited", kind: "method", line: 5, endLine: 6, ownerName: "Base", superTypes: [] },
    { file: "c.ts", name: "Child", kind: "class", line: 1, endLine: 40, ownerName: null, superTypes: ["Base"] },
    { file: "c.ts", name: "other", kind: "method", line: 5, endLine: 6, ownerName: "Child", superTypes: [] },
    { file: "x.ts", name: "Twin", kind: "class", line: 1, endLine: 30, ownerName: null, superTypes: [] },
    { file: "x.ts", name: "m", kind: "method", line: 5, endLine: 6, ownerName: "Twin", superTypes: [] },
    { file: "y.ts", name: "Twin", kind: "class", line: 1, endLine: 30, ownerName: null, superTypes: [] },
  ]
  const oPools = buildOwnerProjectPools(ownerRecords)
  const oVerdict = (type: string, target: string, owner: string, srcFile: string, line: number | null) =>
    ownerChannelVerdict(oPools, { type, target, owner, srcFile, line })
  const directV = oVerdict("calls", "run", "Alpha", "a.ts", 6)
  if (directV.outcome !== "resolved" || directV.reason !== "direct") {
    failures.push(`control (owner channel): a direct member classified ${directV.outcome}/${directV.reason}, expected resolved/direct`)
  }
  const dupeV = oVerdict("calls", "dupe", "Alpha", "a.ts", 6)
  if (dupeV.outcome !== "resolved" || dupeV.reason !== "sameKindDuplicate") {
    failures.push(`control (owner channel): a same-kind duplicate classified ${dupeV.outcome}/${dupeV.reason}, expected resolved/sameKindDuplicate — one member published twice is not an ambiguity`)
  }
  const kindV = oVerdict("calls", "twice", "Alpha", "a.ts", 6)
  if (kindV.outcome !== "declined" || kindV.reason !== "kindAmbiguous") {
    failures.push(`control (owner channel): candidates of two DIFFERENT kinds classified ${kindV.outcome}/${kindV.reason}, expected declined/kindAmbiguous — the channel must not choose between a method and a constructor`)
  }
  const inheritedV = oVerdict("calls", "inherited", "Child", "c.ts", 6)
  if (inheritedV.outcome !== "resolved" || inheritedV.reason !== "inherited") {
    failures.push(`control (owner channel): an ancestor's member classified ${inheritedV.outcome}/${inheritedV.reason}, expected resolved/inherited — the ancestor walk is not applied`)
  }
  const qualifiedV = oVerdict("calls", "Child.inherited", "Child", "c.ts", 6)
  if (qualifiedV.outcome !== "declined") {
    failures.push(`control (owner channel): a QUALIFIED target classified ${qualifiedV.outcome}, expected declined — a qualified target may only bind in the owner it names, never through the chain`)
  }
  const absentV = oVerdict("calls", "run", "NoSuchOwner", "z.ts", 1)
  if (absentV.outcome !== "declined" || absentV.reason !== "ownerAbsent") {
    failures.push(`control (owner channel): an absent owner classified ${absentV.outcome}/${absentV.reason}, expected declined/ownerAbsent`)
  }
  const ambigV = oVerdict("calls", "m", "Twin", "z.ts", 1)
  if (ambigV.outcome !== "declined" || ambigV.reason !== "ownerAmbiguous") {
    failures.push(`control (owner channel): an AMBIGUOUS owner name classified ${ambigV.outcome}/${ambigV.reason} from outside either class, expected declined/ownerAmbiguous — the channel must not pick between same-named classes`)
  }
  const identityV = oVerdict("calls", "m", "Twin", "x.ts", 6)
  if (identityV.outcome !== "resolved") {
    failures.push(`control (owner channel): rule-0 identity classified ${identityV.outcome}/${identityV.reason} for a call INSIDE one of two same-named classes, expected resolved`)
  }
  // THE BRANCH ITSELF — driven through the real classifier, not the rule function:
  const channelResolved = classifyEdge(new Map(), new Map(), "ghostMember", null, undefined, false, undefined, { outcome: "resolved" })
  if (channelResolved.outcome !== "resolved" || channelResolved.verifiedBy !== "ownerChannel") {
    failures.push(`control (owner channel): a channel resolution classified ${channelResolved.outcome}/verifiedBy ${channelResolved.verifiedBy ?? "-"}, expected resolved/ownerChannel`)
  }
  const channelDeclined = classifyEdge(new Map([["uniqueName", 1]]), new Map([["uniqueName", new Set(["function"])]]), "uniqueName", null, undefined, false, undefined, { outcome: "declined" })
  if (channelDeclined.outcome !== "unresolved") {
    failures.push(`control (owner channel): a channel DECLINE on a name-UNIQUE target classified ${channelDeclined.outcome}, expected unresolved — production withdrew that name binding`)
  }
  const channelAbsent = classifyEdge(new Map([["uniqueName", 1]]), new Map([["uniqueName", new Set(["function"])]]), "uniqueName", null, undefined, false, undefined)
  if (channelAbsent.outcome !== "resolved") {
    failures.push(`control (owner channel): with no channel verdict the name model changed its answer (${channelAbsent.outcome}) — the branch is not scoped to owner-carrying rows`)
  }
  const channelRow = emptyOutcomes()
  tally(channelRow, channelResolved, "ghostMember", "calls")
  if (channelRow.resolved !== 1 || channelRow.ambiguousByDecl !== 0) {
    failures.push(`control (owner channel): a channel resolution tallied as resolved=${channelRow.resolved} amb=${channelRow.ambiguousByDecl} — it is not reaching the table the verdict reads`)
  }

  if (got.resolved !== 1) failures.push(`control: expected 1 resolved, got ${got.resolved}`)
  if (got.ambDeclOnly !== 1) failures.push(`control: expected 1 ambiguous-by-declaration-only, got ${got.ambDeclOnly}`)
  if (got.ambBoth !== 1) failures.push(`control: expected 1 ambiguous-by-both, got ${got.ambBoth}`)
  if (got.unresolved !== 1) failures.push(`control: expected 1 unresolved, got ${got.unresolved}`)
  // THE LAUNDERING MUTANT. Delete either verification (return an external outcome for every
  // marked edge) and the refuted count drops to 0 and fails the control — which is the only
  // reason the number it prints can be believed.
  // 3 verified: the absent owner, and the two project-facts claims the project does not contain.
  // THE ARITHMETIC IS THE ASSERTION, so it is written out rather than implied. 8 verified:
  // 1 owner (`AbsentThing.build`) + 2 project-facts package/SDK + 1 file claim verified on its
  // second candidate + 1 file claim verified by DIRECTORY prefix + 2 reference claims verified by
  // SPELLING (a remote action and a docker image) + 1 BARE IDENTIFIER (`NoSuchBareThing`, verified
  // through the target itself — the path that makes a PASS reachable for bare-name lanes).
  if (got.externalVerified !== 8) failures.push(`control: expected 8 verified external claims, got ${got.externalVerified}`)
  // 6 refuted: a published owner, a declared package, an SDK library the project carries, a file
  // claim with no admitted candidate, a directory claim nothing sits under, and a reference claim
  // whose target IS a published declaration.
  if (got.externalRefuted !== 6) {
    failures.push(
      `control: expected 6 REFUTED external claims (owner published, package declared, SDK file ` +
      `present, file claim with no candidate, directory with nothing under it, reference claim on a ` +
      `DECLARED target), got ${got.externalRefuted} — a claim is being accepted without evidence`,
    )
  }
  // 4 unverifiable: a URI with no identifier owner, a project-facts claim with NO facts supplied, a
  // FILE claim with NO facts supplied, and a reference claim on a target that is not a reference
  // shape (plus the project path, which the file claim owns and this one must refuse). The point of
  // the last three: an unchecked claim must never read clean, and a lane must not be able to buy a
  // PASS by marking an edge with a claim whose evidence the run never built or the spelling denies.
  if (got.externalUnverified !== 5) failures.push(`control: expected 5 unverifiable external claims, got ${got.externalUnverified}`)
  // THE BARE-TARGET PATH, asserted in all three directions. It exists because a PASS was
  // UNREACHABLE for every lane whose targets are bare names (php: 2,478 of 2,483 unresolved
  // targets have no dot; bash: every command is a bare name), and since a PASS requires
  // `externalUnverified === 0`, honest marking could never get those lanes there.
  if (verifyExternalClaim(declCount, "NoSuchBareThingAtAll") !== "externalVerified") {
    failures.push("control: a bare identifier the key space does not publish did not verify as external")
  }
  if (verifyExternalClaim(declCount, "alpha") !== "externalRefuted") {
    failures.push("control: a bare identifier the key space DOES publish was not refuted — the direct lookup is not reading the key space")
  }
  if (verifyExternalClaim(declCount, "package:flutter/material.dart:*") !== "externalUnverified") {
    failures.push("control: a URI-shaped target verified as external — a path is not a published name and a lookup proves nothing about it")
  }
  if (verifyExternalClaim(declCount, "./vendor/thing.php") !== "externalUnverified") {
    failures.push("control: a PATH-shaped target verified as external")
  }
  // A RESERVED PLATFORM NAMESPACE IS A CITATION AND CANNOT BE REFUTED BY A SAME-NAMED PROJECT SYMBOL.
  // The measured defect this pins: `java.util` read extFAIL on scala3 because a test file declares
  // `public class java`, and `targetOwner("java.util")` is "java". Both directions are asserted, so a
  // future edit that widens the citation to every dotted prefix fails HERE: a CLASS-OWNED target whose
  // owner the key space publishes must still be REFUTED, or the reserved-namespace branch would have
  // swallowed the whole owner check.
  declCount.set("java", 1)
  declCount.set("Foo", 1)
  if (verifyExternalClaim(declCount, "java.util") !== "externalVerified") {
    failures.push("control: a reserved JDK package (`java.util`) was not verified by its citation — a project class named `java` must not refute it")
  }
  if (verifyExternalClaim(declCount, "java.util.List") !== "externalVerified") {
    failures.push("control: a JDK-qualified type target (`java.util.List`) was not verified by its reserved namespace")
  }
  if (verifyExternalClaim(declCount, "Foo.bar") !== "externalRefuted") {
    failures.push("control: an owner-qualified target whose owner the key space publishes was not refuted — the reserved-namespace branch must not swallow class-owner claims")
  }
  if (verifyExternalClaim(declCount, "kotlinx.coroutines") !== "externalVerified") {
    failures.push("control: a NON-reserved package path whose owner is unpublished did not verify — only reserved namespaces are citations")
  }
  if (verifiedByTarget !== 1) {
    failures.push(
      `control: expected 1 external claim confirmed through the TARGET itself, got ${verifiedByTarget} — ` +
      `the bare-name path is not labelled apart from the owner path, so a broken one would pass`,
    )
  }
  if (verifiedByOwner !== 1 || verifiedByFacts !== 4 || verifiedByRefSpelling !== 2) {
    failures.push(
      `control: expected the 7 verified claims to split 1 owner / 4 project-facts / 2 reference ` +
      `claims verified by spelling (the 2 binding claims are counted separately), got ` +
      `${verifiedByOwner} / ${verifiedByFacts} / ${verifiedByRefSpelling}`,
    )
  }
  // THE BINDING COUNTS. 2 verified from 2 spelled plants, 1 refuted (the plant whose spelling a
  // declaration answers — the phantom shape), 1 unverifiable (the trailing separator).
  if (got.bindingVerified !== 2) {
    failures.push(`control: expected 2 verified binding claims, got ${got.bindingVerified}`)
  }
  if (got.bindingRefuted !== 1) {
    failures.push(
      `control: expected 1 REFUTED binding claim (a marked target whose spelling a declaration ` +
      `answers), got ${got.bindingRefuted} — the claim is being accepted without the spelling check`,
    )
  }
  if (got.bindingUnverified !== 1) {
    failures.push(`control: expected 1 unverifiable binding claim, got ${got.bindingUnverified}`)
  }
  if (verifiedBySpelling !== 2) {
    failures.push(`control: expected 2 binding claims verified BY THE SPELLING, got ${verifiedBySpelling}`)
  }
  // BUCKET 3'S COUNTS. 1 declared from the one well-formed plant; 3 REFUTED — a base that is not
  // this edge's owner, a marker with no reason at all, and the two-books conflict. Delete either
  // check and this fails, which is the same launder-detection the external and binding counts have.
  if (got.causeDeclared !== 1) {
    failures.push(`control: expected 1 declared cause, got ${got.causeDeclared}`)
  }
  if (got.causeRefuted !== 3) {
    failures.push(
      `control: expected 3 REFUTED declared causes (base is not the target's own owner, no reason ` +
      `given, and cause+external on one edge), got ${got.causeRefuted} — bucket 3 is accepting a ` +
      `marker without checking its reason`,
    )
  }
  // MODULE-QUALIFIED RESOLUTION (PSD22/HSA12). The rule is one-way, so the control must show BOTH that
  // it fires where it may and that every refusal it claims really refuses — a rule that always returns
  // the leaf would pass a positive-only control and move 5,000 rows on a guess.
  {
    const repo = "/cr/proj"
    const repoOfFile = (f: string) => f.split("/").slice(0, 3).join("/")
    const claim: ExternalClaim = { kind: "moduleNamespace", module: "Schema" }
    const at = (file: string) => new Map([["column", [{ file, line: 3 }]]])
    const one = new Map([["column", 1]])
    const hit = moduleQualifiedLeaf("Schema.column", claim, repo, one, at("/cr/proj/src/Schema.hs"), repoOfFile)
    if (hit !== "column") {
      failures.push(`control (module-qualified): the module's own file declares the leaf once, expected the leaf back, got ${JSON.stringify(hit)}`)
    }
    const otherFile = moduleQualifiedLeaf("Schema.column", claim, repo, one, at("/cr/proj/src/Other.hs"), repoOfFile)
    if (otherFile !== null) {
      failures.push("control (module-qualified): a leaf declared in a DIFFERENT file was retargeted — the module's file is the whole evidence")
    }
    const twoDecls = moduleQualifiedLeaf("Schema.column", claim, repo, new Map([["column", 2]]), at("/cr/proj/src/Schema.hs"), repoOfFile)
    if (twoDecls !== null) {
      failures.push("control (module-qualified): a leaf with TWO declarations was retargeted — the choice would be a guess")
    }
    const selfDeclared = moduleQualifiedLeaf("Schema.column", claim, repo, new Map([["column", 1], ["Schema.column", 1]]), at("/cr/proj/src/Schema.hs"), repoOfFile)
    if (selfDeclared !== null) {
      failures.push("control (module-qualified): a qualified spelling that IS a declaration was retargeted")
    }
    const wrongModule = moduleQualifiedLeaf("Schema.column", { kind: "moduleNamespace", module: "Nope" }, repo, one, at("/cr/proj/src/Schema.hs"), repoOfFile)
    if (wrongModule !== null) {
      failures.push("control (module-qualified): a module the file does NOT answer to was retargeted")
    }
    const otherClaim = moduleQualifiedLeaf("Schema.column", { kind: "owner", specifier: "Schema" }, repo, one, at("/cr/proj/src/Schema.hs"), repoOfFile)
    if (otherClaim !== null) {
      failures.push("control (module-qualified): a non-module claim was retargeted — only the module claim carries the module path")
    }
    const nested = moduleQualifiedLeaf("Schema.Inner.column", claim, repo, one, at("/cr/proj/src/Schema.hs"), repoOfFile)
    if (nested !== null) {
      failures.push("control (module-qualified): a nested qualified target was retargeted to its last segment")
    }
  }

  return { ok: failures.length === 0, failures }
}

// ─────────────────────────────── THE BAR'S CLAUSES, ONE RESULT EACH ───────────────────────────────
/**
 * THE BAR (`archive/docs-pre-consolidation/analyzers-HANDOFF.md` §5b; restated by the owner as four clauses, 2026-10-16):
 *
 *   1  every edge resolves, or carries a claim the project verifies
 *   2  every ambiguous/unresolved edge classified by a NAMED cause, with a measured count
 *   3  each cause fixed over the SAME population, or ruled with a RUN FALSIFIER
 *   4  extFAIL / bindFAIL / causeFAIL = 0          STANDARD: RESOLVED, NOT RULED.
 *
 * WHAT WAS MISSING, worked out from this file rather than from the brief:
 *
 *   clause 1 — IMPLEMENTED, and STRICTER THAN CLAUSE 4 ALONE, deliberately. Clause 4 names the three
 *     FAIL counters (`extFAIL`/`bindFAIL`/`causeFAIL` = the `*Refuted` columns). The PASS also
 *     required `externalUnverified === 0` and `bindingUnverified === 0`. That is not a mismatch with
 *     the bar: `ext?` is defined by this programme's own legend as "a claim no check can reach",
 *     which is not "a claim the project verifies" — so an `ext?` edge fails CLAUSE 1, not clause 4.
 *     Clause 4 is implemented inside `bad`; clause 1 is implemented by `bad` + the two `*Unverified`
 *     counters. THE STRICT READING IS KEPT (see `EXTERNAL-UNVERIFIED-DECISION` below).
 *   clause 2 — HALF-IMPLEMENTED. Declared causes were COUNTED and never NAMED, so the "named" half of
 *     the clause could not be audited: a reader could see `causeDeclared 12` and not one reason.
 *     `rep.causeNames` now retains the name (`baseBeyondRunScope`'s value) and the verdict prints it.
 *   clause 3 — **UNENFORCED.** The word "falsifier" occurred in this file only inside a narrative
 *     comment about how json-lane once found a defect. NOTHING checked that a ruling carried one, so
 *     a ruling in prose passed a clause that demands a run. This is the clause implemented here.
 *   clause 4 — IMPLEMENTED: `bad` carries `externalRefuted + bindingRefuted + causeRefuted`.
 *
 * ── EXTERNAL-UNVERIFIED-DECISION ────────────────────────────────────────────────────────────────
 * KEEP `externalUnverified === 0` AS A PASS REQUIREMENT. The evidence is the programme's own
 * vocabulary, in `validation/m14/fixtures/laptop-a/README.md` and the probe logs beside it:
 *
 *     extOK   = external claim the PROJECT CONFIRMS
 *     ext?    = claim no check can reach (no identifier owner, and no project fact for it)
 *     extFAIL = claim the project REFUTES, counted against the lane
 *
 * `ext?` is a DISCLOSURE COLUMN, not a failure column — but clause 1 admits only two states, RESOLVED
 * or "carries a claim the project VERIFIES", and an unreachable claim is neither. So `ext?` blocks a
 * PASS by clause 1, and relaxing it would be reading clause 4 alone as if it were the whole bar.
 * The claim that this made a PASS unreachable for bare-name lanes was TRUE ONCE AND WAS FIXED, not by
 * relaxing the bar but by making the claim checkable: `verifyExternalClaim`'s bare-target path looks a
 * bare identifier up directly (`incoming-rule.ts:725-742`), so php's 2,478 dotless targets and bash's
 * commands CAN verify. What remains `ext?` is a target whose SPELLING makes a lookup meaningless — a
 * path, a URI, a member spelling like `operator ==` — and for those the honest report is what this
 * gate now prints: the clause that failed and the count that failed it.
 *
 * ── WHAT THIS GATE SHOULD *NOT* CHECK ───────────────────────────────────────────────────────────
 * Clause 3's falsifier cannot be VERIFIED here — a run that would have failed had the ruling been
 * wrong cannot be executed from inside a census, and pretending otherwise would be the same defect
 * this file is full of warnings about. What IS checkable, and is checked: that a ruling exists for
 * every named cause, that it names THIS run's population (clause 3's "the SAME population"), and that
 * its falsifier carries a RUN and a stated OBSERVATION that would have failed. That is a floor, and
 * the report says so rather than claiming the clause is proved.
 */
export type ClauseResult = { clause: 1 | 2 | 3 | 4; bar: string; ok: boolean; detail: string }

/** The lens clause 3's "SAME population" is judged through: a fingerprint of THIS run's population. */
export function populationFingerprint(rep: Report): string {
  return [
    `parsed=${rep.parsed}/${rep.files.length}`,
    `admitted=${rep.total}`,
    `exts=${rep.admittedExts.join(",")}`,
    `index=${rep.index ? "yes" : "no"}`,
  ].join(" ")
}

/** A cause ruling: the population it was measured over, and the run that would have FAILED if wrong. */
export type CauseRuling = { population?: string; falsifier?: { run?: string; wouldFail?: string } }

/**
 * WHERE A RULING LIVES. `validation/m14/instruments/<lang>/incoming-declaration.json` is the lane's
 * own machine-readable declaration — the only per-lane surface this gate may read (it may not write
 * one: a gate that writes its own input checks nothing). A ruling is read, never defaulted:
 * an absent file, an absent `causeRulings` map, or an unparseable file all mean NO RULING, which is a
 * clause-3 failure and not a pass.
 */
export function loadCauseRulings(lang: string): { rulings: Record<string, CauseRuling>; source: string | null } {
  const p = `validation/m14/instruments/${lang}/incoming-declaration.json`
  if (!existsSync(p)) return { rulings: {}, source: null }
  try {
    const j = JSON.parse(readFileSync(p, "utf8"))
    const r = j?.causeRulings
    return { rulings: r && typeof r === "object" ? r : {}, source: p }
  } catch {
    return { rulings: {}, source: p }
  }
}

/**
 * CLAUSE 3. Every NAMED cause with a nonzero count must be either fixed (it then has no count, so it
 * never reaches here) or RULED with a run falsifier over the SAME population.
 */
export function clause3Check(
  causeNames: Map<string, number>,
  fingerprint: string,
  rulings: Record<string, CauseRuling>,
  source: string | null,
): { ok: boolean; detail: string; failures: string[] } {
  const failures: string[] = []
  if (causeNames.size === 0) return { ok: true, detail: "no declared cause carries a count, so there is nothing to rule", failures }
  const where = source ?? "validation/m14/instruments/<lang>/incoming-declaration.json (NOT FOUND)"
  for (const [name, count] of [...causeNames].sort((a, b) => b[1] - a[1])) {
    const r = rulings[name]
    if (!r) {
      failures.push(`cause "${name}" (${count} edge(s)) has NO ruling in ${where} — clause 3 requires it fixed over this population OR ruled with a run falsifier`)
      continue
    }
    if (typeof r.population !== "string" || r.population.trim() === "" || r.population !== fingerprint) {
      failures.push(`cause "${name}" (${count} edge(s)) is ruled over a DIFFERENT population: ruling says ${JSON.stringify(r.population ?? null)}, this run is ${JSON.stringify(fingerprint)} — clause 3 says the SAME population`)
    }
    const f = r.falsifier
    if (!f || typeof f.run !== "string" || f.run.trim() === "" || typeof f.wouldFail !== "string" || f.wouldFail.trim() === "") {
      failures.push(`cause "${name}" (${count} edge(s)) carries no RUN FALSIFIER — clause 3 wants a run that would have FAILED had the ruling been wrong; a ruling with no run is prose`)
    }
  }
  return {
    ok: failures.length === 0,
    detail: failures.length === 0
      ? `${causeNames.size} named cause(s) ruled over this run's population, each with a run falsifier`
      : `${failures.length} problem(s) over ${causeNames.size} named cause(s)`,
    failures,
  }
}

/**
 * THE NEGATIVE CONTROL FOR CLAUSE 3 — a guard that cannot fail is not a guard.
 *
 * This repository produced FIVE checks that could not fail in one session, each written by someone who
 * believed it worked. So every way a ruling can be absent or hollow is planted here and the check must
 * REFUSE it, and one COMPLETE ruling must be ACCEPTED — the acceptance arm is what stops the control
 * passing by refusing everything, which is the other way a control lies.
 */
export function clause3Control(): { passed: number; failures: string[] } {
  const fp = populationFingerprint({ parsed: 120, files: Array(120), total: 999, admittedExts: ["toml"], index: null } as unknown as Report)
  const okRun = { run: "npx tsx script/m14/incoming-gate.ts toml toml 120", wouldFail: "wouldFail: a `baseBeyondRunScope` edge whose base IS declared in the corpus" }
  const arms: Array<{ name: string; want: boolean; causes: Map<string, number>; rulings: Record<string, CauseRuling> }> = [
    { name: "K no declared cause is vacuously met", want: true, causes: new Map(), rulings: {} },
    { name: "L a named cause with NO ruling is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: {} },
    { name: "M a ruling over a DIFFERENT population is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: "parsed=1/1 admitted=1 exts=toml index=no", falsifier: okRun } } },
    { name: "N a ruling with NO falsifier at all is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: fp } } },
    { name: "O a falsifier with no RUN and nothing that would fail is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: fp, falsifier: { run: "   ", wouldFail: "" } } } },
    { name: "P a COMPLETE ruling over this population is ACCEPTED", want: true, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: fp, falsifier: okRun } } },
    { name: "Q one hollow cause among several is refused, not averaged away", want: false, causes: new Map([["A", 1], ["B", 2]]), rulings: { A: { population: fp, falsifier: okRun }, B: { population: fp, falsifier: { run: "x", wouldFail: "  " } } } },
  ]
  const failures: string[] = []
  let passed = 0
  for (const a of arms) {
    const got = clause3Check(a.causes, fp, a.rulings, "control").ok
    if (got === a.want) passed++
    else failures.push(`clause-3 control ${a.name}: expected ${a.want ? "accepted" : "REFUSED"}, got ${got ? "accepted" : "REFUSED"}`)
  }
  return { passed, failures }
}

/** The four clauses, each with its own number, so a failure names what failed rather than that it did. */export function clauseResults(rep: Report, t: Outcomes): ClauseResult[] {
  const unr = t.ambiguousByDecl + t.unresolved
  const clause1ok = unr === 0 && t.externalRefuted === 0 && t.bindingRefuted === 0 && t.causeRefuted === 0 && t.externalUnverified === 0 && t.bindingUnverified === 0
  const { rulings, source } = loadCauseRulings(rep.lang)
  const c3 = clause3Check(rep.causeNames, populationFingerprint(rep), rulings, source)
  return [
    {
      clause: 1, bar: "every edge resolves, or carries a claim the project verifies", ok: clause1ok,
      detail: clause1ok
        ? `0 ambiguous + 0 unresolved, 0 refuted claim(s), 0 unverifiable claim(s) (ext? 0, bind? 0)`
        : `${unr} ambiguous/unresolved + ${t.externalRefuted + t.bindingRefuted + t.causeRefuted} refuted claim(s) + ${t.externalUnverified + t.bindingUnverified} claim(s) no check can reach (ext? ${t.externalUnverified}, bind? ${t.bindingUnverified})`,
    },
    {
      clause: 2, bar: "every ambiguous/unresolved edge classified by a NAMED cause, with a measured count",
      ok: t.causeRefuted === 0,
      detail:
        rep.causeNames.size === 0
          ? `no edge carries a declared cause (residual ${unr})`
          : `${rep.causeNames.size} named cause(s): ` + [...rep.causeNames].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(" · ") + ` (${t.causeDeclared} declared, ${t.causeRefuted} REFUTED)`,
    },
    {
      clause: 3, bar: "each cause fixed over the SAME population, or ruled with a RUN FALSIFIER",
      ok: c3.ok, detail: c3.detail + (c3.ok ? "" : ` — ${c3.failures.join(" | ")}`),
    },
    {
      clause: 4, bar: "extFAIL / bindFAIL / causeFAIL = 0", ok: t.externalRefuted === 0 && t.bindingRefuted === 0 && t.causeRefuted === 0,
      detail: `extFAIL ${t.externalRefuted} · bindFAIL ${t.bindingRefuted} · causeFAIL ${t.causeRefuted}`,
    },
  ]
}

function verdict(rep: Report): { pass: boolean; edges: number; totals: Outcomes; pooled: Outcomes; clauses: ClauseResult[]; reason: string } {
  const t = emptyOutcomes()
  const pooled = emptyOutcomes()
  let edges = 0
  const add = (into: Outcomes, r: Outcomes) => {
    into.resolved += r.resolved
    // `resolvedAmongCollision` WAS OMITTED HERE, and the error direction flattered — found by
    // json-lane (2026-10-10, `a802ac5f6`). The TOTAL row printed `collRes 0` while the per-type rows
    // carried the real values (measured on that lane's own committed run: `contains` collRes 51,
    // TOTAL 0). A completion package reads the TOTAL, so the omission said exactly one thing — "no
    // resolved edge depended on the tie-break" — which is the single reading this column exists to
    // prevent. It is a property OF the resolved rows, so it accumulates like the rest.
    into.resolvedAmongCollision += r.resolvedAmongCollision
    into.ambiguousByDecl += r.ambiguousByDecl
    into.ambiguousByKind += r.ambiguousByKind
    into.unresolved += r.unresolved
    into.markedExternal += r.markedExternal
    into.externalVerified += r.externalVerified
    into.externalVerifiedByOwner += r.externalVerifiedByOwner
    into.externalVerifiedByProjectFacts += r.externalVerifiedByProjectFacts
    into.externalUnverified += r.externalUnverified
    into.externalRefuted += r.externalRefuted
    into.bindingVerified += r.bindingVerified
    into.bindingRefuted += r.bindingRefuted
    into.bindingUnverified += r.bindingUnverified
    into.causeDeclared += r.causeDeclared
    into.causeRefuted += r.causeRefuted
  }
  for (const r of rep.rows.values()) {
    edges += r.edges
    add(t, r.project)
    add(pooled, r.pooled)
  }
  // THE FOUR CLAUSES, EACH WITH ITS OWN RESULT — computed HERE, above the early returns, because a run
  // refused for an unmeasured population or a broken key space must still say which clause it stands
  // on. `pass` is every clause met, clause 3 included, which is the clause that was unenforced until
  // now: this is the OLD condition PLUS clause 3, so no check was weakened and no lane passes that did
  // not pass before.
  const clauses = clauseResults(rep, t)
  const failedClauses = clauses.filter((c) => !c.ok)
  const clausePrefix = failedClauses.length
    ? failedClauses.map((c) => `CLAUSE ${c.clause} (${c.bar}) FAILS — ${c.detail}`).join("  ||  ") + "  --  "
    : ""
  // A lane with no corpus is UNMEASURED, which is not the same as passing and must not
  // render as one. Exits 2.
  if (rep.parsed === 0) return { pass: false, edges, totals: t, pooled, clauses, reason: "no corpus admitted — UNMEASURED, not a pass" }
  // THE BINDING CLAIM'S EVIDENCE IS THE SPELLING, and the spelling is evidence only while no
  // published declaration name carries the separator: a target containing it could then name a
  // declaration, and every binding claim in the run would be checking nothing. That is a
  // fact about the population, so it is asserted over the population and named in the verdict
  // rather than left to the per-edge check to notice.
  if (rep.bindingSpelling.keys > 0) {
    return {
      pass: false, edges, totals: t, pooled, clauses,
      reason:
        `${rep.bindingSpelling.keys} published key(s) contain the binding separator ` +
        `\`${showSep(rep.bindingSpelling.separator)}\` ${JSON.stringify(rep.bindingSpelling.examples).replace(/\\u0000/g, "\\\\u0000")}, so a target ` +
        `carrying it can name a declaration — every binding claim in this run is unverifiable`,
    }
  }
  // A REFUTED external claim is a bad edge. It is not in `unresolved` (that column is
  // "carries no external claim") and must not be, but it is counted here so that a lane
  // whose large population is external-LOOKING cannot buy a PASS with a marker.
  // `causeRefuted` IS IN `bad`, and `causeDeclared` deliberately is NOT: a declared cause is a
  // stated reason that passed its own checks (its column is reported, never folded into a
  // resolution), while a refuted one is a claim whose own spelling does not check out. The
  // asymmetry is what keeps bucket 3 honest in both directions.
  const bad = t.ambiguousByDecl + t.unresolved + t.externalRefuted + t.bindingRefuted + t.causeRefuted
  const ext = `${t.externalVerified} verified + ${t.externalUnverified} unverifiable external`
  const bind =
    `${t.bindingVerified} binding(s) spelled as a binding` +
    (t.bindingUnverified > 0 ? ` + ${t.bindingUnverified} unverifiable` : "") +
    (t.causeDeclared > 0 ? ` + ${t.causeDeclared} declared cause(s) beyond this run's reach` : "")
  const scope = `of ${edges} edges, resolved against the file's OWN PROJECT (production's scope)`
  if (clauses.every((c) => c.ok)) {
    return {
      pass: true, edges, totals: t, pooled, clauses,
      reason: `every one ${scope} resolves to exactly one declaration, or carries a claim the project confirms (${ext}; ${bind})`,
      // NOT REACHABLE TODAY FOR DART, and left in place because it is the shape a PASS takes: the
      // per-file column carries declared causes, which do not score, so this branch is entered only
      // where the residue is empty — see the contract in `docs/analyzers/dart.md`.
    }
  }
  if (bad === 0) {
    return {
      pass: false, edges, totals: t, pooled, clauses,
      reason:
        clausePrefix +
        `${t.externalUnverified} external claim(s) name no identifier-shaped owner, so the project can neither confirm nor deny them (${ext})`,
    }
  }
  return {
    pass: false, edges, totals: t, pooled, clauses,
    reason:
      clausePrefix +
      `${t.ambiguousByDecl} ambiguous + ${t.unresolved} unresolved ${scope}` +
      (t.externalRefuted > 0 ? `, and ${t.externalRefuted} external claim(s) REFUTED by the project` : "") +
      (t.bindingRefuted > 0 ? `, and ${t.bindingRefuted} binding claim(s) REFUTED — a target marked as a binding whose spelling can name a declaration` : "") +
      (t.causeRefuted > 0 ? `, and ${t.causeRefuted} declared cause(s) REFUTED — the stated base is not the edge's own owner, or the edge also claims to be outside the population` : "") +
      (t.externalUnverified > 0 ? `; ${t.externalUnverified} external claim(s) unverifiable (${ext})` : ""),
  }
}

const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)

function printReport(rep: Report, control: { ok: boolean; failures: string[] }) {
  const v = verdict(rep)
  console.log(`incoming gate — ${rep.lang}`)
  // THE CORPUS ROOT IS PART OF THE POPULATION CLAIM, and until 2026-10-20 the header did not say
  // which one it walked. Measured consequence: the corpus has TWO roots — the default
  // (`$HOME/fixtures/repositories`, 199 repos) and the symlink farm the campaign's own
  // commands select with `BB_CORPUS_ROOT=$PWD/.corpus` (202 repos: the 199 plus three LOCAL
  // checkouts — `pixie`, `plack`, `tf-aws-components`). They are DIFFERENT POPULATIONS, and 24 of
  // the 48 lanes admit a different number of files under each (perl 427 vs 656; hcl 9,329 vs
  // 11,139; protobuf 847 vs 907; typescript 17,350 vs 17,689). Every recorded population that
  // differs between the roots matches the FARM, and none matches the default — so the record and
  // the gate's own default have quietly measured different things, and a run without the
  // environment override is not a re-run of the recorded arm. A population claim that does not name
  // its root cannot be compared with anything. (See
  // validation/m14/verification/FLEET-POPULATION-TABLE-2026-10-20.md.)
  console.log(
    `corpus root: ${CR}` +
    (CR === DEFAULT_CORPUS_ROOT
      ? ` (the DEFAULT)`
      : ` (OVERRIDDEN by BB_CORPUS_ROOT — a DIFFERENT population from the default ` +
        `${DEFAULT_CORPUS_ROOT}; a rate measured here is not comparable with a rate measured there)`),
  )
  console.log(
    `population: ${rep.parsed} parsed of ${rep.files.length} sampled ` +
    `(corpus has ${rep.total} .${rep.ext} files across ${rep.repos} repos; ` +
    (rep.isWholePopulation ? "stride sample)" : "CHUNK)"),
  )
  // ★ A CHUNK IS NOT A POPULATION, AND THE RUN SAYS SO ON ITS OWN LINE. This is printed whenever the
  // run measured a SLICE of the admitted set, with the slice's own bounds, so a reader can tell a
  // chunk from a whole population WITHOUT knowing how the run was invoked. The dart lane's proposal
  // (2026-10-21) is the reason this exists: the shared instrument's unit of work was a whole
  // repository, so three of dart's six repositories — dart-sdk 25,727 · flutter-packages 4,028 ·
  // proxicall 2,350 — REFUSED the small arm slot's 2,000-file cap on their own, and the chunked path
  // could not reach them at all. ⇒ The chunks are DISJOINT slices of ONE SORTED admitted list, so
  // walking them from offset 0 covers the population exactly, and the SUM of the chunks' buckets IS
  // the population's buckets — with `amb(kind)` summed BESIDE it and never added.
  if (!rep.isWholePopulation) {
    console.log(
      `population: ★ THIS RUN IS A CHUNK, NOT A POPULATION — admitted files [${rep.sliceStart}, ` +
      `${rep.sliceEnd}) of ${rep.total}, and ${rep.files.length} of them were measured.`,
    )
    console.log(
      `population: the chunk is a SLICE of the admitted set, not a stride of it, so it is DISJOINT ` +
      `from a chunk at another offset and the chunks COVER the population when walked from offset 0.`,
    )
  }
  // THE ADMITTED SPELLINGS ARE PART OF THE POPULATION CLAIM (HANDOFF §5.2). Printed on their own
  // line so a run against half the lane's files cannot be read as a run against the lane: on
  // ansible `.yaml` alone is 13 files and `.yaml,.yml` is 2,082, same language, same lane.
  const tableSet: string[] = (rep as any).tableExts ?? []
  const tableSetText = tableSet.length > 0 ? tableSet.map((e) => `.${e}`).join(", ") : "(the ONE TABLE has no entry for this lane)"
  const sameAsTable = tableSet.length > 0 && tableSet.join(",") === rep.admittedExts.join(",")
  console.log(
    `population: admitted extensions = ${rep.admittedExts.map((e) => `.${e}`).join(", ")} ` +
    `(SOURCE: ${(rep as any).extSource ?? "unknown"}) ` +
    `(the ROUTER'S ONE TABLE says: ${tableSetText} — ${sameAsTable ? "SAME as this run" : (tableSet.length > 0 ? "*** THIS RUN IS A SUBSET OF THE LANE'S SPELLINGS ***" : "no table entry")}) ` +
    `(${rep.admittedExts.length === 1 ? "ONE spelling" : `${rep.admittedExts.length} spellings`}) ` +
    `— PLUS a bare BASENAME equal to any of them WHEN THE ROUTER'S OWN DETECTION GIVES IT TO ` +
    `THIS LANE (\`Makefile\` has no extension to match, and an extension-only rule measured 129 ` +
    `files where the production router admits ${rep.total} for THIS lane in THIS run — but the ` +
    `router's verdict is a LANGUAGE, not a spelling: \`dart-sdk/sdk/bin/dart\` is a bash script and ` +
    `is NOT this lane's file).`,
  )
  console.log(
    rep.index === null
      ? `project index: NOT USED — this is the per-file population, which is NOT the one ` +
        `production parses (re-run with --index to measure that one)`
      : `project index: USED — ${rep.index.repos} repo index(es) (${rep.index.built} built, ` +
        `${rep.index.cached} from cache, ${rep.index.damaged} damaged) over ${rep.index.indexed} file(s) — ` +
        `the files THIS RUN sampled, so an index over a stride sample is not a project index ` +
        `(run with maxFiles 0 for the real one). Passed as ` +
        `{ projectIndex } exactly as \`pool-worker.ts\` parse_batch does. ` +
        `INDEX-ASSISTED POPULATION, and the distinction is not academic: with the index IN, ` +
        `cross-file base resolution and the widened type-visibility gate are measured. ` +
        // WHICH LANGUAGES PRODUCTION ACTUALLY INDEXES, stated as a fact that was WRONG here twice:
        // this line said "names only .sol" (it named .sol and .fs) and then that the population is
        // production's "only once .dart is added". `.dart` IS STILL NOT IN THE TABLE — the dart spec
        // exists and is unreachable in production — so a dart file is parsed with no context and
        // behaves as this run's --index-less arm does, while `.proto` IS in the table since
        // 2026-10-11 and its --index population IS production's. A header that is wrong about which
        // languages are indexed is the population rule applied to the instrument itself.
        // DERIVED FROM `INDEX_SPECS`, NOT HAND-LISTED. The previous text named `.sol`, `.fs` and
        // `.proto` only, and went stale the moment SCSS, DART and JAVA gained entries: java's lane
        // measured against a header that told it the arm it was using did not exist for its language.
        // A hand-written list of what an instrument covers is a claim about the instrument, so it
        // drifts exactly like any other — this one now reads its own table.
        `THE GATE'S PROJECT-INDEX POPULATION is ${Object.keys(INDEX_SPECS).sort().join(", ")} ` +
        `(the languages \`INDEX_SPECS\` can build an index for). For those, this population IS ` +
        `production's; for every other language the analyzer is parsed with NO context and behaves ` +
        `as this run's --index-less arm does, so its counts are not comparable to a --index-less run. ` +
        `Production's own list is PROJECT_INDEX_EXTENSIONS in src/ast/parallel-indexer.ts; a language ` +
        `in that list with no INDEX_SPECS entry here is a gap in THIS instrument, not in production.`,
  )
  console.log(
    `excluded from that population: ${rep.excluded.absent} tracked-but-absent/unreadable + ` +
    `${rep.excluded.overCap} over the ${(rep.excluded.sizeCapBytes / 1024 / 1024).toFixed(0)} MB cap ` +
    (rep.excluded.overCap > 0 ? `(largest ${(rep.excluded.overCapLargest / 1024 / 1024).toFixed(1)} MB)` : "") +
    ` — above the cap the engine extracts structurally, not as an analyzer`,
  )
  console.log(`parse failures: ${rep.failed}   degraded (regex fallback): ${rep.degraded}`)
  // THE WALK'S OWN POPULATION, because this walk decides which packages the project is said to
  // declare — and that set is what turns an external claim into `extOK` or `ext?`. A walk that skipped
  // symlinked subtrees made the project look like it declared LESS than it does, i.e. it moved claims
  // from `extOK` to `ext?` — the direction that makes a lane look less verifiable than it is.
  if (symlinkedDirsFollowed > 0) console.log(
    `project-facts walk: ${symlinkedDirsFollowed} SYMLINKED director(ies) FOLLOWED — ` +
    `\`Dirent.isDirectory()\` is false for a symlink, so before this fix every such subtree was ` +
    `skipped and a package declared under one read as a claim no check can reach. Cycles are bounded ` +
    `by a realpath seen-set, so the count is a fact about the tree and not about a walk that spun.`,
  )
  if (rep.bindingCollapse === true) console.log(
    `binding collapse (--binding-collapse): ${(rep.bindingCollapsedKeys ?? 0).toLocaleString()} key(s) read as ONE ` +
    `declaration because every declaration answering to them carries the SAME NON-EMPTY qualifiedName ` +
    `(julia's method table: one generic function, many method declarations). A key whose declarations ` +
    `share only a SPELLING is NOT collapsed — that is the difference between one binding and a name ` +
    `coincidence, and it was 95.8% of the naive count on this lane (JUL-D19).`,
  )
  console.log(
    `endpoint keys indexed: name + ${rep.aliasedKeys} qualifiedName alias(es). A lane that ` +
    `publishes a file-scoped qualified name and targets that path is measured, not missed.`,
  )
  if (rep.degradedFiles.length) for (const f of rep.degradedFiles.slice(0, 5)) console.log(`    ${f}`)
  {
    const empty = ((rep as any).emptyResults as string[] | undefined) ?? []
    if (empty.length) {
      // AN EMPTY FILE IS NOT A TIMED-OUT FILE, AND THIS LINE USED TO SAY IT WAS.
      //
      // `emptyResults` is ONE counter over two populations that mean OPPOSITE things: a 0-byte (or
      // whitespace-only) file has NO CONTENT TO EXTRACT — the run missed nothing and the population
      // is COMPLETE — while a file WITH CONTENT that returned nothing is a HOLE in the population
      // (`engine.ts:1991` returns `{symbols: [], relationships: []}` on a timeout, so the file
      // contributes NO EDGES and is invisible by construction).
      //
      // This printed the timed-out warning over BOTH, so on clean-stdlib it announced "the population
      // is INCOMPLETE" over `_library.dcl`, `_startup.dcl` and `_system.dcl` — three files that are
      // **0 bytes**, where the truth is the opposite: nothing was missed. A disclosure that fires on
      // the benign case trains its reader to ignore it on the real one, which is worse than not
      // printing it. The content is read and the two are reported separately.
      const classified = classifyEmptyResults(empty)
      const contentless = classified.filter((c) => c.kind === "contentless")
      const unknown = classified.filter((c) => c.kind === "unknown")
      if (contentless.length) console.log(
        `empty results: ${contentless.length} file(s) hold NO CONTENT AT ALL (0 bytes or whitespace). ` +
        `The run missed nothing, the population is COMPLETE, and these are NOT a defect.`)
      // THE THIRD CATEGORY, AND IT IS NOT ASSERTED AS A HOLE. This counter cannot separate a parse
      // failure from content that simply cannot declare anything. See `script/m14/empty-result-kind.ts`
      // for julia-lane's measurement: its three flagged files were two 8-BYTE files containing
      // `# empty` and a comments-only `julia/etc/startup.jl`, all parsing to 2-3 nodes with NO declaring
      // node, so for THOSE the population IS complete and nothing was missing.
      //
      // AND BOTH READINGS OCCUR IN THIS FLEET: graphql-lane reports 45 of 1,911 files holding content
      // and returning nothing, with `engine.ts:1991` timeouts as the standing explanation. So this is
      // not "usually benign" either — it is genuinely undecidable from the counter, and asserting
      // either direction is the defect. Read the files before you call them.
      if (unknown.length) console.log(
        `empty results: ${unknown.length} file(s) hold CONTENT AND RETURNED NOTHING. **THIS COUNTER ` +
        `CANNOT TELL WHICH OF THREE THINGS THEY ARE**: content that cannot declare anything (comments, ` +
        `blank bodies — population COMPLETE), a genuine parse failure or timeout (a HOLE in it), or a ` +
        `file the analyzer declined. Do NOT report them as a hole without reading them.`)
      // UNKNOWNS FIRST: they are the ones a reader must not silently resolve in either direction.
      for (const c of [...unknown, ...contentless].slice(0, 5)) console.log(
        `    ${c.kind === "contentless" ? "empty " : "????? "}${c.path}`)
    }
  }
  console.log(
    `ambiguous is counted by DECLARATION here. The kind-count is shown beside it because ` +
    `the fleet's earlier number used it, and the two differ by two orders of magnitude.`,
  )
  if (rep.files.length < rep.total) {
    console.log(
      `SAMPLE, NOT POPULATION: ${rep.files.length} of ${rep.total} files. A stride sample ` +
      `truncates each project's symbol table too, so its project-scoped RESOLVED share is ` +
      `biased UP — a name whose collision lives in an unsampled file of the same repository ` +
      `reads unique here. Run with maxFiles 0 for a number about the corpus.`,
    )
  }
  console.log(
    `resolution scope: PER PROJECT (the repository a file belongs to) — production's scope. ` +
    `\`parallel-indexer.resolveRelationships\` fills \`target_symbol_id\`` +
    ` only from a project-scoped qualified-name exact match, or from a bare name whose count ` +
    `in THAT project is exactly 1 (` +
    `\`_res_name.cnt = 1\`, \`WHERE s.project_id = ?\`). A name that collides with a ` +
    `declaration in ANOTHER project is not ambiguous to production and is not counted as ` +
    `ambiguous here.`,
  )
  console.log()
  console.log(`TABLE 1 — PER PROJECT, the scope production resolves in (this is the verdict's):`)
  // THE HEADER MUST BE IN THE EMITTER'S ORDER, and it was not. `line()` emits
  // `edges, resolved, resolvedAmongCollision, amb(decl), …` while this header listed `collRes`
  // THIRD-FROM-LAST, so the printed table mislabelled every column from `amb(decl)` onward and
  // read `ext?` under the heading `extFAIL`. Reported by json-lane, which proved it against the
  // instrument's OWN VERDICT SENTENCE rather than against a parser: kubernetes' verdict reads
  // "(3 verified + 38 unverifiable external)" — the header's mapping calls that `extFAIL 38`,
  // the emitter's mapping calls it `ext? 38, extFAIL 0`, and the sentence decides.
  //
  // The damage was not cosmetic: it is where the Lead's "82 refuted" and json-lane's "46 / 42 /
  // 120" all came from — four wrong numbers, all reading `ext?` in the `extFAIL` slot, all of
  // them REFUTATIONS THAT DID NOT EXIST. A header is part of the measurement.
  const header =
    w("type", 14) + w("edges", 9) + w("resolved", 10) + w("collRes", 9) + w("amb(decl)", 11) +
    w("amb(kind)", 11) + w("unresolved", 12) + w("extOK", 8) + w("ext?", 8) +
    w("extFAIL", 9) + w("bindOK", 9) + w("bind?", 8) + w("bindFAIL", 10) +
    w("causeOK", 9) + "causeFAIL"
  console.log(header)
  console.log("-".repeat(148))
  const line = (label: string, r: Outcomes, edges: string | number) =>
    w(label, 14) + w(edges, 9) + w(r.resolved, 10) + w(r.resolvedAmongCollision, 10) + w(r.ambiguousByDecl, 11) +
    w(r.ambiguousByKind, 11) + w(r.unresolved, 12) +
    w(r.externalVerified, 8) + w(r.externalUnverified, 8) + w(r.externalRefuted, 9) +
    w(r.bindingVerified, 9) + w(r.bindingUnverified, 8) + w(r.bindingRefuted, 10) +
    w(r.causeDeclared, 9) + String(r.causeRefuted)
  for (const type of ALL_TYPES) {
    const r = rep.rows.get(type)!
    console.log(line(type, r.project, r.edges))
  }
  console.log("-".repeat(93))
  console.log(line("TOTAL", v.totals, v.edges))
  console.log(
    "collRes = of `resolved`: the target had MORE THAN ONE declaration, so production's tie-break chose the row — the indexer measures 37,318 of 49,729 such picks as WRONG · " +
    "extOK = external claim the PROJECT CONFIRMS · " +
    "ext? = claim no check can reach (no identifier owner, and no project fact for it) · " +
    "extFAIL = claim the project REFUTES, counted against the lane",
  )
  console.log(
    `bindOK = a target SPELLED as a binding (\`<callable>${showSep(rep.bindingSpelling.separator)}<binding>\`), which no ` +
    `declaration can answer · bind? = a separator with nothing after it · ` +
    `bindFAIL = marked as a binding but spelled so it CAN name a declaration, counted against the lane`,
  )
  console.log(
    `causeOK = bucket 3: the target names nothing here and the edge DECLARED why (a base beyond ` +
    `the run's reach), so it is stated rather than claimed — NEVER folded into resolved · ` +
    `causeFAIL = a declared cause whose own reason does not check out, counted against the lane`,
  )
  // The columns are NOT disjoint groups of equal standing: `amb(kind)` is a SUBSET of
  // `amb(decl)` (both are printed because a lane reads them for different reasons), and saying
  // so here is cheaper than the reader re-deriving it — the sum is the check.
  console.log(
    `amb(kind) is a SUBSET of amb(decl), printed beside it for comparison: ` +
    `resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + ` +
    `causeOK + causeFAIL = the edge count, exactly.`,
  )
  // FALLBACK ROWS — reported because they are IN the columns above and are NOT the analyzer's.
  {
    const fb = (rep as any).fallbackRows as Map<string, number> | undefined
    const totalFb = fb ? [...fb.values()].reduce((a, b) => a + b, 0) : 0
    if (totalFb > 0) {
      console.log()
      console.log(
        `FALLBACK ROWS — ${totalFb} of the ${v.edges} edges above came from pool-worker.ts's ` +
        `extractFallback() (metadata { method: "regex" }), NOT from the analyzer:`,
      )
      for (const [t, n] of [...(fb ?? new Map()).entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(t).padEnd(14)} ${String(n).padStart(9)} fallback row(s)`)
      }
      console.log(
        `  They are COUNTED above rather than removed, so the published figure stays reproducible — ` +
        `but a fallback row comes from a different instrument than the analyzer, it is a property of ` +
        `THE RUN (how many files aborted under load) rather than of the language, and it rarely ` +
        `resolves, so it INFLATES the residual and DEFLATES every rate.`,
      )
      console.log(
        `  >>> DEDUCT ${totalFb} FROM THE RESIDUAL, AND FROM THE EDGE COUNT, BEFORE COMPARING THIS ` +
        `TABLE WITH ANOTHER RUN. A lane whose analyzer does not emit a type at all can still show ` +
        `one here: markdown measured 5,452 of its 15,525 residual as fallback rows (calls 5,528 + ` +
        `instantiates 399), with a sequential census reading calls 0 · instantiates 0 · 0 degraded.`,
      )
    }
  }
  // THE POPULATION HALF OF THE BINDING CLAIM. A per-edge verification of the spelling is
  // only honest while the separator really is unspeakable as a name here, and that is a fact
  // about the key space — asserted once, over the finished space, because the walk classifies
  // edges while the space is still being built.
  console.log(
    `separator tripwire: ${rep.bindingSpelling.keys} published key(s) contain ` +
    `\`${showSep(rep.bindingSpelling.separator)}\` of ${v.edges} edges measured` +
    (rep.bindingSpelling.keys > 0
      ? ` — ${JSON.stringify(rep.bindingSpelling.examples)} — THE CLAIM'S EVIDENCE IS VOID IN THIS POPULATION`
      : ` (0 required: a declaration name carrying it would make a binding claim unfalsifiable)`),
  )
  // WHICH EVIDENCE CONFIRMED THEM. Two mechanisms can produce `extOK`, and a lane must be
  // able to audit the one that did: a claim about a DECLARATION is checked by looking its
  // owner up in the key space, a claim about a FILE is checked against the project's own
  // pubspec files and admitted file list. Printed separately because "verified" without
  // saying by what is the shape of number this programme keeps having to retract.
  if (v.totals.externalVerified > 0) {
    console.log(
      `    of those ${v.totals.externalVerified} verified: ` +
      `${v.totals.externalVerifiedByOwner} by owner lookup in the key space, ` +
      `${v.totals.externalVerifiedByProjectFacts} against the project's own pubspec files + file list`,
    )
  }
  // WHICH MARKERS THE UNWALKABLE EDGES CARRY. A count says how much is unresolved; it does not
  // say WHAT the unresolved edges are, and a round chosen from a count alone is a guess. Each
  // line is a marker a rule could act on, with the RESOLVED share printed beside it so a marker
  // that is already handled reads as handled rather than as remaining work.
  const markRows: { type: Type; sig: string; b: MarkBucket }[] = []
  for (const type of ALL_TYPES) {
    for (const [sig, b] of rep.rows.get(type)!.marks) {
      if (b.amb + b.unres + b.bind + b.cause > 0) markRows.push({ type, sig, b })
    }
  }
  if (markRows.length) {
    console.log(
      `EDGES A MARKER SET EXPLAINS — NOT-RESOLVED, PLUS BINDINGS (diagnostic, PER PROJECT scope, ` +
      `up to 5 marker sets per type ordered by amb+unresolved, then any binding-bearing set):`,
    )
    console.log(
      w("type", 14) + w("metadata KEYS on the edge", 52) + w("resolved", 10) + w("amb", 9) +
      w("unres", 9) + w("extClaim", 10) + w("binding", 9) + "cause",
    )
    console.log("-".repeat(122))
    for (const type of ALL_TYPES) {
      const mine = markRows
        .filter((m) => m.type === type)
        // THE WORK, ranked by what is LEFT — because that is what the top of this table is for.
        // A binding does NOT belong in this ranking: `bindOK` is a verified outcome, and ranking
        // it with the gaps would put a class with nothing left to do at the top of a list of
        // remaining work. They are printed below instead, so neither is hidden.
        .sort((x, y) => y.b.amb + y.b.unres - (x.b.amb + x.b.unres))
        .slice(0, 5)
      // BINDINGS AND DECLARED CAUSES are both printed below the ranking rather than inside it:
      // neither is remaining WORK in the sense the top of this table means (a verified binding
      // has nothing left to do, and a declared cause is a stated, count-not-score bucket), and
      // ranking either with the gaps would hide what actually remains.
      const bindOnly = markRows
        .filter((m) => m.type === type && (m.b.bind > 0 || m.b.cause > 0) && !mine.includes(m))
        .sort((x, y) => y.b.bind + y.b.cause - (x.b.bind + x.b.cause))
      const show = (m: { type: Type; sig: string; b: MarkBucket }) =>
        console.log(
          // THE SIGNATURE IS NO LONGER TRUNCATED. It was cut at 47 chars with a `...`, which made a
          // marker-set key like `methodCall+noDeclarationInFile+on+powershellSpe...` unreadable — so
          // the worklist this block exists to be could not be USED as one, which is a defect in the
          // instrument rather than a limitation of the data. Found by r-lane on powershell, which
          // noted the largest row happened to fit untruncated and the smaller rows did not.
          //
          // A worklist whose identifying key is elided is not a worklist. The column is widened to
          // the full signature; the layout is wide either way and a readable key is worth the width.
          w(m.sig, Math.max(52, m.sig.length + 2)) +
          w(m.b.resolved, 10) + w(m.b.amb, 9) + w(m.b.unres, 9) + w(m.b.ext, 10) +
          w(m.b.bind, 9) + String(m.b.cause),
        )
      for (const m of mine) show(m)
      for (const m of bindOnly) show(m)
      // THE TABLE MUST SHOW ITS OWN CLOSURE. `mine` is the top 5 by amb+unres and `bindOnly` catches
      // the binding/cause-bearing sets — so a set ranked BELOW the top 5 with NO binding and NO cause
      // was printed NOWHERE, and its edges were silently absent from a table whose entire stated
      // purpose is to be the worklist a lane works from.
      //
      // php-lane found it by arithmetic on its own table, not by reading the prose: `uses`'s five
      // printed sets sum to 139,864 of 155,016 edges — **15,152 edges (9.8%) in marker sets this
      // block never prints**, carrying amb 3,482 + unres 1,052 — so the instruction "split the
      // residual by the gate's marker table" could not reach closure, and the lane's largest
      // remaining cause was INVISIBLE in the instrument built to name it.
      //
      // Seventh instance of one family in this programme: a table that does not show its own
      // closure. The remedy is a DISCLOSURE, not a wider cap — the cap is what keeps the table
      // readable, and an instrument that silently drops rows is worse than one that prints fewer and
      // says so. Read this row into your worklist; do not read the printed rows as the whole set.
      {
        const omitted = markRows.filter((m) => m.type === type && !mine.includes(m) && !bindOnly.includes(m))
        if (omitted.length) {
          const s = omitted.reduce(
            (a, m) => ({
              resolved: a.resolved + m.b.resolved, amb: a.amb + m.b.amb,
              unres: a.unres + m.b.unres, ext: a.ext + m.b.ext,
            }),
            { resolved: 0, amb: 0, unres: 0, ext: 0 },
          )
          console.log(
            w("  ⋯ OMITTED", 14) + w(`${omitted.length} further marker set(s) NOT printed above`, 52) +
            w(s.resolved, 10) + w(s.amb, 9) + w(s.unres, 9) + w(s.ext, 10) + w(0, 9) + "0",
          )
          console.log(
            w("", 14) + w(`  ^ add these to the rows above or the type will not close`, 52),
          )
        }
      }
    }
    console.log("-".repeat(122))
    console.log(
      `extClaim = a claim on this marker set the project VERIFIED or that no check can reach · ` +
      `binding = edges on this marker set SPELLED as a binding · ` +
      `cause = edges on this marker set whose analyzer DECLARED why it could not reach the base ` +
      `(bucket 3; never a resolution, and its own column so it cannot be mistaken for one). ` +
      `Grouped by KEY only: a value would split one marker into a signature per symbol it names.`,
    )
  }
  console.log()
  // THE OTHER QUESTION, kept because every dart number in this programme before today was
  // measured this way and a table that silently changed its unit is worse than one that
  // reports two. It is NOT the verdict's scope: pooling seven unrelated projects into one
  // key space makes a name ambiguous that production resolves the moment it lands in a
  // project where it is unique.
  const ident = (a: Outcomes, b: Outcomes) =>
    a.resolved === b.resolved && a.ambiguousByDecl === b.ambiguousByDecl && a.unresolved === b.unresolved
  console.log(
    ident(v.totals, v.pooled)
      ? `TABLE 2 — PER CORPUS (pooled key space): identical to table 1 for this run.`
      : `TABLE 2 — PER CORPUS (one pooled key space; NOT the verdict's scope, shown because ` +
        `every earlier dart number in this programme was measured this way):`,
  )
  if (!ident(v.totals, v.pooled)) {
    console.log(w("type", 14) + w("edges", 9) + w("resolved", 10) + w("amb(decl)", 11) + w("unresolved", 12) + "extFAIL")
    console.log("-".repeat(65))
    for (const type of ALL_TYPES) {
      const r = rep.rows.get(type)!
      console.log(
        w(type, 14) + w(r.edges, 9) + w(r.pooled.resolved, 10) + w(r.pooled.ambiguousByDecl, 11) +
        w(r.pooled.unresolved, 12) + String(r.pooled.externalRefuted),
      )
    }
    console.log("-".repeat(65))
    console.log(
      w("TOTAL", 14) + w(v.edges, 9) + w(v.pooled.resolved, 10) + w(v.pooled.ambiguousByDecl, 11) +
      w(v.pooled.unresolved, 12) + String(v.pooled.externalRefuted),
    )
  }
  console.log()
  // THE WORKLIST. A count a lane cannot resolve back to the things it counted leaves the
  // only response as re-running the whole lane hoping to see it again, and it is not
  // guaranteed to reproduce — so the gate prints the offending target strings, capped.
  // This is the difference between "296 ambiguous" and a list of 296 names.
  const ambList = [...rep.rows.values()].flatMap((r) =>
    r.project.ambiguousNames.map((a) => ({ ...a, type: r.type })),
  )
  const unresList = [...rep.rows.values()].flatMap((r) =>
    r.project.unresolvedNames.map((u) => ({ ...u })),
  )
  // BOTH LISTS, together: a run can have unresolved names and no ambiguous ones (a lane whose
  // targets name nothing at all), and gating the print on the ambiguous list alone would hide
  // exactly that case's worklist.
  // THE EXACT INTENT SPLIT — see `classifyIntent`. Per TYPE, because the types differ by 3x on the
  // store (terragrunt-900: `contains` crossed files at 4.7%, `exports` at 15.5%) and a single ratio
  // hides that. The line test is applied ONLY where the edge line is the target symbol's own start
  // line, and the note says which types those are.
  {
    const withIntent = [...rep.rows.values()].filter((r) => r.intent.intended + r.intent.sameFileUnproven + r.intent.arbitraryTwin + r.intent.noDeclaration + r.noTarget > 0)
    if (withIntent.length) {
      const intentTotals = withIntent.reduce((a: any, r) => ({
        intended: a.intended + r.intent.intended, sameFileUnproven: a.sameFileUnproven + r.intent.sameFileUnproven,
        arbitraryTwin: a.arbitraryTwin + r.intent.arbitraryTwin, noDeclaration: a.noDeclaration + r.intent.noDeclaration,
        noTarget: a.noTarget + r.noTarget,
        edges: a.edges + r.edges,
      }), { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0, noTarget: 0, edges: 0 })
      console.log(`BINDING INTENT — the EXACT test beside the count model's upper bound (resolvedAmongCollision):`)
      console.log(`  intended = a declaration in the edge's OWN FILE ON the edge's own line answers to the target`)
      console.log(`  (exact only where the edge line IS the target symbol's line: ${[...LINE_IS_TARGET_LINE].join(", ")}.)`)
      console.log(`  For every other type the edge line is the READ SITE, so a same-file row is sameFileUnproven —`)
      console.log(`  not wrong and not right; arbitraryTwin is the file-crossing class in both cases.`)
      // ── THE COLUMN NAME `noDeclaration` MISLED A CAREFUL LANE, AND THE NAME IS THE DEFECT.
      //
      // nim-lane reported a contradiction of **45,967 edges** between this block and its own split, on the
      // reading that `noDeclaration` means "no declaration in the EDGE'S OWN FILE". It means **nothing
      // ANYWHERE in the run's key space**. The class nim measured — own file declares nothing, another
      // file does — is `arbitraryTwin`, and on the FULL nim population this block reports:
      //
      //     calls  118262 edges · intended 0 · sameFileUnproven 46001 · arbitraryTwin 70223 · noDeclaration 2038
      //     TOTAL  267284        · 29337      · 121009            · 113007            · 3931
      //
      // **70,223 arbitraryTwin IS nim's class, and both rows close EXACTLY on their own edge counts.**
      // So there was no contradiction: there was a name that reads as "no declaration [in the file]" and
      // means "no declaration [anywhere]". A lane that goes looking for its own-file-absent edges under a
      // heading spelled `noDeclaration` will find a number two orders of magnitude too small and report a
      // defect in the instrument — which is what happened, and the instrument is what was wrong.
      //
      // The header now spells the meaning, and the row shows its own CLOSURE so a reader never has to
      // infer it: `Σ` is intended+sameFileUnproven+arbitraryTwin+noDeclaration, and it must equal `edges`.
      // KEEPING THE ROW AT EXACTLY SIX TOKENS IS A CONTRACT, NOT A STYLE CHOICE. `residual-gate.ts`
      // reads this block POSITIONALLY and rejects any candidate row whose column count is not 6 — and
      // the last column inserted into a positional reader without a width guard produced FOUR FALSE
      // extFAIL COUNTS in this programme. So the closure is NOT a seventh column: it is checked here
      // and reported on its own line, which also keeps it out of the parser's row space entirely.
      console.log(
        "  " + w("type", 14) + w("edges", 9) + w("intended", 10) + w("sameFileUnproven", 17) +
        w("arbitraryTwin", 25) + w("nothingAnywhere", 17) + "noTarget",
      )
      const intentSum = (i: { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }) =>
        i.intended + i.sameFileUnproven + i.arbitraryTwin + i.noDeclaration
      const intentGaps: string[] = []
      for (const r of withIntent) {
        if (intentSum(r.intent) + r.noTarget !== r.edges) intentGaps.push(`${r.type} ${r.edges - intentSum(r.intent) - r.noTarget}`)
        console.log(
          "  " + w(r.type, 14) + w(r.edges, 9) + w(r.intent.intended, 10) + w(r.intent.sameFileUnproven, 17) +
          w(r.intent.arbitraryTwin, 25) + w(r.intent.noDeclaration, 17) + String(r.noTarget),
        )
      }
      console.log(
        "  " + w("TOTAL", 14) + w(intentTotals.edges, 9) + w(intentTotals.intended, 10) +
        w(intentTotals.sameFileUnproven, 17) + w(intentTotals.arbitraryTwin, 25) +
        w(intentTotals.noDeclaration, 17) + String(intentTotals.noTarget),
      )
      // THE TABLE SHOWS ITS OWN CLOSURE — the third table in this gate that did not, and the omission
      // is what let a careful lane read `noDeclaration` as the own-file class and report a 45,967-edge
      // contradiction that does not exist. A row whose four classes do not sum to its edge count is a
      // row with a class missing, and that is now printed instead of left to the reader to notice.
      if (intentGaps.length === 0) {
        console.log(`  INTENT CLOSURE: every row closes — intended+sameFileUnproven+arbitraryTwin+nothingAnywhere+noTarget == edges.`)
        const noTargetTotal = withIntent.reduce((a: number, r: any) => a + r.noTarget, 0)
        if (noTargetTotal > 0) {
          const which = withIntent.filter((r: any) => r.noTarget > 0).map((r: any) => `${r.type} ${r.noTarget}`).join(" · ")
          console.log(
            `  NO-TARGET EDGES: ${noTargetTotal} edge(s) carried an EMPTY target (${which}). COUNTED in the table and ` +
            `classified here as a class, but they are a LANE DEFECT — an analyzer published a relationship that names ` +
            `nothing, so no resolver can bind it and no intent test can place it. Lane owner fixes or rules; it is not ` +
            `a resolution class and must never be reported as one.`,
          )
        }
      } else {
        console.log(
          `  INTENT CLOSURE: ** ${intentGaps.length} ROW(S) DO NOT CLOSE ** — type and the unaccounted ` +
          `edge count: ${intentGaps.join(" · ")}. A class is missing from the classification.`,
        )
      }
      console.log(`  COLUMN NAMES SPELL THE MEANING, because a previous name cost a lane 45,967 edges of`)
      console.log(`  false alarm: sameFileUnproven = the OWN FILE declares it (line inconclusive here);`)
      console.log(`  arbitraryTwin = the OWN FILE DECLARES NOTHING and another file does — THIS is the`)
      console.log(`  own-file-absent class; nothingAnywhere = NO FILE IN THE RUN declares it, which is NOT`)
      console.log(`  the same question and is two orders of magnitude smaller on nim's calls row.`)
      console.log(`  validated against the STORE by validation/m14/fixtures/hcl/tools/store-binding-truth.mts — its`)
      console.log(`  own-file+own-line column is this class read off brain_relationship.target_symbol_id.`)
    }
  }

  // THE CLAIM-CARRYING SHARE OF THE AMBIGUITY COLUMN. A SEPARATE BLOCK, NEVER A COLUMN — TABLE 1 is
  // parsed POSITIONALLY by `residual-gate.ts`, so a new column would shift every row of every lane
  // (that is the same reason the FALLBACK ROWS block is a block). scss-lane found this by building a
  // claim-aware classifier over its whole population: **693 of its ambiguous edges carry a claim**, its
  // printed `references` row read **1,499** where the claim-aware count is **787**, and it sized its
  // repairable work about **30% high** — with nothing in the output saying so.
  {
    // GROUPED BY CLAIM KIND, because the first version of this block was not: it printed
    // "714 unverifiable" on scss — a single word covering a `cause` (which is NOT a claim to be
    // external at all) and a `projectFile` claim whose candidate did not resolve. Two different things
    // under one word is a disclosure that misleads, which is the defect this block exists to remove.
    // It then printed "714 REFUTED", which was worse: a check that can only answer one way on a branch
    // is not a check (see `claimDispositionOnAmbiguous`).
    type Bucket = { verified: number; unverified: number; refuted: number; contradicted: number; ownFileSilent: number; notApplicable: number }
    const zero = (): Bucket => ({ verified: 0, unverified: 0, refuted: 0, contradicted: 0, ownFileSilent: 0, notApplicable: 0 })
    const byKind = new Map<string, Bucket>()
    // THE DENOMINATOR MUST BE THE LANE'S AMBIGUITY, NOT THE CLAIM-CARRYING SUBSET OF IT.
    //
    // The first version of this loop `continue`d when a row had no claim-carrying kinds, so `amb`
    // accumulated only over types where SOME edge carried a claim — and on hcl, whose TABLE 1 reads
    // `amb(decl) 696`, the block printed **"of 0 ambiguous edge(s)"**. A reader taking that as the
    // lane's ambiguity reads a zero the other table contradicts, which is exactly the misreading this
    // block was written to prevent. **hcl-lane found it and wrote it up as a DISCREPANCY rather than a
    // definition, because the fix belongs in this block and not in its lane's data** — correct on both
    // counts, and that division is why it got fixed instead of explained away.
    let amb = 0
    let ambWithClaim = 0
    for (const r of rep.rows.values()) {
      const src = r.project.ambiguousWithClaim
      const keys = Object.keys(src)
      // COUNTED FOR EVERY ROW, claim or no claim.
      amb += r.project.ambiguousByDecl
      for (const k of keys) {
        const b = src[k]
        ambWithClaim += b.verified + b.unverified + b.refuted + b.contradicted + b.ownFileSilent + b.notApplicable
      }
      if (keys.length === 0) continue
      for (const k of keys) {
        const b = byKind.get(k) ?? zero()
        const s = src[k]
        b.verified += s.verified
        b.unverified += s.unverified
        b.refuted += s.refuted
        b.contradicted += s.contradicted
        b.ownFileSilent += s.ownFileSilent
        b.notApplicable += s.notApplicable
        byKind.set(k, b)
      }
    }
    // ALWAYS PRINTED, INCLUDING WHEN EVERY COUNT IS ZERO. The first version printed only when
    // `byKind.size > 0`, so a lane with no claim-carrying ambiguity saw NOTHING — and "the block did
    // not appear" is not the same reading as "the count is 0". A lane reported exactly that state and
    // had to reason from the block's ABSENCE (protobuf: 0 CONTRADICTED, 0 VERIFIED, 0 not verified).
    // The reasoning was sound; the instrument should not have required it. **Absence of output is the
    // defect this whole programme keeps finding, and it is trivially avoidable here.**
    {
      const tot = [...byKind.values()].reduce((a, b) => ({
        verified: a.verified + b.verified, unverified: a.unverified + b.unverified, refuted: a.refuted + b.refuted,
        contradicted: a.contradicted + b.contradicted, ownFileSilent: a.ownFileSilent + b.ownFileSilent,
        notApplicable: a.notApplicable + b.notApplicable,
      }), zero())
      console.log(
        `CLAIM-CARRYING AMBIGUOUS EDGES — the amb(decl) column is NOT claim-aware. Its claim-carrying\n` +
        `share, BY CLAIM KIND: ${ambWithClaim} of this lane's ${amb} ambiguous edge(s) carry a claim — ` +
        `${tot.verified} VERIFIED · ` +
        `${tot.unverified} NOT verified · ${tot.refuted} REFUTED · ${tot.contradicted} CONTRADICTED · ` +
        `${tot.ownFileSilent} OWN-FILE-SILENT · ${tot.notApplicable} n/a.`,
      )
      for (const [k, b] of [...byKind.entries()].sort(
        (x, y) => (y[1].verified + y[1].unverified + y[1].refuted + y[1].contradicted + y[1].ownFileSilent) -
                  (x[1].verified + x[1].unverified + x[1].refuted + x[1].contradicted + x[1].ownFileSilent),
      )) {
        console.log(
          `    ${w(k, 16)} VERIFIED ${b.verified} · not verified ${b.unverified} · REFUTED ${b.refuted}` +
          ` · CONTRADICTED ${b.contradicted} · OWN-FILE-SILENT ${b.ownFileSilent} · n/a ${b.notApplicable}`,
        )
      }
      // AND THE ZERO MUST SAY WHICH ZERO IT IS. "No ambiguous edge carries a claim" and "this lane has
      // no ambiguous edges" are different statements, and the first version printed the second's shape
      // for the first's meaning.
      if (byKind.size === 0) console.log(
        amb === 0
          ? `    (this lane has NO ambiguous edges at all — a MEASURED zero, not a block that failed to print.)`
          : `    (none of this lane's ${amb} ambiguous edge(s) carries a claim — NONE OF ${amb}, not zero of\n` +
            `     a zero. A MEASURED zero of the claim-carrying class, not an absent lane.)`,
      )
      if (tot.contradicted > 0) console.log(
        `  ^ ${tot.contradicted} CONTRADICTED: the EDGE'S OWN FILE declares the target while the edge claims\n` +
        `    externality. That is a refutation under BOTH scope readings, so read these FIRST.`,
      )
      if (tot.ownFileSilent > 0) console.log(
        `  ^ ${tot.ownFileSilent} OWN-FILE-SILENT: only ANOTHER file declares the target. **THIS IS NOT A\n` +
        `    REFUTATION.** css's marker means "THIS FILE declares no --x" (real-css-analyzer.ts:115), and a\n` +
        `    PER-FILE claim cannot be refuted by another file's declaration — yet the arbiter checked the\n` +
        `    PROJECT key space and called all 180 of css's ambiguous edges contradicted. Some generic markers\n` +
        `    are instead about a NAME'S ORIGIN (isStdlib, stdlibModule, nimStdlibModule), which this project\n` +
        `    declaring a same-named symbol does not falsify either. A per-MARKER scope table would settle it\n` +
        `    and does not exist, so this class is reported WITH ITS COUNT and NOT as a failure.`,
      )
      console.log(
        `  A CLAIM IS NOT A RESOLUTION: the outcome is deliberately untouched, because an edge can be BOTH\n` +
        `  ambiguous and file-shaped, and subtracting the claim would HIDE a real collision rather than\n` +
        `  resolve it. Size the repairable work from the VERIFIED count, not the raw amb(decl) column.`,
      )
      console.log()
      // ── THE CLAIMS THAT ARRIVED ON A ROW THE TIE-BREAK RESOLVED (2026-10-21, Lead) ──────────────
      // THE SIBLING DISCLOSURE of the block above, and it exists because of a MEASURED gap: the
      // typescript lane counted 13 moved rows that carried a claim, and the claim's disposition was
      // DROPPED — the arbiter's tie-break path returned before the disposition could be attached, so
      // a claim that arrived on a row the project already had an answer for left NO TRACE. The
      // arbiter now RECORDS it (the outcome is untouched: `tally` reads the field in the AMBIGUOUS
      // branch alone), and the standing rule already decided it — the own file's declaration IS the
      // project's answer, so an externality claim there is CONTRADICTED.
      //
      // ⇒ AND THE READING IS THE POINT: a claim that arrives and is DISCARDED is a fact about the
      // lane's claims, and it is neither a resolution nor a defect. It is the number a reader needs
      // to size "how many claim-carrying edges did the name model settle", which was previously
      // UNREADABLE — the shape this programme keeps finding and fixing.
      {
        type RBucket = { verified: number; unverified: number; refuted: number; contradicted: number; ownFileSilent: number; notApplicable: number }
        const rzero = (): RBucket => ({ verified: 0, unverified: 0, refuted: 0, contradicted: 0, ownFileSilent: 0, notApplicable: 0 })
        const rByKind = new Map<string, RBucket>()
        let rWithClaim = 0
        let rResolved = 0
        for (const r of rep.rows.values()) {
          rResolved += r.project.resolved
          const src = r.project.resolvedWithClaim ?? {}
          for (const k of Object.keys(src)) {
            const b = src[k]
            rWithClaim += b.verified + b.unverified + b.refuted + b.contradicted + b.ownFileSilent + b.notApplicable
            const acc = rByKind.get(k) ?? rzero()
            acc.verified += b.verified
            acc.unverified += b.unverified
            acc.refuted += b.refuted
            acc.contradicted += b.contradicted
            acc.ownFileSilent += b.ownFileSilent
            acc.notApplicable += b.notApplicable
            rByKind.set(k, acc)
          }
        }
        const rtot = [...rByKind.values()].reduce((a, b) => ({
          verified: a.verified + b.verified, unverified: a.unverified + b.unverified, refuted: a.refuted + b.refuted,
          contradicted: a.contradicted + b.contradicted, ownFileSilent: a.ownFileSilent + b.ownFileSilent,
          notApplicable: a.notApplicable + b.notApplicable,
        }), rzero())
        console.log(
          `CLAIM-CARRYING RESOLVED EDGES — the tie-break's DISCARDED claims, recorded because they were\n` +
          `DROPPED. A claim that arrived on a row the OWN FILE already answered is now RECORDED, and it\n` +
          `moved no count: ${rWithClaim} of this lane's ${rResolved} resolved edge(s) carry a claim the\n` +
          `tie-break settled — ${rtot.verified} VERIFIED · ${rtot.unverified} NOT verified · ` +
          `${rtot.refuted} REFUTED · ${rtot.contradicted} CONTRADICTED · ${rtot.ownFileSilent} OWN-FILE-SILENT · ` +
          `${rtot.notApplicable} n/a.`,
        )
        for (const [k, b] of [...rByKind.entries()].sort(
          (x, y) => (y[1].verified + y[1].unverified + y[1].refuted + y[1].contradicted + y[1].ownFileSilent) -
                    (x[1].verified + x[1].unverified + x[1].refuted + x[1].contradicted + x[1].ownFileSilent),
        )) {
          console.log(
            `    ${w(k, 16)} VERIFIED ${b.verified} · not verified ${b.unverified} · REFUTED ${b.refuted}` +
            ` · CONTRADICTED ${b.contradicted} · OWN-FILE-SILENT ${b.ownFileSilent} · n/a ${b.notApplicable}`,
          )
        }
        if (rWithClaim === 0) console.log(
          `    (none of this lane's ${rResolved} resolved edge(s) carries a claim the tie-break settled — a\n` +
          `     MEASURED zero of the class, not an absent block.)`,
        )
        console.log(
          `  A CLAIM IS NOT A RESOLUTION, AND A DISCARDED CLAIM IS NOT A DEFECT: the tie-break IS production's\n` +
          `  own rule (the own file's declaration is the answer), so the claim is refuted rather than applied.\n` +
          `  It is counted here so that "how many claim-carrying edges did the name model settle" is READABLE.`,
        )
        console.log()
      }
    }
  }

  if (ambList.length || unresList.length) {
    // PER TYPE, not the first 20 names. The lists are filled per type (up to 25 each), and a
    // flat slice of the pooled list prints whatever type happens to come first — measured
    // 2026-10-08: a whole-corpus dart run printed 20 `calls` names and no `imports` name at
    // all, so the one worklist that round needed was invisible while the count (35,575) was
    // right there in TABLE 1. A worklist that names the wrong type is a number with a list
    // attached, which is what this section exists not to be.
    console.log(
      `AMBIGUOUS / UNRESOLVED TARGETS (worklist; counts sampled per type — ` +
      `don't read a type's absence here as a zero, read TABLE 1):`,
    )
    // Keyed by STRING, not `Type`: `unresolvedNames` entries already carry the type as their
    // `label` string (written by `tally` for the report), and the two lists must group by the
    // same key or one of them would print under the wrong heading.
    const ambByType = new Map<string, typeof ambList>()
    for (const a of ambList) {
      const list = ambByType.get(a.type) ?? []
      list.push(a)
      ambByType.set(a.type, list)
    }
    const unresByType = new Map<string, typeof unresList>()
    for (const u of unresList) {
      const list = unresByType.get(u.type) ?? []
      list.push(u)
      unresByType.set(u.type, list)
    }
    for (const type of ALL_TYPES) {
      const as = ambByType.get(type) ?? []
      const us = unresByType.get(type) ?? []
      if (!as.length && !us.length) continue
      console.log(`  ${type}`)
      for (const a of as.slice(0, 4)) {
        console.log(`    amb  ${w(a.name, 42)} ${a.declarations} declarations  [${a.kinds}]`)
      }
      for (const u of us.slice(0, 4)) console.log(`    unres  ${u.name}`)
      // SHOW HOW MUCH OF THIS WORKLIST IS NOT BEING SHOWN. TWO caps stack here and NEITHER used to be
      // disclosed: `tally` keeps at most NAME_CAP (25) names per bucket, and THIS loop prints at most
      // 4 of them. scss-lane measured the visible end of it and could not see the rest — `imports`
      // 297 → 25, `references` **1,501 → 25**, `exports` 983 → **25**, every type over 25 listing
      // exactly 25 — and the header said only "counts sampled per type", which tells a reader that a
      // type's ABSENCE is not a zero but **never says how many are hidden**. A lane sizing its work
      // from that list reads 25 against 1,501 and cannot tell the difference.
      //
      // The caps STAY — they are what stops one pathological name from producing a 40,000-line report.
      // What changes is that both omissions are now counted and printed, so the list stops being
      // silently partial. Same remedy as the marker table's `⋯ OMITTED` row: a table that does not show
      // its own closure is the defect, not the cap.
      {
        const om = rep.rows.get(type)?.project.namesOmitted
        const ambCap = om?.ambiguous ?? 0
        const unresCap = om?.unresolved ?? 0
        console.log(
          `    ^ amb: showing ${Math.min(as.length, 4)} of ${as.length} collected` +
          (ambCap > 0 ? ` + **${ambCap} omitted by the ${NAME_CAP}-name cap and never collected**` : "") +
          ` · unres: showing ${Math.min(us.length, 4)} of ${us.length} collected` +
          (unresCap > 0 ? ` + **${unresCap} omitted by the cap**` : "") +
          `. THIS LIST IS A SAMPLE — read TABLE 1 for the full counts.`,
        )
      }
    }
    console.log()
  }
  // THE REFUTED CLAIMS, WITH THE CAP'S OMISSION COUNTED BESIDE THEM.
  //
  // THE HEADER HERE USED TO SAY "PRINTED WHOLE AND UNCAPTIONED BY ANYTHING ELSE", AND THAT WAS
  // FALSE. The list carries the same per-bucket name cap as the other buckets, and the dart lane
  // MEASURED 86 refuted rows behind a 25-name list — so a reader sizing the work from the list saw
  // 25 and could not tell it from the whole. **A LIST THAT IS SILENTLY PARTIAL READS EXACTLY LIKE A
  // COMPLETE ONE**, and this is the same remedy the worklist already uses for its own two buckets:
  // the omission is COUNTED and printed beside the list. The dart lane proposed three ways to fix it
  // (print the omitted count, raise the cap for that bucket, or fix the header); the count is
  // printed AND the header is now true, because the cap is a real protection (one pathological name
  // used 40,000 times must not produce a 40,000-line report) and only SILENCE was the defect.
  //
  // A refuted claim is the one outcome that says the analyzer's OWN claim is false, and the verdict
  // counts it against the lane — so a count with no names is not actionable. It was: measured
  // 2026-10-09, a whole riverpod run printed `extFAIL 4` while the worklist above printed four
  // `calls`/`instantiates` names and not one of the four. The worklist is a sample by design; this
  // is not, because there is nothing here to sample down — a refuted claim is rare by construction
  // (a lane that refuted many would be failing every run) and every one of them is a defect.
  const refuted = [...rep.rows.values()].flatMap((r) =>
    r.project.refutedNames.map((x) => ({ ...x, type: r.type })),
  )
  if (refuted.length) {
    const refutedOmitted = [...rep.rows.values()].reduce(
      (n, r) => n + (r.project.namesOmitted?.refuted ?? 0),
      0,
    )
    console.log(
      `EXTERNAL CLAIMS THE POPULATION REFUTES (counted AGAINST the lane — the owner these name IS published):` +
        (refutedOmitted > 0
          ? ` **+ ${refutedOmitted} omitted by the ${NAME_CAP}-name cap and never collected**`
          : ""),
    )
    for (const x of refuted) console.log(`  ${w(x.type, 14)} ${x.name}`)
    console.log()
  }
  if (bbDumpTruncated) {
    console.log(`DUMP TRUNCATED — ${bbDumpSkipped} eligible row(s) were NOT dumped (the ${BB_DUMP_LIMIT}-row bound was reached). The dump above is NOT the whole non-resolved set.`)
  }
  console.log(`VERDICT: ${v.pass ? "PASS" : "FAIL"} — ${v.reason}`)
  // EVERY CLAUSE ON ITS OWN LINE, WITH ITS OWN NUMBER. `bad === 0 && …` produced one boolean, and the
  // fleet's experience this session is that a gate which cannot say WHY gets misread for weeks. A
  // clause that FAILS is marked so a reader can find it without parsing the sentence above.
  for (const c of v.clauses) {
    console.log(`  clause ${c.clause} ${c.ok ? "ok  " : "FAIL"} — ${c.bar}`)
    console.log(`           ${c.detail}`)
  }
  if (!ident(v.totals, v.pooled)) {
    console.log(
      `  (the same edges under the pooled corpus key space: ${v.pooled.ambiguousByDecl} ambiguous + ` +
      `${v.pooled.unresolved} unresolved — that number is about the CORPUS's name collisions, ` +
      `not about resolution as production performs it)`,
    )
  }
  console.log(`instrument self-test: ${control.ok ? "PASS (control fired)" : "FAILED — THE INSTRUMENT IS BROKEN"}`)
  if (!control.ok) for (const f of control.failures) console.log(`    ${f}`)
  console.log()
  console.log("Scope of a PASS: this population, this analyzer digest, resolution only. It does NOT")
  console.log("say the edges point at the RIGHT declaration — that is differential.ts's question.")
}

/** The separator is U+0000 (src/ast/types.ts): printing it raw puts control bytes in logs and
 *  makes them look binary to grep. One helper, so every report line escapes it the same way. */
const showSep = (sep: string): string => sep.replace(/\u0000/g, "\\u0000")

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const ALL = argv.includes("--all")
const USE_INDEX = argv.includes("--index")
/**
 * `--binding-collapse` — julia's METHOD TABLE, as a model rule rather than a heuristic.
 *
 * Julia declares one generic function across many files: `Base.getindex` is ONE binding with many
 * method declarations, and a per-file analyzer publishes one symbol per declaration. The count model
 * sees N declarations and calls every edge ambiguous. The rule here is narrow and checkable: collapse
 * a key to ONE declaration **iff every declaration answering to it carries a NON-EMPTY
 * `qualifiedName` and they are all THE SAME qualifiedName** — i.e. the NAME has one binding.
 *
 * WHY THE NON-EMPTY CONDITION IS THE WHOLE POINT: a set of file-scope declarations that merely SHARE
 * A SPELLING also collapses to one binding key if the key is computed as `qualifiedName || name` —
 * measured on this lane, that predicate read 28,530 collapsible edges when only 1,038 were a real
 * method table (95.8% were name coincidences, JUL-D19). Requiring a non-empty qualifiedName on EVERY
 * declaration is what separates "one generic function" from "two functions called the same thing".
 *
 * DEFAULT OFF, because the rule is a statement about julia's semantics and 47 other lanes run through
 * this gate; a run that does not pass the flag is byte-for-byte the run it was before.
 */
const BINDING_COLLAPSE = argv.includes("--binding-collapse")
/**
 * THE CLASS-LIKE `implements` RULE, with an OFF switch that exists for AUDIT rather than for policy.
 * The rule is ON by default (it is evidence-gated and never fabricates); `BB_IMPLEMENTS_CLASS_LIKE=0`
 * lets an arm be re-run without it so the rows it moves in ANY language can be measured by subtraction
 * instead of trusted. That is how it was priced on clean (284 = on minus off) and how another lane's
 * owner should check it before adopting the number.
 */
const IMPLEMENTS_CLASS_LIKE = process.env.BB_IMPLEMENTS_CLASS_LIKE !== "0"
// `--repo=a,b` measures whole named repositories instead of a stride over the corpus. See
// `discoverFiles` for why a sampled run cannot answer a question about file-scoped targets.
const REPO_ARG = argv.find((a) => a.startsWith("--repo="))
const ONLY_REPOS = REPO_ARG
  ? new Set(REPO_ARG.slice("--repo=".length).split(",").map((s) => s.trim()).filter(Boolean))
  : undefined
// ★ `--offset=N` MEASURES A DISJOINT CHUNK OF THE ADMITTED POPULATION, AND IT EXISTS BECAUSE THE
// SMALL ARM SLOT CANNOT REACH THE BIG REPOSITORIES. (Dart lane's proposal, 2026-10-21, and the gap it
// names is real: this gate's unit of work is a WHOLE REPOSITORY, so three of dart's six repositories —
// dart-sdk 25,727 · flutter-packages 4,028 · proxicall 2,350 — REFUSE the ≤2,000-file small slot on
// their own, and the chunked path could not reach them at all.)
//
// ⇒ THE CHUNK IS A SLICE OF THE ADMITTED SET, NOT A STRIDE OF IT, AND THE DIFFERENCE IS THE WHOLE
// POINT: a stride inside a chunk leaves GAPS, and a gap means the summed chunks do not cover the
// population. A slice of [offset, offset+maxFiles) over the SAME SORTED admitted list is DISJOINT from
// its neighbours and, walked from 0, COVERS the population exactly. ⇒ THE SUM OF THE CHUNKS' BUCKETS
// IS THE POPULATION'S BUCKETS, with `amb(kind)` summed BESIDE it and never added.
//
// ⇒ AND A CHUNK IS NOT A POPULATION, SO THE HEADER MUST SAY SO. The run prints its own slice bounds
// and the whole admitted count, so a reader can tell a chunk from a whole population WITHOUT having
// to know how the run was invoked. A reader who cannot tell is a reader who will sum a sample and
// publish it as a population.
const OFFSET_ARG = argv.find((a) => a.startsWith("--offset="))
const OFFSET = OFFSET_ARG ? Number.parseInt(OFFSET_ARG.slice("--offset=".length), 10) : 0
// ★ THE PRESENCE OF THE FLAG IS THE MODE, NOT ITS VALUE — and the Lead MEASURED the difference.
// The first implementation switched on `offset > 0`, so `--offset=0` fell through to the STRIDE
// path: chunk 0 became a stride across the whole population and OVERLAPPED the slice chunks.
// MEASURED over dart-sdk (25,727 admitted files, five 2,000-file chunks): 667 DUPLICATE files across
// the five chunks, and the union was 9,333 of the 10,000 the chunks claimed. ⇒ THE CHUNKS WERE NOT
// DISJOINT AND THE SUM WOULD HAVE DOUBLE-COUNTED, and a double-counted sum is worse than no sum
// because it looks like a number. ⇒ A REQUESTED OFFSET IS A SLICE EVEN AT ZERO.
const HAS_OFFSET = OFFSET_ARG !== undefined
if (OFFSET_ARG && (!Number.isInteger(OFFSET) || OFFSET < 0)) {
  console.error(`usage: incoming-gate.ts --offset=N  (N is a non-negative integer; got "${OFFSET_ARG.slice("--offset=".length)}")`)
  process.exit(2)
}
const rest = argv.filter((a) => !a.startsWith("--"))
// `--board-log [path]` writes the file the board reads; see the block below `printReport`.
// A bare `--board-log` (or the next token being another flag) uses the canonical path.
const BOARD_LOG_INDEX = argv.indexOf("--board-log")
const BOARD_LOG = BOARD_LOG_INDEX >= 0
const BOARD_LOG_PATH = (() => {
  if (!BOARD_LOG) return ""
  const next = argv[BOARD_LOG_INDEX + 1]
  return next && !next.startsWith("--") ? next : "validation/m14/results/incoming-laptop-b.current.log"
})()

// THE CONTROL RUNS FIRST, ALWAYS. Before any lane, before any corpus. An instrument that
// cannot detect a planted failure must not be allowed to print a verdict about a language.
const control = selfTest()
// AND THE CONTROL FOR THE NEW CHECK. Clause 3 was unenforced until this file grew it, so its control
// runs on EVERY invocation beside the classification control and refuses to report a lane if it stops
// firing. Arms K-Q: every hollow ruling refused, one complete ruling accepted.
{
  const c3 = clause3Control()
  if (c3.failures.length > 0) {
    control.ok = false
    control.failures.push(...c3.failures)
  }
  // `--self-test` PRINTS the arms. A control that runs silently proves nothing to a reader who was not
  // watching, and this session's whole lesson is that a check must be SEEN to fail — so the same switch
  // that shows the coverage gate's arms shows these.
  if (process.argv.includes("--self-test")) {
    const fp = populationFingerprint({ parsed: 120, files: Array(120), total: 999, admittedExts: ["toml"], index: null } as unknown as Report)
    const okRun = { run: "…incoming-gate.ts toml toml 120", wouldFail: "…an edge whose base IS declared in the corpus" }
    const show: Array<{ name: string; want: boolean; causes: Map<string, number>; rulings: Record<string, CauseRuling> }> = [
      { name: "K no declared cause is vacuously met", want: true, causes: new Map(), rulings: {} },
      { name: "L a named cause with NO ruling is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: {} },
      { name: "M a ruling over a DIFFERENT population is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: "parsed=1/1 admitted=1 exts=toml index=no", falsifier: okRun } } },
      { name: "N a ruling with NO falsifier at all is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: fp } } },
      { name: "O a falsifier with no RUN and nothing that would fail is refused", want: false, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: fp, falsifier: { run: "   ", wouldFail: "" } } } },
      { name: "P a COMPLETE ruling over this population is ACCEPTED", want: true, causes: new Map([["BeyondThing", 3]]), rulings: { BeyondThing: { population: fp, falsifier: okRun } } },
      { name: "Q one hollow cause among several is refused, not averaged away", want: false, causes: new Map([["A", 1], ["B", 2]]), rulings: { A: { population: fp, falsifier: okRun }, B: { population: fp, falsifier: { run: "x", wouldFail: "  " } } } },
    ]
    console.log(`clause-3 self-test — ${c3.passed}/${show.length} arms (a ruling needs a population AND a run falsifier)`)
    for (const a of show) {
      const got = clause3Check(a.causes, fp, a.rulings, "control").ok
      const ok = got === a.want
      console.log(`  ${ok ? "PASS" : "FAIL"} ${a.name} -> ${got ? "accepted" : "REFUSED"}`)
    }
  }
}
if (!control.ok) {
  console.error("FATAL: this gate's own positive control did not fire.")
  for (const f of control.failures) console.error(`  ${f}`)
  console.error("Refusing to report any lane: a probe that cannot fail returns the same")
  console.error("number as a clean one, which is this programme's most repeated failure.")
  process.exit(3)
}

/**
 * `--board-log [path]` — REGENERATE THE ARTEFACT THE BOARD READS.
 *
 * The board's incoming column is parsed from `validation/m14/results/incoming-laptop-b.current.log`,
 * which until now had NO generator in the tree: every lane's row was pasted there by hand from a
 * separate run. So the log could not be refreshed without re-deriving someone's invocation from
 * memory, and a lane whose population changed (yaml, after the extension-spelling fix) kept a
 * number the instrument could no longer produce while the instrument that would contradict it had
 * no way to write the file. A measurement with no writer is a measurement that ages silently.
 *
 * The verdict line is CAPTURED from the printer rather than reformatted, so the file cannot drift
 * from what a single-lane run prints — the board reads counters out of that sentence, and a second
 * wording would be a second source of truth. Progress goes to stderr and deliberately not into the
 * file, because the board counts every unrecognised line as `unparsed`.
 */
function captureReport(fn: () => void): string[] {
  const out: string[] = []
  const saved = console.log
  console.log = (...a: unknown[]) => { out.push(a.map(String).join(" ")) }
  try { fn() } finally { console.log = saved }
  return out
}

if (BOARD_LOG) {
  const lines: string[] = []
  let failed = 0, unmeasured = 0
  // `--only <lane>` exists because a whole-fleet regeneration is an hour-scale run and the lanes
  // it needs to cover are rarely all of them. Without it the only way to refresh ONE lane's row
  // was to re-run all twenty-three, which is how a lane's number goes stale rather than fixed.
  const ONLY_INDEX = argv.indexOf("--only")
  const ONLY = ONLY_INDEX >= 0 ? argv[ONLY_INDEX + 1] : undefined
  const lanes = ONLY
    ? Object.entries(FLEET_LANES).filter(([l]) => l === ONLY)
    : Object.entries(FLEET_LANES)
  if (lanes.length === 0) {
    console.error(`--only ${ONLY} names no lane; known: ${Object.keys(FLEET_LANES).join(" ")}`)
    process.exit(2)
  }
  for (const [lang, ext] of lanes) {
    const max = Number(rest[0] ?? 120)
    const rep = await measure(lang, ext, max, USE_INDEX, ONLY_REPOS)
    const v = verdict(rep)
    const captured = captureReport(() => printReport(rep, control))
    const verdictLine = captured.find((l) => l.startsWith("VERDICT: ")) ?? `VERDICT: FAIL — printer produced no verdict line`
    const stLine = captured.find((l) => l.startsWith("instrument self-test: ")) ?? `instrument self-test: NOT RUN`
    lines.push(`### ${lang}`, verdictLine, stLine)
    console.error(
      `${w(lang, 12)} ${rep.parsed}/${rep.files.length} parsed of ${rep.total} admitted ` +
      `(.${rep.ext})  degraded ${rep.degraded}  ${v.pass ? "PASS" : "FAIL"}`,
    )
    if (rep.parsed === 0) unmeasured++
    else if (!v.pass) failed++
  }
  writeFileSync(BOARD_LOG_PATH, lines.join("\n") + "\n")
  console.error(`\nwrote ${lines.length / 3} lane(s) to ${BOARD_LOG_PATH}`)
  console.error(`PASS ${lines.filter((l) => l.includes("VERDICT: PASS")).length}   FAIL ${failed}   UNMEASURED ${unmeasured}`)
  process.exit(0)
}

if (ALL) {
  let failed = 0
  let unmeasured = 0
  const summary: string[] = []
  for (const [lang, ext] of Object.entries(FLEET_LANES)) {
    const max = Number(rest[0] ?? 120)
    const rep = await measure(lang, ext, max, USE_INDEX, ONLY_REPOS)
    const v = verdict(rep)
    if (rep.parsed === 0) {
      unmeasured++
      summary.push(`${w(lang, 12)} UNMEASURED  (0 of ${rep.total} .${ext} files parsed)`)
      continue
    }
    if (!v.pass) failed++
    summary.push(
      `${w(lang, 12)} ${v.pass ? "PASS" : "FAIL"}  ` +
      `edges ${w(String(t0(rep)), 8)} amb(decl) ${w(String(v.totals.ambiguousByDecl), 7)} ` +
      `unres ${w(String(v.totals.unresolved), 7)} extOK ${w(String(v.totals.externalVerified), 7)} ` +
      `extFAIL ${v.totals.externalRefuted} ` +
      `[pooled amb ${v.pooled.ambiguousByDecl} unres ${v.pooled.unresolved}] ` +
      `[${rep.parsed} files]`,
    )
  }
  console.log(`incoming gate — ${Object.keys(FLEET_LANES).length} fleet lanes (the union of LANES_A and LANES_B)\n`)
  for (const s of summary) console.log(s)
  console.log()
  console.log(`PASS: ${summary.filter((s) => s.includes("PASS")).length}   FAIL: ${failed}   UNMEASURED: ${unmeasured}`)
  console.log(`ambiguous counted by DECLARATION, and resolved PER PROJECT (production's scope).`)
  console.log(`the fleet's earlier figure used distinct KINDS and one pooled key space.`)
  process.exit(failed > 0 ? 1 : 0)
}

function t0(rep: Report): number {
  let n = 0
  for (const r of rep.rows.values()) n += r.edges
  return n
}

// This file is a CLI. The RULE it applies is importable on its own (`incoming-rule.ts`), so a
// census reads the rule rather than executing a walk.
if (rest.length < 2) {
  console.error("usage: npx tsx script/m14/incoming-gate.ts <lang> <extension> [maxFiles]")
  console.error("       --selftest is accepted but is NOT control-only: it runs the ARM and reports the")
  console.error("       control at the end. A control-only mode would print a pass line with no arm behind it.")
  console.error("       <extension> may be a COMMA-SEPARATED LIST — `yaml,yml` for one language whose")
  console.error("       files carry two spellings, `.yaml` for a question about one of them.")
  console.error("       npx tsx script/m14/incoming-gate.ts --all [maxFiles]")
  console.error("       npx tsx script/m14/incoming-gate.ts --board-log [path] [maxFiles]")
  console.error("         --board-log REGENERATES validation/m14/results/incoming-laptop-b.current.log,")
  console.error("         the artefact language-board.ts reads. It had no writer until now.")
  console.error("         Add --index to measure the population production actually parses.")
  console.error("       maxFiles 0 = the WHOLE admitted corpus. A positive value stride-samples it,")
  console.error("       and stride against a corpus that has grown since the number was chosen")
  console.error("       silently truncates the population back to the old size.")
  process.exit(2)
}
const lang = rest[0]
/**
 * ★⇒⇒⇒ THE POSITIONAL ARGS ARE `lang ext maxFiles`, AND OMITTING THE EXTENSION MUST NOT SHIFT THE
 * COUNT INTO THE EXTENSION SLOT. This was measured the minute the table-derived default was added:
 * `incoming-gate.ts cpp 40` took `40` as the EXTENSION and printed "corpus has 0 .40 files across 0
 * repos" — **A MISSING ARGUMENT SILENTLY BECAME A DIFFERENT ARGUMENT**, and the gate RAN on it and
 * printed a population claim about it. ⇒⇒⇒ ⇒⇒⇒ **A MISSING ARGUMENT THAT LANDS IN ANOTHER
 * ARGUMENT'S SLOT IS A DEFECT IN THE PARSER, AND IT IS THE SAME CLASS AS EVERY OTHER ONE THE FLEET
 * HAS FOUND**: the gate's own header says a measurement whose population came from a spelling is
 * measuring the spelling, and here the spelling was a NUMBER.
 * ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **SO THE EXTENSION SLOT IS TYPED BY ITS CONTENT: a token that is a bare integer is
 * the COUNT, and the extension is absent.** ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ AND THE COUNT SLOT IS READ THE SAME WAY,
 * so `lang ext count` and `lang count` both mean what they look like.
 */
const extArgRaw = rest[1]
const countArgRaw = rest[2]
const extArg = extArgRaw !== undefined && /^\d+$/.test(extArgRaw) ? undefined : extArgRaw
const maxFiles = Number(
  (extArg === undefined ? (extArgRaw !== undefined ? extArgRaw : countArgRaw) : countArgRaw) ?? 120,
)

/**
 * ★⇒⇒⇒ THE POPULATION IS THE LANE'S, AND IT COMES FROM THE ROUTER'S ONE TABLE UNLESS THE CALLER
 * NAMES A SET. This is the cpp lane's finding, and it is a REAL GAP IN THE ARBITER, not in the
 * caller: the gate was given `.cpp` and measured **3,425 files in 22 repos**, while the lane's own
 * denominators measure **7,435 files in 31 repos across NINE spellings** (cpp, cc, cxx, c++, hpp,
 * hxx, ipp, inl, cu) — the gate PRINTS the warning ("ONE spelling — check the lane does not carry
 * another") and the lane DOES carry eight more, so the two numbers were never comparable and
 * neither was subtracted from the other.
 *
 * ⇒⇒⇒ ⇒⇒⇒ **THE INSTRUMENT AND THE DENOMINATOR MUST COUNT THE SAME POPULATION**, and the one table
 * is where the lane's spellings are WRITTEN DOWN — so the gate reads it rather than taking the
 * caller's word for a subset.
 *
 * ⇒⇒⇒ ⇒⇒⇒ **AND THE CALLER'S EXPLICIT SET IS STILL HONOURED**, because a lane may DELIBERATELY
 * measure one spelling — the html lane's thirteen-spelling measurement and the sql fork both do —
 * and a gate that refused a named set would be a gate that cannot be pointed at a question. ⇒⇒⇒ ⇒⇒⇒
 * **BUT THE NAMED SET IS NOW PRINTED BESIDE THE TABLE'S SET, AND THE SOURCE IS PRINTED WITH IT**,
 * because a warning is not a fix and a number whose population's source is not in the output is a
 * claim. ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ **A NUMBER WITHOUT ITS POPULATION'S SOURCE IS A CLAIM.**
 */
const tableExts = lang && Object.prototype.hasOwnProperty.call(FLEET_LANES, lang)
  ? FLEET_LANES[lang].split(",").map((t) => t.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
  : []
const ext = extArg ?? (tableExts.length > 0 ? tableExts.join(",") : undefined)
const extSource = extArg
  ? "the CALLER'S ARGUMENT (an explicit set — deliberate, and the table's set is printed beside it)"
  : (tableExts.length > 0
      ? "the ROUTER'S ONE TABLE (no argument was given, so the lane's own spellings were used)"
      : "NOTHING — there is no lane and no argument, so the population is whatever the walk finds")
const rep = await measure(lang, ext ?? "", maxFiles, USE_INDEX, ONLY_REPOS)
;(rep as any).extSource = extSource
;(rep as any).tableExts = tableExts
const v = verdict(rep)

if (JSON_OUT) {
  console.log(JSON.stringify({
    lang: lang,
    population: {
      sampled: rep.files.length, parsed: rep.parsed, failed: rep.failed,
      corpusTotal: rep.total, repos: rep.repos, degraded: rep.degraded,
      degradedFiles: rep.degradedFiles, qualifiedNameAliases: rep.aliasedKeys,
      excluded: rep.excluded,
    },
    verdict: v.pass ? "PASS" : "FAIL",
    reason: v.reason,
    ambiguityMetric: "declarations (distinct-kind shown for comparison only)",
    resolutionScope:
      "per project (the repository a file belongs to) — parallel-indexer.resolveRelationships' scope",
    instrumentSelfTest: control,
    perType: Object.fromEntries(ALL_TYPES.map((t) => [t, rep.rows.get(t)])),
    totals: v.totals,
    totalsPooled: v.pooled,
  }, null, 2))
} else {
  printReport(rep, control)
}

if (rep.parsed === 0) {
  // ★⇒⇒⇒ A POPULATION OF ZERO IS A CONTROL FAILURE, NOT A MEASUREMENT. The gate was just measured
  // printing "population: 0 parsed of 0 sampled (corpus has 0 .40 files across 0 repos)" and
  // continuing — **A CLEAN-LOOKING ZERO OVER AN EMPTY POPULATION**, the same defect the Lead's own
  // heritage probe had over cpp, and the Lead's own fix for that probe is the rule here. ⇒⇒⇒ ⇒⇒⇒
  // **AND THE ZERO WAS A NONSENSE EXTENSION BECAUSE A MISSING ARGUMENT HAD LANDED IN THE
  // EXTENSION SLOT** — so this refusal is also the second half of that fix: the parser is fixed AND
  // the empty population is refused, because either alone would let a nonsense run print a claim.
  console.error("")
  console.error("*** THE POPULATION IS EMPTY — THIS IS A CONTROL FAILURE, NOT A FINDING. ***")
  console.error(`    language        : ${lang ?? "(none)"}`)
  console.error(`    admitted exts   : ${rep.admittedExts.join(", ") || "(none)"}`)
  console.error(`    extension source: ${(rep as any).extSource ?? "unknown"}`)
  console.error(`    the ONE TABLE   : ${((rep as any).tableExts ?? []).join(", ") || "(no entry for this lane)"}`)
  console.error("    ⇒⇒⇒ a run that admits no files measures nothing, and a gate that prints a")
  console.error("    ⇒⇒⇒ population claim about an empty population is worse than a gate that stays")
  console.error("    ⇒⇒⇒ silent, because the reader has nothing to distrust.")
  console.error("")
  process.exit(5)
}
// A DEGRADED POPULATION MAY CLAIM NEITHER A PASS, NOR AN EXCUSE FROM A FAIL.
//
// This line read `process.exit(v.pass || rep.degraded > 0 ? 0 : 1)`, which by operator
// precedence is `v.pass || (rep.degraded > 0)` — so ANY run containing a single degraded
// file exited 0. Measured 2026-10-07: the whole-corpus dart run printed
// `VERDICT: FAIL — 1551929 ambiguous + 654042 unresolved of 2847867 edges` with 2 degraded
// files and exited **0**. That is the exact defect this file's header says it exists to
// end: "a measurement with no arbiter is not a gate; it is a log line." A shell, a CI job,
// or `script/m14/run-all-gates.sh` reads the exit code, not the prose.
//
// The two states are not interchangeable, so they no longer share a branch: FAIL exits 1,
// and a PASS over a degraded population ALSO exits 1, because a PASS is a claim about the
// population and a file the analyzer never read is not in it. (`incoming-check` counted
// those files as parsed; this gate now refuses to.) The reason is printed either way.
if (!v.pass) process.exit(1)
if (rep.degraded > 0) {
  console.error(
    `incoming gate: ${rep.degraded} of ${rep.parsed} file(s) were NOT measured by the analyzer ` +
      `(regex fallback, or the analyzer's own 2.0-basic-fallback), so a PASS over this population ` +
      `is not claimable: ${rep.degradedFiles.slice(0, 5).join(", ")}`,
  )
  process.exit(1)
}
process.exit(0)