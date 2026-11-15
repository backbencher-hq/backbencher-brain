import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
const SRC = "/home/ishaq2321/bb_tests/repositories/jq/src/jv_print.c"
const lines = readFileSync(SRC, "utf8").split("\n")
const dir = mkdtempSync(join(tmpdir(), "c901bs2-"))
const slices: Array<[string, number, number]> = [
  ["S1: 219-400 (jv_dump_term .. jv_show)", 218, 400],
  ["S2: 380-400 (tail + jv_dumpf/jv_dump/jv_show)", 379, 400],
  ["S3: 219-395 (through jv_dump)", 218, 395],
  ["S4: 300-400", 299, 400],
]
for (const [label, a, b] of slices) {
  const file = join(dir, `${label.split(":")[0]}.c`)
  writeFileSync(file, lines.slice(a, b).join("\n"))
  const r: any = await parseFile(file, dir)
  const fns = new Set((r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => String(s.name)))
  console.log(`${label}: jv_dumpf=${fns.has("jv_dumpf") ? "yes" : "NO "} jv_dump=${fns.has("jv_dump") ? "yes" : "NO "} jv_show=${fns.has("jv_show") ? "yes" : "NO "} jv_dump_term=${fns.has("jv_dump_term") ? "yes" : "NO "}`)
}
