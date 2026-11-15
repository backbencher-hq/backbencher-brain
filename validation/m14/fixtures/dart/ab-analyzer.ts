/**
 * A/B THE ANALYZER ACROSS A CHANGE — attribute a difference to the change or to drift
 *
 * ## Why this file exists
 *
 * Re-walking the deterministic 600-file sample before and after a change answers "did
 * anything change?" but not "did MY change cause it?". Those are different questions and
 * conflating them is how a lane credits itself with an unrelated fix, or blames itself for
 * an unrelated regression.
 *
 * The concrete case: skipping the redundant `collectDartLocals` re-walk left all ten
 * relationship counts at delta +0 across 600 files, and moved the SYMBOL count by exactly
 * +600 — one `module` per file, in 600 of 600 files, no removals. A change inside
 * `processNode`, which emits relationships, cannot publish a module symbol; module
 * publishing happens in `analyze()`. So the +600 is real but is not obviously mine, and
 * "obviously not mine" is not a measurement.
 *
 * ## The method
 *
 * Parse the same files with the analyzer as it stands, dump to a named file, then check out
 * the other revision of the one analyzer file and parse the SAME files again. Both halves
 * are recorded with the analyzer's own SHA, so a diff between them is attributable to the
 * commit range and not to the machine.
 *
 * Both legs run in separate processes: the analyzer is a module-level singleton around the
 * WASM parser, so loading two revisions in one process is not possible.
 *
 * Run: npx tsx validation/m14/fixtures/dart/ab-analyzer.ts <out.ndjson> [n]
 */
import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2]
const N = Number(process.argv[3] ?? 150)
if (!OUT) throw new Error("usage: ab-analyzer.ts <out.ndjson> [n]")

const { detectLanguageFromPath } = await import("../../../../src/ast/language-detection")

/**
 * The same admission rule `collect-sample.ts` uses — byte-sorted `.dart` paths under the
 * corpus root, then a fixed stride — so this sample is drawn from the SAME population and
 * in the same proportions as the 600-file census the diff is against.
 */
function population(): string[] {
  const out: string[] = []
  const stack = [CR]
  while (stack.length) {
    const dir = stack.pop() as string
    let entries: string[]
    try { entries = readdirSync(dir) } catch { continue }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules" || e === "build" || e === ".dart_tool") continue
      const full = path.join(dir, e)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) stack.push(full)
      else if (st.isFile() && e.endsWith(".dart")) out.push(full)
    }
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return out
}

const pop = population()
const stride = Math.max(1, Math.floor(pop.length / N))
const sample: string[] = []
for (let i = 0; i < pop.length && sample.length < N; i += stride) sample.push(pop[i])

function projectRootFor(file: string): string {
  let dir = path.dirname(file)
  for (;;) {
    try { statSync(path.join(dir, ".git")); return dir } catch { /* keep climbing */ }
    const up = path.dirname(dir)
    if (up === dir) return path.dirname(file)
    dir = up
  }
}

const digest = execFileSync("git", ["hash-object", "src/ast/real-dart-analyzer.ts"], { encoding: "utf8" }).trim()
const rows: string[] = []
let bad = 0
for (const f of sample) {
  let text: string
  try { text = readFileSync(f, "utf8") } catch { continue }
  if (detectLanguageFromPath(f, text) !== "dart") continue
  try {
    const r: any = await parseFile(f, projectRootFor(f))
    const symbols = (Array.isArray(r?.symbols) ? r.symbols : []).map((s: any) => ({
      n: String(s?.name ?? ""), k: String(s?.kind ?? ""), q: String(s?.qualifiedName ?? ""), l: Number(s?.startLine ?? 0),
    }))
    const rels = (Array.isArray(r?.relationships) ? r.relationships : []).map((x: any) => ({
      t: String(x?.type ?? ""), s: String(x?.source ?? x?.from ?? ""), g: String(x?.target ?? x?.to ?? ""),
      l: Number(x?.line_number ?? x?.line ?? 0), c: Number(x?.confidence ?? 0),
    }))
    rows.push(JSON.stringify({ f, symbols, rels }))
  } catch {
    bad++
    rows.push(JSON.stringify({ f, error: true }))
  }
}
mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
writeFileSync(OUT, rows.join("\n") + "\n")
console.log(`wrote ${rows.length} records to ${OUT} (${bad} errored)`)
console.log(`  sample: stride ${stride} of population ${pop.length}`)
console.log(`  analyzer blob sha256-ish (git hash-object): ${digest}`)