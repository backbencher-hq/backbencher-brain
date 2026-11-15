/**
 * Drives `JULIA_RULED_INSTRUMENT_B`'s `countOnTree` over the corpus using the SAME discovery rules
 * as `script/m14/ontology-coverage-gate.ts`, so the number the ruling publishes is verified against
 * the exported probe rather than against a census that computed it a different way. READ-ONLY; writes
 * nothing. EXITS NON-ZERO on disagreement.
 *
 * The published pair is READ FROM THE RULING (`publishedCount` / `publishedFiles`), not repeated here.
 * The first version hardcoded `325 occurrences / 60 files` in this file's own source, so when the
 * corpus grew the probe compared a fresh measurement against a stale literal, printed MISMATCH, and
 * still exited 0 — the two ways a gate like this fails at once.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const files: { rel: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    files.push({ rel: `${e}/${rel}`, text })
  }
}
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

const { JULIA_RULED_INSTRUMENT_B } = await import("../../../../script/m14/julia-ruled")
const probe = JULIA_RULED_INSTRUMENT_B[0].countOnTree!

const hits: string[] = []
const hitFiles = new Set<string>()
let unreadable = 0
for (const f of files) {
  const before = hits.length
  const t = parser.parse(f.text)
  if (!t) { unreadable++; continue }
  probe(t.rootNode, f.rel, hits)
  t.delete?.()
  if (hits.length > before) hitFiles.add(f.rel)
}
console.log(`corpus: ${files.length} admitted files, ${unreadable} unreadable`)
console.log(`JULIA_RULED_INSTRUMENT_B countOnTree -> ${hits.length} occurrences in ${hitFiles.size} files`)
for (const h of hits.slice(0, 5)) console.log(`  ${h}`)
const ruling = JULIA_RULED_INSTRUMENT_B[0]
if (typeof ruling.publishedCount !== "number" || typeof ruling.publishedFiles !== "number") {
  console.error(`MISMATCH — the ruling publishes no number (publishedCount/publishedFiles absent), so there is nothing to check against`)
  process.exit(1)
}
console.log(`\nthe ruling publishes: ${ruling.publishedCount} occurrences / ${ruling.publishedFiles} files`)
if (hits.length === ruling.publishedCount && hitFiles.size === ruling.publishedFiles) {
  console.log("MATCH")
} else {
  console.error(
    `MISMATCH — the exported probe and the published number disagree: measured ${hits.length}/${hitFiles.size}, published ${ruling.publishedCount}/${ruling.publishedFiles}. ` +
      `Either the corpus changed (re-measure and update publishedCount/publishedFiles in script/m14/julia-ruled.ts) or the probe does not measure what the ruling says.`,
  )
  process.exit(1)
}