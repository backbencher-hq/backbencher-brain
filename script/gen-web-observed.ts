// Generates validation/m11/results/web-observed.json by parsing the web/data/
// query/config/shell fixtures with the real analyzers (no DB, no embeddings).
import { parseFile } from "../src/ast/pool-worker"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const fixtures = [
  "validation/m11/fixtures/web/schema.sql",
  "validation/m11/fixtures/web/schema.xml",
  "validation/m11/fixtures/web/index.html",
  "validation/m11/fixtures/web/styles.css",
  "validation/m11/fixtures/web/orders.graphql",
  "validation/m11/fixtures/web/config.yaml",
  "validation/m11/fixtures/web/infra.tf",
  "validation/m11/fixtures/web/deploy.sh",
  "validation/m11/fixtures/web/deploy.ps1",
  "validation/m11/fixtures/web/Documentation.php",
  "validation/m11/fixtures/web/Orders.pm",
  "validation/m11/fixtures/web/app.lua",
  "validation/m11/fixtures/web/analysis.R",
  "validation/m11/fixtures/web/appsettings.json",
  "validation/m11/fixtures/web/README.md",
  "validation/m11/fixtures/web/Makefile",
]

const root = process.cwd()
const symbols: any[] = []

for (const rel of fixtures) {
  const abs = resolve(root, rel)
  try {
    const p = await parseFile(abs, root)
    for (const s of p.symbols) {
      symbols.push({
        file: rel.split("/").pop(),
        name: s.name,
        kind: s.kind,
        start_line: s.range?.startLine ?? s.startLine ?? 0,
      })
    }
  } catch (e: any) {
    console.error(`ERR ${rel}: ${e?.message?.slice(0, 120)}`)
  }
}

writeFileSync(
  "validation/m11/results/web-observed.json",
  JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), symbols }, null, 2),
)
console.log(`wrote ${symbols.length} observed symbols`)
process.exit(0)
