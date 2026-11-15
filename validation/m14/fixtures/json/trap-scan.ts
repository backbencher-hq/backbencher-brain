/**
 * JSON LANE TRAP SCAN — which admitted files make the WASM parser trap?
 *
 * ## The defect this exists to characterise
 *
 * Every `script/m14/ontology-coverage-gate.ts json` run at HEAD ended without a verdict:
 *
 *   [BB-PARSE-ERR] json | <file> | memory access out of bounds
 *   [BB-HANG] parser stuck 120s on <the SAME file> — exiting
 *
 * Three runs: the whole 11,713-file admitted population; a 3,281-file 12-repository
 * subset; a file-filtered subset of that. The second symptom is a consequence of the
 * first: `getParser` reuses ONE tree-sitter WASM parser per language, a trap leaves that
 * instance unusable, and the next parse on it hangs to a hardcoded 120 s
 * `process.exit(1)` that takes the whole gate run down. Both live in shared code
 * (`src/ast/pool-worker.ts` / the engine), so this lane measures the blast radius and
 * reports it rather than fixing it.
 *
 * The trap is NOT malformedness. `kubernetes/staging/src/k8s.io/kubectl/testdata/apply/rc.json`
 * parses cleanly under `JSON.parse` and still traps, so a validity filter cannot exclude it
 * and the run cannot be rescued by dropping "broken" input.
 *
 * ## Method
 *
 * One parser per POOL SLOT, and a slot whose parse throws is DISCARDED and replaced. That
 * is the whole difference from the gate: a poisoned instance is never reused, so a trapping
 * file costs one slot and never a hang. The scan therefore terminates where the gate does
 * not, and it names every trapping file so a scoped gate run can exclude exactly those.
 *
 * Usage: npx tsx validation/m14/fixtures/json/trap-scan.ts [--out f.json]
 */
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string, d: string) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const OUT = argOf("--out", "")
const SLOTS = Number(argOf("--slots", "4"))

const population: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
      .sort()
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    population.push({ repo: e, dir, rel, abs })
  }
}

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

const traps: string[] = []
let parsed = 0
let errorNodeFiles = 0
let idx = 0
async function worker(slot: number): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= population.length) return
    const f = population[i]
    let text: string
    try {
      text = readFileSync(f.abs, "utf8")
    } catch {
      continue
    }
    try {
      const t = slots[slot].parse(text)
      if (!t) throw new Error("no tree")
      parsed++
      const stack: any[] = [t.rootNode]
      let saw = false
      while (stack.length) {
        const n = stack.pop()
        if (n.type === "ERROR" || n.isMissing) saw = true
        for (let k = n.childCount - 1; k >= 0; k--) stack.push(n.child(k))
      }
      if (saw) errorNodeFiles++
      t.delete?.()
    } catch (e: any) {
      traps.push(`${f.repo}/${f.rel}: ${String(e?.message ?? e)}`)
      // The poisoned-instance problem, handled: DISCARD the slot rather than reuse it.
      try {
        slots[slot].delete?.()
      } catch {
        /* the instance is already unusable; that is the finding */
      }
      slots[slot] = await makeParser()
    }
  }
}
await Promise.all(slots.map((_, i) => worker(i)))

console.log(`json trap scan — admitted population ${population.length}, parsed ${parsed}, files with ERROR/missing nodes ${errorNodeFiles}`)
console.log(`trapping files: ${traps.length}`)
for (const t of traps.slice(0, 40)) console.log(`  ${t}`)
if (OUT) {
  writeFileSync(OUT, JSON.stringify({ corpusRoot: CR, admittedPopulation: population.length, parsed, filesWithErrorOrMissingNodes: errorNodeFiles, slots: SLOTS, traps }, null, 2))
  console.log(`wrote ${OUT}`)
}