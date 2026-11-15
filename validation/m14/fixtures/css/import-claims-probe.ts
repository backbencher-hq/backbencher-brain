/**
 * CSS IMPORT-CLAIM PROBE — the new claim keys, exercised on the real corpus files the 400-file
 * stride left unresolved, WITH a control that must fail.
 *
 * WHY A PROBE AND NOT A FIXTURE. `run-fixtures.ts:986` calls `analyze()` with NO context, and the
 * claim this lane now publishes is deliberately NOT stated without a caller-supplied project root
 * (see `real-css-analyzer.ts` `importClaimMetadata`): a claim about the project's admitted file list
 * is not a statement the analyzer may invent. So no flat fixture can reach the claim. This probe
 * calls the analyzer the way PRODUCTION and the GATE do — `{ projectRoot }` — and then hands the
 * emitted claim to the arbiter's OWN `classifyEdge` with the arbiter's own `ProjectFacts`, which is
 * the only thing that makes a claim a claim rather than an assertion.
 *
 * THE CONTROL IS THE POINT. `PROJECT FACTS EMPTIED` runs the same file claim against an empty file
 * list and asserts the arbiter REFUTES it — a claim that cannot fail is not a measurement, and this
 * programme has paid for that lesson more than once.
 *
 * Usage: bun run validation/m14/fixtures/css/import-claims-probe.ts   (exit 0 = all cases hold)
 */
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealCssAnalyzer } from "../../../../src/ast/real-css-analyzer"
import {
  classifyEdge, type ProjectFacts,
} from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CASES: {
  name: string
  repo: string
  file: string
  line: number
  expect: "importProjectFile" | "sourcePathClaim" | "none"
  expectTarget?: (t: string) => boolean
}[] = [
  {
    name: "sibling project file (dbeaver layout.css)",
    repo: "dbeaver",
    file: "plugins/org.jkiss.dbeaver.ui.ai/web/styles.css",
    line: 1,
    expect: "importProjectFile",
    expectTarget: (t) => t.endsWith("::layout.css"),
  },
  {
    name: "sibling project file (hasura cross-app legacy-boostrap.css)",
    repo: "hasura-engine",
    file: "frontend/apps/console-ee/src/css/tailwind.css",
    line: 4,
    expect: "importProjectFile",
    expectTarget: (t) => t.endsWith("::legacy-boostrap.css"),
  },
  {
    name: "network URL (FSharp.Formatting google fonts)",
    repo: "FSharp.Formatting",
    file: "docs/content/fsdocs-default.css",
    line: 1,
    expect: "sourcePathClaim",
    expectTarget: (t) => t.startsWith("https://fonts.googleapis.com/"),
  },
  {
    name: "network URL (geb http fonts)",
    repo: "geb",
    file: "doc/manual/src/resources/css/style.css",
    line: 1,
    expect: "sourcePathClaim",
    expectTarget: (t) => t.startsWith("http://fonts.googleapis.com/"),
  },
]

let pass = 0
const failures: string[] = []
const ok = (name: string, cond: boolean, detail: string): void => {
  if (cond) { pass++; console.log(`  PASS  ${name} — ${detail}`) }
  else { failures.push(`${name}: ${detail}`); console.log(`  FAIL  ${name} — ${detail}`) }
}

/** The gate's own ProjectFacts for a repo: every admitted `.css`/`.less` file, repo-relative POSIX. */
function factsFor(repo: string): ProjectFacts {
  const dir = path.join(CR, repo)
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\0").filter(Boolean)
  const files = new Set<string>()
  for (const rel of tracked) {
    if (!/\.(css|less)$/i.test(rel)) continue
    files.add(rel.split(path.sep).join("/"))
  }
  return { packages: new Set<string>(), files, sdkLib: false }
}

const parser = await getParser("css")
const analyzer = new RealCssAnalyzer()
const NO_DECLS = new Map<string, number>()
const NO_KINDS = new Map<string, Set<string>>()

for (const c of CASES) {
  const filePath = path.join(CR, c.repo, c.file)
  const content = readFileSync(filePath, "utf8")
  const root = parser.parse(content).rootNode
  const projectRoot = path.join(CR, c.repo)
  const res = analyzer.analyze(root, content, filePath, { projectRoot })
  const edges = (res.relationships ?? []).filter((r: any) => String(r.type ?? "") === "imports")
  const onLine = edges.filter((r: any) => Number(r.line_number ?? -1) === c.line)
  const edge: any = onLine.find((r: any) => (c.expectTarget ? c.expectTarget(String(r.target ?? "")) : true)) ?? onLine[0]
  const md = (edge?.metadata ?? {}) as Record<string, unknown>
  console.log(`${c.name}  (${c.file}:${c.line})`)
  if (!edge) { failures.push(`${c.name}: no imports edge on line ${c.line}`); console.log("  FAIL  no imports edge on that line"); continue }
  console.log(`  target = ${JSON.stringify(String(edge.target))}`)
  console.log(`  claim keys on the edge = ${JSON.stringify(Object.keys(md).filter((k) => k === "sourcePathClaim" || k === "importProjectFile"))}`)
  if (c.expect === "none") {
    ok(c.name, md.sourcePathClaim === undefined && md.importProjectFile === undefined, "no claim key (as required)")
    continue
  }
  const key = c.expect
  ok(c.name, md[key] !== undefined, `${key} is published`)
  // AND THE ARBITER'S OWN VERDICT, with the project's own facts — the mechanism the gate uses.
  const claim = key === "importProjectFile"
    ? { kind: "projectFile" as const, candidates: md.importProjectFile as string[] }
    : { kind: "sourcePath" as const, sources: md.sourcePathClaim as string[] }
  const facts = factsFor(c.repo)
  const verified = classifyEdge(NO_DECLS, NO_KINDS, String(edge.target), claim, facts, false)
  ok(c.name, verified.outcome === "externalVerified", `arbiter verdict with project facts = ${verified.outcome}`)
  // THE CONTROL — the same claim against an EMPTY project must be REFUTED. A claim that cannot fail
  // is not a measurement. `sourcePathClaim` refutes only when a candidate IS admitted, so it cannot
  // be refuted by emptying the list; the file claim must be.
  if (key === "importProjectFile") {
    const refuted = classifyEdge(NO_DECLS, NO_KINDS, String(edge.target), claim, { packages: new Set(), files: new Set(), sdkLib: false }, false)
    ok(c.name, refuted.outcome === "externalRefuted", `CONTROL: same claim, empty project facts = ${refuted.outcome} (must be externalRefuted)`)
  }
}

// ── the two negative controls that no corpus file is needed for: a package name and a contextless run
{
  const projectRoot = path.join(CR, "dbeaver")
  const url = "https://fonts.googleapis.com/css?family=Nunito:400,700"
  const synthetic = (src: string) => `@import "${src}";\nbody { color: red; }\n`
  const parse = (s: string) => parser.parse(s).rootNode
  const withRoot = analyzer.analyze(parse(synthetic(url)), synthetic(url), path.join(projectRoot, "x.css"), { projectRoot })
  const urlEdge: any = (withRoot.relationships ?? []).find((r: any) => String(r.target) === url)
  ok("synthetic network URL with a named project", urlEdge?.metadata?.sourcePathClaim?.[0] === url, `sourcePathClaim = ${JSON.stringify(urlEdge?.metadata?.sourcePathClaim)}`)
  const noRoot = analyzer.analyze(parse(synthetic(url)), synthetic(url), path.join(projectRoot, "x.css"))
  const noRootEdge: any = (noRoot.relationships ?? []).find((r: any) => String(r.target) === url)
  ok("CONTROL: network URL with NO project root states nothing", noRootEdge !== undefined && noRootEdge.metadata?.sourcePathClaim === undefined, "no claim without a named project (the html/scss delegate boundary)")
  const bare = "tailwindcss"
  const bareRes = analyzer.analyze(parse(synthetic(bare)), synthetic(bare), path.join(projectRoot, "x.css"), { projectRoot })
  const bareEdge: any = (bareRes.relationships ?? []).find((r: any) => String(r.target) === bare)
  ok("CONTROL: bare package name gets no claim", bareEdge !== undefined && bareEdge.metadata?.sourcePathClaim === undefined && bareEdge.metadata?.importProjectFile === undefined, "the spelling that can also name a DECLARATION stays unmarked")
}

console.log("")
console.log(`CSS IMPORT-CLAIM PROBE: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAILED: ${f}`)
process.exitCode = failures.length === 0 ? 0 : 1
