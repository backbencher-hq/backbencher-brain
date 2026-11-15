// DEPENDENCY-MARKER-NAME CONTROL — the marker-namespace guard pinned in BOTH directions, on the
// three real corpus files and on crafted arms.
//
// WHY IT EXISTS. `DEPENDS_ON_KEYS` fires on four loader spellings (Compose `depends_on`, GitHub
// `needs`, Azure `dependsOn`, CircleCI `requires`), and in every one of them the value names a
// DECLARATION the document carries — except one measured position: kube-api-linter's config spells
// a rule-to-marker requirement `dependenttags.rules[].dependsOn: ["k8s:optional"]`, where the value
// is a kubebuilder MARKER (a Go-comment annotation `+k8s:optional`), not a key any analyzer
// publishes in any lane. The edge it produced (target `k8s:optional`, `isExternal: true`) was
// structurally unverifiable: no symbol named `k8s:optional` can exist in the key space. A rule
// whose refusals are read off the corpus cannot be checked by reading source, so this probe runs
// the production path (`pool-worker.parseFile`, project root passed, the one that carries claims)
// and asserts which edges refuse and — the point — which ones do NOT:
//
//   1..3. the THREE REAL CORPUS FILES (kubernetes' hack/golangci{,-hints}.yaml and
//         hack/kube-api-linter/kube-api-linter.yaml):
//         no edge targets `k8s:optional`, and the `dependenttags.rules[0].dependsOn`
//         SYMBOL is still published — the guard drops the edge, not the declaration
//   4. the crafted kube-api-linter shape, production path -> same refusal
//   5. BOUNDARY: a TEMPLATE value at the same key -> still emits (`isExternal: true`,
//      the ruled external claim the `{{` exclusion keeps)
//   6. BOUNDARY: compose `depends_on: [db]` with the sibling in the same file -> resolves
//   7. BOUNDARY: workflow `needs: build` -> resolves through the document-scoped identity
//   8. BOUNDARY: CircleCI `requires` with a bare job name -> still emits (no-colon values
//      are untouched by construction)
//   9. the falsifier: the predicate itself, pinned on all three shapes at once —
//      `k8s:optional` refused, the template spelling NOT refused, a bare name NOT refused —
//      so a mutant that deletes the colon test, or the `{{` exclusion, cannot pass
//
// USAGE: npx tsx validation/m14/fixtures/yaml/dependency-marker-name-control.ts

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { RealYamlAnalyzer } = await import(`${REPO}/src/ast/real-yaml-analyzer.ts`)

const ROOT = join(REPO, ".tmp-yaml", "dependency-marker-name-control")
rmSync(ROOT, { recursive: true, force: true })

const write = (rel: string, body: string): void => {
  const dir = rel.slice(0, rel.lastIndexOf("/"))
  if (dir.length > 0) mkdirSync(join(ROOT, dir), { recursive: true })
  writeFileSync(join(ROOT, rel), body)
}

// 4. the crafted kube-api-linter shape
write("arm4/lint-config.yml", [
  "lintersConfig:",
  "  dependenttags:",
  "    rules:",
  "      - identifier: \"k8s:unionMember\"",
  "        type: \"All\"",
  "        dependsOn:",
  "          - \"k8s:optional\"",
  "",
].join("\n"))
// 5. BOUNDARY: a template value at the same key
write("arm5/azure.yml", [
  "stages:",
  "  - pipeline:",
  "      jobs:",
  "        - deploy:",
  "            dependsOn:",
  "              - \"${{ parameters.dependsOn }}\"",
  "",
].join("\n"))
// 6. BOUNDARY: compose sibling service
write("arm6/compose.yml", [
  "services:",
  "  web:",
  "    image: nginx",
  "    depends_on:",
  "      - db",
  "  db:",
  "    image: postgres",
  "",
].join("\n"))
// 7. BOUNDARY: workflow job dependency
write("arm7/wf.yml", [
  "on:",
  "  workflow_call:",
  "jobs:",
  "  test:",
  "    needs: build",
  "  build:",
  "    runs-on: ubuntu-latest",
  "",
].join("\n"))
// 8. BOUNDARY: CircleCI-style bare job name under `requires`
write("arm8/circle.yml", [
  "jobs:",
  "  deploy:",
  "    requires:",
  "      - build",
  "  build:",
  "    docker:",
  "      - image: cimg/base:stable",
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

const edgesOf = async (arm: string, file: string): Promise<any[]> => {
  const root = join(ROOT, arm)
  const r = await parseFile(join(root, file), root, { projectRoot: root } as any)
  return (r?.relationships ?? []) as any[]
}
const relsOf = async (arm: string, file: string): Promise<any> => {
  const root = join(ROOT, arm)
  return await parseFile(join(root, file), root, { projectRoot: root } as any)
}

console.log(`project: ${ROOT}\n`)

// ---- 1..3. THE REAL CORPUS FILES ----------------------------------------------------------------
const CORPUS = [
  "/home/ishaq2321/bb_tests/repositories/kubernetes/hack/golangci.yaml",
  "/home/ishaq2321/bb_tests/repositories/kubernetes/hack/golangci-hints.yaml",
  "/home/ishaq2321/bb_tests/repositories/kubernetes/hack/kube-api-linter/kube-api-linter.yaml",
]
for (const [i, f] of CORPUS.entries()) {
  const r: any = await parseFile(f, "yaml", { projectRoot: "/home/ishaq2321/bb_tests/repositories/kubernetes" } as any)
  const markerEdges = ((r?.relationships ?? []) as any[]).filter((e) => String(e.target ?? "") === "k8s:optional")
  check(`${i + 1} ${f.split("/").slice(-2).join("/")} emits NO edge to the marker`, markerEdges.length, 0)
  const depSymbol = ((r?.symbols ?? []) as any[]).find((s) => String(s.qualifiedName ?? "").endsWith(".dependenttags.rules[0].dependsOn"))
  check(`${i + 1} ...the dependsOn SYMBOL is still published`, Boolean(depSymbol), true)
}

// ---- 4. the crafted shape, production path ------------------------------------------------------
{
  const rels = await edgesOf("arm4", "lint-config.yml")
  const marker = rels.filter((e) => e.metadata?.relationshipType === "yaml_depends_on" && String(e.target ?? "").includes(":"))
  check("4 the crafted kube-api-linter shape emits no colon-bearing dependency edge", marker.length, 0)
  const r = await relsOf("arm4", "lint-config.yml")
  const sym = ((r?.symbols ?? []) as any[]).find((s) => String(s.qualifiedName ?? "").endsWith(".dependenttags.rules[0].dependsOn"))
  check("4 ...and the symbol survives the refusal", Boolean(sym), true)
}

// ---- 5..8. THE BOUNDARIES -----------------------------------------------------------------------
{
  const rels = await edgesOf("arm5", "azure.yml")
  const e = rels.find((x) => x.metadata?.relationshipType === "yaml_depends_on" && String(x.target ?? "") === "${{ parameters.dependsOn }}")
  check("5 a TEMPLATE value at the same key still emits", String(e?.type ?? ""), "references")
  check("5 ...as the ruled external claim", e?.metadata?.isExternal, true)
  check("5 ...with the template spelling as its referenced name", e?.metadata?.referencedName, "${{ parameters.dependsOn }}")
}
{
  // The document identity is the FILE STEM (`compose.yml` -> `compose`), not the arm name.
  const rels = await edgesOf("arm6", "compose.yml")
  const e = rels.find((x) => x.metadata?.relationshipType === "yaml_depends_on" && String(x.target ?? "") === "compose.services.db")
  check("6 a compose sibling service still resolves", e?.metadata?.resolved, true)
  check("6 ...on the service's qualified identity", String(e?.target ?? ""), "compose.services.db")
}
{
  const rels = await edgesOf("arm7", "wf.yml")
  const e = rels.find((x) => x.metadata?.relationshipType === "yaml_depends_on" && String(x.target ?? "") === "wf.jobs.build")
  check("7 a workflow `needs:` still resolves", e?.metadata?.resolved, true)
  check("7 ...through the document-scoped identity", String(e?.target ?? ""), "wf.jobs.build")
}
{
  // A CircleCI `requires` name resolves document-scoped the same way `needs` does — the
  // sibling job key is in `declaredNames` — so the boundary here is RESOLUTION, not
  // merely emission: a no-colon value at a dependency position behaves exactly as
  // before the guard.
  const rels = await edgesOf("arm8", "circle.yml")
  const e = rels.find((x) => x.metadata?.relationshipType === "yaml_depends_on" && String(x.target ?? "") === "circle.jobs.build")
  check("8 a CircleCI bare job name still emits and RESOLVES (no-colon untouched)", String(e?.type ?? ""), "references")
  check("8 ...through the document-scoped identity", e?.metadata?.resolved, true)
}

// ---- 9. the falsifier: the predicate, pinned on all three shapes at once -------------------------
{
  const m = (RealYamlAnalyzer as any).markerNamespaceTarget
  check("9 the predicate refuses a marker namespace", typeof m === "function" ? m("k8s:optional") : "no-predicate", true)
  check("9 ...does NOT refuse a template spelling", typeof m === "function" ? m("${{ parameters.dependsOn }}") : "no-predicate", false)
  check("9 ...and does NOT refuse a bare dependency name", typeof m === "function" ? m("db") : "no-predicate", false)
}

console.log(`\nCONTROL ${control.ok ? "PASS" : "FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
