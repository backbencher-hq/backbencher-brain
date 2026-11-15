/**
 * LANE-LOCAL MUTATION PROOF — TOML (#289), laptop B.
 *
 * ## Why this file exists rather than an entry in `script/m14/mutate-analyzer.ts`
 *
 * `script/m14/mutate-analyzer.ts` is the M14 mutation registry and it is
 * SUPERVISOR-OWNED (§8 of the lane brief: "anything else in `script/m14/` that is
 * shared machinery"). The F4 gate reads that registry, so a mutant belonging to
 * this lane's two new fixes belongs there — and adding it is a report item, not
 * an edit.
 *
 * A mutant that is not RUN proves nothing, and the fsharp lane's own note in that
 * registry records what happens when one is registered but not run: "the fourteen
 * mutants it registers did not fail and did not report; they were not RUN, so the
 * F4 gate could not fail for this lane while reading as a suite with no fsharp
 * reds." So this file does not wait for the registry entry. It applies each
 * mutant to a COPY of the analyzer, runs the copy on this lane's fixture, and
 * asserts that the fixture's own pins FAIL — which is the property F4 measures,
 * established here from the lane's own fixtures.
 *
 * The mutant is a SOURCE patch, not a result transform. `MUTANTS` in the shared
 * registry transforms the analyzer's OUTPUT; a source patch is the stronger form
 * because it cannot accidentally re-implement the thing it is breaking, and
 * because the two defects below are structural (an index captured at the wrong
 * time, a filter removed) rather than a relabelling.
 *
 * A patch whose anchor text is not found FAILS LOUDLY and is reported as
 * unapplied. A mutant that silently does not apply is a green row that measures
 * nothing, which is the shape this whole exercise exists to avoid.
 *
 * READ-ONLY with respect to the repository: the mutant is written to a temp
 * directory and the analyzer's own import of `./engine` is rewritten to an
 * absolute path so the copy resolves outside `src/`.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"

const ANALYZER = path.resolve(process.cwd(), "src/ast/real-toml-analyzer.ts")
const ENGINE = path.resolve(process.cwd(), "src/ast/engine.ts")
const FIXTURE_DIR = path.resolve(process.cwd(), "validation/m14/fixtures/toml")
/** WHICH FIXTURE the suite runs against: `--fixture=<name>` picks one. */
const FIXTURE_NAME = (() => {
  const a = process.argv.slice(2).find((x) => x.startsWith("--fixture="))
  return a ? a.slice("--fixture=".length) : "declaration-order-and-empty-keys"
})()
const FIXTURE = path.resolve(FIXTURE_DIR, `${FIXTURE_NAME}.toml`)

type Mutant = {
  id: string
  /**
   * The source patches, ALL of which must apply. A mutant is a REVERT of a fix,
   * so it is as many patches as the fix was edits: the second one below removes
   * the `namesSomething` guard but would not reproduce the corpus defect on its
   * own, because `segmentsOf` no longer drops the empty segment. Reverting one
   * half produces `table.with.empty.key.""` — a name this lane also forbids —
   * rather than `table.with.empty.key.`, so the first version of this mutant was
   * caught breaking a pin and NOT caught breaking the pin it named. Both halves
   * are reverted here so the mutant reproduces the measured state exactly.
   */
  patches: { anchor: string; replacement: string }[]
  description: string
  /** A pin from the fixture that the mutant MUST break. Named, not inferred. */
  mustBreak: { kind: "forbidSymbol" | "forbidRelationship" | "missSymbol" | "missRelationship"; match: Record<string, unknown> }
  /**
   * WHICH FIXTURE carries the pin this mutant must break. A mutation is only
   * meaningful against the fixture that PINS the behaviour it removes, so the
   * fixture is part of the mutant's identity rather than a global setting: two
   * mutants on two different fixtures are two different proofs.
   */
  fixture?: string
}

const MUTANTS: Mutant[] = [
  {
    id: "toml/declaration-order-second-pass-disabled",
    patches: [{ anchor: "      if (owner === rec.owner) continue", replacement: "      if (true) continue" }],
    description:
      "DECLARATION ORDER: the second pass that re-owns a section against the WHOLE declared-table map is disabled. `[late.child.grandchild]` is declared above both its ancestors, so a document-order walk files it under the MODULE and the `contains` edge points at the file instead of at the table that contains the section. Measured on the corpus before the fix: 1 occurrence in 1,140 files, `ansible/pyproject.toml`.",
    mustBreak: {
      kind: "forbidRelationship",
      match: { type: "contains", from: "declaration-order-and-empty-keys", target: "declaration-order-and-empty-keys.late.child.grandchild" },
    },
  },
  {
    id: "toml/empty-key-fix-reverted",
    patches: [
      { anchor: "  return out\n}\n\n/**\n * Does this key NAME something?", replacement: "  return out.filter((s) => s.length > 0)\n}\n\n/**\n * Does this key NAME something?" },
      {
        anchor: "          const segs = segmentsOf(ck)\n          if (!namesSomething(segs)) continue\n          emitKey(child, `${name}.${joinPath(segs)}`, name)",
        replacement: "          const segs = segmentsOf(ck)\n          emitKey(child, `${name}.${joinPath(segs)}`, name)",
      },
    ],
    description:
      "THE EMPTY KEY, IN A TABLE — the whole fix reverted. `segmentsOf` drops the empty segment again AND the in-table guard is removed, so `[\"table.with.empty.key\"]` followed by `\"\" = \"x\"` publishes the symbol `table.with.empty.key.` — a trailing dot, which is not a spelling TOML can parse back. This is not a synthetic defect: it is the state `pb-grpc/pyproject.toml:53` was in, measured at 1 occurrence in 1,140 files. The document-root guard is left in place, because the defect WAS the two halves of one rule disagreeing.",
    mustBreak: {
      kind: "forbidSymbol",
      match: { name: "table.with.empty.key." },
    },
  },
  {
    id: "toml/claim-shape-rule-removed",
    fixture: "bare-name-and-claim-shapes",
    patches: [
      {
        anchor: "          ...(fileClaim === null && /[/\\\\]|^[a-z][a-z0-9+.-]*:/i.test(pathValue)\n            ? { sourcePathClaim: [pathValue] }\n            : {}),",
        replacement: "          ...(fileClaim === null\n            ? { sourcePathClaim: [pathValue] }\n            : {}),",
      },
    ],
    description:
      "THE CLAIM-SHAPE RULE, REMOVED. A `path` dependency's target is claimed only when it is PATH-SHAPED — it carries a '/' or a scheme — because a bare name ('SubProjectB', 'dependency') has nothing to check against the project's admitted file list. With the shape test gone, EVERY target is claimed, bare names included, and a bare name then carries a source-path claim that can never be refuted: a claim no input can refute is a claim that can certify anything, which is the fleet's laundering vector (a bare fixture name promoted to a verified external). THIS IS THE CLASS OF THE LANE'S FIVE REMAINING UNRESOLVED EDGES — all five are bare names — and the reason they are RULED rather than fixed is this rule and not a missing implementation. The mutation is proved against the fixture that PINS the refusal (`meta.sourcePathClaim: null` on the bare-name edge), so the anti-laundering property has a test behind it instead of a comment.",
    mustBreak: {
      kind: "missRelationship",
      match: {
        type: "imports",
        from: "bare-name-and-claim-shapes.dependencies.SubProjectB",
        target: "SubProjectB",
        "meta.sourcePathClaim": null,
      },
    },
  },
]

// ---------------------------------------------------------------- the runner

type Pin = {
  expectSymbols: Record<string, unknown>[]
  forbidSymbols: Record<string, unknown>[]
  expectRelationships: Record<string, unknown>[]
  forbidRelationships: Record<string, unknown>[]
}
const expectation: Pin = JSON.parse(readFileSync(FIXTURE.replace(/\.toml$/, ".expectation.json"), "utf8"))

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-toml.wasm"))))

/**
 * ONE FIXTURE'S MATERIAL — the file, its content, and its pins. A mutant names
 * the fixture whose pin it must break, so the suite is a set of per-fixture
 * groups rather than one global fixture: two mutants on two fixtures are two
 * different proofs, and a mutant measured against a fixture that does not pin
 * its behaviour measures nothing.
 */
type FixtureMaterial = { name: string; path: string; content: string; expectation: Pin }
function loadFixture(name: string): FixtureMaterial {
  const p = path.resolve(FIXTURE_DIR, `${name}.toml`)
  return {
    name,
    path: p,
    content: readFileSync(p, "utf8"),
    expectation: JSON.parse(readFileSync(p.replace(/\.toml$/, ".expectation.json"), "utf8")),
  }
}

/** Run an analyzer CLASS on a fixture and return its result. */
async function run(Analyzer: any, fx: FixtureMaterial): Promise<any> {
  const tree = parser.parse(fx.content)
  if (!tree) throw new Error("fixture did not parse")
  const r = Analyzer.prototype.analyze.call(new Analyzer(), tree.rootNode as unknown as Node, fx.content, fx.path)
  tree.delete?.()
  return r
}

/** Does an actual item satisfy EVERY specified field of a pin row? */
function matches(actual: any, pin: Record<string, unknown>): boolean {
  for (const [k, want] of Object.entries(pin)) {
    // `comment` is DOCUMENTATION on an expectation row, not a constraint —
    // run-fixtures says so explicitly and a matcher that treats it as a field
    // reports every commented pin as unmet against a correct analyzer, which is
    // the failure mode that makes a mutation harness look like it found nothing.
    if (k === "comment") continue
    if (k.startsWith("meta.")) {
      const key = k.slice("meta.".length)
      const meta = (actual.metadata ?? {}) as Record<string, unknown>
      // THE `meta.x: null` CONVENTION (M59), the same one run-fixtures uses: "this edge
      // must NOT carry x", where ABSENT counts. Without it a strict `!==` could never
      // state the absence — the case a consumer actually hits most — and a pin written
      // that way would read as UNMET against a correct analyzer. That is not a
      // theoretical concern here: the claim-shape fixture pins the ABSENCE of a claim
      // key, and this matcher reported it unmet on the unmutated analyzer until the
      // convention was implemented.
      if (want === null) {
        if (meta[key] !== undefined && meta[key] !== null) return false
        continue
      }
      // ARRAY-VALUED metadata (a claim payload) compares BY CONTENT, not by reference —
      // the same rule run-fixtures uses (M49, #868). A strict `!==` can never be true for
      // two distinct arrays holding the same values, so a claim pin written that way
      // would read as UNMET against a correct analyzer. This is not theoretical here:
      // the claim-shape fixture pins `meta.sourcePathClaim: ["../core"]`, and this
      // matcher reported it unmet on the unmutated analyzer until the rule was added.
      if (Array.isArray(want)) {
        if (!Array.isArray(meta[key])) return false
        const norm = (a: unknown[]) => JSON.stringify([...a].map((x) => JSON.stringify(x)).sort())
        if (norm(meta[key] as unknown[]) !== norm(want)) return false
        continue
      }
      if (meta[key] !== want) return false
      continue
    }
    if (k === "line_number") {
      if (actual.line_number !== want) return false
      continue
    }
    // An expectation row names an edge endpoint `from`; the analyzer's row names
    // it `source`. run-fixtures does this mapping, so a lane-local matcher that
    // does not will report every relationship pin as unmet — which is what the
    // first version of this file did, 22 pins failing against a correct analyzer.
    const field = k === "from" ? "source" : k
    if (actual[field] !== want) return false
  }
  return true
}

type Verdict = { broken: boolean; detail: string }
function checkPin(result: any, pin: (typeof MUTANTS)[number]["mustBreak"]): Verdict {
  if (pin.kind === "forbidSymbol") {
    const hit = (result.symbols ?? []).find((s: any) => matches(s, pin.match))
    return { broken: hit !== undefined, detail: hit ? `published the forbidden symbol ${JSON.stringify(hit.name)}` : "no forbidden symbol" }
  }
  if (pin.kind === "forbidRelationship") {
    const hit = (result.relationships ?? []).find((x: any) => matches(x, pin.match))
    return { broken: hit !== undefined, detail: hit ? `emitted the forbidden relationship ${JSON.stringify(hit.source)} -> ${JSON.stringify(hit.target)}` : "no forbidden relationship" }
  }
  if (pin.kind === "missSymbol") {
    const hit = (result.symbols ?? []).find((s: any) => matches(s, pin.match))
    return { broken: hit === undefined, detail: hit ? `expected symbol ${JSON.stringify(hit.name)} present` : "expected symbol absent" }
  }
  const hit = (result.relationships ?? []).find((x: any) => matches(x, pin.match))
  return { broken: hit === undefined, detail: hit ? "expected relationship present" : "expected relationship absent" }
}

/** How many of a fixture's pins the CURRENT output satisfies — the baseline. */
function pinScore(result: any, expectation: Pin): { satisfied: number; total: number; failures: string[] } {
  let satisfied = 0
  let total = 0
  const failures: string[] = []
  for (const s of expectation.expectSymbols ?? []) {
    total++
    if ((result.symbols ?? []).some((x: any) => matches(x, s))) satisfied++
    else failures.push(`missing symbol ${JSON.stringify(s.name)}`)
  }
  for (const s of expectation.forbidSymbols ?? []) {
    total++
    const hit = (result.symbols ?? []).some((x: any) => matches(x, s))
    if (!hit) satisfied++
    else failures.push(`forbidden symbol present: ${JSON.stringify(s.name)}`)
  }
  for (const r of expectation.expectRelationships ?? []) {
    total++
    if ((result.relationships ?? []).some((x: any) => matches(x, r))) satisfied++
    else failures.push(`missing relationship ${JSON.stringify(r.from)} -> ${JSON.stringify(r.target)}`)
  }
  for (const r of expectation.forbidRelationships ?? []) {
    total++
    const hit = (result.relationships ?? []).some((x: any) => matches(x, r))
    if (!hit) satisfied++
    else failures.push(`forbidden relationship present: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.target)}`)
  }
  return { satisfied, total, failures }
}

const { RealTomlAnalyzer } = await import(path.join(process.cwd(), "src/ast/real-toml-analyzer"))
const src = readFileSync(ANALYZER, "utf8")
const tmp = mkdtempSync(path.join(tmpdir(), "toml-mutant-"))
let applied = 0
let caught = 0
const unapplied: string[] = []
const survivors: string[] = []

/**
 * THE SUITE IS GROUPED BY FIXTURE, because a mutant's baseline is "how many pins
 * did the fixture satisfy before the mutation" — and that number is a property
 * of the FIXTURE, not of the analyzer. A mutant measured against a fixture that
 * does not pin the behaviour it removes measures nothing, so each mutant names
 * the fixture whose pin it must break, and each fixture is baselined once.
 */
const groups = new Map<string, typeof MUTANTS>()
for (const m of MUTANTS) {
  const key = m.fixture ?? FIXTURE_NAME
  const g = groups.get(key) ?? []
  g.push(m)
  groups.set(key, g)
}

for (const [fxName, group] of groups) {
  const fx = loadFixture(fxName)
  const base = await run(RealTomlAnalyzer, fx)
  const baseScore = pinScore(base, fx.expectation)
  console.log(`fixture: ${path.relative(process.cwd(), fx.path)}`)
  console.log(`baseline (unmutated analyzer): ${baseScore.satisfied}/${baseScore.total} pins satisfied`)
  if (baseScore.failures.length > 0) {
    console.log("  UNMET PINS ON THE UNMUTATED ANALYZER:")
    for (const f of baseScore.failures) console.log(`    ${f}`)
    console.log("")
    console.log("REFUSING to measure mutants against a fixture the current analyzer already fails: a suite that is red before the mutation cannot show that the mutation made it red.")
    process.exit(1)
  }

  for (const m of group) {
    let mutated = src
    let bad = false
    for (const patch of m.patches) {
      const occurrences = mutated.split(patch.anchor).length - 1
      if (occurrences !== 1) {
        unapplied.push(`${m.id}: an anchor was found ${occurrences}x, expected exactly 1 — ${JSON.stringify(patch.anchor.slice(0, 60))}`)
        bad = true
        break
      }
      mutated = mutated.replace(patch.anchor, patch.replacement)
    }
    if (bad) continue
    // THE COPY LIVES IN A TEMP DIRECTORY, so EVERY local relative import has to be
    // rewritten to an absolute path — not just `./engine`.
    //
    // THIS WAS THE HARNESS'S OWN LATENT BREAK, AND IT IS WHY THE SUITE COULD NOT RUN AT
    // ALL: the analyzer gained `./file-claim` (the file-claim refactor) and
    // `./project-scoped-identity` (the file-scoped identity), and this harness rewrote
    // ONLY `from "./engine"`. The mutant copy therefore failed to resolve its own
    // imports with `MODULE_NOT_FOUND` — the suite was DEAD, not red. A dead suite reads
    // exactly like a green one, which is the failure mode this file exists to avoid, so
    // the rewrite is now GENERAL: every `from "./<local>"` becomes the absolute path of
    // `src/ast/<local>.ts`.
    mutated = mutated.replace(
      /from "\.\/([A-Za-z0-9_.\-]+)"/g,
      (_m, local: string) => `from ${JSON.stringify(path.join(path.dirname(ANALYZER), `${local}.ts`))}`,
    )
    const file = path.join(tmp, `${m.id.replace(/[^a-z0-9]+/gi, "_")}.ts`)
    writeFileSync(file, mutated)
    applied++
    const Mutant = (await import(file)).RealTomlAnalyzer
    const result = await run(Mutant, fx)
    const score = pinScore(result, fx.expectation)
    const verdict = checkPin(result, m.mustBreak)
    const ok = verdict.broken && score.satisfied < baseScore.satisfied
    if (ok) caught++
    else survivors.push(m.id)
    console.log("")
    console.log(`${ok ? "CAUGHT  " : "SURVIVED"} ${m.id}`)
    console.log(`  ${m.description}`)
    console.log(`  pins ${score.satisfied}/${score.total} (baseline ${baseScore.satisfied}/${baseScore.total})   mustBreak ${m.mustBreak.kind} ${JSON.stringify(m.mustBreak.match)} -> ${verdict.detail}`)
    for (const f of score.failures.slice(0, 6)) console.log(`    now-failing pin: ${f}`)
    if (score.failures.length > 6) console.log(`    ... ${score.failures.length - 6} more`)
  }
}

console.log("")
console.log(`applied ${applied}/${MUTANTS.length}   caught ${caught}/${applied}   survivors ${survivors.length}`)
for (const u of unapplied) console.log(`UNAPPLIED ${u}`)
if (unapplied.length > 0 || survivors.length > 0 || caught !== MUTANTS.length) {
  console.log("")
  console.log(">>> THIS GATE FAILS. An unapplied mutant measures nothing and a surviving mutant is a defect class with no test behind it.")
  process.exitCode = 1
} else {
  console.log(`every mutant was applied and every one was caught by this lane's own fixture pins.`)
}