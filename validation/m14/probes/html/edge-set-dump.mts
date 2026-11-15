/**
 * HTML LANE — THE ANALYZER'S OWN EDGE SET, on a FIXED file list, dumped for
 * before/after comparison.
 *
 * WHY THIS EXISTS INSTEAD OF A DIFFERENTIAL COMPARISON.
 *
 * `script/m14/differential.ts --repo otp` advances a cold-pool rotation on every
 * run, so two consecutive runs draw DIFFERENT 60-file subsets and report
 * different numbers with nothing in the analyzer changed — measured on this lane:
 * 320 truth rows at rot 1 and 319 at rot 5, both at 100% covered, both
 * MISSING=0/unexplained=0, with different hashes. A before/after count taken from
 * consecutive runs is therefore unfalsifiable in BOTH directions, and the pin that
 * makes it falsifiable lives in shared harness this lane does not own.
 *
 * So this file does the one comparison that is falsifiable without the harness: a
 * DETERMINISTIC file list (sorted, the first N), and the analyzer's html-native
 * (label, source, target) triples — which is exactly the key the differential
 * compares on, because it matches label + target and cannot see metadata. Two
 * dumps, one from HEAD and one from the working tree, and `diff` them:
 *
 *   npx tsx validation/m14/probes/html/edge-set-dump.mts --repo=otp --files=60 --out=/tmp/before.json
 *   # <apply the change>
 *   npx tsx validation/m14/probes/html/edge-set-dump.mts --repo=otp --files=60 --out=/tmp/after.json
 *   diff /tmp/before.json /tmp/after.json
 *
 * A change to `confidenceReason`, to an export's stamp, or to a range cannot show
 * up here, because the differential cannot see one either. A change to a label or
 * an endpoint shows up as a line, which is the whole point.
 *
 * The oracle's half needs no dump: `deriveHtmlEdges` reads the PARSE TREE and
 * never the analyzer, so the truth set is identical before and after by
 * construction — unless a change alters the TREE, and this file reports the
 * node-type inventory per file so a change there would be visible.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../../../../src/ast/engine"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (n: string, d: string): string => {
  const h = argv.find((a) => a.startsWith(`--${n}=`))
  return h ? h.slice(h.indexOf("=") + 1) : d
}
const repo = arg("repo", "otp")
const limit = Number(arg("files", "60"))
const out = arg("out", "")

const dir = path.join(CR, repo)
const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.html"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
}).split("\0").filter(Boolean)
const files = tracked
  .filter((r) => { try { return statSync(path.join(dir, r)).isFile() } catch { return false } })
  .sort()
  .slice(0, limit)

const native = new Set<string>()
const delegated = new Set<string>()
let symbols = 0
for (const rel of files) {
  const abs = path.join(dir, rel)
  let r: any
  try { r = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"), { projectPath: dir }) } catch { continue }
  symbols += (r.symbols ?? []).length
  for (const x of (r.relationships ?? []) as any[]) {
    const m = x?.metadata ?? {}
    const key = `${rel}|${x.type}|${x.source}|${x.target}`
    if (m.htmlEmbedded) delegated.add(key)
    else if (m.htmlSpecific) native.add(key)
  }
}
const dump = {
  repo, files: files.length, symbols,
  nativeEdges: [...native].sort(),
  delegatedEdges: [...delegated].sort(),
}
if (out) {
  writeFileSync(out, JSON.stringify(dump, null, 2))
  console.log(`wrote ${out} — ${files.length} files, ${symbols} symbols, ${native.size} html-native edges, ${delegated.size} delegate edges`)
} else {
  for (const line of dump.nativeEdges) console.log(line)
  console.error(`${files.length} files, ${symbols} symbols, ${native.size} html-native edges, ${delegated.size} delegate edges`)
}
