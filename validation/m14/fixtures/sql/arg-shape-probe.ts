// Dumps the `function_arguments` subtree for named, unnamed, mode-qualified and
// defaulted parameters, so a signature key can be read off the grammar that is
// actually wired rather than the one the docs describe.
import { readFileSync } from "node:fs"
import { getParser } from "../../../../src/ast/engine.ts"
const sql = `CREATE FUNCTION p_named(a integer, b text) RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE FUNCTION p_unnamed(integer, text) RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE FUNCTION p_out(a integer, OUT b text) RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE FUNCTION p_default(a integer DEFAULT 1) RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE FUNCTION p_custom(a my_type) RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE FUNCTION p_variadic(VARIADIC a integer[]) RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
CREATE FUNCTION p_none() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;
`
const parser = await getParser("sql")
const pr = await parser.parse(sql, "probe.sql")
function dump(n: any, d = 0, max = 5) {
  if (d > max) return
  const field = n.parent ? "" : ""
  console.log("  ".repeat(d) + `${n.type}${n.isNamed ? "" : " (anon)"}  [${JSON.stringify(sql.slice(n.startIndex, n.endIndex))}]`)
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, d + 1, max) }
}
const all: any[] = []
const st: any[] = [pr.rootNode]
while (st.length) { const n = st.pop(); all.push(n); for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) } }
for (const node of all) {
  if (node.type !== "create_function") continue
  const args = node.childForFieldName?.("function_arguments") ?? node.namedChildren.find((c: any) => c.type === "function_arguments")
  const name = node.childForFieldName?.("name")
  console.log(`\n=== ${name ? sql.slice(name.startIndex, name.endIndex) : "?"}`)
  if (!args) { console.log("  (no function_arguments node)"); continue }
  for (const a of args.namedChildren) {
    console.log(`  function_argument  [${JSON.stringify(sql.slice(a.startIndex, a.endIndex))}]  nameField=${a.childForFieldName?.("name") ? JSON.stringify(sql.slice(a.childForFieldName("name").startIndex, a.childForFieldName("name").endIndex)) : "NONE"}  custom_type=${a.childForFieldName?.("custom_type") ? JSON.stringify(sql.slice(a.childForFieldName("custom_type").startIndex, a.childForFieldName("custom_type").endIndex)) : "NONE"}`)
    dump(a, 2, 3)
  }
}
