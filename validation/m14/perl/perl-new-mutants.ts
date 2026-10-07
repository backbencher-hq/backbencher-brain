// LANE-OWNED MUTATION CHECK for the four behaviours CORPUS_PERL3 added or
// changed: the `uses` code-reference edge, the `references` type-query edge, the
// evidence tier both labels carry, and the `&`-sigil strip on `calls`.
//
// WHY THIS FILE EXISTS RATHER THAN A REGISTRY ENTRY. The repo's mutation harness
// is `script/m14/mutate-analyzer.ts`, which is MASTER-owned: ONTOLOGY-WORKSTREAM's
// ownership table puts shared `script/m14/**` machinery and the mutant registry
// outside a language lane's remit. Adding four rows there is a shared change and
// is REPORTED in the lane report, not made here. A lane that cannot register its
// own mutants still has to prove its fixtures can fail, so this does the same
// thing locally -- the arrangement go's lane took, for the same reason.
//
// Each mutant is a DELETION or a FORCING of one guard, not a semantic rewrite,
// so the expectation is precise: exactly the named fixture must fail. A mutant
// that also kills an unrelated fixture is recorded, because a fixture that dies
// for the wrong reason is not evidence.
//
// NO REGEX. Each mutation is an exact-string replacement, asserted present
// exactly once before it is applied -- a hand-written anchor string is what makes
// a mutation testable; a pattern would make it silently no-op on a refactor.
//
// Usage: bun validation/m14/perl/perl-new-mutants.ts

import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const PERL_UNUSED_DOC = 0

const ROOT = process.env.PERL_LANE_ROOT || resolve(import.meta.dir, "..", "..", "..")
const ANALYZER = resolve(ROOT, "src/ast/real-perl-analyzer.ts")
const BACKUP = resolve(ROOT, "src/ast/real-perl-analyzer.ts.mutant-backup")

interface Mutant {
  id: string
  expectFailFixture: string
  rationale: string
  from: string
  to: string
}

const MUTANTS: Mutant[] = [
  {
    id: "perl/uses-coderef-edge-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Removes the `uses` emission itself. The coarse check: if this survives, the fixture's `expectRelationships` row for `uses` is not being read at all, and every other mutant in this file would be reporting a green suite that never looked.",
    from: "          addRelationship(source, leaf, ASTEngine.RelationshipType.Uses, { reasonCode: REASON.codeReference, ...(qualifier ? { qualifiedAs: name, qualifier } : {}) }, 0.9, varname)\n",
    to: "          void varname\n",
  },
  {
    id: "perl/uses-coderef-self-reference-guard-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Removes the self-reference guard from the `uses` branch, so `\\&run` inside `sub run` publishes `uses run -> run` -- the only edge in the label that makes it reflexive. The same rule the self-base guard applies to `extends`. This mutant SURVIVED the first run because the fixture wrote no such line; line 56 was added to the SOURCE for it.",
    from: "          if (leaf === source) break\n",
    to: "",
  },
  {
    id: "perl/uses-coderef-name-guards-both-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Removes BOTH name guards on the code-reference target: the `varname` lookup and the `isWrittenCalleeName` allowlist. This is a COMPOUND mutant on purpose, and the reason is measured rather than stylistic. Each guard alone is redundant with the other -- removing just one leaves `\\&{ $self->{slot} }` refused by the survivor, which is why three single-guard mutants against this rule all SURVIVED the first run. The question the pair actually has to answer is whether the two together are load-bearing, and only removing both answers it. With both gone, `\\&{ ... }` publishes the block's source text as a target name.",
    from: [
      '          const varname = this.findChildByType(fnNode, "varname")\n',
      '          if (!varname) break\n',
      '          // EXACTLY one named child under the `function` node: the varname. Anything\n',
      '          // else is a compound form (`&{...}`, `&($x)`) whose target is computed, and\n',
      '          // its named child is not a `varname` at all -- so this is a second guard on\n',
      '          // the same rule, not a new one.\n',
      '          if (fnNode.namedChildCount !== 1) break\n',
      '          const name = varname.text\n',
      '          if (!name || !this.isWrittenCalleeName(name)) break\n',
    ].join(""),
    to: [
      '          const varname = this.findChildByType(fnNode, "varname") ?? fnNode.namedChild(0)\n',
      '          if (!varname) break\n',
      '          const name = varname.text\n',
    ].join(""),
  },
  {
    id: "perl/references-edge-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Removes the `references` emission. The coarse check for the second new label.",
    from: "                addRelationship(\n                  source,\n                  leaf,\n                  ASTEngine.RelationshipType.References,\n                  { reasonCode: REASON.typeQueryLiteral, query: method },\n                  0.9,\n                  nameNode,\n                )\n",
    to: "",
  },
  {
    id: "perl/references-query-method-gate-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Widens the query gate from `isa`/`DOES`/`can` to EVERY method call, so `$self->render('Not::AClass')` publishes a class named `Not::AClass`. That is the phantom-type defect class this lane has already removed twice (the phantom `DSN` class and the phantom `use_module` class): a string argument to an ordinary method is DATA, not a type being queried. This mutant SURVIVED the first run because the fixture had no ordinary method call with a literal argument; line 62 was added to the SOURCE for it.",
    from: '          if (method === "isa" || method === "DOES" || method === "can") {\n            const args = this.argumentNodes(node)\n',
    to: '          if (true) {\n            const args = this.argumentNodes(node)\n',
  },
  {
    id: "perl/references-self-by-package-guard-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Removes the self-reference-by-package guard, so `$self->isa('Code::Ref')` inside `package Code::Ref` publishes `references run -> Ref`: the class asking whether it is itself. Same rule as the self-base guard on `extends`, and the two shapes are pinned separately because they are decided by different comparisons (`leaf === source` and `queried === packageName`).",
    from: '              const selfByPackage = state.packageName !== "" && queried === state.packageName\n',
    to: "              const selfByPackage = false\n",
  },
  {
    id: "perl/evidence-tier-for-new-labels-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Removes the `uses`/`references` branch from `classifyEvidenceTier`, so both fall through to `inferred` -- the tier the legend reserves for a guess. These are not guesses, they are written names, and the fixture pins `usage_contextual` on every row of both labels. Nothing else in the lane reads that field for these two types, so without this mutant the wrong tier would ship silently.",
    from: '      if (type === "uses" || type === "references") {\n        md.evidenceClass = (r.confidence ?? 0) >= 0.7 ? "usage_contextual" : "inferred"\n        continue\n      }\n',
    to: "",
  },
  {
    id: "perl/calls-ampersand-sigil-strip-removed",
    expectFailFixture: "perl/code-references",
    rationale:
      "Puts the `&` back on the emitted call target, which is the state before this lane's fix. `&helper(...)` then publishes `calls -> &helper`, a target no symbol carries -- the indexer stores `helper`. Measured 93 such edges in 36 corpus files, none of which could resolve at the target end.",
    from: '      const named = target.startsWith("&") ? target.slice(1) : target\n',
    to: "      const named = target\n",
  },
  {
    id: "perl/calls-ampersand-builtin-probe-defeated",
    expectFailFixture: "perl/code-references",
    rationale:
      "Moves the `&` strip to AFTER the builtin probe, which is the exact regression this lane's fix had to avoid: `&print(...)` is the builtin `print`, and probing `&print` against PERL_BUILTINS misses it, so the edge comes back for a word the LANGUAGE owns. The doc records that the pre-review builtin list being 10 words short produced phantom call edges on mojo, and this is the same mechanism one level along.",
    from: '      const named = target.startsWith("&") ? target.slice(1) : target\n      const probe = builtinProbe ?? named\n',
    to: '      const probe = builtinProbe ?? target\n      const named = target.startsWith("&") ? target.slice(1) : target\n',
  },
]

/**
 * GUARDS DELIBERATELY NOT MUTATED, because a mutant that cannot die is a claim
 * the harness does not support. Each of these is a real guard in the analyzer,
 * each is redundant with another guard on the same rule, and that redundancy was
 * MEASURED rather than assumed -- the first run of this file survived three
 * single-guard mutants against exactly this redundancy:
 *
 *   the `varname` lookup in the `uses` branch  -- redundant with
 *     `isWrittenCalleeName` AND with `namedChildCount !== 1`
 *   `literalNameIn`'s node-type gate          -- redundant with
 *     `isWrittenCalleeName`, which rejects a sigil
 *   `literalNameIn`'s `$` test                -- same
 *
 * Their redundancy is stated in the fixture's own rationale, and the pair that
 * IS jointly load-bearing is mutated together above. The honesty contract's rule
 * is that a surviving mutant fails the suite; the way to honour that is to
 * register only mutants whose survival would mean something.
 */
void PERL_UNUSED_DOC

function runFixtures(): { fail: string[]; pass: string[]; ran: boolean; raw: string } {
  const r = spawnSync("bun", ["run", "script/m14/run-fixtures.ts", "--lang", "perl"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900_000,
  })
  const out = `${r.stdout || ""}${r.stderr || ""}`
  const fail: string[] = []
  const pass: string[] = []
  let ran = false
  // The prefix LENGTH is computed, never hard-coded. go's copy of this runner
  // writes `line.slice(9)` because "PASS  go/" is 9 characters; "PASS  perl/" is
  // 11, so a copied 9 yields the fixture id `perl/l/code-references` and every
  // mutant reads as a SURVIVOR while the fixture that actually failed is sitting
  // in the output under a name nothing compares against. Nine survivors, none of
  // them real. An instrument that reports the wrong answer with total confidence
  // is worse than one that crashes, and this is the same shape as the
  // hard-coded population list the honesty contract calls a defect: the constant
  // rots the moment the lane name changes.
  const PASS_PREFIX = "PASS  perl/"
  const FAIL_PREFIX = "FAIL  perl/"
  for (const raw of out.split("\n")) {
    const line = raw.replace("\r", "")
    if (line.startsWith(PASS_PREFIX)) {
      pass.push(`perl/${line.slice(PASS_PREFIX.length).trim()}`)
      ran = true
    } else if (line.startsWith(FAIL_PREFIX)) {
      fail.push(`perl/${line.slice(FAIL_PREFIX.length).trim()}`)
      ran = true
    }
  }
  return { fail, pass, ran, raw: out }
}

if (existsSync(BACKUP)) {
  console.error(`a stale mutant backup exists at ${BACKUP} — a previous run was killed. Refusing to overwrite the analyzer.`)
  process.exit(2)
}

const original = readFileSync(ANALYZER, "utf8")
copyFileSync(ANALYZER, BACKUP)

let baseline: ReturnType<typeof runFixtures>
try {
  baseline = runFixtures()
} finally {
  writeFileSync(ANALYZER, original)
}
if (!baseline.ran) {
  console.error("baseline fixture run produced no perl rows — the runner did not execute; refusing to report")
  process.exit(2)
}
console.log(`baseline: ${baseline.pass.length} pass / ${baseline.fail.length} fail  (${baseline.pass.join(", ")})`)
if (baseline.fail.length > 0) {
  console.error(`baseline is not clean, so no mutant result is meaningful: ${baseline.fail.join(", ")}`)
  process.exit(2)
}

const results: Array<{ id: string; expected: string; killed: boolean; collateral: string[]; rationale: string }> = []
for (const m of MUTANTS) {
  const occurrences = original.split(m.from).length - 1
  if (occurrences !== 1) {
    console.error(`MUTANT ${m.id}: anchor appears ${occurrences} times, expected exactly 1. Refusing to apply.`)
    process.exit(2)
  }
  const mutated = original.replace(m.from, m.to)
  writeFileSync(ANALYZER, mutated)
  let run: ReturnType<typeof runFixtures>
  try {
    run = runFixtures()
  } finally {
    writeFileSync(ANALYZER, original)
  }
  const killed = run.fail.includes(m.expectFailFixture)
  const collateral = run.fail.filter((f) => f !== m.expectFailFixture)
  results.push({ id: m.id, expected: m.expectFailFixture, killed, collateral, rationale: m.rationale })
  console.log(
    `${killed ? "KILLED  " : "SURVIVED"} ${m.id.padEnd(52)} expected fail: ${m.expectFailFixture}` +
      (collateral.length ? `   collateral: ${collateral.join(", ")}` : ""),
  )
}

try {
  const now = readFileSync(ANALYZER, "utf8")
  if (now !== original) {
    console.error(`ANALYZER NOT RESTORED — the backup is kept at ${BACKUP}`)
    process.exit(2)
  }
} finally {
  rmSync(BACKUP, { force: true })
}

const survivors = results.filter((r) => !r.killed)
console.log("")
console.log(`${results.length} mutants, ${results.length - survivors.length} killed, ${survivors.length} survivors`)
for (const r of results) console.log(`  ${r.id}: ${r.rationale}`)
if (survivors.length) process.exitCode = 1
