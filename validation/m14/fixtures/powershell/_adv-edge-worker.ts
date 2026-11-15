/**
 * Shard worker for `adversarial-probes.ts`. Reads a newline-separated file list,
 * calls PRODUCTION `parseFile` on each, and writes the resulting relationships
 * with the file each came from.
 *
 * Split out because `src/ast/engine.ts:1412` installs a per-file self-destruct
 * timer: `parser.parse()` is synchronous WASM and cannot be interrupted from the
 * event loop, so one pathological input kills the process with `[BB-HANG]`. A
 * shard keeps that blast radius to 1/10th of the corpus instead of all of it,
 * which is the same reason `census.ts` shards.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const [listFile, outFile] = process.argv.slice(2)
const files = readFileSync(listFile, "utf8").split("\n").filter(Boolean)

const out: { file: string; edges: Record<string, unknown>[] }[] = []
for (const f of files) {
  let r
  try {
    r = await parseFile(f, path.dirname(f))
  } catch (e) {
    console.error(`[ADV-ERR] ${f}: ${String(e).slice(0, 200)}`)
    continue
  }
  const rels = (r?.relationships ?? []) as Record<string, unknown>[]
  out.push({
    file: f,
    edges: rels.map((x) => ({
      source: String(x.source ?? ""),
      target: String(x.target ?? ""),
      type: String(x.type ?? ""),
      line: Number(x.line_number ?? 0),
      confidence: Number(x.confidence ?? 0),
      meta: (x.metadata ?? {}) as Record<string, unknown>,
    })),
  })
}
writeFileSync(outFile, JSON.stringify(out), "utf8")