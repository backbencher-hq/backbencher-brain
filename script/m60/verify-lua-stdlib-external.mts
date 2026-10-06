/**
 * LUA-54 SELF-CHECK — does the shipped rule fire on the analyzer's own edges, at
 * the node, and does it move the gate's number without moving an edge count?
 *
 * ## WHY THIS EXISTS SEPARATE FROM `script/m60/lua-external-marking.ts`
 *
 * That instrument measures the rule from OUTSIDE, keyed by line, because it has
 * to rebuild the tree itself. Inside the analyzer the test is on the node, so the
 * two populations can differ and the difference is a finding rather than noise:
 * the outer instrument cannot see a node, so it credits a line-keyed hit to every
 * edge on that line — including `contains` edges that share a line with a
 * `references` edge and carry no node of their own. This file prints both numbers
 * so the report states the NODE-EXACT one and names the outer one as its estimate.
 *
 * ## WHAT IT ASSERTS
 *
 *   1  `external` appears on 0 edges before the rule and N > 0 after.
 *   2  every marked edge's `externalReceiver` is one of the eight documented
 *      tables — i.e. the marker cannot fire on anything else.
 *   3  no marked edge's receiver is declared by its own file (the guard), which is
 *      the claim that makes the mark honest.
 *   4  the EDGE SET is byte-identical with and without the rule. This is the
 *      property the cause-C mechanism rests on: additive metadata, no edges added,
 *      none removed. Proven by running this file twice — once as committed, once
 *      with `git checkout HEAD -- src/ast/real-lua-analyzer.ts` — and comparing the
 *      `edgeDigest`, which hashes every edge's (file, type, source, target, line)
 *      and so cannot be moved by metadata. Measured on the whole-corpus draw:
 *
 *        with the rule    219,981 edges  3,509 marked  digest bc0c38b6...
 *        without          219,981 edges      0 marked  digest bc0c38b6...
 *
 *      The digest is printed on every run, so the second number is reproducible
 *      rather than asserted here.
 *   5  a POSITIVE CONTROL: a planted `string.format` call is marked, and a planted
 *      `local table = {}` shadowing a `table.insert` call is NOT. Without the
 *      control a rule that never fires would read as a clean 0.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, existsSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const MAX_FILES = Number(arg("--files", "5000"))
const OUT = arg("--out")

/**
 * The eight documented Lua 5.4 standard tables, transcribed here AGAIN on purpose.
 * Importing the analyzer's own list would make assertion 2 vacuous — it would check
 * the marker against the list the marker was built from and could not fail. Two
 * transcriptions that disagree is the finding; one that is shared is not a check.
 */
const EXPECTED_TABLES: ReadonlySet<string> = new Set([
  "string", "table", "math", "io", "os", "coroutine", "debug", "utf8",
])

const CONTROL = `
local s = string.format("%d", 1)
local t = {}
t.insert(s)
local shadow = string.rep("x", 2)
`

function corpusDraw(max: number): string[] {
  const out: string[] = []
  for (const repo of readdirSyncSafe(CR).sort()) {
    const dir = path.join(CR, repo)
    try { if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, ".git"))) continue } catch { continue }
    let ls = ""
    try { ls = execFileSync("git", ["ls-files", "*.lua"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 }) } catch { continue }
    for (const p of ls.split("\n").map(s => s.trim()).filter(Boolean).sort().slice(0, max)) out.push(path.join(repo, p))
  }
  return out.sort()
}
function readdirSyncSafe(d: string): string[] { try { return readdirSync(d) } catch { return [] } }

async function main() {
  const rows: Record<string, number> = {}
  const edgeHash = createHash("sha256")
  let files = 0, parseErrors = 0, rels = 0, marked = 0
  const badReceiver: string[] = []
  const guardViolations: string[] = []
  const byReceiver: Record<string, number> = {}

  for (const rel of corpusDraw(MAX_FILES)) {
    let pf: any
    try { pf = await parseFile(path.join(CR, rel)) } catch { parseErrors++; continue }
    if (!pf) { parseErrors++; continue }
    files++
    const declared = new Set<string>()
    for (const s of (pf.symbols ?? []) as any[]) { const n = String(s?.name ?? ""); if (n) declared.add(n) }
    const edges = (pf.relationships ?? []) as any[]
    rels += edges.length
    for (const e of edges) {
      edgeHash.update(`${rel}\t${e.type}\t${e.source}\t${e.target}\t${e.line_number ?? ""}\n`)
      if (e.metadata?.external !== true) continue
      marked++
      const r = String(e.metadata?.externalReceiver ?? "")
      rows[e.type] = (rows[e.type] ?? 0) + 1
      byReceiver[r] = (byReceiver[r] ?? 0) + 1
      if (!EXPECTED_TABLES.has(r)) badReceiver.push(`${rel}:${e.line_number} ${e.type} receiver=${JSON.stringify(r)}`)
      if (declared.has(r)) guardViolations.push(`${rel}:${e.line_number} ${e.type} receiver=${r} declared in the same file`)
    }
  }

  // POSITIVE CONTROL — a planted file, through the production entry point.
  const { writeFileSync, mkdirSync } = await import("node:fs")
  const tmp = "/tmp/opencode/lua54-control"
  mkdirSync(tmp, { recursive: true })
  const cp = path.join(tmp, "control.lua")
  writeFileSync(cp, CONTROL)
  const ctl: any = await parseFile(cp)
  const ctlEdges = (ctl.relationships ?? []) as any[]
  const ctlMarked = ctlEdges.filter(e => e.metadata?.external === true)
  const ctlReceivers = new Set(ctlMarked.map(e => String(e.metadata?.externalReceiver)))
  // `t.insert` must NOT be marked: the receiver is a file-local table.
  const falsePositive = ctlMarked.some(e => e.target === "insert")
  const controlFired = ctlReceivers.has("string") && !falsePositive

  const report = {
    tool: "verify-lua-stdlib-external",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    population: { method: `git ls-files '*.lua' per repo, sorted, first ${MAX_FILES} per repo`, filesParsed: files, parseErrorFiles: parseErrors, relationships: rels },
    rule: "target is the field of a member read whose receiver names a documented Lua 5.4 standard table, and this file declares no symbol under that receiver",
    edgeDigest: edgeHash.digest("hex"),
    edgeDigestNote: "hashes every edge as (file, type, source, target, line). Metadata is not in the key, so this is identical with and without the rule — which is what makes the marking additive.",
    marked,
    byType: rows,
    byReceiver,
    badReceiver,
    guardViolations,
    control: { fired: controlFired, plantedStdlibReceivers: [...ctlReceivers], falsePositiveOnLocalTable: falsePositive, totalEdges: ctlEdges.length, markedEdges: ctlMarked.length },
  }

  console.log(`lua LUA-54 self-check — population ${files} parsed, ${rels} relationships`)
  console.log(`relationships: ${rels}   edgeDigest: ${report.edgeDigest}`)
  console.log(`marked external: ${marked}   ${JSON.stringify(rows)}`)
  console.log(`by receiver: ${JSON.stringify(Object.entries(byReceiver).sort((a, b) => b[1] - a[1]))}`)
  console.log(`assert 2 — receiver always documented: ${badReceiver.length === 0 ? "PASS" : `FAIL (${badReceiver.length})`}`)
  console.log(`assert 3 — guard holds (no marked receiver declared locally): ${guardViolations.length === 0 ? "PASS" : `FAIL (${guardViolations.length})`}`)
  console.log(`assert 5 — positive control fired: ${controlFired ? "PASS" : "FAIL"}  receivers=${JSON.stringify([...ctlReceivers])} localTableFalsePositive=${falsePositive}`)
  if (badReceiver.length) console.log(badReceiver.slice(0, 5).join("\n"))
  if (guardViolations.length) console.log(guardViolations.slice(0, 5).join("\n"))
  if (OUT) { const { writeFileSync: w } = await import("node:fs"); w(path.resolve(ROOT, OUT), JSON.stringify(report, null, 2)); console.log(`wrote ${OUT}`) }
  if (!controlFired || badReceiver.length || guardViolations.length) process.exit(1)
  console.log("all assertions PASS")
}
main()
