/**
 * CONTROL — `include:` IS AN IMPORT AT SOME POSITIONS AND A SELECTOR LIST AT OTHERS.
 *
 * The guard (`RealYamlAnalyzer.isIncludeSelectorKey`) suppresses the import edge when an ANCESTOR
 * segment of the key's own path is a selector container (`branches`, `paths`, `sources`, `outputs`,
 * `exposure`, `objc-interfaces`, `objc-protocols`, `enums`). Two ways it can be wrong, and this
 * control pins BOTH:
 *
 *   POSITIVE — a selector `include:` must emit NOTHING. Each arm below is a real shape read out of
 *              the corpus (Azure branch filter, semgrep rule paths, ffigen Selector lists,
 *              build_runner target sources, Spring Boot endpoint exposure, GitHub Actions job
 *              output). If the guard is reverted, every one of these arms goes red.
 *   NEGATIVE — a file import must still fire, INCLUDING in a document whose own FILENAME is a
 *              selector word. `paths.yaml` with a top-level `include:` is the case the older
 *              `matrix` guard had to state explicitly (`matrix.yml` has the document identity
 *              `matrix`, so a bare suffix test made every top-level include in it invisible), and
 *              the document segment is excluded from this guard for the same measured reason. A
 *              guard that also suppressed THIS would trade a false edge for a missing one.
 *
 * Run: npx tsx validation/m14/fixtures/yaml/include-selector-control.ts   (exit 0 = pass, 3 = control failure)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const ROOT = join(process.cwd(), ".tmp-yaml", "include-selector-control")
rmSync(ROOT, { recursive: true, force: true })
const W = (rel: string, lines: string[]): void => {
  const abs = join(ROOT, rel)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(abs, lines.join("\n") + "\n")
}

// ── the FILE IMPORTS that must survive ───────────────────────────────────────────────────────
W("ansible/tasks/real.yml", ["- name: real", "  debug: msg=hi"])
W("ansible/tasks/main.yml", ["- include_tasks: real.yml", "- import_tasks: real.yml"])
// a document whose FILENAME is a selector word: the document segment must not count
W("selquiz/child.yml", ["a: 1"])
W("selquiz/paths.yaml", ["include: child.yml"])

// ── the SELECTOR LISTS that must emit nothing ────────────────────────────────────────────────
W("azure/pipeline.yml", ["trigger:", "  branches:", "    include:", "      - main", "      - feature/*", "  paths:", "    include:", "      - sdk/"])
W("semgrep/rule.yml", ["rules:", "  - id: r1", "    paths:", "      include:", '        - "**/migrations/tasks/*.py"'])
W("ffigen/ffigen.yaml", ["objc-interfaces:", "  include:", "    - 'NSCondition'", "enums:", "  include:", "    - 'NSURLRequestCachePolicy'", "  as-int:", "    include:", "      - 'NSURLSessionTaskState'"])
W("build/build.yaml", ["targets:", "  $default:", "    sources:", "      include:", "        - lib/**", "        - $package$"])
W("spring/application.yml", ["management:", "  endpoints:", "    web:", "      exposure:", "        include: 'env,health'"])
W("gha/workflow.yml", ["jobs:", "  build:", "    outputs:", "      include: ${{ steps.m.outputs.include }}"])

let pass = 0
const fail: string[] = []
const check = (label: string, got: number, want: number): void => {
  if (got === want) { pass++; return }
  fail.push(`${label}: imports ${got}, expected ${want}`)
}
const importsOf = async (rel: string): Promise<{ n: number; targets: string[]; files: string[] }> => {
  const r: any = await parseFile(join(ROOT, rel), ROOT, { projectRoot: ROOT })
  const e = (r?.relationships ?? []).filter((x: any) => String(x.type) === "imports")
  return {
    n: e.length,
    targets: e.map((x: any) => String(x.target)),
    files: e.map((x: any) => JSON.stringify(x.metadata?.importProjectFile ?? null)),
  }
}

// NEGATIVE: a file import in an ansible task file — and it must carry a VERIFIED file claim.
const ansible = await importsOf("ansible/tasks/main.yml")
check("ansible/tasks/main.yml (include_tasks + import_tasks)", ansible.n, 2)
check("ansible claim is a FILE claim (not a bare name)", ansible.files.filter((f) => f !== "null").length, 2)
// The TARGET keeps the source's own spelling; the CLAIM carries the loader-resolved candidates, and
// the first candidate is the file's directory joined to the spelling — which is a file this project
// HAS, so the arbiter's `verifyFileClaim` confirms it rather than reading it as a bare name.
check("ansible claim resolves to the real file", ansible.files.filter((f) => f.includes("ansible/tasks/real.yml")).length, 2)

// NEGATIVE: the document identity IS a selector word, so a top-level include must still emit.
const selquiz = await importsOf("selquiz/paths.yaml")
check("selquiz/paths.yaml (document named `paths`)", selquiz.n, 1)
check("selquiz claim is a FILE claim", selquiz.files.filter((f) => f !== "null").length, 1)
check("selquiz claim resolves to the real file", selquiz.files.filter((f) => f.includes("selquiz/child.yml")).length, 1)

// POSITIVE: six selector positions, six silences.
check("azure/pipeline.yml (branches/paths filter)", (await importsOf("azure/pipeline.yml")).n, 0)
check("semgrep/rule.yml (rules[].paths.include)", (await importsOf("semgrep/rule.yml")).n, 0)
check("ffigen/ffigen.yaml (objc-interfaces + enums + as-int)", (await importsOf("ffigen/ffigen.yaml")).n, 0)
check("build/build.yaml (targets.*.sources.include)", (await importsOf("build/build.yaml")).n, 0)
check("spring/application.yml (exposure.include)", (await importsOf("spring/application.yml")).n, 0)
check("gha/workflow.yml (outputs.include)", (await importsOf("gha/workflow.yml")).n, 0)

console.log(`include-selector-control: ${pass} passed, ${fail.length} failed`)
for (const f of fail) console.log(`  FAIL ${f}`)
console.log(`  NEGATIVE arms assert a file import still fires (and stays a VERIFIED file claim).`)
console.log(`  POSITIVE arms assert six measured selector positions emit NOTHING.`)
console.log(`  REVERTING the guard must turn every POSITIVE arm red; over-reaching it (count the document`)
console.log(`  segment) must turn the selquiz arm red. Either one exits 3.`)
if (fail.length > 0) {
  console.log("CONTROL FAILURE")
  process.exit(3)
}
console.log("control holds")
