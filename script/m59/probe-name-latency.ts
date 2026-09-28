// script/m59/probe-name-latency.ts — where does the time go, per tool call?
// The kotlin matrix cell stalled past 7 minutes after only 2 of 8 cells, so the
// cost is in a CALL, not in the sweep. This times bb_graph(maxDepth=1) and
// bb_analyze(callers) per name against an EXISTING index, with a hard per-call
// wall-clock bound, so the slow name is named and its cost is a number.
//
// Usage: npx tsx script/m59/probe-name-latency.ts --data=<BB_DATA_DIR> --pid=<id> --names=a,b,c [--limit-ms=60000]

import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1]
const data = arg("data")!
const pid = arg("pid")!
const names = (arg("names") ?? "").split(",").filter(Boolean)
const limitMs = Number(arg("limit-ms") ?? 60_000)
process.env.BB_DATA_DIR = data

async function main() {
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const handlers: any = createToolHandlers()

  const timed = async (label: string, fn: () => Promise<any>) => {
    const t0 = Date.now()
    let note = ""
    const timer = setTimeout(() => console.log(`      … still running after ${Math.round((Date.now() - t0) / 1000)}s`), 15_000)
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("LIMIT")), limitMs))])
    } catch (e: any) {
      note = e?.message === "LIMIT" ? ` <-- EXCEEDED ${limitMs / 1000}s` : ` ERROR ${e?.message}`
    }
    clearTimeout(timer)
    const ms = Date.now() - t0
    console.log(`    ${label.padEnd(34)} ${String(ms).padStart(7)}ms${note}`)
    return ms
  }

  for (const name of names) {
    console.log(`\n=== ${name} ===`)
    await timed(`bb_graph maxDepth=1`, () =>
      handlers.bb_graph({ symbol: name, maxDepth: 1 }, { projectId: pid }),
    )
    await timed(`bb_analyze callers (maxDepth=3)`, () =>
      handlers.bb_analyze({ target: name, mode: "callers" }, { projectId: pid }),
    )
  }
}

main().catch((e) => {
  console.error("PROBE ERROR:", e?.stack ?? e)
  process.exitCode = 1
})
