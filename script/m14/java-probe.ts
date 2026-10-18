/**
 * JAVA LANE — emission probe. Read-only: prints what the PRODUCTION entry (`parseFile`, the same
 * call `engine.ts` makes) emits for one source file, so an expectation row, a gap closure, or a
 * construct claim can be diagnosed against REAL emission instead of guessed at.
 *
 * This is the Java lane's probe instrument for the OWNER RULING of 2026-10-18 ("all out of all"):
 * a construct's owed relationship is either visible here or it is not emitted, and a fixture
 * expectation is authored from this output. It walks nothing and measures no population — the
 * population instruments are the fleet gate (script/m14/incoming-gate.ts) and the lane's
 * whole-population census.
 *
 * CLI
 *   bun run script/m14/java-probe.ts <file.java> [--type calls] [--from <source>] [--md relationshipType=throws_type]
 *   bun run script/m14/java-probe.ts --inline '<java source>' [--type references]
 *
 * EXIT: 0 printed · 2 usage/file
 */
import { parseFile } from "../../src/ast/pool-worker"
import { mkdtempSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const target = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")))
const inline = flag("inline")
if (!target && !inline) {
  console.error("usage: java-probe.ts <file.java> [--type t] [--from s] [--md k=v] | --inline '<source>'")
  process.exit(2)
}

let abs: string
let dir: string
if (inline !== undefined) {
  dir = mkdtempSync(path.join(os.tmpdir(), "java-probe-"))
  abs = path.join(dir, "Probe.java")
  writeFileSync(abs, inline)
} else {
  abs = path.resolve(process.cwd(), target!)
  dir = path.dirname(abs)
}

const onlyType = flag("type")
const onlyFrom = flag("from")
const mdFilter = flag("md")
const r: any = await parseFile(abs, dir)
const rels = (r.relationships ?? []) as any[]
const meta = (x: any) => (x.metadata ?? {}) as Record<string, unknown>
const shown = rels.filter((x) =>
  (!onlyType || String(x.type) === onlyType) &&
  (!onlyFrom || String(x.source) === onlyFrom) &&
  (!mdFilter || String(meta(x)[mdFilter.split("=")[0]] ?? "") === mdFilter.split("=")[1]),
)

console.log(`\n${inline !== undefined ? "<inline>" : target}: ${r.symbols?.length ?? 0} symbols, ${rels.length} relationships`)
if (onlyType || onlyFrom || mdFilter) console.log(`(filtered: ${shown.length} of ${rels.length})`)
const byType = new Map<string, number>()
for (const x of rels) byType.set(String(x.type), (byType.get(String(x.type)) ?? 0) + 1)
console.log("types:", JSON.stringify(Object.fromEntries([...byType].sort((a, b) => b[1] - a[1]))))
const byMd = new Map<string, number>()
for (const x of rels) {
  const rt = String(meta(x).relationshipType ?? "-")
  byMd.set(rt, (byMd.get(rt) ?? 0) + 1)
}
console.log("relationshipType markers:", JSON.stringify(Object.fromEntries([...byMd].sort((a, b) => b[1] - a[1]))))
for (const x of shown.sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.source).localeCompare(String(b.source)) || String(a.target).localeCompare(String(b.target)))) {
  console.log(
    `  ${String(x.type).padEnd(12)} ${String(x.source).padEnd(28)} -> ${String(x.target).padEnd(34)} conf=${x.confidence} line=${x.line_number ?? "-"} md=${JSON.stringify(meta(x))}`,
  )
}
console.log("\nsymbols:")
for (const s of (r.symbols ?? []) as any[]) {
  console.log(`  ${String(s.kind).padEnd(12)} ${String(s.name).padEnd(20)} vis=${String(s.visibility).padEnd(16)} owner=${s.ownerName ?? "-"} recv=${s.metadata?.receiverType ?? "-"} params=${(s.parameters ?? []).map((p: any) => p.type).join(",")} ret=${s.returnType ?? "-"} md=${JSON.stringify(s.metadata ?? {})}`)
}
if ((r.errors ?? []).length > 0) console.log("\nerrors:", JSON.stringify(r.errors).slice(0, 500))
process.exit(0)
