// SAME-DIRECTORY REFERENT CONTROL — the one-edge rule, pinned in BOTH directions and at its refusals.
//
// WHY IT EXISTS. `name-collision-falsifier.ts` priced a rule and found it CLEAN: CEILING 1 ambiguous
// edge a same-directory, same-kind resolution can reach, CONTROL 0 of them in a directory declaring
// that kind+name twice, and 117 MORE that a PROJECT-WIDE version would bind — refused, because
// another manifest set is another cluster. The rule is now applied in
// `resolveSameDirectoryResource`; this is the control that makes it falsifiable.
//
// A resolution rule is not checkable by reading source: the question is which edges MOVE. So this
// probe runs the production path and asserts five cases, three of which must NOT resolve:
//
//   1. same directory, same kind, same name          -> RESOLVES to that sibling's document identity
//   2. same kind + name, DIFFERENT directory         -> must stay unresolved (the 117's shape)
//   3. same directory, WRONG kind (ConfigMap vs SA)  -> must stay unresolved
//   4. TWO same-directory siblings match             -> must stay unresolved (refuse, never pick)
//   5. a name the file declares ITSELF               -> still resolves in-file (nothing regressed)
//
// USAGE: npx tsx validation/m14/fixtures/yaml/same-directory-referent-control.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const ROOT = join(REPO, ".tmp-yaml", "same-directory-referent-control")
rmSync(ROOT, { recursive: true, force: true })

const DEPLOY = (sa: string) => [
  "apiVersion: v1",
  "kind: Pod",
  "metadata:",
  "  name: pod1",
  "spec:",
  `  serviceAccountName: ${sa}`,
  "",
].join("\n")
const SA = (name: string, kind = "ServiceAccount") => ["apiVersion: v1", `kind: ${kind}`, "metadata:", `  name: ${name}`, ""].join("\n")
const write = (rel: string, body: string): void => {
  mkdirSync(join(ROOT, rel.slice(0, rel.lastIndexOf("/"))), { recursive: true })
  writeFileSync(join(ROOT, rel), body)
}

// 1. same directory, same kind, same name
write("a/deployment.yaml", DEPLOY("apiserver"))
write("a/sa.yaml", SA("apiserver"))
// 2. the declaration exists, but in ANOTHER directory (the 117's shape)
write("b/deployment.yaml", DEPLOY("apiserver"))
// 3. same directory, WRONG kind
write("c/deployment.yaml", DEPLOY("apiserver"))
write("c/cm.yaml", SA("apiserver", "ConfigMap"))
// 4. TWO same-directory siblings match -> refuse
write("d/deployment.yaml", DEPLOY("apiserver"))
write("d/sa1.yaml", SA("apiserver"))
write("d/sa2.yaml", SA("apiserver"))
// 5. declared in the file itself (the pre-existing in-file path must be untouched)
write("e/all.yaml", ["apiVersion: v1", "kind: ServiceAccount", "metadata:", "  name: apiserver", "", DEPLOY("apiserver")].join("\n"))

const control = { ok: true, failures: [] as string[] }
const check = (label: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { console.log(`  PASS  ${label}`); return }
  control.ok = false
  control.failures.push(`${label}: got ${g}, want ${w}`)
  console.log(`  FAIL  ${label}: got ${g}, want ${w}`)
}
const refEdge = async (rel: string) => {
  const r = await parseFile(join(ROOT, rel), ROOT, { projectRoot: ROOT } as any)
  return (r?.relationships ?? []).find((e: any) => e.metadata?.relationshipType === "yaml_resource_ref")
}

console.log(`project: ${ROOT}\n`)

const a = await refEdge("a/deployment.yaml")
check("1 same directory + kind + name RESOLVES", a?.metadata?.resolved, true)
check("...to the SIBLING's document identity", String(a?.target), "a.sa")
check("...and it is not marked external", a?.metadata?.isExternal, false)

const b = await refEdge("b/deployment.yaml")
check("2 a same-kind name in ANOTHER directory does NOT bind", b?.metadata?.resolved, false)
check("...and the bare name is kept, not a fabricated path", String(b?.target), "apiserver")
check("...and it is still stated as external", b?.metadata?.isExternal, true)

const c = await refEdge("c/deployment.yaml")
check("3 a WRONG kind in the same directory does NOT bind", c?.metadata?.resolved, false)

const d = await refEdge("d/deployment.yaml")
check("4 TWO matching siblings REFUSE rather than pick", d?.metadata?.resolved, false)

const e = await refEdge("e/all.yaml")
check("5 an in-file declaration still resolves", e?.metadata?.resolved, true)
check("...to its own document identity", String(e?.target), "e.all")

console.log(`\n${control.ok ? "CONTROL PASS" : "CONTROL FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
