/**
 * DUMP EVERY `uses` TARGET THE ANALYZER EMITS, for before/after comparison.
 *
 * Two runs of this, one with the analyzer change and one without, diffed against
 * each other, answer the only question that matters about a resolution change:
 * exactly which edges moved, from what name to what name. A count cannot answer
 * it — "4 gained" and "4 gained and 82 lost" have the same gain.
 *
 * Writes one `file\tsource#n\ttarget\tS/T-flags` line per edge to the path given by `--out`.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/dump-uses-targets.mts --out /tmp/x.tsv
 */
import { writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/opencode/pb/uses-targets.tsv"

const { readdirSync, statSync } = await import("node:fs")
const files: string[] = []
const walk = (d: string): void => {
  let kids: string[]
  try { kids = readdirSync(d) } catch { return }
  for (const k of kids.sort()) {
    if (k === ".git" || k === "node_modules") continue
    const abs = path.join(d, k)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) { walk(abs); continue }
    if (k.endsWith(".proto")) files.push(abs)
  }
}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  walk(dir)
}

const lines: string[] = []
let silent = 0
const silentFiles: string[] = []
for (const f of files) {
  const rel = path.relative(CR, f)
  let prod: any
  try { prod = await parseFile(f, path.dirname(f)) } catch { continue }
  const syms: any[] = Array.isArray(prod?.symbols) ? prod.symbols : []
  if (syms.length === 0) {
    silent++
    // NAMED, not just counted. `parseFile` catches its own wasm fault and returns,
    // so a file that lost its whole parse still reaches this counter as `0`. A
    // count alone cannot be told apart from a file that legitimately declares
    // nothing, and this dump feeds an external oracle — an input that silently
    // dropped a file would adjudicate a corpus the analyzer never saw.
    if (silentFiles.length < 10) silentFiles.push(rel)
  }
  const ids = new Set<string>()
  for (const s of syms) {
    const meta: any = s?.metadata ?? {}
    const id = typeof meta.id === "string" && meta.id.length > 0 ? meta.id : typeof s?.qualifiedName === "string" ? s.qualifiedName : null
    if (id) ids.add(id)
  }
  // An rpc emits TWO `uses` edges — one for the request type and one for the
  // response — and both carry the rpc's own id as their source. Keying the dump on
  // (file, source) therefore COLLIDES on every rpc, and a before/after diff over
  // such a key reports "the target moved" when only one of two edges did. The
  // occurrence counter is what makes the key unique; measured on this corpus, 1,552
  // rpcs would otherwise be ambiguous.
  const seenPerSource = new Map<string, number>()
  for (const e of (prod?.relationships ?? []) as any[]) {
    if (String(e.type) !== "uses") continue
    const src = String(e.source)
    const n = seenPerSource.get(src) ?? 0
    seenPerSource.set(src, n + 1)
    lines.push(`${rel}\t${src}#${n}\t${e.target}\t${ids.has(src) ? "S" : "-"}${ids.has(String(e.target)) ? "T" : "-"}`)
  }
}
lines.sort()
writeFileSync(OUT, lines.join("\n") + "\n")
console.log(`files ${files.length}   uses edges ${lines.length}   files with no production symbols ${silent}`)
if (silentFiles.length) console.log(`  files the analyzer read and production published NOTHING for: ${silentFiles.join(", ")}`)
console.log(`wrote ${OUT}`)
