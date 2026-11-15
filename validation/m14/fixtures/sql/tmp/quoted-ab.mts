/**
 * A/B probe: does the working-tree `wholeQuotedName` change alter parseFile output at all?
 */
import { writeFileSync } from "node:fs"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CASES: Array<[string, string]> = [
  ["quoted-whole", `SELECT * FROM "vault.secret";`],
  ["unquoted-qualified", `SELECT * FROM vault.secret;`],
  ["quoted-two-part", `SELECT * FROM "vault"."secret";`],
  ["call-quoted-whole", `CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$ SELECT "vault.decrypt"() $$;`],
  ["call-unqualified", `CREATE FUNCTION g() RETURNS text LANGUAGE sql AS $$ SELECT vault.decrypt() $$;`],
]

const rows: Array<Record<string, unknown>> = []
for (const [label, sql] of CASES) {
  const p = `/tmp/opencode/sqlq/ab-${label}.sql`
  writeFileSync(p, sql)
  const r: any = await parseFile(p, sql)
  const rels = r?.relationships ?? []
  rows.push({
    label,
    sql,
    edges: rels.map((e: any) => ({
      type: e.type ?? e.relationshipType,
      target: e.target,
      external: e.metadata?.external ?? null,
      qualified: e.metadata?.qualified ?? null,
      quotedName: e.metadata?.quotedName ?? null,
    })),
  })
}
console.log(JSON.stringify(rows, null, 2))