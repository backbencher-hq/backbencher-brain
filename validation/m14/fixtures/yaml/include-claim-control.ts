// INCLUDE-CLAIM CONTROL — proves the claim decision can FAIL in both directions.
//
// WHY IT EXISTS. The 107-refutation fix is a change of CLAIM KIND on one emission site, and a
// claim kind is exactly the sort of thing that cannot be checked by reading the source: the
// question is whether the ARBITER, given the edge, verifies a true claim and refutes a false
// one. `run-fixtures.ts` cannot answer it — a flat fixture is analyzed with NO context, so
// `relativePathCandidates` returns null and every include falls back to `isExternal` — which is
// why this probe exists next to the fixture and not as one.
//
// It runs the PRODUCTION path (`pool-worker.parseFile` with the same `projectRoot` the incoming
// gate passes) over a synthetic project built at run time, then applies the GATE'S OWN RULE
// (`incoming-rule.ts` `classifyEdge`, the one function measurement and control both call) to the
// edges that come out. Every assertion is paired with the outcome the OLD hard-coded
// `isExternal: true` would have produced, so a probe that quietly stopped exercising the claim
// would report a mismatch rather than a pass.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/include-claim-control.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { classifyEdge, externalClaimOf, verifyExternalClaim, verifyFileClaim } = await import(`${REPO}/script/m14/incoming-rule.ts`)

const ROOT = join(REPO, ".tmp-yaml", "include-claim-control-project")
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(ROOT, "tasks"), { recursive: true })

// The project: one including file and ONE admitted sibling. `apt` is ALSO a published
// declaration in the key space, because that is the whole mechanism being fixed — ansible
// publishes a module named `apt`, so an owner lookup on `apt.yml` refutes a file reference.
const MAIN = `tasks:
  - include_tasks: apt.yml
  - include_tasks: missing.yml
  - include_tasks: '{{ service_type }}_cleanup.yml'
  - include_tasks: file=x.yml
  - include_tasks: package:lints/recommended.yaml
  - include_tasks: .vsts-ci/windows/*.yml
  - import_role:
      name: role1
      tasks_from: y.yml
`
writeFileSync(join(ROOT, "tasks", "main.yml"), MAIN)
writeFileSync(join(ROOT, "tasks", "apt.yml"), "tasks: []\n")

const res = await parseFile(join(ROOT, "tasks", "main.yml"), ROOT, { projectRoot: ROOT })
const edges = (res?.relationships ?? []).filter(
  (e) => String(e.type) === "imports" && e.metadata?.relationshipType === "yaml_keyword_include",
)
const byTarget = new Map(edges.map((e) => [String(e.target), e.metadata ?? {}]))
const edgesByTarget = new Map(edges.map((e) => [String(e.target), e]))

// The key space the gate builds: one declaration named `apt` — the module ansible publishes,
// and the reason a filename spelled `apt.yml` was refuted before this fix.
const declCount = new Map([["apt", 1]])
const facts = { packages: new Set(), files: new Set(["tasks/apt.yml"]), sdkLib: false }
const control = { ok: true, failures: [] as string[] }
const check = (label: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${label}`); return }
  control.ok = false
  control.failures.push(`${label}: got ${g}, want ${w}`)
  console.log(`  FAIL  ${label}: got ${g}, want ${w}`)
}

console.log(`project: ${ROOT}`)
console.log(`include edges emitted: ${edges.length} -> ${JSON.stringify([...byTarget.keys()])}\n`)

// 1. THE FIX, AND WHAT IT REMOVES. `apt.yml` is a literal path and an admitted file, so the edge
//    must carry the FILE claim; and the claim the edge used to carry must be shown to NOT verify
//    the same target in the same key space, or this probe proves nothing.
//
//    THE OLD CLAIM'S OUTCOME MOVED, and the move is recorded rather than papered over: when this
//    control was written it read `externalRefuted` (the edge was counted AGAINST the lane), and
//    after the Lead's `5a611de4b` — which stopped `verifyExternalClaim` reading a filename's stem
//    as an owner — the same call reads `externalUnverified`. Either way the old claim cannot
//    VERIFY this edge, which is the property that makes the file claim the thing doing the work.
const apt = byTarget.get("apt.yml")
check("literal include claims the project file", apt?.importProjectFile, ["tasks/apt.yml", "apt.yml"])
check("literal include carries NO weaker marker too", apt?.isExternal, undefined)
check("the arbiter VERIFIES that claim", apt === undefined ? null : verifyFileClaim(facts, apt.importProjectFile as string[]), "externalVerified")
check("the OLD claim cannot verify this edge (before/after control)", verifyExternalClaim(declCount, "apt.yml"), "externalUnverified")
check("...and the edge itself now classifies VERIFIED", classifyEdge(declCount, new Map(), "apt.yml", { kind: "projectFile", candidates: apt?.importProjectFile as string[] }, facts).outcome, "externalVerified")
check("...while the OLD claim still does not verify it", classifyEdge(declCount, new Map(), "apt.yml", { kind: "owner" }, facts).outcome === "externalVerified", false)

// 2. THE CLAIM IS MADE ONLY WHERE THE PROJECT CONFIRMS IT — the Lead's ruling, and it replaces
//    the earlier assertion here ("an absent literal file still claims a file"). `verifyFileClaim`
//    refuting a miss is pinned by the gate's own control and is NOT weakened; what changed is
//    WHICH edges assert a file claim. An absent path now states `isExternal`, which on a
//    path-shaped target is `externalUnverified` — so 18 residual refutations become accounted
//    for without removing one arm of the gate.
const missing = byTarget.get("missing.yml")
check("absent literal include claims NO project file", missing?.importProjectFile, undefined)
check("absent literal include falls back to isExternal", missing?.isExternal, true)
check("...and its emitted claim reads VERIFIABLE-BY-NOTHING, not refuted",
  classifyEdge(declCount, new Map(), "missing.yml", externalClaimOf(edgesByTarget.get("missing.yml")), facts).outcome,
  "externalUnverified")
// THE RULE ITSELF IS STILL ARMED: a claim that IS made and misses still refutes. Without this
// line the control could pass while the arbiter had quietly stopped refuting anything.
check("the arbiter STILL refutes a file claim that misses", verifyFileClaim(facts, ["tasks/absent-nope.yml"]), "externalRefuted")

// 3. THE GUARD. Spellings that are not literal paths must keep the old marker: a template,
//    ansible's free-form `file=`, a ROLE-NAME target (a role is not a file path in this project),
//    a URI SCHEME, and a GLOB. The last two are the whole-corpus refutations found AFTER the
//    first version of this control passed: 85 edges claimed `package:lints/recommended.yaml`,
//    `package:lints/core.yaml`, … as project files because a Dart pub URI ends in `.yaml` and
//    contains no character the first guard refused.
//    `y.yml` is NOT here any more: since the over-emission fix it is not emitted at all (section 5),
//    which the previous version of this assertion caught by failing.
for (const t of ["{{ service_type }}_cleanup.yml", "file=x.yml", "role1", "package:lints/recommended.yaml", ".vsts-ci/windows/*.yml"]) {
  const md = byTarget.get(t)
  check(`${JSON.stringify(t)} claims NO project file`, md?.importProjectFile, undefined)
  check(`${JSON.stringify(t)} keeps the pre-existing marker`, md?.isExternal, true)
}

// 4. THE ROLE-RELATIVE CANDIDATE, which is a CANDIDATE rule and therefore needs its own control:
//    a role's `handlers/main.yml` including a bare name must offer the role's `tasks/` directory,
//    and the spelling that names the subdirectory must offer the role root. Measured on the
//    ansible population before it existed: 8 edges refuted by a TRUE claim.
mkdirSync(join(ROOT, "roles", "r", "handlers"), { recursive: true })
mkdirSync(join(ROOT, "roles", "r", "tasks"), { recursive: true })
writeFileSync(join(ROOT, "roles", "r", "handlers", "main.yml"), `- include_tasks: cleanup.yml\n- include_tasks: tasks/nested.yml\n`)
writeFileSync(join(ROOT, "roles", "r", "tasks", "cleanup.yml"), "tasks: []\n")
writeFileSync(join(ROOT, "roles", "r", "tasks", "nested.yml"), "tasks: []\n")
const roleRes = await parseFile(join(ROOT, "roles", "r", "handlers", "main.yml"), ROOT, { projectRoot: ROOT })
const roleEdges = new Map(
  (roleRes?.relationships ?? [])
    .filter((e) => String(e.type) === "imports" && e.metadata?.relationshipType === "yaml_keyword_include")
    .map((e) => [String(e.target), e.metadata ?? {}]),
)
const roleFacts = { packages: new Set(), files: new Set(["roles/r/tasks/cleanup.yml", "roles/r/tasks/nested.yml"]), sdkLib: false }
for (const [t, want] of [["cleanup.yml", "roles/r/tasks/cleanup.yml"], ["tasks/nested.yml", "roles/r/tasks/nested.yml"]] as const) {
  const cands = roleEdges.get(t)?.importProjectFile as string[] | undefined
  check(`${JSON.stringify(t)} offers the role-relative spelling`, cands?.includes(want), true)
  check(`...and the arbiter VERIFIES it`, cands === undefined ? null : verifyFileClaim(roleFacts, cands), "externalVerified")
}
// THE NEGATIVE TWIN: a non-role file must not grow a role-relative candidate. `tasks/main.yml`
// is already its own directory, and a `roleRoot/<written>` guess is exactly what the guard in
// `relativePathCandidates` refuses when the target does not name a role subdirectory.
check("a non-role file gets no role-root guess", byTarget.get("apt.yml")?.importProjectFile, ["tasks/apt.yml", "apt.yml"])

// 5. NO OVER-EMISSION FROM A MAPPING. `scalarValues` recurses, so one role import used to publish
//    the role name, its `tasks_from` file and any boolean as three imports of THIS file — measured
//    over ansible: 567 of 891 include edges came from a key that names a file, 263 from nested
//    scalars (`name:` 149, `tasks_from:` 45, `role_name:` 18, `hosts:`/`public:`/`gather_facts:` … 51).
//    That over-emission is what put bare identifiers (`a`, `c`, `foo`, `include_role`) into
//    `imports`, where the arbiter can only read them as ambiguous.
mkdirSync(join(ROOT, "tasks"), { recursive: true })
writeFileSync(join(ROOT, "tasks", "real.yml"), "tasks: []\n")
writeFileSync(join(ROOT, "shape.yml"), [
  "tasks:",
  "  - include_tasks:",
  "      file: real.yml",
  "      apply:",
  "        become: true",
  "  - import_role:",
  "      name: role1",
  "      tasks_from: y.yml",
  "      allow_duplicates: true",
  "",
].join("\n"))
const shapeRes = await parseFile(join(ROOT, "shape.yml"), ROOT, { projectRoot: ROOT })
const shapeTargets = (shapeRes?.relationships ?? [])
  .filter((e) => String(e.type) === "imports" && e.metadata?.relationshipType === "yaml_keyword_include")
  .map((e) => String(e.target))
check("a file key with a mapping emits its `file:` target", shapeTargets.includes("real.yml"), true)
check("a role key emits its role name", shapeTargets.includes("role1"), true)
for (const noise of ["become", "true", "y.yml", "allow_duplicates", "apply"]) {
  check(`${JSON.stringify(noise)} is NOT emitted as an import target`, shapeTargets.includes(noise), false)
}

// 6. `include:` UNDER A `matrix:` IS NOT AN INCLUDE. Every CI system uses the key for the matrix
//    directive, whose members are dimensions, languages and shell commands. Measured: powershell's
//    `windows-packaging-reusable.yml` published `x64`, `preview`, `win7`, `x86`, `stable`, `arm64`
//    as imports, and bulma's `.travis.yml` published `sass`, `node_js` and `gem install sass`.
//    14 of the lane's 57 ambiguous `imports` were these names; the rest sat in VERIFIED as claims
//    about files that do not exist. The positive twin below is the point: an ansible-style
//    `include: [a.yml]` is still an import, so the guard did not just delete the key.
writeFileSync(join(ROOT, "matrix.yml"), [
  "jobs:",
  "  build:",
  "    strategy:",
  "      matrix:",
  "        include:",
  "          - architecture: x64",
  "            channel: preview",
  "          - architecture: arm64",
  "            channel: stable",
  "tasks:",
  "  - include:",
  "      - real.yml",
  "",
].join("\n"))
const matrixRes = await parseFile(join(ROOT, "matrix.yml"), ROOT, { projectRoot: ROOT })
const matrixTargets = (matrixRes?.relationships ?? [])
  .filter((e) => String(e.type) === "imports" && e.metadata?.relationshipType === "yaml_keyword_include")
  .map((e) => String(e.target))
check("a `matrix.include` emits NO import targets", matrixTargets.includes("x64") || matrixTargets.includes("preview") || matrixTargets.includes("architecture"), false)
check("...and no other scalar from the matrix leaks in", matrixTargets.some((t) => ["x64", "arm64", "stable", "channel"].includes(t)), false)
check("...while an ansible-style `include: [real.yml]` STILL imports", matrixTargets.includes("real.yml"), true)

// 7. THE ROLE ENTRY FILE — a role import names a DIRECTORY, not a symbol. Ansible resolves
//    `name: X` to `<roleRoot>/roles/X/tasks/main.yml`; when that file is on the search path the
//    edge must target IT and carry the file claim, and when it is not the pre-existing bare-name
//    marker must be kept. Both directions are asserted, because a guard that only fires is as
//    broken as one that never does — and the negative twin is the safety property: this change may
//    only ADD a checkable edge, never manufacture a refutation. Measured on the ansible population
//    before it existed: 209 role-import sites, 131 (62.7%) resolvable.
mkdirSync(join(ROOT, "roles", "resolvable", "tasks"), { recursive: true })
writeFileSync(join(ROOT, "roles", "resolvable", "tasks", "main.yml"), "tasks: []\n")
writeFileSync(join(ROOT, "roleimport.yml"), [
  "tasks:",
  "  - include_role:",
  "      name: resolvable",
  "  - include_role:",
  "      name: nowhere_role",
  "",
].join("\n"))
const riRes = await parseFile(join(ROOT, "roleimport.yml"), ROOT, { projectRoot: ROOT })
const riEdges = new Map(
  (riRes?.relationships ?? [])
    .filter((e) => String(e.type) === "imports" && e.metadata?.relationshipType === "yaml_keyword_include")
    .map((e) => [String(e.target), e.metadata ?? {}]),
)
const roleFacts2 = { packages: new Set(), files: new Set(["roles/resolvable/tasks/main.yml"]), sdkLib: false }
check("a resolvable role import targets the role ENTRY FILE", riEdges.get("roles/resolvable/tasks/main.yml")?.importProjectFile, ["roles/resolvable/tasks/main.yml"])
check("...and keeps the role NAME in metadata", riEdges.get("roles/resolvable/tasks/main.yml")?.roleName, "resolvable")
check("...and the arbiter VERIFIES that claim", verifyFileClaim(roleFacts2, ["roles/resolvable/tasks/main.yml"]), "externalVerified")
check("...and the bare role NAME is no longer a target", riEdges.has("resolvable"), false)
check("an UNRESOLVABLE role keeps the bare name and the marker", [riEdges.has("nowhere_role"), riEdges.get("nowhere_role")?.isExternal], [true, true])
check("...and emits no file claim for it", riEdges.get("nowhere_role")?.importProjectFile, undefined)

// 8. A STEP-LEVEL `uses:` OF A WORKFLOW **FILE**. GitHub admits
//    `steps[].uses: ./.github/workflows/x.yml` — a step-level reusable-workflow call — and the
//    target is a file THIS project has. The manifest lookup cannot see it (there is no `action.yml`
//    inside a file), so the edge used to say `isExternal`: the Round-5 defect class, in a spelling
//    that fix did not cover. Named by the enumerator's own CLAIMABLE EDGES section as the ONE such
//    site in the whole admitted population (`nomad/.github/workflows/test-scheduler-prop.yml:45`).
//
//    Four arms, because the claim may fire only where evidence exists — and three of the four are
//    the ways it must NOT fire:
//      (a) the file IS carried          -> the FILE claim, and the arbiter verifies it
//      (b) the file is NOT carried      -> `isExternal`, no claim (the statSync gate)
//      (c) `./dir` holding `action.yml` -> still the MANIFEST, never the directory (unchanged)
//      (d) a carried NON-`.ya?ml` file  -> `isExternal` (the spelling gate: the arbiter's evidence
//                                          base is `.yaml`/`.yml` by construction, so a claim about
//                                          `notes.txt` could never be confirmed, only refuted)
mkdirSync(join(ROOT, ".github", "workflows"), { recursive: true })
mkdirSync(join(ROOT, "ci", "actdir"), { recursive: true })
writeFileSync(join(ROOT, ".github", "workflows", "notify.yml"), "name: notify\non:\n  workflow_call:\n")
writeFileSync(join(ROOT, "ci", "actdir", "action.yml"), "name: actdir\nruns:\n  using: composite\n")
writeFileSync(join(ROOT, "ci", "notes.txt"), "not an admitted spelling\n")
writeFileSync(join(ROOT, ".github", "workflows", "caller.yml"), [
  "name: caller",
  "on: push",
  "jobs:",
  "  notify:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: ./.github/workflows/notify.yml",
  "      - uses: ./.github/workflows/not-here.yml",
  "      - uses: ./ci/actdir",
  "      - uses: ./ci/notes.txt",
  "",
].join("\n"))
const callerRes = await parseFile(join(ROOT, ".github", "workflows", "caller.yml"), ROOT, { projectRoot: ROOT })
const actEdges = new Map(
  (callerRes?.relationships ?? [])
    .filter((e) => String(e.type) === "imports" && e.metadata?.relationshipType === "yaml_action_use")
    .map((e) => [String(e.target), e.metadata ?? {}]),
)
// The admitted population is `.yaml`/`.yml` ONLY — `notes.txt` is on disk and is NOT in this set,
// which is exactly why arm (d) must not claim it.
const actFacts = {
  packages: new Set<string>(),
  files: new Set([".github/workflows/notify.yml", ".github/workflows/caller.yml", "ci/actdir/action.yml"]),
  sdkLib: false,
}
const notifyCands = actEdges.get("./.github/workflows/notify.yml")?.importProjectFile as string[] | undefined
check("(a) a step-level `uses:` of a CARRIED workflow file claims the FILE",
  notifyCands?.includes(".github/workflows/notify.yml"), true)
check("(a) ...and carries no weaker marker beside it", actEdges.get("./.github/workflows/notify.yml")?.isExternal, undefined)
check("(a) ...and the arbiter VERIFIES that claim",
  notifyCands === undefined ? null : verifyFileClaim(actFacts, notifyCands), "externalVerified")
check("(a) ...and the edge itself classifies VERIFIED",
  classifyEdge(new Map(), new Map(), "./.github/workflows/notify.yml",
    { kind: "projectFile", candidates: notifyCands ?? [] }, actFacts).outcome, "externalVerified")
check("(b) a step-level `uses:` of an ABSENT workflow file claims NO file",
  actEdges.get("./.github/workflows/not-here.yml")?.importProjectFile, undefined)
check("(b) ...and keeps the pre-existing marker", actEdges.get("./.github/workflows/not-here.yml")?.isExternal, true)
check("(c) `./dir` still claims the action MANIFEST, not the directory",
  actEdges.get("./ci/actdir")?.importProjectFile, ["ci/actdir/action.yml"])
check("(d) a carried NON-`.ya?ml` file still claims NO file",
  actEdges.get("./ci/notes.txt")?.importProjectFile, undefined)
check("(d) ...and keeps the pre-existing marker", actEdges.get("./ci/notes.txt")?.isExternal, true)

console.log(`\n${control.ok ? "CONTROL PASS" : "CONTROL FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
