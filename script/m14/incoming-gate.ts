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
 *    declarations share this name'"), and `docs/analyzers/real-scss-analyzer.md:1741`
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
 * Exit: 0 pass · 1 fail (a real unresolved/ambiguous edge class) · 2 usage/environment ·
 *       3 THE INSTRUMENT'S OWN CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
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
// THE RULE IS IMPORTED, NOT COPIED. A census that counts WHY about the same edges must
// count them the same way, so the classification lives in incoming-rule.ts and this file
// consumes it. Re-exported below so a caller of this module keeps working unchanged.
import {
  EXTERNAL_KEYS, isMarkedExternal, externalClaimOf, targetOwner, verifyExternalClaim, classifyEdge, tally,
  NAME_CAP,
  FILE_CLAIM_KEY, REMOTE_REF_CLAIM_KEY,
  emptyOutcomes, verifyImportClaim, verifyBindingClaim, BINDING_CLAIM_KEY, isContainsEdge,
  type ExternalClaim, type ProjectFacts,
  type Outcome, type Classified, type Outcomes,
} from "./incoming-rule"
export {
  EXTERNAL_KEYS, isMarkedExternal, externalClaimOf, targetOwner, verifyExternalClaim, classifyEdge, tally,
  FILE_CLAIM_KEY, REMOTE_REF_CLAIM_KEY,
  emptyOutcomes, verifyImportClaim, verifyBindingClaim, BINDING_CLAIM_KEY, isContainsEdge,
}
export type { ExternalClaim, ProjectFacts, Outcome, Classified, Outcomes }

/** Laptop B's 23 lanes, from docs/analyzers/PROMPT-LAPTOP-B.md:15 — asserted, not inferred. */
export const LANES_B: Record<string, string> = {
  bash: "sh,bash,zsh", fsharp: "fs,fsi,fsx", zig: "zig", lua: "lua", julia: "jl", nim: "nim,nims,nimble",
  php: "php", powershell: "ps1,psm1,psd1", r: "r", dart: "dart", sql: "sql", graphql: "graphql,gql,graphqls",
  // `.graphqls` ADDED. The lane definition carried `graphql` and `gql`, and the ROUTER carried the same two —
  // so `.graphqls` was invisible to BOTH, which is why fixing one place would not have moved the gate's own
  // population. MEASURED: 97 corpus `.graphqls` files, worth 83,371 SYMBOLS and 195,108 RELATIONSHIPS, read by
  // nothing. The router fix is `1150b2140`; this is the lane definition beside it, and the two must agree or a
  // lane's population and the engine's population are different sets.
  // NOTE: no `key: "value"` shape and no backticks in this comment — the parser below reads this literal
  // quote-aware but NOT comment-aware.

  protobuf: "proto", json: "json,jsonc,jsonl,jsonlog",
  // `.jsonlog` ADDED, at BOTH sites in one commit — the fourth time today these two lists had to be kept
  // together (graphqls, sass, jsonl, and now this), so both are named here on purpose.
  // NOTE: no shape of key-colon-quote in this comment and no backticks — the parser reads this literal
  // quote-aware but NOT comment-aware.

  // `.jsonl` ADDED, and it is a SEPARATE list from the router — the two were half-kept three times today
  // (graphqls, sass, and now this), so both sites are named in the same commit on purpose.
  // NOTE: no shape of key-colon-quote in this comment and no backticks: the parser reads this literal
  // quote-aware but NOT comment-aware, and a comment carrying one is read as a lane.

  // BOTH SPELLINGS, because one language does not become a different population by being spelled
  // `.yml`. Measured on ansible — 13 `.yaml` files against 2,068 `.yml`, 2,081 combined — so the
  // `--all` table was measuring 0.6% of the lane's files and reporting the 13-file verdict as the
  // lane's. `firing-check.mjs` has always admitted both spellings, which is exactly how the two
  // instruments came to disagree (HANDOFF §5.2).
  //
  // READ THIS BEFORE WRITING A COMMENT IN THIS LITERAL. `language-board.ts` parses LANES_B by
  // splitting the object body on top-level commas and taking `key` before the first colon and
  // `value` after it — quote-aware, but NOT comment-aware. A comment whose text contains a
  // COLON-SPACE-QUOTE sequence is therefore read as a lane. The first version of this comment
  // contained one and the board reported 26 lanes, three of them sentences. Comments here stay
  // free of `key: "value"` shapes and of backticks.
  yaml: "yaml,yml",
  css: "css,less", scss: "scss,sass",
  // `.sass` ADDED. The ROUTER already maps it — to its own language, which `language-detection.ts` records as a
  // fix in its own right — and NO LANE ADMITTED IT, so 67 corpus files were routed to a language nothing
  // measured. Third instance of this shape in one day: the router and the lane definition are separate lists and
  // only one of them was being kept; `.graphqls` was the first, and `.sass` is the same defect one file over.
  // MEASURED: 67 admitted `.sass` files, ALL of them routed to `sass` (Documenter.jl 64, bulma 3).
  // NOTE: no `key: "value"` shape and no backticks in this comment — the parser reads this literal quote-aware
  // but NOT comment-aware, and a comment containing one is read as a lane.

  // `make: "mk,mak,makefile"` NOW ADMITS A BARE `Makefile`. It did not, because `admitByExtension`
  // matched a trailing dot-plus-ext and that file has no extension to match — and the note that stood
  // here REPORTED the gap for months instead of fixing it, which made the gate's population 129 files
  // where the production router admits 697 (18.5%). Found by make-lane, which measured the router's
  // own predicate and found it disagreed with this table. The predicate now also matches a bare
  // basename equal to an admitted ext; see its docstring.
  // XML IS SEVEN SPELLINGS, and the router says so itself: `src/ast/language-detection.ts` maps
  // `.xml .xsd .dtd .svg .xsl .xslt .rng` all to the `xml` language. This table admitted only the
  // first, so every xml number from this instrument covered **2,081 of the lane's 11,552 files
  // (18.0%)** — and only **3.0% of its `references`** edges and 29.1% of its `imports`. Measured by
  // xml-lane, which also noted that this table already records the identical defect and fix for
  // yaml one line above ("one language does not become a different population by being spelled
  // .yml"). The same sentence applies with six more spellings.
  hcl: "tf,hcl,tfvars,tofu", make: "mk,mak,makefile", toml: "toml", xml: "xml,xsd,dtd,svg,xsl,xslt,rng", markdown: "md,markdown", clean: "icl,dcl",
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
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
}
const ontologyName = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

/** The engine's own full-AST bound (`pool-worker.ts` FULL_AST_LIMIT). Above it the analyzer
 *  extracts structurally; above 5 MB `parseFile` returns an empty fallback with zero symbols.
 *  A gate that admits files the analyzer will not measure is measuring its own patience. */
const SIZE_CAP = 1024 * 1024

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

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
function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

function discoverFiles(lang: string, ext: string, exts: string[], maxFiles: number, onlyRepos?: Set<string>): {
  files: string[]; total: number; repos: number
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
    return { files: [], admitted: [], total: 0, repos: 0, absent: 0, overCap: 0, overCapLargest: 0 }
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
      if (!admitByExtension(rel, exts, lang)) continue
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
  if (maxFiles > 0 && total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  void lang
  return { files, admitted: found, total, repos: repos.size, ...excluded }
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
function projectFactsForFiles(repoRoot: string, admitted: string[]): ProjectFacts {
  const files = new Set<string>()
  for (const abs of admitted) {
    const rel = path.relative(repoRoot, abs)
    if (rel.length > 0) files.add(rel.split(path.sep).join("/"))
  }
  return { packages: new Set<string>(), files, sdkLib: false }
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
 *   arbitraryTwin       nothing in the edge's own file answers to the name, but a declaration in
 *                       ANOTHER file does — exactly when the store's `s.id` tie-break (a TEXT
 *                       comparison of `${fileId}:${name}:${line}`) picks a foreign declaration.
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
}
const INDEX_CACHE = process.env.BB_INDEX_CACHE ?? "/tmp/bb-project-index"

/** Build (or reuse) one index per repository, the unit production builds for. */
async function projectIndexesFor(
  lang: string, files: string[],
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
    const cachePath = path.join(INDEX_CACHE, `${lang}-${path.basename(repo)}.json`)
    // A cache is keyed on the file set AND the newest mtime in it. A count alone would
    // return yesterday's index for a repository that edited a file in place, which is the
    // one case where a stale index silently changes an answer instead of failing.
    let newest = 0
    for (const f of repoFiles) { try { newest = Math.max(newest, statSync(f).mtimeMs) } catch { /* counted by the gate */ } }
    try {
      const raw = JSON.parse(readFileSync(cachePath, "utf8"))
      if (raw?.files === repoFiles.length && raw?.newest === newest) {
        const back = mod.deserializeProjectIndex(raw.index)
        if (back !== null) { byRepo.set(repo, back); cached++; indexed += raw.files; continue }
      }
    } catch { /* no usable cache: build below */ }
    const index = await mod.buildProjectIndexStreaming(wasm, repoFiles, spec)
    damaged += index.stats.damaged
    indexed += index.stats.files
    byRepo.set(repo, index)
    built++
    try {
      writeFileSync(cachePath, JSON.stringify({
        files: repoFiles.length, newest, index: mod.serializeProjectIndex(index),
      }))
    } catch { /* a cache that cannot be written is not a failed measurement */ }
  }
  return { byRepo, built, cached, damaged, indexed }
}

async function measure(lang: string, ext: string, maxFiles: number, useIndex: boolean, onlyRepos?: Set<string>) {
  // `yaml,yml` → ["yaml","yml"]; a bare `yaml` keeps its exact old meaning, so no existing
  // invocation changes population. The admitted set travels into the report and is printed.
  const exts = ext.split(",").map((e) => e.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
  const { files, admitted, total, repos, absent, overCap, overCapLargest } = discoverFiles(lang, ext, exts, maxFiles, onlyRepos)

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
  const projectKinds = new Map<string, Map<string, Set<string>>>()
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
    rows.set(t, { type: t, edges: 0, project: emptyOutcomes(), pooled: emptyOutcomes(), marks: new Map(), intent: emptyIntent() })
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
  const indexInfo = useIndex ? await projectIndexesFor(lang, files) : null
  const repoOf = (f: string): string => {
    const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
    return path.join(CR, rel.split(path.sep)[0])
  }

  // THE EVIDENCE FOR AN IMPORT CLAIM, built once per repository and ONLY for a lane whose
  // analyzer makes that claim (`importOutsideProject`). Built from the UNSAMPLED admitted
  // list, because "is this path in the project?" is a fact about the project, not about
  // how many files this run had budget for.
  const projectFacts: Map<string, ProjectFacts> | null = (() => {
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
      out.set(repo, ext.toLowerCase() === "dart" ? projectFactsForDart(repo, list) : projectFactsForFiles(repo, list))
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
    /** the marker-set signature, interned in `row.marks` at push time so the diagnostic and
     *  the classification cannot disagree about which marker set an edge belongs to */
    sig: string
    /** the PROJECT the edge was emitted in — the key space that decides its outcome */
    repo: string
    /** the FILE the edge was emitted from and its own line — the exact intent test's two inputs */
    srcFile: string
    line: number | null
  }
  const pending: PendingEdge[] = []
  /** WHERE each declaration lives — see `classifyIntent`. Filled by `countKey` in both key spaces. */
  const declPos = new Map<string, { file: string; line: number }[]>()

  // PROGRESS ON STDERR, because a whole-corpus run is hours and a run whose only output is
  // its last line cannot be told apart from a wedged one. stdout stays exactly the report:
  // every consumer of this gate reads stdout and the exit code.
  const PROGRESS_EVERY = 2000
  const t0 = Date.now()

  for (const f of files) {
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
    /** the same increment in both key spaces, so a symbol can never be counted in one only.
     *  ALSO records WHERE the declaration lives: the exact intent test needs (file, line), and a
     *  count cannot answer "is the declaration the edge meant in the edge's own file?". */
    const countKey = (key: string, kind: string, file: string, line: number | null) => {
      const at = declPos.get(key)
      const pos = { file, line: line ?? -1 }
      if (!at) declPos.set(key, [pos])
      else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
      pooledDecl.set(key, (pooledDecl.get(key) ?? 0) + 1)
      let ps = pooledKinds.get(key)
      if (!ps) pooledKinds.set(key, (ps = new Set()))
      ps.add(kind)
      pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
      let qs = pKinds!.get(key)
      if (!qs) pKinds!.set(key, (qs = new Set()))
      qs.add(kind)
    }

    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const symKind = String(s?.kind ?? "")
      const symLine = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
      countKey(name, symKind, f, symLine)

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
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) {
        countKey(q, symKind, f, symLine)
        aliasedKeys++
      }
    }

    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const row = rows.get(label)!
      row.edges++
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) continue
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
      const edgeLine = Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null
      pending.push({ label, tgt, claim, sig, repo: repoOf(f), srcFile: f, line: edgeLine })
      continue
    }
  }

  // ------------------------------------------------------------------------------------------
  // CLASSIFICATION, over the finished key spaces. Project scope first because that is the one
  // the verdict reads; pooled beside it because that is the one every earlier dart number in
  // this programme was measured with, and dropping it silently would make this run
  // incomparable to its own history — and BOTH are complete here, which is the point.
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
    const needsFacts = e.claim?.kind === "projectFacts" || e.claim?.kind === "projectFile"
    const facts = needsFacts ? projectFacts?.get(e.repo) : undefined
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
    const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
    const pc = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, facts, isContains, ownFileDeclares)
    tally(row.project, pc, e.tgt, e.label)
    row.intent[classifyIntent(e.tgt, e.srcFile, e.line, e.label, declPos)]++
    tally(row.pooled, classifyEdge(pooledDecl, pooledKinds, e.tgt, e.claim, facts, isContains), e.tgt, e.label)
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
      case "causeDeclared": case "causeRefuted": marks.cause++; break
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

  return {
    lang, ext: exts.join(","), admittedExts: exts, files, total, repos, parsed, failed, degraded, degradedFiles, aliasedKeys, rows, fallbackRows, emptyResults,
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
  return { ok: failures.length === 0, failures }
}

function verdict(rep: Report): { pass: boolean; edges: number; totals: Outcomes; pooled: Outcomes; reason: string } {
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
  // A lane with no corpus is UNMEASURED, which is not the same as passing and must not
  // render as one. Exits 2.
  if (rep.parsed === 0) return { pass: false, edges, totals: t, pooled, reason: "no corpus admitted — UNMEASURED, not a pass" }
  // THE BINDING CLAIM'S EVIDENCE IS THE SPELLING, and the spelling is evidence only while no
  // published declaration name carries the separator: a target containing it could then name a
  // declaration, and every binding claim in the run would be checking nothing. That is a
  // fact about the population, so it is asserted over the population and named in the verdict
  // rather than left to the per-edge check to notice.
  if (rep.bindingSpelling.keys > 0) {
    return {
      pass: false, edges, totals: t, pooled,
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
  if (bad === 0 && t.externalUnverified === 0 && t.bindingUnverified === 0) {
    return {
      pass: true, edges, totals: t, pooled,
      reason: `every one ${scope} resolves to exactly one declaration, or carries a claim the project confirms (${ext}; ${bind})`,
      // NOT REACHABLE TODAY FOR DART, and left in place because it is the shape a PASS takes: the
      // per-file column carries declared causes, which do not score, so this branch is entered only
      // where the residue is empty — see the contract in `docs/analyzers/real-dart-analyzer.md`.
    }
  }
  if (bad === 0) {
    return {
      pass: false, edges, totals: t, pooled,
      reason: `${t.externalUnverified} external claim(s) name no identifier-shaped owner, so the project can neither confirm nor deny them (${ext})`,
    }
  }
  return {
    pass: false, edges, totals: t, pooled,
    reason:
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
  console.log(
    `population: ${rep.parsed} parsed of ${rep.files.length} sampled ` +
    `(corpus has ${rep.total} .${rep.ext} files across ${rep.repos} repos; stride sample)`,
  )
  // THE ADMITTED SPELLINGS ARE PART OF THE POPULATION CLAIM (HANDOFF §5.2). Printed on their own
  // line so a run against half the lane's files cannot be read as a run against the lane: on
  // ansible `.yaml` alone is 13 files and `.yaml,.yml` is 2,082, same language, same lane.
  console.log(
    `population: admitted extensions = ${rep.admittedExts.map((e) => `.${e}`).join(", ")} ` +
    `(${rep.admittedExts.length === 1 ? "ONE spelling — check the lane does not carry another" : "both spellings admitted"}) ` +
    `— PLUS a bare BASENAME equal to any of them WHEN THE ROUTER'S OWN DETECTION GIVES IT TO ` +
    `THIS LANE (\`Makefile\` has no extension to match, and an extension-only rule measured 129 ` +
    `files where the production router admits 697 — but the router's verdict is a LANGUAGE, not a ` +
    `spelling: \`dart-sdk/sdk/bin/dart\` is a bash script and is NOT this lane's file).`,
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
        `THE TABLE (src/ast/parallel-indexer.ts PROJECT_INDEX_EXTENSIONS) carries ` +
        `\`.sol\`, \`.fs\` and \`.proto\`: ` +
        `for SOLIDITY, FSHARP and PROTOBUF this population IS production's, and for every other ` +
        `language — DART included, whose spec exists in project-index.ts but is unreachable because ` +
        `\`.dart\` was never added — the analyzer is parsed with no context and behaves as this ` +
        `run's --index-less arm does. Its counts are not comparable to a --index-less run.`,
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
    const withIntent = [...rep.rows.values()].filter((r) => r.intent.intended + r.intent.sameFileUnproven + r.intent.arbitraryTwin + r.intent.noDeclaration > 0)
    if (withIntent.length) {
      const intentTotals = withIntent.reduce((a, r) => ({
        intended: a.intended + r.intent.intended, sameFileUnproven: a.sameFileUnproven + r.intent.sameFileUnproven,
        arbitraryTwin: a.arbitraryTwin + r.intent.arbitraryTwin, noDeclaration: a.noDeclaration + r.intent.noDeclaration,
        edges: a.edges + r.edges,
      }), { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0, edges: 0 })
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
        w("arbitraryTwin", 25) + "nothingAnywhere",
      )
      const intentSum = (i: { intended: number; sameFileUnproven: number; arbitraryTwin: number; noDeclaration: number }) =>
        i.intended + i.sameFileUnproven + i.arbitraryTwin + i.noDeclaration
      const intentGaps: string[] = []
      for (const r of withIntent) {
        if (intentSum(r.intent) !== r.edges) intentGaps.push(`${r.type} ${r.edges - intentSum(r.intent)}`)
        console.log(
          "  " + w(r.type, 14) + w(r.edges, 9) + w(r.intent.intended, 10) + w(r.intent.sameFileUnproven, 17) +
          w(r.intent.arbitraryTwin, 25) + String(r.intent.noDeclaration),
        )
      }
      console.log(
        "  " + w("TOTAL", 14) + w(intentTotals.edges, 9) + w(intentTotals.intended, 10) +
        w(intentTotals.sameFileUnproven, 17) + w(intentTotals.arbitraryTwin, 25) +
        String(intentTotals.noDeclaration),
      )
      // THE TABLE SHOWS ITS OWN CLOSURE — the third table in this gate that did not, and the omission
      // is what let a careful lane read `noDeclaration` as the own-file class and report a 45,967-edge
      // contradiction that does not exist. A row whose four classes do not sum to its edge count is a
      // row with a class missing, and that is now printed instead of left to the reader to notice.
      if (intentGaps.length === 0) {
        console.log(`  INTENT CLOSURE: every row closes — intended+sameFileUnproven+arbitraryTwin+nothingAnywhere == edges.`)
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
  // THE REFUTED CLAIMS, PRINTED WHOLE AND UNCAPTIONED BY ANYTHING ELSE.
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
    console.log(
      `EXTERNAL CLAIMS THE POPULATION REFUTES (counted AGAINST the lane — the owner these name IS published):`,
    )
    for (const x of refuted) console.log(`  ${w(x.type, 14)} ${x.name}`)
    console.log()
  }
  console.log(`VERDICT: ${v.pass ? "PASS" : "FAIL"} — ${v.reason}`)
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
// `--repo=a,b` measures whole named repositories instead of a stride over the corpus. See
// `discoverFiles` for why a sampled run cannot answer a question about file-scoped targets.
const REPO_ARG = argv.find((a) => a.startsWith("--repo="))
const ONLY_REPOS = REPO_ARG
  ? new Set(REPO_ARG.slice("--repo=".length).split(",").map((s) => s.trim()).filter(Boolean))
  : undefined
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
    ? Object.entries(LANES_B).filter(([l]) => l === ONLY)
    : Object.entries(LANES_B)
  if (lanes.length === 0) {
    console.error(`--only ${ONLY} names no lane; known: ${Object.keys(LANES_B).join(" ")}`)
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
  for (const [lang, ext] of Object.entries(LANES_B)) {
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
  console.log(`incoming gate — ${Object.keys(LANES_B).length} laptop-B lanes\n`)
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
const ext = rest[1]
const maxFiles = Number(rest[2] ?? 120)
const rep = await measure(lang, ext, maxFiles, USE_INDEX, ONLY_REPOS)
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

if (rep.parsed === 0) process.exit(2)
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