import { writeFileSync } from "node:fs"
import { parseFile } from "/home/ishaq2321/mcp/bb-lanes/sql/src/ast/pool-worker"
const CASES: Array<[string,string]> = [
  ["clean-domain", `create domain "text/plain" as text;\ncreate table t (a "text/plain");\n`],
  ["clean-function-or-replace", `create or replace function f() returns int language sql as $$ select 1 $$;\n`],
  ["clean-two-functions", `create or replace function f() returns int language sql as $$ select 1 $$;\ncreate or replace function g() returns int language sql as $$ select 2 $$;\n`],
  ["sqlite-modeA-like", `create table t1 (a integer, c text);\ncreate table t2 (b integer);\n`],
]
for (const [label, sql] of CASES) {
  const p = `/tmp/opencode/sqlq/dom-${label}.sql`
  writeFileSync(p, sql)
  const r: any = await parseFile(p, sql)
  console.log(`=== ${label}: symbols=${(r.symbols??[]).length} rels=${(r.relationships??[]).length}`)
  for (const s of r.symbols??[]) console.log(`    ${s.kind}:${s.name}`)
}
