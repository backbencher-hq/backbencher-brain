// WORKFLOW-NEEDS CONTROL — a `needs:` target must name the JOB, the lookup must still refuse, and
// the KEY must be at a POSITION that means a dependency.
//
// WHY IT EXISTS. `needs: [test]` names a job declared once per WORKFLOW FILE, so the bare name has
// N declarations in the project and production's `COUNT(*) = 1` bare-name rule can never bind it:
// 802 of this lane's 879 ambiguous `references` were exactly that shape. The fix targets the
// document-scoped identity `<document>.jobs.<id>`, which the lane already publishes.
//
// A target change is not checkable by reading source, because the question is what the ARBITER
// then does with it. So this probe runs the production path and pins FIVE things, three of which
// are negatives that keep the fixes from being rubber stamps:
//   * a declared job resolves to the document-scoped identity;
//   * a job the document does NOT declare stays unresolved (the lookup is not "looks like a job");
//   * a Compose `depends_on` still resolves through the service index, untouched;
//   * a `needs:` under `steps[].with` emits NO dependency edge at all — it is an action INPUT, and
//     the measurement behind the rule is 1,655 true `jobs.<id>.needs` against 48 false
//     `steps[].with.needs` over the whole admitted population;
//   * Compose's LONG form names its dependencies with MAPPING KEYS, so `condition: service_healthy`
//     is configuration and must not become a dependency edge (31 such edges measured).
//
// USAGE: npx tsx validation/m14/fixtures/yaml/workflow-needs-control.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const ROOT = join(REPO, ".tmp-yaml", "workflow-needs-control")
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(ROOT, ".github", "workflows"), { recursive: true })
writeFileSync(join(ROOT, ".github", "workflows", "build.yml"), [
  "name: Build",
  "on: [push]",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "  publish:",
  "    runs-on: ubuntu-latest",
  "    needs: [test]",
  "  broken:",
  "    runs-on: ubuntu-latest",
  "    needs: [no-such-job]",
  // THE POSITION NEGATIVE, and it deliberately names a job that EXISTS: if the key's POSITION
  // were not consulted, this edge would resolve to `.github.workflows.build.jobs.test` and read as
  // a true dependency — the "false edge that resolves" shape, which is worse than an ambiguous one.
  "  input:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: r-lib/actions/setup-r-dependencies@v2",
  "        with:",
  "          needs: test",
  "",
].join("\n"))
writeFileSync(join(ROOT, "compose.yaml"), [
  "services:",
  "  web:",
  "    depends_on: [db]",
  // THE LONG FORM: the dependency names are these KEYS (`db`, `cache`); the `condition:` values
  // are the dependency's own configuration and are not dependencies.
  "  api:",
  "    depends_on:",
  "      db:",
  "        condition: service_healthy",
  "      cache:",
  "        condition: service_started",
  "  db:",
  "    image: postgres",
  "  cache:",
  "    image: redis",
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
const needsEdges = async (rel: string) => {
  const r = await parseFile(join(ROOT, rel), ROOT, { projectRoot: ROOT })
  return (r?.relationships ?? []).filter((e) => e.metadata?.relationshipType === "yaml_depends_on")
}

const wf = await needsEdges(".github/workflows/build.yml")
const doc = ".github.workflows.build"
check("a workflow declares the job identity the lane publishes",
  (await parseFile(join(ROOT, ".github/workflows/build.yml"), ROOT, { projectRoot: ROOT }))?.symbols?.some((s) => String(s.qualifiedName) === `${doc}.jobs.test`), true)
check("`needs: [test]` targets the DOCUMENT-SCOPED job", wf.find((e) => e.metadata?.referencedName === "test")?.target, `${doc}.jobs.test`)
check("...and is marked resolved", wf.find((e) => e.metadata?.referencedName === "test")?.metadata?.resolved, true)
// THE NEGATIVE. A job this document does not declare must NOT be resolved by the new lookup, or
// the fix would have replaced an ambiguity with a fabrication.
const bogus = wf.find((e) => e.metadata?.referencedName === "no-such-job")
check("a job the document does NOT declare stays unresolved", bogus?.target, "no-such-job")
check("...with no fabricated document path", bogus?.metadata?.resolved, false)

const compose = await needsEdges("compose.yaml")
check("a Compose `depends_on` still resolves through the service index", compose.some((e) => e.metadata?.resolved === true), true)
check("...to the sibling service", String(compose.find((e) => e.metadata?.resolved === true)?.target).endsWith("db"), true)

// THE POSITION NEGATIVE. `steps[].with` is an action INPUT named `needs`; no dependency edge may
// be emitted for it, whatever the value names — and the value here names a job that EXISTS, so a
// missing position rule would produce a resolved edge (the "false edge that RESOLVES" shape).
// Asserted by SOURCE, not by target: the job's own `needs: [test]` and the input's `needs: test`
// name the same string, so a target-only test could not tell the true edge from the false one —
// and the first version of this check was written that way and failed for exactly that reason.
check("a `needs:` under `steps[].with` emits NO dependency edge",
  wf.some((e) => String(e.source ?? "").includes(".steps[") || String(e.source ?? "").includes(".with")), false)
check("...so the ONE `test` dependency is the job's own, not the input's",
  wf.filter((e) => String((e.metadata as any)?.referencedName) === "test").length, 1)
check("...and it comes from `jobs.publish`",
  String(wf.find((e) => String((e.metadata as any)?.referencedName) === "test")?.source), `${doc}.jobs.publish.needs`)

// THE LONG FORM. The keys ARE dependencies; the `condition:` values are not.
const composeNames = compose.map((e) => String((e.metadata as any)?.referencedName))
check("Compose's long form names the MAPPING KEYS as dependencies", composeNames.includes("cache"), true)
check("...and NOT the nested `condition:` value", composeNames.includes("service_healthy"), false)
check("...nor the other condition", composeNames.includes("service_started"), false)
check("the long form's key RESOLVES to the sibling service",
  compose.some((e) => (e.metadata as any)?.referencedName === "cache" && String(e.target).endsWith(".services.cache")), true)

console.log(`\n${control.ok ? "CONTROL PASS" : "CONTROL FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
