/**
 * BASH ROUND-17 A/B — did changing `overridesLine` from the first declaration to
 * the prior one alter any EDGE, and did it move the value the right way?
 *
 * ## Why this file exists
 *
 * Round 17's change rewrites the VALUE of one metadata key on `overrides` edges. It
 * adds no edge, removes no edge and publishes no declaration — so the diff this
 * family of instruments was built for reports **nothing at all**, and a green
 * `ADDED 0 / REMOVED 0` line is equally consistent with "the change did what it
 * claimed" and "the change did nothing". That is the failure mode this file exists
 * to rule out, and it is why the round-17 counters below exist alongside round 15's.
 *
 * Three claims, and only the third is specific to this round:
 *
 *   1. METADATA ONLY — the change cannot add, remove or retype an edge. An edge
 *      appearing or disappearing would mean the change reached the emitter rather
 *      than the declaration map, and it would be a defect, not a bigger number.
 *   2. NOTHING LOST — `overridesLine` is written on every declaration of a name, so
 *      the key disappearing is a claim withdrawn, the one failure mode a metadata
 *      change must be incapable of.
 *   3. MOVED TOWARD THE EDGE, AND NEVER PAST IT — the declaration in effect is the
 *      CLOSEST earlier declaration, so it is the LARGEST line strictly below the
 *      edge's own line. The prior-declaration reading can therefore only move
 *      `overridesLine` UP from the first-declaration value (55 -> 58 for an edge at
 *      61), and never to or past the edge's own line. This file's first version
 *      asserted the opposite direction and FAILED on a correct change, which is the
 *      recorded reason the direction is now argued from the edge's line rather than
 *      from taste: a declaration in effect before line N is by definition < N.
 *
 * `script/m14/differential.ts` cannot answer any of them: its cold-pool rotation
 * draws a different 60 files every run, so two consecutive runs are not comparable.
 *
 * ## Derived from the round-15 harness, and what changed in it
 *
 * The corpus walk, the private-parser discipline and the edge/symbol keys are
 * round 15's, unchanged — re-deriving them would risk measuring a different
 * population than the round-15 row in the doc, and the two rows are meant to be
 * read together. Changed: the marker (below), the sibling-module filename, the
 * round-17 counters, and four round-17 pass criteria. Round 15's criteria are kept,
 * so this file also re-checks that round's claim on every run.
 *
 * ## The marker, and why the guard matters
 *
 * `functionPriorDeclaration` is the marker — the map this round introduced. If the
 * base commit already contains it, the two sides are the same file and the A/B is a
 * NO-OP that says so rather than printing `ADDED 0` for a comparison it never made.
 * A comparison that cannot distinguish "no difference" from "no difference because I
 * compared a file to itself" is not a check.
 *
 * ## NO REGEX
 *
 * Every comparison is `===` on published fields. Nothing is matched as text.
 *
 * CLI: BB_AB_BASE=<the commit BEFORE the change>
 *      npx tsx validation/m14/fixtures/bash/ab-round17-overrides-line.mts [--sample 400 | --all]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : num("sample", 400)
const BASE = process.env.BB_AB_BASE ?? "HEAD"
const EXAMPLES = 12

const ROOT = process.cwd()
const CURRENT = path.join(ROOT, "src/ast/real-bash-analyzer.ts")
const OLD_COPY = path.join(ROOT, "src/ast/__ab_r17_old_bash_analyzer.mts")

const NEW_MARKER = "functionPriorDeclaration"
let oldSrc: string
try {
  oldSrc = execFileSync("git", ["show", `${BASE}:src/ast/real-bash-analyzer.ts`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
} catch {
  console.log(`NO-OP: no ${BASE}:src/ast/real-bash-analyzer.ts in this checkout.`)
  process.exit(0)
}
if (oldSrc.includes(NEW_MARKER)) {
  console.log(
    `NO-OP: ${BASE} already contains the round-15 change, so it is not the pre-change version.\n` +
      `      Pass BB_AB_BASE=<the commit BEFORE the change>, e.g. 25eb3bc91.`,
  )
  process.exit(0)
}
if (!readFileSync(CURRENT, "utf8").includes(NEW_MARKER)) {
  console.log("NO-OP: the working tree does not contain the round-15 change either; nothing to compare.")
  process.exit(0)
}
writeFileSync(OLD_COPY, oldSrc)

// ------------------------------------------------------------------ file set
interface F {
  repo: string
  rel: string
  abs: string
  text: string
  hash: string
}
const files: F[] = []
let scanned = 0
const repoNames = new Set<string>()
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
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    repoNames.add(e)
    files.push({ repo: e, rel, abs, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

// ------------------------------------------------------- private tree handle
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

const { RealBashAnalyzer: NewAnalyzer } = await import("../../../../src/ast/real-bash-analyzer")
const { RealBashAnalyzer: OldAnalyzer } = await import("../../../../src/ast/__ab_r17_old_bash_analyzer.mts")
const newA: any = new NewAnalyzer()
const oldA: any = new OldAnalyzer()

const relKey = (r: any): string => `${r.source}|${r.type}|${r.target}|${r.line_number}`
const symKey = (s: any): string => `${s.name}|${s.kind}|${s.scope ?? ""}|${s.startLine ?? 0}`

let compared = 0
let degraded = 0
let relOld = 0
let relNew = 0
let symOld = 0
let symNew = 0
let symAdded = 0
let symRemoved = 0
const relAddedByType = new Map<string, number>()
const relRemovedByType = new Map<string, number>()
const metaGained = new Map<string, number>()
const metaLost = new Map<string, number>()
const relAddedEx: string[] = []
const relRemovedEx: string[] = []
const symAddedEx: string[] = []
const metaLostEx: string[] = []
/** The two keys this round is about, counted SEPARATELY from every other key so
 *  "the collision label reached N edges" is its own number and not a row in a
 *  metadata table that also carries line numbers. */
let collisionGained = 0
let flagGained = 0
let flagOnLabeledEdge = 0
const collisionEx: string[] = []

/** ROUND 17. The change is a metadata VALUE on `overrides`, so the edge-identity
 *  diff above reports nothing at all for it. This counts the movement directly:
 *  how many `overrides` edges changed their `overridesLine`, and in which
 *  direction — a value that moves is the whole claim, and a value that moves the
 *  WRONG way would be invisible to every other counter in this file. */
let ovCompared = 0
let ovChanged = 0
let ovUnchanged = 0
let ovGainedKey = 0
let ovLostKey = 0
let ovTowardEdge = 0
let ovAwayFromEdge = 0
let ovAtOrPastEdge = 0
const ovAtOrPastEx: string[] = []
const ovEx: string[] = []

for (const f of sample) {
  const label = `${f.repo}/${f.rel}`
  let oldR: any
  let newR: any
  try {
    const tOld = parser.parse(f.text)
    oldR = oldA.analyze(tOld.rootNode, f.text, f.abs)
    tOld.delete?.()
    const tNew = parser.parse(f.text)
    newR = newA.analyze(tNew.rootNode, f.text, f.abs)
    tNew.delete?.()
  } catch {
    continue
  }
  if (!oldR || !newR) continue
  if (newR.fallback || oldR.fallback) degraded++
  compared++

  const oRels: any[] = oldR.relationships ?? []
  const nRels: any[] = newR.relationships ?? []
  relOld += oRels.length
  relNew += nRels.length
  const oMap = new Map(oRels.map((r: any) => [relKey(r), r]))
  const nMap = new Map(nRels.map((r: any) => [relKey(r), r]))

  for (const [k, r] of nMap) {
    const o = oMap.get(k)
    if (o) {
      const oKeys = Object.keys(o.metadata ?? {})
      const nKeys = Object.keys(r.metadata ?? {})
      for (const g of nKeys.filter((x) => !oKeys.includes(x))) metaGained.set(g, (metaGained.get(g) ?? 0) + 1)
      for (const l of oKeys.filter((x) => !nKeys.includes(x))) {
        metaLost.set(l, (metaLost.get(l) ?? 0) + 1)
        if (metaLostEx.length < EXAMPLES) metaLostEx.push(`${label}: ${k} lost ${l}`)
      }
      if (String(r.type) === "overrides") {
        ovCompared++
        const oLine = o.metadata?.overridesLine
        const nLine = r.metadata?.overridesLine
        if (oLine === undefined && nLine !== undefined) ovGainedKey++
        else if (oLine !== undefined && nLine === undefined) ovLostKey++
        else if (oLine !== nLine) {
          ovChanged++
          // Direction is measured against the EDGE'S OWN LINE, because that is what
          // makes the reading checkable: the declaration in effect at line N is the
          // closest declaration before N, so the correct value is the largest line
          // strictly below N. Moving toward the edge is therefore correct, and
          // landing on or past it is the self-reference defect.
          const edgeLine = Number(r.line_number ?? 0)
          if (typeof nLine === "number" && typeof oLine === "number") {
            if (nLine > oLine) ovTowardEdge++
            else ovAwayFromEdge++
          }
          if (typeof nLine === "number" && nLine >= edgeLine) {
            ovAtOrPastEdge++
            if (ovAtOrPastEx.length < EXAMPLES)
              ovAtOrPastEx.push(`${label}: edge@${edgeLine}  overridesLine=${nLine}  (must be strictly less)`)
          }
          if (ovEx.length < EXAMPLES) ovEx.push(`${label}: edge@${r.line_number}  overridesLine ${oLine} -> ${nLine}`)
        } else ovUnchanged++
      }
      if (r.metadata?.collidesWithLocalDeclaration === true) {
        collisionGained++
        if (r.metadata?.targetResolution === "commandNameIsExternal") {
          if (collisionEx.length < EXAMPLES) collisionEx.push(`${label}: ${k}`)
        }
      }
      if (r.metadata?.commandInErrorRecovery === true) {
        flagGained++
        // The two facts must not appear together. `commandNameIsExternal` asserts
        // the edge reaches an external binary; the flag says the command name was
        // read out of wreckage. Counting the overlap is how the ORDER of the two
        // checks would be caught if a future change swapped them.
        if (r.metadata?.targetResolution === "commandNameIsExternal") flagOnLabeledEdge++
      }
    } else {
      const t = String(r.type)
      relAddedByType.set(t, (relAddedByType.get(t) ?? 0) + 1)
      if (relAddedEx.length < EXAMPLES) relAddedEx.push(`${label}: ${k}`)
    }
  }
  for (const k of oMap.keys()) {
    if (!nMap.has(k)) {
      const t = String(String(k).split("|")[1])
      relRemovedByType.set(t, (relRemovedByType.get(t) ?? 0) + 1)
      if (relRemovedEx.length < EXAMPLES) relRemovedEx.push(`${label}: ${k}`)
    }
  }

  const oSyms = new Set((oldR.symbols ?? []).map(symKey))
  const nSyms = new Set((newR.symbols ?? []).map(symKey))
  symOld += (oldR.symbols ?? []).length
  symNew += (newR.symbols ?? []).length
  for (const k of nSyms) {
    if (!oSyms.has(k)) {
      symAdded++
      if (symAddedEx.length < EXAMPLES) symAddedEx.push(`${label}: ${k}`)
    }
  }
  for (const k of oSyms) if (!nSyms.has(k)) symRemoved++
}

try {
  unlinkSync(OLD_COPY)
} catch {
  /* the sibling module is a scratch artefact; failing to remove it must not
     change this file's verdict, but it is reported rather than swallowed */
  console.log(`note: could not remove ${OLD_COPY}`)
}

const fmt = (m: Map<string, number>): string =>
  [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join("  ") || "(none)"
const relAdded = [...relAddedByType.values()].reduce((a, b) => a + b, 0)
const relRemoved = [...relRemovedByType.values()].reduce((a, b) => a + b, 0)

console.log(`bash round-17 A/B — ${compared} files${ALL ? " (--all)" : ""}, base ${BASE}, private tree handle`)
console.log(`corpus: ${files.length} admitted / ${scanned} scanned / ${repoNames.size} repos; degraded ${degraded}\n`)
console.log(`relationships  old ${relOld}  new ${relNew}   ADDED ${relAdded}  REMOVED ${relRemoved}`)
console.log(`  added   ${fmt(relAddedByType)}`)
console.log(`  removed ${fmt(relRemovedByType)}`)
for (const e of relAddedEx) console.log(`      + ${e}`)
for (const e of relRemovedEx) console.log(`      - ${e}`)
console.log(`\nsymbols        old ${symOld}  new ${symNew}   ADDED ${symAdded}  REMOVED ${symRemoved}`)
for (const e of symAddedEx) console.log(`      + ${e}`)
console.log(`\nmetadata GAINED  ${fmt(metaGained)}`)
console.log(`metadata LOST    ${fmt(metaLost)}`)
for (const e of metaLostEx) console.log(`      - ${e}`)
console.log(`\ncollision label gained on ${collisionGained} edges; examples:`)
for (const e of collisionEx) console.log(`      ${e}`)
console.log(`\nROUND 17 — \`overrides\` edges compared ${ovCompared}`)
console.log(`  overridesLine CHANGED          ${ovChanged}`)
console.log(`  overridesLine unchanged        ${ovUnchanged}`)
console.log(`  key gained / lost              ${ovGainedKey} / ${ovLostKey}`)
console.log(`  moved TOWARD the edge's line   ${ovTowardEdge}   (correct: the closest earlier declaration)`)
console.log(`  moved AWAY from it             ${ovAwayFromEdge}   (impossible under the prior reading)`)
console.log(`  at or PAST the edge's own line ${ovAtOrPastEdge}   (must be 0 — self-reference)`)
for (const e of ovAtOrPastEx) console.log(`      ${e}`)
for (const e of ovEx) console.log(`      ${e}`)
console.log(`commandInErrorRecovery gained on ${flagGained} edges`)
console.log(`BOTH the label and the flag on the same edge: ${flagOnLabeledEdge}  (must be 0)`)

const problems: string[] = []
if (relAdded > 0) problems.push(`${relAdded} relationships ADDED; the change is metadata-only by construction`)
if (relRemoved > 0) problems.push(`${relRemoved} relationships REMOVED; the change removes no edge`)
if (symAdded > 0) problems.push(`${symAdded} symbols ADDED; the change touches attribution only`)
if (symRemoved > 0) problems.push(`${symRemoved} symbols REMOVED; the change publishes no declaration`)
if (metaLost.size > 0) problems.push(`metadata LOST ${fmt(metaLost)}; the pass only sets absent keys`)
if (flagOnLabeledEdge > 0) {
  problems.push(
    `${flagOnLabeledEdge} edges carry BOTH commandNameIsExternal and commandInErrorRecovery; the position check must come first`,
  )
}
if (collisionGained === 0) {
  problems.push("no edge gained the collision label, so this run did not exercise the round-15 change")
}

// ROUND 17 criteria. The edge/symbol diffs above are shared: both rounds claim to
// add and remove nothing. These four are this round's own.
if (ovCompared === 0) problems.push("no `overrides` edge was compared, so this run did not exercise the change")
if (ovChanged === 0) problems.push("no `overridesLine` value moved, so the A/B did not exercise the change")
if (ovLostKey > 0) problems.push(`${ovLostKey} edges LOST overridesLine; the map is written on every declaration`)
if (ovAwayFromEdge > 0) {
  problems.push(`${ovAwayFromEdge} edges moved overridesLine to a SMALLER line; the closest earlier declaration is never below the first one`)
}
if (ovAtOrPastEdge > 0) {
  problems.push(`${ovAtOrPastEdge} edges carry an overridesLine at or past the edge's own line; the declaration in effect is strictly earlier`)
}

if (problems.length > 0) {
  console.log(`\nFAIL`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log(
  `\nPASS — ${relAdded} added, ${relRemoved} removed, ${fmt(metaLost)} lost, 0 label+flag overlap.`,
)
console.log(`      Round 17: ${ovChanged} \`overridesLine\` values moved, 0 edges or symbols added or removed.`)