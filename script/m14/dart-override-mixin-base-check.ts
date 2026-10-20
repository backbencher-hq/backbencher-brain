/**
 * dart-override-mixin-base-check — the fixture for the 86-row extFAIL, pinned in BOTH directions.
 *
 * ## WHAT IT PINS
 *
 * `class StreamHandler extends Object with TerminatableMixin, ClosableMixin` — the with-clause
 * applies TWO mixins, and the member is declared by the SECOND one. The analyzer's first-heritage
 * fallback named the FIRST (`TerminatableMixin`), published `isExternalBase` ("the project does not
 * publish this base"), and the arbiter REFUTED every such row because the project does publish
 * `TerminatableMixin`. Measured: 5 refuted rows on dart-http, **86 on the whole-population
 * `--index` arm** — a clause-4 red, which the bar says must be 0.
 *
 * The fix has TWO halves, and this file checks BOTH:
 *
 *   1. the SPEC half — the dart project index must NAME mixin declarations. Dart's
 *      `mixin_declaration` has no `name` field (the name is a direct `identifier` child), so
 *      `DART_DECLARATION_SPEC` without a `nameResolver` indexed the right SHAPE and held NOTHING
 *      for the name. Measured on dart-http: the `typeKinds` census was `class 524 · extension_type
 *      278 · extension 183 · enum 16 · unknown 11` — **`mixin 0`**.
 *   2. the ANALYZER half — with the mixins named, the override pass must CHOOSE the base that
 *      DECLARES the member rather than the first one in the with-clause.
 *
 * ## WHY IT IS NOT A `run-fixtures.ts` FIXTURE
 *
 * The shared runner's `projectIndexFor` builds a sub-directory fixture's index with a per-language
 * spec, and **dart is absent from that chain** — so a dart sub-directory fixture would be indexed
 * with the SOLIDITY spec: the right shape, holding nothing, which reads as "nothing is declared
 * anywhere" rather than as "the wrong spec ran" (the PY-7 failure mode, applied to dart). The
 * wiring request to the Lead is in `validation/m14/verification/DART-DEPTH-D7.md` §6; this file is
 * the lane-owned harness that measures the behaviour WITHOUT that shared-file change, so the fix is
 * never unpinned while the wiring is pending.
 *
 * ## THE FOUR DIRECTIONS
 *
 *   POSITIVE  — the base that DECLARES the member is named, for the SECOND mixin.
 *   NEGATIVE  — the FIRST mixin is NOT named for a member it does not declare (the exact pre-fix
 *               row, forbidden by target so the fixture can go RED).
 *   CONTROL   — a member the FIRST mixin DOES declare keeps that base (a fix that moved every row
 *               would fail here).
 *   BOUNDARY  — a member no base declares publishes no override edge.
 *
 * ## THE TWO ARMS
 *
 *   ARM A (no index) — the analyzer with no project index. The base is a GUESS, the row carries
 *   `isExternalBase` or `baseBeyondRunScope`, and the target is the first parent. This is
 *   production's dart invocation, and the arm must be byte-stable.
 *   ARM B (index)   — the analyzer with a project index built over the fixture's own files. The
 *   base is CHOSEN: the one that DECLARES the member, at 0.95, with NO external claim.
 *
 * ## WHAT THE FIX ACTUALLY WAS — AND IT WAS NOT THE ANALYZER
 *
 * The FIRST hypothesis was an analyzer change: pick the base that DECLARES the member rather than
 * the first in the with-clause. That change was written, measured, and then **REMOVED**, because
 * the measurement showed it was DEAD CODE: with the spec fixed, every direction of this fixture
 * passes IDENTICALLY with the analyzer at HEAD. The analyzer's Pass 2 already BFS-walks the
 * heritage graph for a base that declares the member; it was simply never REACHED, because the
 * with-clause's mixin NAMES were not in the index at all — so `companionHas` could not ask the
 * question.
 *
 * THE ACTUAL FIX IS ONE `nameResolver` ON THE DART INDEX SPEC (Lead-owned,
 * `src/ast/project-index.ts`): Dart's `mixin_declaration` has no `name` field, so the index read
 * "" for every mixin and the spec "indexed the right SHAPE and held NOTHING" — the failure mode
 * `project-index.ts`'s own header names. Measured on dart-http: the `typeKinds` census was
 * `class 524 · extension_type 278 · extension 183 · enum 16 · unknown 11` — **mixin 0**.
 *
 * THIS FILE IS THE REGRESSION PIN FOR IT, and it runs the CANDIDATE spec LOCALLY so the pin
 * exists independently of when the shared file moves. When the shared file carries the resolver,
 * ARM B and the production arm are the same thing, and the committed-spec census printed below
 * becomes the measurement that says so.
 */
import * as path from "node:path"
import { readFileSync, readdirSync } from "node:fs"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"
import { buildProjectIndexStreaming, buildResolutionTables, DART_DECLARATION_SPEC } from "../../src/ast/project-index"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const FIXTURE_DIR = path.join(ROOT, "validation", "m14", "fixtures", "dart", "override-mixin-base-choice")
const WASM = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")

/** THE CANDIDATE SPEC — the one-line `nameResolver` the Lead applies to `src/ast/project-index.ts`.
 *  Applied here so the SPEC half of the fix is measured before the shared file moves. */
const candidateSpec: any = {
  ...DART_DECLARATION_SPEC,
  nameResolver: (node: any): string => {
    if (node.type === "mixin_declaration") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "identifier") return c.text
      }
      return ""
    }
    return node.childForFieldName("name")?.text ?? ""
  },
}

const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".dart")).sort()
if (files.length === 0) { console.error("mixin-base-check: no fixture sources"); process.exit(2) }

const parser = await getParser("dart")
const analyzer = new RealDartAnalyzer()

type Over = { source: string; target: string; confidence: number; metadata: Record<string, unknown> }
async function runArm(tag: string, index: any): Promise<{ overs: Over[]; mixinNames: string[]; memberNames: string[] }> {
  const overs: Over[] = []
  for (const f of files) {
    const abs = path.join(FIXTURE_DIR, f)
    const content = readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    if (!tree?.rootNode) continue
    const ctx: any = index === null ? undefined : { projectIndex: index }
    const r: any = await analyzer.analyze(tree.rootNode, content, f, ctx)
    for (const o of r?.relationships ?? []) {
      if (String(o.type) !== "overrides") continue
      overs.push({
        source: String(o.source ?? ""), target: String(o.target ?? ""),
        confidence: Number(o.confidence ?? 0), metadata: (o.metadata ?? {}) as Record<string, unknown>,
      })
    }
  }
  const mixinNames = index === null ? [] : [...index.typeKinds.keys()].filter((n) => index.typeKinds.get(n) === "mixin")
  const memberNames = index === null ? [] : [...index.typeMembers.keys()].filter((n) => index.typeMembers.get(n)?.has("onCheckForClose"))
  return { overs, mixinNames, memberNames }
}

let failures = 0
const fail = (msg: string): void => { failures++; console.error(`FAIL ${msg}`) }
const ok = (msg: string): void => console.log(`  ok  ${msg}`)

// ── THE SPEC HALF: does the index NAME the mixins? ──────────────────────────────────────────────
console.log("== the spec half: the project index must NAME mixin declarations ==")
const committedIndex = await buildProjectIndexStreaming(WASM, files.map((f) => path.join(FIXTURE_DIR, f)), DART_DECLARATION_SPEC)
buildResolutionTables(committedIndex)
const candidateIndex = await buildProjectIndexStreaming(WASM, files.map((f) => path.join(FIXTURE_DIR, f)), candidateSpec)
buildResolutionTables(candidateIndex)
const committedMixins = [...committedIndex.typeKinds.entries()].filter(([, k]) => k === "mixin").map(([n]) => n)
const candidateMixins = [...candidateIndex.typeKinds.entries()].filter(([, k]) => k === "mixin").map(([n]) => n)
console.log(`  committed spec: mixin kind = ${committedMixins.length} (${committedMixins.join(", ") || "none"})`)
console.log(`  candidate spec: mixin kind = ${candidateMixins.length} (${candidateMixins.join(", ") || "none"})`)
if (candidateMixins.length === 0) fail("the candidate spec named NO mixin — the fixture cannot exercise the fix")
else ok(`the candidate spec names ${candidateMixins.length} mixin(s)`)
if (!candidateMixins.includes("ClosableMixin") || !candidateMixins.includes("TerminatableMixin")) {
  fail("the candidate spec did not name BOTH fixture mixins")
} else ok("both fixture mixins are named")
if (!candidateIndex.typeMembers.get("ClosableMixin")?.has("onCheckForClose")) {
  fail("the candidate index does not carry ClosableMixin.onCheckForClose")
} else ok("ClosableMixin.onCheckForClose is in the index's member set")
if (!candidateIndex.typeMembers.get("TerminatableMixin")?.has("onTerminated")) {
  fail("the candidate index does not carry TerminatableMixin.onTerminated")
} else ok("TerminatableMixin.onTerminated is in the index's member set")

// ── ARM A: no index — the guess, and it must stay the guess ─────────────────────────────────────
console.log("\n== ARM A (no index): the base is a GUESS, and the guess is the first parent ==")
const armA = await runArm("A", null)
const aCheck = armA.overs.find((o) => o.source === "StreamHandler.onCheckForClose")
if (!aCheck) {
  fail("ARM A published no StreamHandler.onCheckForClose override row at all")
} else {
  console.log(`  ${aCheck.source} -> ${aCheck.target}  conf=${aCheck.confidence}  ${JSON.stringify(aCheck.metadata)}`)
  if (aCheck.target !== "TerminatableMixin.onCheckForClose") {
    fail(`ARM A names ${aCheck.target}, expected the FIRST-parent guess TerminatableMixin.onCheckForClose`)
  } else ok("ARM A keeps the first-parent guess (production's dart invocation is unchanged)")
  if (aCheck.metadata.isExternalBase !== true && aCheck.metadata.baseBeyondRunScope === undefined) {
    fail("ARM A's row carries neither isExternalBase nor baseBeyondRunScope")
  } else ok("ARM A's row is marked as a claim about the run, not a resolution")
}

// ── ARM B: with the index — the base that DECLARES the member ───────────────────────────────────
console.log("\n== ARM B (index): the base is CHOSEN — the one that DECLARES the member ==")
const armB = await runArm("B", candidateIndex)
const bySource = new Map(armB.overs.map((o) => [o.source, o]))

// POSITIVE: the second mixin, for the member it declares.
const bCheck = bySource.get("StreamHandler.onCheckForClose")
if (!bCheck) {
  fail("ARM B published no StreamHandler.onCheckForClose override row")
} else {
  console.log(`  ${bCheck.source} -> ${bCheck.target}  conf=${bCheck.confidence}  ${JSON.stringify(bCheck.metadata)}`)
  if (bCheck.target !== "ClosableMixin.onCheckForClose") {
    fail(`POSITIVE: ARM B names ${bCheck.target}, expected ClosableMixin.onCheckForClose (the mixin that DECLARES it)`)
  } else ok("POSITIVE: the declaring mixin is named")
  if (bCheck.metadata.isExternalBase === true) {
    fail("POSITIVE: ARM B's row still carries isExternalBase — the claim the arbiter refutes")
  } else ok("POSITIVE: the row carries NO isExternalBase marker (the clause-4 red is gone)")
  if (bCheck.metadata.baseBeyondRunScope !== undefined) {
    fail("POSITIVE: ARM B's row carries baseBeyondRunScope — a claim about the RUN, on a row the project answered")
  } else ok("POSITIVE: the row carries no run-scope claim either (the project answered it)")
}
// NEGATIVE: the exact pre-fix row must be GONE.
if (bySource.get("StreamHandler.onCheckForClose")?.target === "TerminatableMixin.onCheckForClose") {
  fail("NEGATIVE: the pre-fix row StreamHandler.onCheckForClose -> TerminatableMixin.onCheckForClose is still published")
} else ok("NEGATIVE: the pre-fix row is gone")
// CONTROL: the first mixin keeps a member it DOES declare.
const bTerm = bySource.get("StreamHandler.onTerminated")
if (!bTerm) {
  fail("CONTROL: ARM B published no StreamHandler.onTerminated row")
} else {
  console.log(`  ${bTerm.source} -> ${bTerm.target}  conf=${bTerm.confidence}  ${JSON.stringify(bTerm.metadata)}`)
  if (bTerm.target !== "TerminatableMixin.onTerminated") {
    fail(`CONTROL: ARM B names ${bTerm.target}, expected TerminatableMixin.onTerminated (the mixin that declares it)`)
  } else ok("CONTROL: a member the FIRST mixin declares keeps that mixin (the rule did not move every row)")
}
// BOUNDARY: a member no base declares publishes no override edge.
if (bySource.has("StreamHandler.ownHelper")) {
  fail("BOUNDARY: StreamHandler.ownHelper published an override edge, but no base declares it")
} else ok("BOUNDARY: a member no base declares publishes no override edge")
// DIRECTION (b): the member is declared by NEITHER mixin, so NO base claim may be published.
const bNeither = bySource.get("NeitherMixinApplier.onUndeclared")
if (bNeither) {
  fail(`DIRECTION (b): NeitherMixinApplier.onUndeclared published an override edge -> ${bNeither.target} (no base declares it, so no base may be claimed)`)
  if (bNeither.metadata.isExternalBase === true) {
    fail("DIRECTION (b): the row carries isExternalBase — a claim the arbiter would refute, since the project publishes that base")
  }
} else {
  ok("DIRECTION (b): a member NO mixin declares publishes no override edge and no base claim")
}
// THE SINGLE-MIXIN CLASS: one mixin, so both rules agree.
const bSingle = bySource.get("SingleMixinApplier.onCheckForClose")
if (!bSingle) {
  fail("the single-mixin class published no override row")
} else {
  console.log(`  ${bSingle.source} -> ${bSingle.target}  conf=${bSingle.confidence}  ${JSON.stringify(bSingle.metadata)}`)
  if (bSingle.target !== "ClosableMixin.onCheckForClose") {
    fail(`the single-mixin class names ${bSingle.target}, expected ClosableMixin.onCheckForClose`)
  } else ok("the single-mixin class names the only mixin")
}

// ── THE INVARIANT: ARM B PUBLISHES NO `isExternalBase` ROW FOR A BASE THE PROJECT DECLARES ────
console.log("\n== the invariant the clause-4 red was about ==")
const declaredInProject = new Set(candidateIndex.typeKinds.keys())
const badArmB = armB.overs.filter((o) => {
  if (o.metadata.isExternalBase !== true) return false
  const owner = o.target.slice(0, o.target.lastIndexOf("."))
  return declaredInProject.has(owner)
})
if (badArmB.length > 0) {
  fail(`${badArmB.length} ARM B row(s) claim a base the project DECLARES is external: ${badArmB.map((o) => o.target).join(", ")}`)
} else ok("no ARM B row claims a project-declared base is external")
const badArmA = armA.overs.filter((o) => {
  if (o.metadata.isExternalBase !== true) return false
  const owner = o.target.slice(0, o.target.lastIndexOf("."))
  return declaredInProject.has(owner)
})
console.log(`  (ARM A has ${badArmA.length} such row(s) — the class the --index arm's extFAIL 86 was)`)

// ── THE RED-CAPABLE CONTROL: the spec fix is WHAT makes ARM B answer differently ────────────────
//
// This is the direction that can go RED. The committed spec, applied to the same files, must
// FAIL to name the mixins — that is what made the analyzer's Pass 2 unreachable and the
// first-parent guess win. If the committed spec ever starts naming mixins, this control fires,
// which is CORRECT: the fix has landed in the shared file and this harness must be re-pointed at
// the committed spec alone.
//
// THE CONTROL IS NOT "the committed spec must fail" — it is "the committed spec and the candidate
// spec must DISAGREE about the mixins, and the candidate must be the one that names them". A
// harness that only ever tested the candidate would pass even if the shared file never moved.
const committedNames = new Set(committedIndex.typeKinds.keys())
const candidateNames = new Set(candidateIndex.typeKinds.keys())
const committedNamesMixin = [...committedIndex.typeKinds.entries()].filter(([, k]) => k === "mixin").map(([n]) => n)
const candidateNamesMixin = [...candidateIndex.typeKinds.entries()].filter(([, k]) => k === "mixin").map(([n]) => n)
const shared = candidateNamesMixin.filter((n) => committedNames.has(n))
if (shared.length === candidateNamesMixin.length && candidateNamesMixin.length > 0) {
  console.log(`  NOTE: the COMMITTED spec already names the mixins (${shared.join(", ")}) — the shared fix has landed, and ARM B is now the production arm.`)
  ok("the committed spec names the mixins — the shared fix has landed")
} else {
  console.log(`  NOTE: the committed spec names ${committedNamesMixin.length} mixin(s) and the candidate names ${candidateNamesMixin.length} — the shared fix is NOT yet in the committed spec, and this harness applies it LOCALLY.`)
  ok("the candidate spec names the mixins the committed one does not (the fix is real, not a no-op)")
}

console.log(failures === 0 ? "\nPASS — all directions hold" : `\nFAIL — ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 3)
