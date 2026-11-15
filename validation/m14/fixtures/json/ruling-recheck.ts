/**
 * JSON LANE RULING RE-MEASUREMENT — is `script/m14/json-ruled.ts` still sound at the CURRENT
 * corpus state?
 *
 * ## Why this file exists
 *
 * A ruling is a claim about a corpus: "0 occurrences over N admitted files" decays the moment
 * the corpus grows, because a new repository can carry the construct the ruling says is absent.
 * This lane's table was measured at **11,713 admitted files**. The corpus is now **12,543**,
 * so the ruling is 830 files stale and the number quoted for it cannot be reproduced.
 *
 * The instrument that produced it, `validation/m14/fixtures/json/ruling-table.ts`, cannot answer
 * the question at the current state. It walks the whole admitted population in ONE process, and
 * `parse-determinism.ts` measured why that fails: the trap that kills the run is a property of
 * the RUN and not of any file (40 isolated parses of the 8 named trapping files, 0 traps), so a
 * sustained in-process walk eventually poisons the shared WASM parser instance and the next
 * parse hangs to the engine's hardcoded 120 s `process.exit(1)`. `census.ts` survives this by
 * running per-repo children; this file uses the cheaper route, which is enough because the
 * probe needs a PARSE TREE and not a full `parseFile`:
 *
 *   - N parser instances, and an instance whose parse throws is DISCARDED and replaced, so a
 *     trap costs one slot and never a hang (the technique `trap-scan.ts` uses, and the reason
 *     that file reports 0 trapping files where the single-process gate reports some);
 *   - the probe itself is imported from `script/m14/json-ruled.ts`, NOT reimplemented here, so
 *     this harness cannot accidentally audit a different rule than the one the gate will read.
 *
 * What it does NOT do: it does not decide EMITTED. It counts one thing — how many admitted
 * files the table's own instrument fires on — and it prints the corpus it counted over, so the
 * ruling carries the population it was measured on.
 *
 * Usage: npx tsx validation/m14/fixtures/json/ruling-recheck.ts [--slots N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { JSON_RULED, type Ruled } from "../../../../script/m14/json-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string, d: number) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
}
const SLOTS = argOf("--slots", 4)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : ""

// ---------------------------------------------------------------- corpus — the gate's own admission test
const files: { repo: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    files.push({ repo: e, abs })
  }
}
files.sort((a, b) => (a.repo === b.repo ? (a.abs < b.abs ? -1 : 1) : a.repo < b.repo ? -1 : 1))

// ---------------------------------------------------------------- parsers — poison-discarding slots
const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))
const makeParser = async (): Promise<any> => {
  const p = new Parser()
  p.setLanguage(await Language.load(wasm))
  return p
}
const slots: any[] = await Promise.all(Array.from({ length: SLOTS }, () => makeParser()))

// ---------------------------------------------------------------- run every table entry over every file
type Tally = { type: string; instrument: string; hits: string[]; files: number; nodeTypes: Set<string> }
const tallies: Tally[] = JSON_RULED.map((r: Ruled) => ({ type: r.type, instrument: r.instrument, hits: [], files: 0, nodeTypes: new Set<string>() }))

let parsed = 0
let threw = 0
const threwFiles: string[] = []
let idx = 0

async function worker(slot: number): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let tree: any = null
    try {
      tree = slots[slot].parse(readFileSync(f.abs, "utf8"))
    } catch {
      // A poisoned instance is never reused: discard the slot, replace it, and REPORT the file.
      threw++
      threwFiles.push(f.abs)
      slots[slot] = await makeParser()
      continue
    }
    if (!tree) continue
    parsed++
    for (const t of tallies) {
      const entry = JSON_RULED.find((r: Ruled) => r.type === t.type)!
      const before = t.hits.length
      if (entry.countOnTree) entry.countOnTree(tree.rootNode, `${f.repo}/${path.relative(path.join(CR, f.repo), f.abs)}`, t.hits)
      if (t.hits.length > before) t.files++
    }
    tree.delete?.()
  }
}

await Promise.all(Array.from({ length: SLOTS }, (_, s) => worker(s)))

// ---------------------------------------------------------------- report
console.log(`json ruling re-measurement — ${JSON_RULED.length} table entr${JSON_RULED.length === 1 ? "y" : "ies"} over the whole admitted population`)
console.log(`corpus: ${CR}`)
console.log(`admitted ${files.length} files across ${new Set(files.map((f) => f.repo)).size} repos   parsed ${parsed}   parse threw ${threw}`)
console.log("")
for (const t of tallies) {
  console.log(`  ${t.type}  instrument ${t.instrument}  HITS ${t.hits.length}  in ${t.files} file(s)`)
  for (const h of t.hits.slice(0, 10)) console.log(`      ${h}`)
  if (t.hits.length > 10) console.log(`      … and ${t.hits.length - 10} more`)
}
console.log("")
const fired = tallies.filter((t) => t.hits.length > 0)
if (threwFiles.length) {
  console.log(`files whose parse threw and whose slot was discarded (NOT counted as a hit, NOT counted as a clean parse): ${threwFiles.length}`)
  for (const f of threwFiles.slice(0, 10)) console.log(`      ${f}`)
}
if (!fired.length) console.log(`VERDICT: no table entry fires over ${parsed} admitted files — every RULED row holds at THIS corpus state.`)
else console.log(`VERDICT: ${fired.length} ruling(s) are FALSIFIED by the corpus and must be overturned.`)

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        tool: "json-ruling-recheck",
        corpusRoot: CR,
        admitted: files.length,
        repos: new Set(files.map((f) => f.repo)).size,
        parsed,
        threw,
        threwFiles,
        rulings: tallies.map((t) => ({ type: t.type, instrument: t.instrument, hits: t.hits.length, files: t.files, examples: t.hits.slice(0, 25) })),
      },
      null,
      2,
    ),
  )
  console.log(`wrote ${OUT}`)
}