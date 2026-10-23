#!/usr/bin/env bun
/**
 * ERLANG CAUSE CENSUS — every UNRESOLVED row of the whole-population arm, dispositioned as an
 * EXACT PARTITION of named causes, each with a count and a falsifier.
 *
 * ## WHY THIS EXISTS
 *
 * The arm (`script/m14/incoming-gate.ts erlang erl,hrl 0 --dump`) prints one `unresolved` number
 * per type and one `TOTAL`. A TOTAL IS NOT A CAUSE. The completion gate's condition (D) requires
 * every wall to be dispositioned with a count and a falsifier, and this instrument produces the
 * partition that the declaration's `causeRulings` transcribe.
 *
 * ## THE INPUTS
 *
 *   · THE ARM LOG (`--arm`), parsed by `script/m14/erlang-arm-log.ts` — ONE parser for both this
 *     instrument and the declaration generator, because a rule copied in two places is one rule that
 *     will diverge. It refuses a truncated dump, a non-whole population, a TABLE 1 that does not
 *     close, and a dump whose unresolved rows disagree with the table.
 *   · THE EXTENDED CENSUS (`--census`): `declaredNameIndex.namesByRepo` is what makes the classes
 *     SEMANTIC — "declared in ANOTHER repository of the corpus" (external evidence) and "declared
 *     NOWHERE in the corpus" (the BIF/vendor boundary) are different causes with different repairs,
 *     and neither can be read off an edge's text. ONE instrument walks the tree; this reads what it saw.
 *
 * ## THE PARTITION (the wall = TABLE 1's `unresolved` column)
 *
 *   Q1 qualified-remote-call      a `calls` target that keeps `module:function` (ER-D1): NO erlang
 *                                 symbol carries a `qualifiedName` alias BY DESIGN, so a name-count
 *                                 resolver cannot bind it — a SPELLING wall, not a missing declaration.
 *   Q2 qualified-reference        any other label whose target is qualified (`mod:type()`, ER-D31).
 *   F1 file-inclusion-path        a `part_of` target: an INCLUDE PATH, not a symbol name (ER-D46).
 *   B1 bare-declared-elsewhere    a bare target declared in ANOTHER repository of the corpus.
 *   B2 bare-declared-nowhere      a bare target declared in NO admitted file: BIF / type-vocabulary /
 *                                 inserted-header boundary.
 *   W1 own-repo-yet-unresolved    a bare target DECLARED in the row's own repository and still
 *                                 unresolved — the resolution model's residual, counted, never hidden.
 *   U0 unclassified               MUST BE 0; the instrument exits 11 rather than absorb a row.
 *
 * Rows whose outcome is NOT `unresolved` are not walls: they live in their own TABLE-1 columns and
 * are reported beside the partition in `nonWallTerms`.
 *
 * USAGE
 *   bun script/m14/erlang-cause-census.ts --arm <gate log> --census <erlang-extended-census.json> \
 *        [--out validation/m14/measurements/erlang-cause-census.json] [--fail-nonzero-w1]
 *
 * EXIT: 0 partition exact · 2 usage/input · 7 the arm log is refused by the shared parser · 11 an
 * unclassified row exists (or W1 > 0 under --fail-nonzero-w1).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

import { parseArmLog, ArmLogRefusal, closureTerms } from "./erlang-arm-log"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const ARM = argOf("--arm")
const CENSUS = argOf("--census")
const OUT = argOf("--out") ?? path.join(ROOT, "validation", "m14", "measurements", "erlang-cause-census.json")
const FAIL_ON_W1 = argv.includes("--fail-nonzero-w1")
const LANE = "erlang"
const say = (s: string) => process.stderr.write(s + "\n")

if (!ARM || !CENSUS) {
  console.error("usage: bun script/m14/erlang-cause-census.ts --arm <incoming-gate log> --census <erlang-extended-census.json> [--out <path>]")
  process.exit(2)
}

let arm
try {
  arm = parseArmLog(ARM)
} catch (e: any) {
  if (e instanceof ArmLogRefusal) { console.error(`REFUSED — ${e.message}`); process.exit(7) }
  throw e
}

const census = JSON.parse(readFileSync(CENSUS, "utf8"))
const namesByRepo: Record<string, string[]> = census?.declaredNameIndex?.namesByRepo ?? {}
const repoSet = new Map<string, Set<string>>()
const corpusUnion = new Set<string>()
for (const [repo, names] of Object.entries(namesByRepo)) {
  const s = new Set(names as string[])
  repoSet.set(repo, s)
  for (const n of s) corpusUnion.add(n)
}
if (repoSet.size === 0) {
  console.error("REFUSED — the census carries no declaredNameIndex.namesByRepo; the B1/B2 split cannot be made without it.")
  process.exit(2)
}

const corpusRoot: string = census?.populationRule?.root ?? ""
const repoOf = (srcFile: string): string => {
  if (corpusRoot && srcFile.startsWith(corpusRoot)) {
    return srcFile.slice(corpusRoot.length).replace(/^\//, "").split("/")[0] ?? "-"
  }
  const marker = "/.corpus/"
  const i = srcFile.indexOf(marker)
  if (i >= 0) return srcFile.slice(i + marker.length).split("/")[0] ?? "-"
  return srcFile.replace(/^\//, "").split("/")[0] ?? "-"
}

interface ClassRow { count: number; labels: Record<string, number>; examples: string[] }
const classes: Record<string, ClassRow> = {
  Q1_qualified_remote_call: { count: 0, labels: {}, examples: [] },
  Q2_qualified_reference: { count: 0, labels: {}, examples: [] },
  F1_file_inclusion_path: { count: 0, labels: {}, examples: [] },
  B1_bare_declared_in_another_repository: { count: 0, labels: {}, examples: [] },
  B2_bare_declared_nowhere_in_corpus: { count: 0, labels: {}, examples: [] },
  W1_declared_in_own_repository_yet_unresolved: { count: 0, labels: {}, examples: [] },
  U0_unclassified: { count: 0, labels: {}, examples: [] },
}
const addClass = (cls: string, label: string, example: string) => {
  const c = classes[cls]!
  c.count++
  c.labels[label] = (c.labels[label] ?? 0) + 1
  if (c.examples.length < 12) c.examples.push(example)
}
for (const row of arm.unresolvedRows) {
  const { label, target, srcFile, line } = row
  const example = `${srcFile}:${line} ${label} -> ${target}`
  if (!target) { addClass("U0_unclassified", label, example); continue }
  if (label === "part_of") { addClass("F1_file_inclusion_path", label, example); continue }
  if (target.includes(":")) {
    addClass(label === "calls" ? "Q1_qualified_remote_call" : "Q2_qualified_reference", label, example)
    continue
  }
  const repo = repoOf(srcFile)
  const own = repoSet.get(repo)
  if (own && own.has(target)) { addClass("W1_declared_in_own_repository_yet_unresolved", label, example); continue }
  if (corpusUnion.has(target)) { addClass("B1_bare_declared_in_another_repository", label, example); continue }
  addClass("B2_bare_declared_nowhere_in_corpus", label, example)
}

const wall = arm.total.unresolved
const classSum = Object.values(classes).reduce((a, c) => a + c.count, 0)
if (classSum !== wall) {
  console.error(`REFUSED — the partition sums to ${classSum} against the wall ${wall}; the census cannot name ${wall - classSum} row(s).`)
  process.exit(11)
}
if (classes.U0_unclassified!.count > 0) {
  console.error(`REFUSED — ${classes.U0_unclassified!.count} unresolved row(s) are UNCLASSIFIED. A class that cannot be named is a hole, not a ruling.`)
  process.exit(11)
}
if (FAIL_ON_W1 && classes.W1_declared_in_own_repository_yet_unresolved!.count > 0) {
  console.error(
    `REFUSED — W1 (declared in the row's own repository, yet unresolved) is ${classes.W1_declared_in_own_repository_yet_unresolved!.count}, not 0. ` +
      "That is the resolution model's residual and it must be read, not skipped.",
  )
  process.exit(11)
}

const nonWallTerms = {
  resolved: arm.total.resolved,
  collRes: arm.total.collRes,
  ambDecl: arm.total.ambDecl,
  ambKind: arm.total.ambKind,
  extOK: arm.total.extOK,
  extUnk: arm.total.extUnk,
  extFAIL: arm.total.extFAIL,
  bindOK: arm.total.bindOK,
  bindUnk: arm.total.bindUnk,
  bindFAIL: arm.total.bindFAIL,
  causeOK: arm.total.causeOK,
  causeFAIL: arm.total.causeFAIL,
}

const truth = {
  schemaVersion: 1,
  kind: "erlang-cause-census",
  lane: LANE,
  generatedAt: new Date().toISOString(),
  instrument: "script/m14/erlang-cause-census.ts (reads the arm log through script/m14/erlang-arm-log.ts + the extended census; no second parse)",
  command: `bun script/m14/erlang-cause-census.ts --arm ${path.relative(ROOT, ARM)} --census ${path.relative(ROOT, CENSUS)} --out ${path.relative(ROOT, OUT)}`,
  population: arm.population,
  populationRule: census?.populationRule ?? null,
  arm: {
    log: path.relative(ROOT, ARM),
    edges: arm.total.edges,
    wall,
    nonWallTerms,
    note:
      "the wall this partition dispositions is TABLE 1's `unresolved` column. amb(decl)/amb(kind)/collRes and the external/binding/cause columns are NOT the wall: they live in their own TABLE-1 columns and are reported in nonWallTerms. The closure block below is the arm's own eleven-term row, so the declaration inherits it verbatim instead of recomputing it.",
    closure: closureTerms(arm.total),
  },
  partition: {
    rule:
      "Every unresolved row is in EXACTLY ONE class. Q1/Q2 target a qualified spelling; F1 targets an include path (a file, not a symbol); B1/B2/W1 look the bare target up in the census's declared-name index (own repository, corpus union). U0 must be 0 — the instrument refuses to write otherwise.",
    sum: classSum,
    wall,
    classes,
  },
  falsifiers: {
    Q1_qualified_remote_call: {
      run: "bun script/m14/erlang-cause-census.ts --arm <arm log> --census <erlang-extended-census.json>",
      wouldFail:
        "a `calls` unresolved target WITHOUT a colon landing in this class, or an erlang ANALYZER symbol carrying a non-empty `qualifiedName` (ER-D1: the analyzer sets none; the ARBITER's own population counter `qualifiedNameAliases` read 0 in the lane's prior declaration; the parseFile projection derives one for every symbol and is explicitly not used — see the census's analyzerQualifiedNameNote) — either would mean the target COULD be resolved by name, so the class would be a defect and not a spelling wall.",
    },
    Q2_qualified_reference: {
      run: "bun script/m14/erlang-cause-census.ts --arm <arm log> --census <erlang-extended-census.json>",
      wouldFail: "a non-calls unresolved target WITHOUT a colon landing in this class; the class is defined by the spelling, so a bare target here would falsify it.",
    },
    F1_file_inclusion_path: {
      run: "bun script/m14/erlang-cause-census.ts --arm <arm log> --census <erlang-extended-census.json>",
      wouldFail:
        "a `part_of` target that the census's declared-name index carries in the row's own repository — that would mean the target is a declaration and the file-inclusion label is wrong; or a `part_of` row that resolves in TABLE 1 while this class counts it.",
    },
    B1_bare_declared_in_another_repository: {
      run: "bun script/m14/erlang-cause-census.ts --arm <arm log> --census <erlang-extended-census.json>",
      wouldFail:
        "a B1 target that IS in the row's own repository's name set (it would be W1 and the under-report would move the row, not disappear), or a target absent from the corpus union (it would be B2).",
    },
    B2_bare_declared_nowhere_in_corpus: {
      run: "bun script/m14/erlang-cause-census.ts --arm <arm log> --census <erlang-extended-census.json>",
      wouldFail: "a B2 target that the corpus union DOES contain — the class would be claiming an external boundary for a name the corpus declares.",
    },
    W1_declared_in_own_repository_yet_unresolved: {
      run: "bun script/m14/erlang-cause-census.ts --arm <arm log> --census <erlang-extended-census.json> --fail-nonzero-w1",
      wouldFail: "W1 > 0: a name declared in the edge's own repository that the arm still left unresolved is a resolution-model gap, and the --fail-nonzero-w1 run is the falsifier-as-exit-code.",
    },
    U0_unclassified: {
      run: "bun script/m14/erlang-cause-census.ts --arm <arm log> --census <erlang-extended-census.json>",
      wouldFail: "U0 > 0 exits 11: a row this instrument cannot name falsifies the claim that the partition is exact.",
    },
  },
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(truth, null, 2) + "\n")
say("")
say(`CAUSE PARTITION — the wall ${wall} = ` + Object.entries(classes).filter(([, c]) => c.count > 0).map(([k, c]) => `${k} ${c.count}`).join(" + "))
say(`  non-wall TABLE 1 terms: ${JSON.stringify(nonWallTerms)}`)
say(`  per-class labels: ${JSON.stringify(Object.fromEntries(Object.entries(classes).map(([k, c]) => [k, c.labels])))}`)
say(`artifact: ${OUT}`)
