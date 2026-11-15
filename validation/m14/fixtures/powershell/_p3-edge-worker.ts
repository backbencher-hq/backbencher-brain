/**
 * Shard worker for the EDGE half of `pass3-probes.ts`.
 *
 * Reads a newline-separated file list, calls PRODUCTION `parseFile` on each, and writes
 * the relationships AND the symbol table with the file each came from.
 *
 * ## Why this is a second worker rather than an extension of `_adv-edge-worker.ts`
 *
 * Pass 2's edge worker writes relationships only, and every pass-2 probe is a question
 * ABOUT relationships. Pass 3's P14 and P18 are questions about the RELATIONSHIP
 * AGAINST THE SYMBOL TABLE of the same file — "is this `instantiates` target a type name
 * or a variable the file declares?", "which `exports` targets name nothing?". Neither is
 * answerable from edges alone, and adding a `symbols` field to pass 2's worker would
 * change the byte shape of the artifact pass 2's numbers were measured from, so the two
 * stay separate.
 *
 * Split out because `src/ast/engine.ts:1412` installs a per-file self-destruct timer:
 * `parser.parse()` is synchronous WASM and cannot be interrupted from the event loop, so
 * one pathological input kills the process with `[BB-HANG]`. A shard keeps that blast
 * radius to a fraction of the corpus instead of all of it, which is the same reason
 * `census.ts` shards.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const [listFile, outFile] = process.argv.slice(2)
const files = readFileSync(listFile, "utf8").split("\n").filter(Boolean)

const out: {
  file: string
  symbols: { name: string; kind: string }[]
  edges: Record<string, unknown>[]
}[] = []
for (const f of files) {
  let r
  try {
    r = await parseFile(f, path.dirname(f))
  } catch (e) {
    console.error(`[P3-ERR] ${f}: ${String(e).slice(0, 200)}`)
    continue
  }
  const rels = (r?.relationships ?? []) as Record<string, unknown>[]
  const syms = (r?.symbols ?? []) as Record<string, unknown>[]
  out.push({
    file: f,
    symbols: syms.map((s) => ({ name: String(s.name ?? ""), kind: String(s.kind ?? "") })),
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