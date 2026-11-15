import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
const SRC = "/home/ishaq2321/bb_tests/repositories/jq/src/jv_print.c"
const lines = readFileSync(SRC, "utf8").split("\n")
const dir = mkdtempSync(join(tmpdir(), "c901bs-"))
for (const n of [lines.length, 442, 430, 420, 411, 400]) {
  const file = join(dir, `prefix-${n}.c`)
  writeFileSync(file, lines.slice(0, n).join("\n"))
  const r: any = await parseFile(file, dir)
  const fns = new Set((r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => String(s.name)))
  console.log(`first ${n} lines: jv_dumpf=${fns.has("jv_dumpf") ? "yes" : "NO "} jv_dump=${fns.has("jv_dump") ? "yes" : "NO "} jv_show=${fns.has("jv_show") ? "yes" : "NO "} (functions=${fns.size})`)
}
