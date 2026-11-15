// MATERIALIZED-ACTION CONTROL — the re-route pinned in BOTH directions, on crafted files.
//
// WHY IT EXISTS. `materialized-action-price.ts` measured the rule's whole-corpus reach before the
// analyzer was touched: 523 local `uses: ./…` sites, 10 matched to a prior same-job checkout, 9
// convertible, 1 honestly left unverifiable. A rule whose refusals are read off the corpus cannot
// be checked by reading source — the question is WHICH EDGES MOVE — so this probe runs the
// production path (`pool-worker.parseFile`, project root passed, the one that carries claims) and
// asserts ten arms, six of which must NOT move:
//
//   1. exact `./D` + earlier same-job checkout NAMING a repository -> re-routed to repo@ref
//   2. no checkout at all                                          -> UNCHANGED (isExternal)
//   3. the checkout is in ANOTHER job (another machine)            -> UNCHANGED
//   4. the checkout comes AFTER the use (order is the evidence)    -> UNCHANGED
//   5. the checkout materializes a DIFFERENT path                  -> UNCHANGED
//   6. a NON-checkout action carries the same `with: path:`        -> UNCHANGED
//   7. `with:` written BEFORE `uses:` inside the checkout step     -> STILL re-routed
//   8. `./D/<rest>` of a checkout of the CALLING repo (no
//      `repository:`) with the manifest on disk                   -> project FILE claim
//   9. the same shape with NO manifest in the project              -> UNCHANGED (isExternal)
//  10. an in-repo `foo/action.yml` AND a checkout materializing
//      `foo` from another repo                                    -> the MATERIALIZED repo wins
//      (the checkout REPLACES the directory at run time), and the
//      falsifier direction: with the checkout removed the same file
//      claims the in-repo manifest again.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/materialized-action-control.ts

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const ROOT = join(REPO, ".tmp-yaml", "materialized-action-control")
rmSync(ROOT, { recursive: true, force: true })

const write = (rel: string, body: string): void => {
  const dir = rel.slice(0, rel.lastIndexOf("/"))
  if (dir.length > 0) mkdirSync(join(ROOT, dir), { recursive: true })
  writeFileSync(join(ROOT, rel), body)
}

const HEAD = (): string => ["name: t", "on:", "  workflow_call:", "jobs:", "  scan:", "    runs-on: ubuntu-latest", "    steps:"].join("\n") + "\n"
const CHECKOUT = (repository: string | null, path: string, ref: string | null, withFirst = false): string => {
  const withBlock = ["        with:"]
  if (repository !== null) withBlock.push(`          repository: ${repository}`)
  withBlock.push(`          path: ${path}`)
  if (ref !== null) withBlock.push(`          ref: ${ref}`)
  // `with:` BEFORE `uses:` INSIDE THE SAME STEP — the only order that is a well-formed step. The
  // first version of this arm put the block before the list item itself, which is not a step at
  // all (a mapping key where the sequence expects an item), and the arm failed for that reason
  // rather than for the rule it was testing.
  return withFirst
    ? ["      - name: checkout", ...withBlock, "        uses: actions/checkout@v6"].join("\n") + "\n"
    : ["      - uses: actions/checkout@v6", withBlock.join("\n")].join("\n") + "\n"
}

// 1. exact, earlier same-job checkout naming a repository
write("arm1/wf.yml", HEAD() + CHECKOUT("hashicorp/security-scanner", "security-scanner", "main") + "      - uses: ./security-scanner\n")
// 2. no checkout at all
write("arm2/wf.yml", HEAD() + "      - uses: ./security-scanner\n")
// 3. the checkout is in ANOTHER job
write("arm3/wf.yml", HEAD() + "      - uses: ./security-scanner\n" + "  other:\n    runs-on: ubuntu-latest\n    steps:\n" + CHECKOUT("hashicorp/security-scanner", "security-scanner", "main"))
// 4. the checkout comes AFTER the use
write("arm4/wf.yml", HEAD() + "      - uses: ./late-action\n" + CHECKOUT("hashicorp/late-action", "late-action", "main"))
// 5. a DIFFERENT path is materialized
write("arm5/wf.yml", HEAD() + CHECKOUT("hashicorp/security-scanner", "other-dir", "main") + "      - uses: ./security-scanner\n")
// 6. a NON-checkout action carries the same `with: path:`
write("arm6/wf.yml", HEAD() + "      - uses: acme/checkout@v1\n        with:\n          repository: hashicorp/security-scanner\n          path: security-scanner\n          ref: main\n      - uses: ./security-scanner\n")
// 7. `with:` BEFORE `uses:` in the checkout step (key order inside a step is not evidence)
write("arm7/wf.yml", HEAD() + CHECKOUT("hashicorp/security-scanner", "security-scanner", "main", true) + "      - uses: ./security-scanner\n")
// 8. `./ci-actions/<rest>` of a checkout of the CALLING repo, manifest on disk
write("arm8/wf.yml", HEAD() + CHECKOUT(null, "ci-actions", null) + "      - uses: ./ci-actions/.github/actions/setup\n")
write("arm8/.github/actions/setup/action.yml", "name: setup\nruns:\n  using: composite\n  steps: []\n")
// 9. the same shape, NO manifest in the project
write("arm9/wf.yml", HEAD() + CHECKOUT(null, "ci-actions", null) + "      - uses: ./ci-actions/.github/actions/setup\n")
// 10. an in-repo manifest AND a checkout materializing the same directory from another repository
write("arm10/wf.yml", HEAD() + CHECKOUT("acme/ci-actions", "ci-actions", "v2") + "      - uses: ./ci-actions\n")
write("arm10/ci-actions/action.yml", "name: in-repo\nruns:\n  using: composite\n  steps: []\n")
// 10b. the falsifier direction: without the checkout the in-repo manifest is claimed again
write("arm10b/wf.yml", HEAD() + "      - uses: ./ci-actions\n")
write("arm10b/ci-actions/action.yml", "name: in-repo\nruns:\n  using: composite\n  steps: []\n")

const control = { ok: true, failures: [] as string[] }
const check = (label: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${label}`); return }
  control.ok = false
  control.failures.push(`${label}: got ${g}, want ${w}`)
  console.log(`  FAIL  ${label}: got ${g}, want ${w}`)
}

// EACH ARM IS ITS OWN PROJECT ROOT, and this is a measurement decision rather than tidiness: a
// claim's candidates are PROJECT-relative (`<root>/.github/actions/setup/action.yml`), so an arm
// whose tree lives under a shared root would have its manifest looked for at
// `arm8/.github/actions/setup/action.yml` while the `path:` the runner used is `.github/...`.
const edgesOf = async (arm: string): Promise<any[]> => {
  const root = join(ROOT, arm)
  const r = await parseFile(join(root, "wf.yml"), root, { projectRoot: root } as any)
  return (r?.relationships ?? []).filter((e: any) => e.metadata?.relationshipType === "yaml_action_use")
}
const edgeTo = (edges: any[], target: string): any => edges.find((e: any) => String(e.target) === target)

console.log(`project: ${ROOT}\n`)

// ---- 1. the re-route itself ---------------------------------------------------------------------
{
  const edges = await edgesOf("arm1")
  const e = edgeTo(edges, "hashicorp/security-scanner@main")
  check("1 earlier same-job checkout NAMING a repo RE-ROUTES the target", String(e?.target ?? ""), "hashicorp/security-scanner@main")
  check("...to a remoteRef claim the arbiter can read", e?.metadata?.remoteRef, true)
  check("...carrying the `./D` spelling it replaced", e?.metadata?.materializedPath, "./security-scanner")
  check("...and the authorizing step's line", e?.metadata?.materializedAtLine, 8)
  check("...and it is NOT stated as external", e?.metadata?.isExternal, undefined)
  check("1 the literal target is GONE", edgeTo(edges, "./security-scanner"), undefined)
}

// ---- 2..6: the refusals -------------------------------------------------------------------------
for (const [arm, label] of [["arm2", "2 no checkout in the file"], ["arm3", "3 checkout in ANOTHER job"], ["arm5", "5 checkout materializes a DIFFERENT path"], ["arm6", "6 a NON-checkout action"]] as const) {
  const edges = await edgesOf(arm)
  const e = edgeTo(edges, "./security-scanner")
  check(`${label}: the literal target STAYS`, String(e?.target ?? ""), "./security-scanner")
  check(`${label}: still stated as external`, e?.metadata?.isExternal, true)
  check(`${label}: no repo target was invented`, edges.filter((x) => String(x.target).includes("hashicorp/")).length, 0)
}
{
  const edges = await edgesOf("arm4")
  const e = edgeTo(edges, "./late-action")
  check("4 a LATER checkout does not authorize the use: the literal target STAYS", String(e?.target ?? ""), "./late-action")
  check("4 ...still stated as external", e?.metadata?.isExternal, true)
  check("4 ...and no repo target was invented", edges.filter((x) => String(x.target).includes("hashicorp/")).length, 0)
}

// ---- 7. key order inside the step is not evidence -----------------------------------------------
{
  const edges = await edgesOf("arm7")
  const e = edgeTo(edges, "hashicorp/security-scanner@main")
  check("7 `with:` before `uses:` STILL re-routes", String(e?.target ?? ""), "hashicorp/security-scanner@main")
  check("7 ...with the checkout's own line", e?.metadata?.materializedAtLine, 13)
  check("7 ...and both keys agree on the step", e?.metadata?.materializedPath, "./security-scanner")
}

// ---- 8/9. subpath of a checkout of the CALLING repo ---------------------------------------------
{
  const edges = await edgesOf("arm8")
  const e = edgeTo(edges, "./ci-actions/.github/actions/setup")
  check("8 the written target is kept as the edge's target", String(e?.target ?? ""), "./ci-actions/.github/actions/setup")
  check("8 ...and the claim is the STRIPPED project file", e?.metadata?.importProjectFile, [".github/actions/setup/action.yml"])
  check("8 ...not an external claim", e?.metadata?.isExternal, undefined)
}
{
  const edges = await edgesOf("arm9")
  const e = edgeTo(edges, "./ci-actions/.github/actions/setup")
  check("9 with NO manifest on disk the claim STAYS external", e?.metadata?.isExternal, true)
  check("9 ...and no file claim is fabricated", e?.metadata?.importProjectFile, undefined)
}

// ---- 10. precedence, and its falsifier ----------------------------------------------------------
{
  const edges = await edgesOf("arm10")
  const e = edgeTo(edges, "acme/ci-actions@v2")
  check("10 the materialized repository WINS over an in-repo manifest", String(e?.target ?? ""), "acme/ci-actions@v2")
  check("10 ...because the checkout REPLACES that directory at run time", e?.metadata?.remoteRef, true)
  const edgesB = await edgesOf("arm10b")
  const eB = edgeTo(edgesB, "./ci-actions")
  check("10b the FALSIFIER: without the checkout the in-repo manifest is claimed", eB?.metadata?.importProjectFile, ["ci-actions/action.yml"])
  check("10b ...and the two arms disagree exactly on the claim", e?.metadata?.importProjectFile, undefined)
}

console.log(`\nCONTROL ${control.ok ? "PASS" : "FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
