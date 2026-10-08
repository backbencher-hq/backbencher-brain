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
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

/** Laptop B's 23 lanes, from docs/analyzers/PROMPT-LAPTOP-B.md:15 — asserted, not inferred. */
export const LANES_B: Record<string, string> = {
  bash: "sh", fsharp: "fs", zig: "zig", lua: "lua", julia: "jl", nim: "nim",
  php: "php", powershell: "ps1", r: "r", dart: "dart", sql: "sql", graphql: "graphql",
  protobuf: "proto", json: "json", yaml: "yaml", css: "css", scss: "scss",
  hcl: "tf", make: "mk", toml: "toml", xml: "xml", markdown: "md", clean: "icl",
}

/**
 * Metadata keys that mark an edge as naming something outside the corpus.
 *
 * An EXPLICIT list, not a heuristic, because "looks like a stdlib name" is exactly the
 * kind of inference that made `no-regex-gate.sh` report 187 where the truth was 5: a rule
 * that fires on shape convicts a correct analyzer. A lane must opt in, per key, and the
 * key must mean the same thing fleet-wide or the number is not comparable between lanes.
 *
 * `zigExternalRef` and `nimStdlibModule` are read from the committed analyzers:
 *   real-zig-analyzer.ts:2281 zigExternalReceiverPath, measured marking 2,189 recoverable
 *     + 5,009 external edges (validation/m14/fixtures/zig/measurements/incoming-abc-400-p30.json)
 *   real-nim-analyzer.ts  meta.nimStdlibModule, measured marking 66 of 485 unbindable
 *     (docs/analyzers/real-nim-analyzer.md:435-449)
 */
const EXTERNAL_KEYS = [
  "zigExternalRef",
  "nimStdlibModule",
  "isExternal",
  "isExternalTarget",
  "external",
  "externalRef",
  "isStdlib",
  "stdlibModule",
  "moduleNamingEdges",
  "markAsExternal",
  // dart: the first-heritage fallback in `real-dart-analyzer.ts`, which fires only where
  // NO evidence refutes the base (the base is a name this run cannot see) and only for a
  // member carrying the `@override` annotation. Named `isExternalBase` rather than one of
  // the generic spellings because it marks a BASE, not a target: the marked row still
  // names a member, and that member is still required to exist (see the Object retarget).
  "isExternalBase",
]

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
function discoverFiles(lang: string, ext: string, maxFiles: number): {
  files: string[]; total: number; repos: number
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
    return { files: [], total: 0, repos: 0, absent: 0, overCap: 0, overCapLargest: 0 }
  }
  for (const name of entries.sort()) {
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
      if (!rel.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) continue
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
  return { files, total, repos: repos.size, ...excluded }
}

/** Is this edge declared as naming something outside the corpus? */
function isMarkedExternal(rel: any): boolean {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return false
  for (const k of EXTERNAL_KEYS) {
    if (md[k] === true) return true
    // `moduleNamingEdges` is an ARRAY of such flags on some lanes; presence counts.
    if (Array.isArray(md[k]) && md[k].length > 0) return true
  }
  return false
}

type Outcome =
  | "resolved" | "ambBoth" | "ambDeclOnly" | "unresolved"
  | "externalVerified" | "externalRefuted" | "externalUnverified"

/**
 * The owner segment of a qualified target: everything before the FINAL dot.
 *
 * `Object.hashCode` -> `Object`; `package:flutter/material.dart:*` -> a non-identifier,
 * which is the point of returning it rather than a cleaned-up guess.
 */
function targetOwner(tgt: string): string | null {
  const dot = tgt.lastIndexOf(".")
  if (dot <= 0) return null
  return tgt.slice(0, dot)
}

/**
 * CAN THE POPULATION REFUTE THE CLAIM? An external marker is a claim the corpus can check,
 * and a gate that accepts it unverified is a gate that can be laundered: mark every
 * unresolved edge external and `unresolved` reads 0. So the claim is verified here.
 *
 *   VERIFIED   the target's OWNER is not published anywhere in the population. The corpus
 *              has looked for the declaration this edge depends on and does not have it —
 *              that is what "outside the declared population" means, measured.
 *   REFUTED    the corpus DOES publish the owner. The claim "this names something outside
 *              the corpus" is then false about the owner, and the edge is reported as what
 *              it is: unresolved. It is never counted clean.
 *   UNVERIFIABLE  the target has no identifier-shaped owner to look up (a module URI such
 *              as `package:flutter/material.dart:*`, or a bare unqualified name). The index
 *              cannot confirm or deny, so this is a THIRD bucket — visible, counted, and
 *              deliberately not merged into either of the other two.
 *
 * Calibrated on this programme's own record: `docs/analyzers/INCOMING-WORKLIST.md` says an
 * unmarked external "counts against a lane, because a genuinely-external target and a
 * broken edge are otherwise indistinguishable". This keeps that standard and adds the
 * missing half — a marked one must still survive a lookup.
 */
function verifyExternalClaim(
  declCount: Map<string, number>,
  tgt: string,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  const owner = targetOwner(tgt)
  if (owner === null) return "externalUnverified"
  // `:`, `/` or whitespace means the owner is not an identifier — a URI scheme, a path, or
  // a member spelling like `operator ==`. No published symbol can be keyed by it, so a
  // lookup would return 0 for a reason that has nothing to do with the claim.
  if (/[:/\s]/.test(owner)) return "externalUnverified"
  return (declCount.get(owner) ?? 0) > 0 ? "externalRefuted" : "externalVerified"
}

/**
 * THE ONE RULE. Measurement and control both call this, because two copies of a counting
 * rule are two rules, and the copy the control runs is the one that stays correct.
 */
type Classified = {
  outcome: Outcome
  /** how many declarations answer to the target IN THIS KEY SPACE */
  decls: number
  /** the distinct kinds among them, `|`-joined — empty when there are none */
  kinds: string
}

function classifyEdge(
  declCount: Map<string, number>,
  kinds: Map<string, Set<string>>,
  tgt: string,
  markedExternal: boolean,
): Classified {
  const decls = declCount.get(tgt) ?? 0
  const kindSet = kinds.get(tgt)
  const kindText = [...(kindSet ?? [])].sort().join("|")
  if (decls === 0) {
    const outcome = markedExternal ? verifyExternalClaim(declCount, tgt) : "unresolved"
    return { outcome, decls, kinds: kindText }
  }
  if (decls > 1) {
    return { outcome: (kindSet?.size ?? 0) > 1 ? "ambBoth" : "ambDeclOnly", decls, kinds: kindText }
  }
  return { outcome: "resolved", decls, kinds: kindText }
}

/**
 * COUNT IT WHERE IT BELONGS — one rule, called once per scope, so the two columns can never
 * drift into being two rules.
 */
function tally(out: Outcomes, c: Classified, tgt: string, label: Type): void {
  switch (c.outcome) {
    case "resolved":
      out.resolved++
      break
    case "ambDeclOnly":
    case "ambBoth":
      out.ambiguousByDecl++
      if (c.outcome === "ambBoth") out.ambiguousByKind++
      if (out.ambiguousNames.length < 25) {
        out.ambiguousNames.push({ name: tgt, declarations: c.decls, kinds: c.kinds })
      }
      break
    case "externalVerified":
      out.markedExternal++
      out.externalVerified++
      break
    case "externalUnverified":
      out.markedExternal++
      out.externalUnverified++
      break
    case "externalRefuted":
      // NOT `unresolved` (that column means "carries no external claim") and NOT clean
      // (that column means "names exactly one declaration"). It is its own thing, and
      // the verdict counts it as bad, so a lane cannot mark its way to a PASS.
      out.markedExternal++
      out.externalRefuted++
      if (out.unresolvedNames.length < 25) {
        out.unresolvedNames.push({
          name: `${tgt}   [external claim REFUTED — the population publishes ${targetOwner(tgt)}]`,
          type: label,
        })
      }
      break
    case "unresolved":
      out.unresolved++
      // NAME IT. A count a lane cannot resolve back to the things it counted leaves
      // the only response as re-running the whole lane hoping to see it again — and
      // it is not guaranteed to reproduce. This is the population rule applied to the
      // verdict itself, and it is capped per type so one pathological name (a
      // stdlib function used 40,000 times) cannot produce a 40,000-line report.
      if (out.unresolvedNames.length < 25) out.unresolvedNames.push({ name: tgt, type: label })
      break
  }
}

/**
 * ONE SCOPE'S TALLY. The gate reports two, because "resolved" is not a property of an edge
 * on its own — it is a property of an edge AGAINST A KEY SPACE, and the two key spaces
 * answer two different questions (see `PROJECT SCOPE, and why the verdict is scoped`).
 */
type Outcomes = {
  /** targets resolving to exactly one published declaration */
  resolved: number
  /** targets naming MORE THAN ONE published declaration — the number that matters */
  ambiguousByDecl: number
  /** the same targets, counted by DISTINCT KIND — incoming-check's metric, for comparison */
  ambiguousByKind: number
  /** targets naming nothing published and NOT declared external */
  unresolved: number
  /** targets naming nothing published but carrying an external marker — the claim, total */
  markedExternal: number
  /** of those: the owner is absent, so the claim survives */
  externalVerified: number
  /** of those: the target has no identifier-shaped owner to check */
  externalUnverified: number
  /** of those: the key space publishes the owner, so the claim is FALSE and the edge is not clean */
  externalRefuted: number
  /** the colliding TARGET STRINGS, so the gap is a list a lane can act on */
  ambiguousNames: { name: string; declarations: number; kinds: string }[]
  unresolvedNames: { name: string; type: string }[]
}

const emptyOutcomes = (): Outcomes => ({
  resolved: 0, ambiguousByDecl: 0, ambiguousByKind: 0, unresolved: 0,
  markedExternal: 0, externalVerified: 0, externalUnverified: 0, externalRefuted: 0,
  ambiguousNames: [], unresolvedNames: [],
})

type Row = {
  type: Type
  edges: number
  /** resolution against the file's OWN PROJECT — what production does; the verdict's scope */
  project: Outcomes
  /** resolution against every file in this run pooled into one key space — the old number */
  pooled: Outcomes
}

/**
 * PRODUCTION PARITY: the project index.
 *
 * This gate used to walk the corpus file by file with NO context — `parseFile(f, dirname(f))`
 * — while production (`pool-worker.ts` `parse_batch`) deserialises a `ProjectIndex` the parent
 * built and hands `{ projectIndex }` to every parse. Two dart passes read it: the override
 * pass resolves a base declared in ANOTHER file of the same repository, and the expression
 * pass gates which type mentions it emits at all. So a no-context walk is not a measurement
 * of the analyzer, it is a measurement of a degraded invocation of it.
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
const INDEX_SPECS: Record<string, { spec: any; wasm: string }> = {
  dart: { spec: null, wasm: "tree-sitter-dart/tree-sitter-dart.wasm" },
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
  const spec = lang === "dart" ? mod.DART_DECLARATION_SPEC : mod.SOLIDITY_DECLARATION_SPEC
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

async function measure(lang: string, ext: string, maxFiles: number, useIndex: boolean) {
  const { files, total, repos, absent, overCap, overCapLargest } = discoverFiles(lang, ext, maxFiles)

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
  for (const t of ALL_TYPES) {
    rows.set(t, { type: t, edges: 0, project: emptyOutcomes(), pooled: emptyOutcomes() })
  }

  let parsed = 0
  let failed = 0
  let degraded = 0
  const degradedFiles: string[] = []
  /** how many qualified-name aliases were indexed — printed, so the reader knows the
   *  endpoint population is name + qualifiedName and not name alone. */
  let aliasedKeys = 0

  // Built BEFORE the walk, because production's index is built before its batch runs too.
  const indexInfo = useIndex ? await projectIndexesFor(lang, files) : null
  const repoOf = (f: string): string => {
    const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
    return path.join(CR, rel.split(path.sep)[0])
  }

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
      const idx = indexInfo?.byRepo.get(repoOf(f))
      r = idx === undefined
        ? await parseFile(f, path.dirname(f))
        : await parseFile(f, path.dirname(f), { projectIndex: idx } as any)
    } catch {
      failed++
      continue
    }
    if (!r) {
      failed++
      continue
    }
    parsed++
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
    /** the same increment in both key spaces, so a symbol can never be counted in one only */
    const countKey = (key: string, kind: string) => {
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
      countKey(name, symKind)

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
        countKey(q, symKind)
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
      const marked = isMarkedExternal(rel)
      // THE SAME EDGE, BOTH QUESTIONS. Project scope first because that is the one the
      // verdict reads; pooled beside it because it is the one every earlier dart number in
      // this programme was measured with, and dropping it silently would make this run
      // incomparable to its own history.
      tally(row.project, classifyEdge(pDecl!, pKinds!, tgt, marked), tgt, label)
      tally(row.pooled, classifyEdge(pooledDecl, pooledKinds, tgt, marked), tgt, label)
    }
  }

  return {
    lang, ext, files, total, repos, parsed, failed, degraded, degradedFiles, aliasedKeys, rows,
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
  // ONE OF EACH OUTCOME, including the two the old control could not reach: an external
  // claim that survives a lookup and one that does not. A control that cannot plant a
  // refuted claim cannot detect the laundering it exists to prevent.
  const marked = new Set([
    "AbsentThing.build",              // owner not published -> verified
    "Object.hashCode",                // owner published     -> REFUTED
    "package:flutter/material.dart:*", // no identifier owner -> unverified
  ])
  const got: Record<Outcome, number> = {
    resolved: 0, ambBoth: 0, ambDeclOnly: 0, unresolved: 0,
    externalVerified: 0, externalRefuted: 0, externalUnverified: 0,
  }
  for (const t of [
    "alpha", "beta", "gamma", "delta",
    "AbsentThing.build", "Object.hashCode", "package:flutter/material.dart:*",
  ]) {
    got[classifyEdge(declCount, kinds, t, marked.has(t)).outcome]++
  }

  // THE SCOPE IS APPLIED, and this asserts it rather than trusting the caller. `gamma` is
  // declared twice in the pooled key space and once in a project's — the shape seven
  // unrelated repositories produce constantly, and the whole reason the two tables exist.
  // If a future edit collapses the scopes back into one, this fails and the control exits 3.
  const oneProject = new Map<string, number>([["gamma", 1]])
  const oneProjectKinds = new Map<string, Set<string>>([["gamma", new Set(["function"])]])
  const scoped = classifyEdge(oneProject, oneProjectKinds, "gamma", false).outcome
  const pooled = classifyEdge(declCount, kinds, "gamma", false).outcome
  if (scoped !== "resolved" || pooled !== "ambBoth") {
    failures.push(
      `control: the same target classified ${scoped} in project scope and ${pooled} pooled; ` +
      `expected resolved/ambBoth — the two key spaces are not distinct`,
    )
  }

  if (got.resolved !== 1) failures.push(`control: expected 1 resolved, got ${got.resolved}`)
  if (got.ambDeclOnly !== 1) failures.push(`control: expected 1 ambiguous-by-declaration-only, got ${got.ambDeclOnly}`)
  if (got.ambBoth !== 1) failures.push(`control: expected 1 ambiguous-by-both, got ${got.ambBoth}`)
  if (got.unresolved !== 1) failures.push(`control: expected 1 unresolved, got ${got.unresolved}`)
  // THE LAUNDERING MUTANT. Delete the verification (return an external outcome for every
  // marked edge) and this asserts 0 and fails the control — which is the only reason the
  // number it prints can be believed.
  if (got.externalRefuted !== 1) {
    failures.push(
      `control: expected 1 REFUTED external claim (owner published), got ${got.externalRefuted} ` +
      `— an external marker is being accepted without a lookup`,
    )
  }
  if (got.externalVerified !== 1) failures.push(`control: expected 1 verified external claim, got ${got.externalVerified}`)
  if (got.externalUnverified !== 1) failures.push(`control: expected 1 unverifiable external claim, got ${got.externalUnverified}`)
  return { ok: failures.length === 0, failures }
}

function verdict(rep: Report): { pass: boolean; edges: number; totals: Outcomes; pooled: Outcomes; reason: string } {
  const t = emptyOutcomes()
  const pooled = emptyOutcomes()
  let edges = 0
  const add = (into: Outcomes, r: Outcomes) => {
    into.resolved += r.resolved
    into.ambiguousByDecl += r.ambiguousByDecl
    into.ambiguousByKind += r.ambiguousByKind
    into.unresolved += r.unresolved
    into.markedExternal += r.markedExternal
    into.externalVerified += r.externalVerified
    into.externalUnverified += r.externalUnverified
    into.externalRefuted += r.externalRefuted
  }
  for (const r of rep.rows.values()) {
    edges += r.edges
    add(t, r.project)
    add(pooled, r.pooled)
  }
  // A lane with no corpus is UNMEASURED, which is not the same as passing and must not
  // render as one. Exits 2.
  if (rep.parsed === 0) return { pass: false, edges, totals: t, pooled, reason: "no corpus admitted — UNMEASURED, not a pass" }
  // A REFUTED external claim is a bad edge. It is not in `unresolved` (that column is
  // "carries no external claim") and must not be, but it is counted here so that a lane
  // whose large population is external-LOOKING cannot buy a PASS with a marker.
  const bad = t.ambiguousByDecl + t.unresolved + t.externalRefuted
  const ext = `${t.externalVerified} verified + ${t.externalUnverified} unverifiable external`
  const scope = `of ${edges} edges, resolved against the file's OWN PROJECT (production's scope)`
  if (bad === 0 && t.externalUnverified === 0) {
    return {
      pass: true, edges, totals: t, pooled,
      reason: `every one ${scope} resolves to exactly one declaration, or carries an external claim the project confirms (${ext})`,
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
  console.log(
    rep.index === null
      ? `project index: NOT USED — this is the per-file population, which is NOT the one ` +
        `production parses (re-run with --index to measure that one)`
      : `project index: USED — ${rep.index.repos} repo index(es) (${rep.index.built} built, ` +
        `${rep.index.cached} from cache, ${rep.index.damaged} damaged) over ${rep.index.indexed} file(s) — ` +
        `the files THIS RUN sampled, so an index over a stride sample is not a project index ` +
        `(run with maxFiles 0 for the real one). Passed as ` +
        `{ projectIndex } exactly as \`pool-worker.ts\` parse_batch does. This is the ` +
        `production population: cross-file base resolution and the widened type-visibility ` +
        `gate are IN these numbers, and its counts are not comparable to a --index-less run`,
  )
  console.log(
    `excluded from that population: ${rep.excluded.absent} tracked-but-absent/unreadable + ` +
    `${rep.excluded.overCap} over the ${(rep.excluded.sizeCapBytes / 1024 / 1024).toFixed(0)} MB cap ` +
    (rep.excluded.overCap > 0 ? `(largest ${(rep.excluded.overCapLargest / 1024 / 1024).toFixed(1)} MB)` : "") +
    ` — above the cap the engine extracts structurally, not as an analyzer`,
  )
  console.log(`parse failures: ${rep.failed}   degraded (regex fallback): ${rep.degraded}`)
  console.log(
    `endpoint keys indexed: name + ${rep.aliasedKeys} qualifiedName alias(es). A lane that ` +
    `publishes a file-scoped qualified name and targets that path is measured, not missed.`,
  )
  if (rep.degradedFiles.length) for (const f of rep.degradedFiles.slice(0, 5)) console.log(`    ${f}`)
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
  const header =
    w("type", 14) + w("edges", 9) + w("resolved", 10) + w("amb(decl)", 11) +
    w("amb(kind)", 11) + w("unresolved", 12) + w("extOK", 8) + w("ext?", 8) + "extFAIL"
  console.log(header)
  console.log("-".repeat(93))
  const line = (label: string, r: Outcomes, edges: string | number) =>
    w(label, 14) + w(edges, 9) + w(r.resolved, 10) + w(r.ambiguousByDecl, 11) +
    w(r.ambiguousByKind, 11) + w(r.unresolved, 12) +
    w(r.externalVerified, 8) + w(r.externalUnverified, 8) + String(r.externalRefuted)
  for (const type of ALL_TYPES) {
    const r = rep.rows.get(type)!
    console.log(line(type, r.project, r.edges))
  }
  console.log("-".repeat(93))
  console.log(line("TOTAL", v.totals, v.edges))
  console.log(
    "extOK = external claim the PROJECT CONFIRMS (owner absent from it) · " +
    "ext? = claim no lookup can check (no identifier owner) · " +
    "extFAIL = claim the project REFUTES, counted against the lane",
  )
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
  if (ambList.length) {
    const shown = ambList.slice(0, 20)
    console.log(`AMBIGUOUS TARGETS (${ambList.length} sampled, up to 20 shown) — the worklist:`)
    for (const a of shown) {
      console.log(`  ${w(a.type, 13)} ${w(a.name, 42)} ${a.declarations} declarations  [${a.kinds}]`)
    }
    console.log()
  }
  if (unresList.length) {
    const shown = unresList.slice(0, 20)
    console.log(`UNRESOLVED TARGETS (${unresList.length} sampled, up to 20 shown) — the worklist:`)
    for (const u of shown) console.log(`  ${w(u.type, 13)} ${u.name}`)
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

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const ALL = argv.includes("--all")
const USE_INDEX = argv.includes("--index")
const rest = argv.filter((a) => !a.startsWith("--"))

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

if (ALL) {
  let failed = 0
  let unmeasured = 0
  const summary: string[] = []
  for (const [lang, ext] of Object.entries(LANES_B)) {
    const max = Number(rest[0] ?? 120)
    const rep = await measure(lang, ext, max, USE_INDEX)
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

if (rest.length < 2) {
  console.error("usage: npx tsx script/m14/incoming-gate.ts <lang> <extension> [maxFiles]")
  console.error("       npx tsx script/m14/incoming-gate.ts --all [maxFiles]")
  console.error("       maxFiles 0 = the WHOLE admitted corpus. A positive value stride-samples it,")
  console.error("       and stride against a corpus that has grown since the number was chosen")
  console.error("       silently truncates the population back to the old size.")
  process.exit(2)
}
const lang = rest[0]
const ext = rest[1]
const maxFiles = Number(rest[2] ?? 120)
const rep = await measure(lang, ext, maxFiles, USE_INDEX)
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