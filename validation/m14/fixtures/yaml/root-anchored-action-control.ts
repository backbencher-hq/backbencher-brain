// ROOT-ANCHORED-ACTION CONTROL — the `$/…` re-route pinned in BOTH directions, on crafted files.
//
// WHY IT EXISTS. `$/.github/actions/go-cache-{restore,save}` is a ROOT-ANCHORED path: 18 corpus
// sites, all terragrunt, and `terragrunt/.github/actions/go-cache-restore/action.yml` plus
// `…/go-cache-save/action.yml` are files that project carries. Before the rewrite the value fell to
// `actionUseClaim`'s last line, `return { remoteRef: true }` — a claim that `$` is a GitHub OWNER.
// A rule whose refusals are read off the corpus cannot be checked by reading source, so this probe
// runs the production path (`pool-worker.parseFile`, project root passed, the one that carries
// claims) and asserts which edges move and — the point — which ones do NOT:
//
//   1. `$/D` with `D/action.yml` on disk        -> target `./D`, FILE claim on the manifest
//   2. `$/D` with NO manifest                   -> target `./D`, isExternal (as `./D` already was)
//   3. `$/D` whose manifest is `action.yaml`    -> the OTHER admitted manifest spelling
//   4. `$/D` in a NON-workflow file             -> `yaml_action_use_unverified`, still local
//   5. job-level `$/….github/workflows/x.yml`   -> the CALL role, not an import
//   6. `actions/checkout@v4`                    -> UNCHANGED (remoteRef, the fix's boundary)
//   7. `./sub/$/dir` (CONTAINS `$/`, does not
//      start with it)                           -> UNCHANGED, no spelling recorded
//   8. `../outside`                             -> UNCHANGED, no spelling recorded
//   9. the falsifier direction: arm 1's edge
//      carries `actionSpelling` and NOT
//      `remoteRef`, while arm 6's carries
//      `remoteRef` and NOT `actionSpelling`     -> the two claims are disjoint
//
// USAGE: npx tsx validation/m14/fixtures/yaml/root-anchored-action-control.ts

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const ROOT = join(REPO, ".tmp-yaml", "root-anchored-action-control")
rmSync(ROOT, { recursive: true, force: true })

const write = (rel: string, body: string): void => {
  const dir = rel.slice(0, rel.lastIndexOf("/"))
  if (dir.length > 0) mkdirSync(join(ROOT, dir), { recursive: true })
  writeFileSync(join(ROOT, rel), body)
}

const HEAD = (): string => ["name: t", "on:", "  workflow_call:", "jobs:", "  scan:", "    runs-on: ubuntu-latest", "    steps:"].join("\n") + "\n"
const NO_SHAPE = (): string => ["name: t", "# no `on:` and no `jobs:`, so the file's shape proves no workflow", "steps:"].join("\n") + "\n"
const MANIFEST = "name: local\nruns:\n  using: composite\n  steps: []\n"

// 1. `$/D` with the manifest on disk — the whole-corpus shape
write("arm1/wf.yml", HEAD() + "      - uses: $/.github/actions/cache-restore\n")
write("arm1/.github/actions/cache-restore/action.yml", MANIFEST)
// 2. `$/D` with NO manifest — the refusal
write("arm2/wf.yml", HEAD() + "      - uses: $/.github/actions/missing-restore\n")
// 3. the other admitted manifest spelling
write("arm3/wf.yml", HEAD() + "      - uses: $/tools/inline\n")
write("arm3/tools/inline/action.yaml", MANIFEST)
// 4. a file whose shape proves no workflow
write("arm4/plain.yml", NO_SHAPE() + "      - uses: $/.github/actions/cache-save\n")
// 5. job-level `$/` — a reusable-workflow CALL
write("arm5/wf.yml", HEAD().replace("    steps:\n", "") + "  call:\n    uses: $/.github/workflows/reusable.yml\n")
// 6. an ordinary external action: the fix must not touch it
write("arm6/wf.yml", HEAD() + "      - uses: actions/checkout@v4\n")
// 7. a target that CONTAINS `$/` but does not start with it
write("arm7/wf.yml", HEAD() + "      - uses: ./sub/$/dir\n")
// 8. a `../` relative action
write("arm8/wf.yml", HEAD() + "      - uses: ../outside\n")

const control = { ok: true, failures: [] as string[] }
const check = (label: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${label}`); return }
  control.ok = false
  control.failures.push(`${label}: got ${g}, want ${w}`)
  console.log(`  FAIL  ${label}: got ${g}, want ${w}`)
}

// EACH ARM IS ITS OWN PROJECT ROOT for the same reason the materialized control's arms are: a file
// claim's candidates are PROJECT-relative, so an arm under a shared root would look its manifest up
// under the wrong prefix. Files are parsed through `pool-worker` — the production path that carries
// claims — because `analyze()` alone passes no root and could not see any of this.
const edgesOf = async (arm: string, file = "wf.yml", rt = "yaml_action_use"): Promise<any[]> => {
  const root = join(ROOT, arm)
  const r = await parseFile(join(root, file), root, { projectRoot: root } as any)
  return (r?.relationships ?? []).filter((e: any) => e.metadata?.relationshipType === rt)
}
const edgeTo = (edges: any[], target: string): any => edges.find((e: any) => String(e.target) === target)

console.log(`project: ${ROOT}\n`)

// ---- 1. the re-route itself ---------------------------------------------------------------------
{
  const edges = await edgesOf("arm1")
  const e = edgeTo(edges, "./.github/actions/cache-restore")
  check("1 the `$/` spelling is rewritten to the `./` target", String(e?.target ?? ""), "./.github/actions/cache-restore")
  check("1 ...and the claim is the FILE the project carries", e?.metadata?.importProjectFile, [".github/actions/cache-restore/action.yml"])
  check("1 ...NOT an external remote ref", e?.metadata?.remoteRef, undefined)
  check("1 ...and not the weaker external marker either", e?.metadata?.isExternal, undefined)
  check("1 the written spelling is kept for audit", e?.metadata?.actionSpelling, "$/.github/actions/cache-restore")
  check("1 the RAW target is gone", edgeTo(edges, "$/.github/actions/cache-restore"), undefined)
}

// ---- 2/3: the refusals --------------------------------------------------------------------------
{
  const edges = await edgesOf("arm2")
  const e = edgeTo(edges, "./.github/actions/missing-restore")
  check("2 with NO manifest the target is still rewritten", String(e?.target ?? ""), "./.github/actions/missing-restore")
  check("2 ...the claim STAYS external, exactly as `./…` does", e?.metadata?.isExternal, true)
  check("2 ...and no file claim is fabricated", e?.metadata?.importProjectFile, undefined)
  check("2 ...and no remote ref is invented", e?.metadata?.remoteRef, undefined)
}
{
  const edges = await edgesOf("arm3")
  const e = edgeTo(edges, "./tools/inline")
  check("3 the OTHER admitted manifest spelling is claimed", e?.metadata?.importProjectFile, ["tools/inline/action.yaml"])
}

// ---- 4. a non-workflow file keeps its role, and its spelling -----------------------------------
{
  const edges = await edgesOf("arm4", "plain.yml", "yaml_action_use_unverified")
  const e = edgeTo(edges, "./.github/actions/cache-save")
  check("4 in a NON-workflow file the edge is the unverified reference", String(e?.target ?? ""), "./.github/actions/cache-save")
  check("4 ...still local, not remote", e?.metadata?.remoteRef, undefined)
  check("4 ...with the written spelling kept", e?.metadata?.actionSpelling, "$/.github/actions/cache-save")
}

// ---- 5. the role is unchanged: job-level `$/` is a workflow CALL ---------------------------------
{
  const root = join(ROOT, "arm5")
  const r = await parseFile(join(root, "wf.yml"), root, { projectRoot: root } as any)
  const calls = (r?.relationships ?? []).filter((x: any) => x.metadata?.relationshipType === "yaml_workflow_call")
  const e = calls.find((x: any) => String(x.target) === "./.github/workflows/reusable.yml")
  check("5 a job-level `$/` call is still a `calls` edge", String(e?.type ?? ""), "calls")
  check("5 ...on the rewritten target", String(e?.target ?? ""), "./.github/workflows/reusable.yml")
  check("5 ...resolved:false, the same-repository reason", e?.metadata?.unresolvedReason, "workflow-in-same-repository-not-indexed")
  check("5 ...and the written spelling is kept", e?.metadata?.actionSpelling, "$/.github/workflows/reusable.yml")
}

// ---- 6..8. the boundary: what the rewrite must NOT touch ----------------------------------------
{
  const edges = await edgesOf("arm6")
  const e = edgeTo(edges, "actions/checkout@v4")
  check("6 an ordinary external action keeps its remoteRef claim", e?.metadata?.remoteRef, true)
  check("6 ...and records no spelling, because nothing was rewritten", e?.metadata?.actionSpelling, undefined)
}
{
  const edges = await edgesOf("arm7")
  const e = edgeTo(edges, "./sub/$/dir")
  check("7 a target that only CONTAINS `$/` is untouched", String(e?.target ?? ""), "./sub/$/dir")
  check("7 ...and records no spelling", e?.metadata?.actionSpelling, undefined)
}
{
  const edges = await edgesOf("arm8")
  const e = edgeTo(edges, "../outside")
  check("8 a `../` relative action is untouched", String(e?.target ?? ""), "../outside")
  check("8 ...and records no spelling", e?.metadata?.actionSpelling, undefined)
}

// ---- 9. the falsifier: the two claim keys are disjoint ------------------------------------------
{
  const rootA = join(ROOT, "arm1")
  const a = await parseFile(join(rootA, "wf.yml"), rootA, { projectRoot: rootA } as any)
  const ea = (a?.relationships ?? []).find((x: any) => String(x.target) === "./.github/actions/cache-restore")
  const rootB = join(ROOT, "arm6")
  const b = await parseFile(join(rootB, "wf.yml"), rootB, { projectRoot: rootB } as any)
  const eb = (b?.relationships ?? []).find((x: any) => String(x.target) === "actions/checkout@v4")
  check("9 the re-routed edge and a real remote action disagree on BOTH keys",
    [ea?.metadata?.remoteRef, ea?.metadata?.actionSpelling, eb?.metadata?.remoteRef, eb?.metadata?.actionSpelling],
    [undefined, "$/.github/actions/cache-restore", true, undefined])
}

console.log(`\nCONTROL ${control.ok ? "PASS" : "FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
