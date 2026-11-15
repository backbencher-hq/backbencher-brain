/**
 * EX perf — quadratic test on a SYNTHETIC ladder, which is the only clean way to
 * separate "this file is big" from "this analyzer degrades as the file grows".
 * The ladder replicates one realistic def N times (N = 250 … 4000), so the only
 * variable is N. A linear analyzer keeps ms/def flat; O(n^2) shows it climbing.
 * Also measures a second shape (many small modules) because the analyzer keeps a
 * per-file alias chain and a `seenRels` set: a shape with many MODULES could
 * regress where one module with many defs does not.
 *
 * Reads nothing, writes nothing: sources are generated in memory.
 */
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"

function defLadder(n: number): string {
  const out: string[] = ["defmodule Ladder do"]
  for (let i = 0; i < n; i++) {
    out.push(`  def step_${i}(a, b) do`)
    out.push(`    a + b + step_next(a)`)
    out.push(`  end`)
  }
  out.push("  defp step_next(x), do: x * 2")
  out.push("end")
  return out.join("\n")
}

function moduleLadder(n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(`defmodule Mod${i} do`)
    out.push(`  def run(a), do: helper(a) + Mod${(i + 1) % n}.value()`)
    out.push(`  defp helper(x), do: x + 1`)
    out.push("end")
  }
  return out.join("\n")
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const shapes: { name: string; gen: (n: number) => string }[] = [
    { name: "defs-in-one-module", gen: defLadder },
    { name: "many-modules", gen: moduleLadder },
  ]
  for (const shape of shapes) {
    console.log(`\n== ${shape.name} ==`)
    console.log("     N   bytes   analyzeMs   ms/N     ms/1kB  symbols  rels")
    for (const n of [250, 500, 1000, 2000, 4000]) {
      const src = shape.gen(n)
      // warm once so JIT/alloc noise does not land on the first measurement
      await ASTEngine.parseFile("/tmp/synthetic.ex", src)
      const t0 = process.hrtime.bigint()
      const res: any = await ASTEngine.parseFile("/tmp/synthetic.ex", src)
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      const kib = src.length / 1024
      console.log(
        `${String(n).padStart(6)} ${String(src.length).padStart(7)} ${ms.toFixed(1).padStart(11)} ${(ms / n).toFixed(4).padStart(8)} ${(ms / kib).toFixed(3).padStart(9)} ${String((res.symbols ?? []).length).padStart(8)} ${String((res.relationships ?? []).length).padStart(5)}`,
      )
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
