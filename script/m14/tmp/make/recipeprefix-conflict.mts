/**
 * MAKE-G2 (`.RECIPEPREFIX`): the conflict that blocks the patch, made reproducible.
 *
 * The scanner for `.RECIPEPREFIX` is finished and correct — see
 * `grammars/tree-sitter-make/recipeprefix/README.md`, which carries the measurements
 * and the reasoning. This probe exists so the CLAIM that it cannot yet be wired is
 * checkable in one command rather than taken on trust, because "it did not work" is
 * the least reusable kind of finding there is.
 *
 * It measures the two requirements in conflict, on the smallest inputs that show
 * each of them:
 *
 *   1. a comment between two recipe lines must not end the recipe
 *      (`a:` / tab / `# note` / tab) — a shape ordinary makefiles use constantly
 *   2. the declared prefix must be able to LEAD A RULE (`>a: deps`), which is the
 *      normal way to write `.RECIPEPREFIX` at all
 *
 * and it compares THREE builds of the same grammar:
 *
 *   pristine    upstream, tab hardcoded
 *   wired       P1 + P2, what the product loads today
 *   recipe-only the external scanner, prefix inside recipes but NOT before a rule
 *
 * The expected outcome, and the reason the patch is not wired:
 *
 *   requirement 1   recipe-only PASSES   (this is the variant the corpus A/B liked)
 *   requirement 2   recipe-only FAILS    (so the feature is only half working)
 *
 * A variant that also allowed the prefix before a rule satisfied requirement 2 and
 * BROKE requirement 1 across 3 real corpus files with 36 new error nodes. That
 * variant is not built here because it is a regression by measurement, not a
 * tradeoff to be argued about.
 *
 * Usage: bun run script/m14/tmp/make/recipeprefix-conflict.mts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"

const REPO = "<corpus-root>/backbencher-brain"
const OUT = "<corpus-root>/bb_tests/make/out"
const ATTEMPT = `${REPO}/grammars/tree-sitter-make/recipeprefix`

const BUILDS: { label: string; wasm: string }[] = [
  { label: "pristine", wasm: "<corpus-root>/bb_tests/make/ab/pristine-make.wasm" },
  { label: "wired (P1+P2)", wasm: `${REPO}/wasm/tree-sitter-make.wasm` },
  // Built by the procedure in the recipeprefix README, if it is present.
  { label: "recipe-only (NOT wired)", wasm: "/tmp/opencode/ts-g2b/make-g2b.wasm" },
]

const CASES: { id: string; requirement: 1 | 2; why: string; src: string }[] = [
  {
    id: "comment-between-recipes",
    requirement: 1,
    why: "an ordinary comment between two recipe lines must not end the recipe. A space-indented or column-zero comment is everyday makefile style, and this shape is in 3 of the 100 pinned corpus files.",
    src: "a:\n\techo hi\n# note\n\techo bye\n",
  },
  {
    id: "prefix-leads-a-rule",
    requirement: 2,
    why: "make strips the prefix from a rule line too, so `>a: deps` is the normal way to write this feature. Without it the rule line is an ERROR and the rule is swallowed into the previous recipe.",
    src: ".RECIPEPREFIX = >\nCC = gcc\n>a: $(CC)\n>\techo hi\n",
  },
]

await Parser.init()

const results: any[] = []
for (const b of BUILDS) {
  if (!existsSync(b.wasm)) {
    results.push({ build: b.label, wasm: b.wasm, present: false })
    continue
  }
  const lang = await Language.load(b.wasm)
  for (const c of CASES) {
    const p = new Parser()
    p.setLanguage(lang as any)
    const tree = p.parse(c.src)
    const errors: string[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) errors.push(`${n.type}@${n.startPosition.row + 1}`)
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree!.rootNode)
    results.push({
      build: b.label,
      wasm: b.wasm,
      present: true,
      case: c.id,
      requirement: c.requirement,
      hasError: tree!.rootNode.hasError,
      errors,
      pass: !tree!.rootNode.hasError,
    })
  }
}

const row = (r: any) =>
  r.present === false
    ? `  ${r.build.padEnd(26)} (build absent — ${r.wasm})`
    : `  ${r.build.padEnd(26)} ${r.case.padEnd(26)} requirement ${r.requirement}  ${r.pass ? "PASS" : `FAIL (${r.errors.length} error node(s): ${r.errors.slice(0, 3).join(", ")})`}`

for (const b of BUILDS) {
  console.log(`\n${b.label}`)
  for (const c of CASES) {
    const r = results.find((x) => x.build === b.label && x.case === c.id)
    if (r) console.log(row(r))
  }
}

const rr = results.find((x) => x.build?.startsWith("recipe-only") && x.case === "comment-between-recipes")
const rp = results.find((x) => x.build?.startsWith("recipe-only") && x.case === "prefix-leads-a-rule")
const verdict =
  rr && rp
    ? rr.pass && !rp.pass
      ? "AS DOCUMENTED: the scanner satisfies requirement 1 and fails requirement 2, which is why it is not wired. Making it satisfy requirement 2 regresses requirement 1 across 3 real corpus files (36 error nodes) — see the recipeprefix README."
      : `UNEXPECTED: requirement 1 pass=${rr.pass} requirement 2 pass=${rp.pass}. The README's account of this is out of date and must be corrected.`
    : "INCONCLUSIVE: the recipe-only build is absent. Rebuild it per grammars/tree-sitter-make/recipeprefix/README.md to re-run this probe."

console.log(`\nverdict: ${verdict}\n`)

writeFileSync(`${OUT}/recipeprefix-conflict.json`, JSON.stringify({ cases: CASES.map((c) => ({ id: c.id, requirement: c.requirement, why: c.why })), results, verdict }, null, 2) + "\n")
console.log(`→ ${OUT}/recipeprefix-conflict.json`)
