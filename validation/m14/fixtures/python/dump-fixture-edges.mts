/**
 * DUMP ONE PYTHON FILE'S EDGES WITH THE METADATA A FIXTURE PINS — a development instrument.
 *
 * The fixture runner reports pass/fail, not the analyzer's actual rows; when a row does not fire,
 * the question is "what DID the analyzer emit for that line?" and this answers it for exactly one
 * file: line, type, source -> target, `metadata.qualified`, `metadata.reasonCode`, and the
 * external claim's reason/specifier when present, beside the source line.
 *
 * READ-ONLY. Writes nothing.
 *   bun run validation/m14/fixtures/python/dump-fixture-edges.mts <file> [--type calls,references]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const file = path.resolve(argv[0] ?? "")
const typeArg = (() => {
  const i = argv.indexOf("--type")
  return i >= 0 ? new Set(argv[i + 1]!.split(",")) : undefined
})()
const r: any = await parseFile(file, path.dirname(file), { projectRoot: path.dirname(file) } as any)
const lines = readFileSync(file, "utf8").split("\n")
const rows: string[] = []
if (argv.includes("--symbols")) {
  for (const sym of r?.symbols ?? []) console.log(`SYMBOL ${String(sym.name)} ${String(sym.kind)} owner=${sym.ownerName ?? ""}`)
  process.exit(0)
}
for (const rel of r?.relationships ?? []) {
  const type = String(rel?.type ?? "")
  if (typeArg && !typeArg.has(type)) continue
  const md = (rel?.metadata ?? {}) as Record<string, any>
  const line = Number(rel?.line_number ?? 0)
  const claim = md.isExternalTarget === true
    ? `${String(md.externalReason ?? "")}/${String(md.externalSpecifier ?? "")}`
    : md.languageNamespace !== undefined ? "languageNamespace" : "-"
  rows.push([
    String(line).padStart(5),
    type.padEnd(13),
    `${String(rel?.source ?? "")} -> ${String(rel?.target ?? "")}`.padEnd(34),
    `qual=${JSON.stringify(md.qualified ?? null)}`.padEnd(28),
    `reason=${String(md.reasonCode ?? "-")}`.padEnd(30),
    `claim=${claim}`,
    `| ${(lines[line - 1] ?? "").trim().slice(0, 80)}`,
  ].join("\t"))
}
rows.sort((a, b) => Number(a.trim().split("\t")[0]) - Number(b.trim().split("\t")[0]))
for (const row of rows) console.log(row)
console.log(`\n${rows.length} row(s) in ${path.basename(file)}`)
