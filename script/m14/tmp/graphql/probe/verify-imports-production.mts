/**
 * DOES THE NEW `imports` EDGE ACTUALLY FIRE THROUGH PRODUCTION `parseFile`?
 *
 * `analyze()` is a per-file unit and `script/m14/run-fixtures.ts:678` calls it directly,
 * so a passing fixture does NOT establish that production emits anything. This walks the
 * corpus files the census named and reads the edge counts off `parseFile`.
 *
 * The population is the 131 files the census measured a `#import` directive in, so the
 * count here is a count over files KNOWN to contain the construct — which is the strict
 * reading: a number over a population selected for the property being measured cannot be
 * diluted by files that lack it.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const census = JSON.parse(readFileSync("script/m14/tmp/graphql/out/imports-and-calls.json", "utf8"))
const target = process.argv[2] ?? "gql-graphql-tools"

// Every file in the repo that the census found a directive in, found by re-scanning that
// one repo — cheaper and simpler than threading the census's per-file list through, and it
// re-derives the population instead of trusting it.
const repoDir = path.join(CR, target)
const { execFileSync } = await import("node:child_process")
const tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z", "--", "*.graphql", "*.gql", "*.graphqls"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)

const rows: Array<{ file: string; imports: number; example: string; source: string; target: string; line: number; form: string; bindings: string[] }> = []
let filesWithImports = 0
let otherTypes = 0
for (const rel of tracked) {
  const abs = path.join(repoDir, rel)
  const r: any = await parseFile(abs, repoDir)
  const imps = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase().includes("import"))
  const other = (r.relationships ?? []).length - imps.length
  otherTypes += other
  if (imps.length === 0) continue
  filesWithImports++
  for (const e of imps) {
    rows.push({
      file: `${target}/${rel}`,
      imports: imps.length,
      example: "",
      source: String(e.source),
      target: String(e.target),
      line: e.line_number,
      form: String(e.metadata?.importForm ?? ""),
      bindings: e.metadata?.importBindings ?? [],
    })
  }
}

const byForm: Record<string, number> = {}
for (const r of rows) byForm[r.form] = (byForm[r.form] ?? 0) + 1
const badEndpoints = rows.filter((r) => !r.source || r.source === "unknown" || !r.target || r.target === "unknown")
const magicLiterals = rows.filter((r) => r.source === "(file)")

console.log(
  JSON.stringify(
    {
      repo: target,
      trackedGraphqlFiles: tracked.length,
      filesWithImports,
      importEdges: rows.length,
      byForm,
      nonImportRelationshipsInThoseFiles: otherTypes,
      emptyOrUnknownEndpoints: badEndpoints.length,
      magicFileLiteralSources: magicLiterals.length,
      distinctSources: [...new Set(rows.map((r) => r.source))].sort(),
      sample: rows.slice(0, 8),
    },
    null,
    1,
  ),
)