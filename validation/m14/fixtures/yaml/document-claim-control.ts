// DOCUMENT-CLAIM CONTROL — a cross-FILE `$ref` and a LOCAL reusable-workflow `uses:` both claimed
// `isExternal: true` about a file their own project has, and this pins the correction in BOTH
// directions on the production path.
//
// WHY IT EXISTS. Both fixes are a change of CLAIM KIND on one emission site, and a claim kind
// cannot be checked by reading source: the question is whether the ARBITER, handed the edge,
// verifies a true claim and refuses a false one. `run-fixtures.ts` cannot answer it — a flat
// fixture is analyzed with NO context, so `relativePathCandidates` returns null and there are no
// candidates to claim — which is why this is a probe and not a fixture.
//
// It runs the PRODUCTION path (`pool-worker.parseFile` with the same `projectRoot` the incoming
// gate passes) over a synthetic project built at run time, then applies the GATE'S OWN RULE
// (`incoming-rule.ts` `classifyEdge` — the one function measurement and control both call).
//
// MEASURED over the whole admitted population (18,364 `.yaml`/`.yml`, 189 repos) before the fix:
//   1,356 `references` edges  — `./Responses.OpenAPI.yaml#/400` (681) and
//                               `Shared.Components.OpenAPI.yaml#/components/…` (675)
//     208 `calls` edges      — `./.github/workflows/x.yml` (local reusable-workflow calls)
// = 1,564 of this lane's 1,903 `externalUnverified`, the outcome that blocks a PASS.
//
// Every assertion is paired with the outcome the OLD `isExternal: true` produced, so a probe whose
// emission site stopped firing would report a mismatch rather than a pass.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/document-claim-control.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { classifyEdge, externalClaimOf, verifyExternalClaim, verifyFileClaim } = await import(`${REPO}/script/m14/incoming-rule.ts`)

const ROOT = join(REPO, ".tmp-yaml", "document-claim-control-project")
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(ROOT, "api"), { recursive: true })
mkdirSync(join(ROOT, ".github", "workflows"), { recursive: true })

writeFileSync(join(ROOT, "api", "Child.yaml"), "400:\n  description: bad request\n")
writeFileSync(join(ROOT, "api", "Sibling.yaml"), "components:\n  schemas:\n    Thing:\n      type: object\n")
writeFileSync(join(ROOT, "api", "Parent.yaml"), [
  "definitions:",
  "  Local:",
  "    type: object",
  "paths:",
  "  /a:",
  "    get:",
  "      responses:",
  '        "400":',
  '          $ref: "./Child.yaml#/400"',
  '        "500":',
  '          $ref: "Sibling.yaml#/components/schemas/Thing"',
  '        "404":',
  '          $ref: "./Missing.yaml#/404"',
  '        "503":',
  '          $ref: "https://example.invalid/x.yaml#/503"',
  '        "200":',
  '          $ref: "#/definitions/Local"',
  "",
].join("\n"))
writeFileSync(join(ROOT, ".github", "workflows", "build.yml"), "name: Build\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n")
writeFileSync(join(ROOT, ".github", "workflows", "caller.yml"), [
  "name: Caller",
  "on: [push]",
  "jobs:",
  "  present:",
  "    uses: ./.github/workflows/build.yml",
  "  absent:",
  "    uses: ./.github/workflows/no-such-workflow.yml",
  "  remote:",
  "    uses: owner/repo/.github/workflows/x.yml@v1",
  "",
].join("\n"))

const control = { ok: true, failures: [] as string[] }
const check = (label: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${label}`); return }
  control.ok = false
  control.failures.push(`${label}: got ${g}, want ${w}`)
  console.log(`  FAIL  ${label}: got ${g}, want ${w}`)
}

/** The project's admitted `.yaml` file list, POSIX repo-relative — the gate's own `files` fact. */
const facts = {
  packages: new Set<string>(),
  files: new Set(["api/Parent.yaml", "api/Child.yaml", "api/Sibling.yaml", ".github/workflows/build.yml", ".github/workflows/caller.yml"]),
  sdkLib: false,
}
/** The published name table the gate builds. `Missing` is NOT in it, and neither is `no-such-workflow`. */
const declCount = new Map<string, number>()

const parse = async (rel: string) => await parseFile(join(ROOT, rel), ROOT, { projectRoot: ROOT })
const refs = async (rel: string, rt: string) =>
  ((await parse(rel))?.relationships ?? []).filter((e) => e.metadata?.relationshipType === rt)

console.log(`project: ${ROOT}\n`)
console.log("=== 1. a cross-FILE `$ref` claims the FILE, not `isExternal` ===")
{
  const edges = await refs("api/Parent.yaml", "yaml_json_pointer")
  const byTarget = new Map(edges.map((e) => [String(e.target), e.metadata ?? {}]))
  const edgeByTarget = new Map(edges.map((e) => [String(e.target), e]))

  const rel = byTarget.get("./Child.yaml#/400")
  check("relative sibling `$ref` claims the project file", rel?.importProjectFile, ["api/Child.yaml", "Child.yaml"])
  check("...and carries NO weaker marker too", rel?.isExternal, undefined)
  // `?? []` and not a bare cast: with the fix reverted these calls would THROW, and a control that
  // crashes reports exit 1 where the harness expects a red assertion and exit 3 (measured — the
  // first version of this file did exactly that). A missing claim must read as a FAILED check.
  check("...the arbiter VERIFIES that claim", verifyFileClaim(facts, (rel?.importProjectFile as string[]) ?? []), "externalVerified")
  check("...the OLD claim cannot verify the same target (before/after)", verifyExternalClaim(declCount, "./Child.yaml#/400"), "externalUnverified")
  check("...the edge itself now classifies VERIFIED",
    classifyEdge(declCount, new Map(), "./Child.yaml#/400", { kind: "projectFile", candidates: (rel?.importProjectFile as string[]) ?? [] }, facts).outcome,
    "externalVerified")
  check("...while the OLD claim still does not",
    classifyEdge(declCount, new Map(), "./Child.yaml#/400", { kind: "owner" }, facts).outcome === "externalVerified", false)

  const bare = byTarget.get("Sibling.yaml#/components/schemas/Thing")
  check("bare sibling `$ref` claims the project file", bare?.importProjectFile, ["api/Sibling.yaml", "Sibling.yaml"])
  check("...the arbiter VERIFIES that claim", verifyFileClaim(facts, (bare?.importProjectFile as string[]) ?? []), "externalVerified")

  // THE FRAGMENT IS NOT PART OF THE FILE NAME. A claim built from the whole pointer would name a
  // path no project can have, and would be refuted by the claim rather than by the project.
  check("the fragment is dropped from the candidate", rel?.importProjectFile?.some((c: string) => c.includes("#")), false)

  // THE OTHER DIRECTION, and it is the one that keeps the fix from being a rubber stamp.
  const missing = byTarget.get("./Missing.yaml#/404")
  check("an ABSENT sibling keeps `isExternal`", missing?.isExternal, true)
  check("...and claims NO project file", missing?.importProjectFile, undefined)
  check("...its emitted claim reads VERIFIABLE-BY-NOTHING, not refuted",
    classifyEdge(declCount, new Map(), "./Missing.yaml#/404", externalClaimOf(edgeByTarget.get("./Missing.yaml#/404")), facts).outcome,
    "externalUnverified")
  check("the arbiter STILL refutes a file claim that misses", verifyFileClaim(facts, ["api/absent-nope.yaml"]), "externalRefuted")

  const url = byTarget.get("https://example.invalid/x.yaml#/503")
  check("a URL `$ref` keeps `isExternal` (not a path this project can be asked about)", url?.isExternal, true)
  check("...and claims NO project file", url?.importProjectFile, undefined)

  // AN IN-DOCUMENT POINTER IS NOT EXTERNAL AND MUST NOT BE GIVEN A FILE CLAIM — the `#/` half of
  // the site is untouched, and if the claim were applied to it the edge would lose its `#/` pointer.
  const internal = byTarget.get("api.Parent.definitions.Local")
  check("an in-document `$ref` is NOT marked external", internal?.isExternal, false)
  check("...and claims NO project file", internal?.importProjectFile, undefined)
  check("...and still RESOLVES", internal?.resolved, true)
}

console.log("\n=== 2. a LOCAL reusable-workflow call claims the WORKFLOW FILE ===")
{
  const edges = await refs(".github/workflows/caller.yml", "yaml_workflow_call")
  const byTarget = new Map(edges.map((e) => [String(e.target), e.metadata ?? {}]))
  const edgeByTarget = new Map(edges.map((e) => [String(e.target), e]))

  const present = byTarget.get("./.github/workflows/build.yml")
  check("a local call claims the workflow file", present?.importProjectFile, [".github/workflows/.github/workflows/build.yml", ".github/workflows/build.yml"])
  check("...and carries NO weaker marker too", present?.isExternal, undefined)
  // THE CLAIM IS THE *FILE*, NOT AN ACTION MANIFEST — the defect this half fixes: `actionUseClaim`
  // looked for `./.github/workflows/build.yml/action.yml`, which can never exist.
  check("...and never an action manifest inside it",
    (present?.importProjectFile as string[])?.some((c: string) => c.endsWith("/action.yml") || c.endsWith("/action.yaml")), false)
  check("...the arbiter VERIFIES that claim", verifyFileClaim(facts, (present?.importProjectFile as string[]) ?? []), "externalVerified")
  check("...the OLD claim cannot verify it (before/after)",
    classifyEdge(declCount, new Map(), "./.github/workflows/build.yml", { kind: "owner" }, facts).outcome === "externalVerified", false)
  check("...the edge itself now classifies VERIFIED",
    classifyEdge(declCount, new Map(), "./.github/workflows/build.yml", externalClaimOf(edgeByTarget.get("./.github/workflows/build.yml")), facts).outcome,
    "externalVerified")

  const absent = byTarget.get("./.github/workflows/no-such-workflow.yml")
  check("an ABSENT local call keeps `isExternal`", absent?.isExternal, true)
  check("...and claims NO project file", absent?.importProjectFile, undefined)

  const remote = byTarget.get("owner/repo/.github/workflows/x.yml@v1")
  check("a REMOTE call keeps the reference claim", remote?.remoteRef, true)
  check("...and claims NO project file", remote?.importProjectFile, undefined)
}

console.log(`\n${control.ok ? "CONTROL PASS" : "CONTROL FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
