/**
 * DOES THE ORACLE COVER A BARE `(( … ))` OPERAND? — the DERIVATION question for round 8.
 *
 * ## Why this file exists
 *
 * `script/m14/differential.ts` (`deriveBashEdges`) is a SEPARATE walker over the
 * SAME pinned wasm. It is the only instrument in the tree that can say whether a
 * `uses` edge the analyzer emits is corroborated by something that is not the
 * analyzer — and the round-8 change adds a whole class of edges, so "is the new
 * class audited?" is a question with a number attached, not a matter of taste.
 *
 * It cannot be answered from `differential.ts --lang bash` alone, for two reasons
 * that are properties of the instrument rather than of this lane:
 *
 *   1. the lane's cold-pool ROTATION advances a persisted counter
 *      (`m14-f5-cold-pool.json`), so two runs draw different files and their
 *      `unexplained` counts are not comparable. Pinning the rotation means editing
 *      shared state, which §8 of the task forbids.
 *   2. `unexplained` is a POOLED number over seven types. A class that moves it by
 *      +8 and a class that moves it by −8 are one number.
 *
 * So this file answers the narrow question on a FIXED file set: for every
 * `(( … ))` operand read the analyzer publishes, does the oracle publish the same
 * (source, label, target, line) row?
 *
 * ## What is compared, and what is not
 *
 * Compared: the analyzer's `uses` edges whose line is an arithmetic
 * compound_statement's line, against `deriveBashEdges`' rows for the same file.
 * The oracle publishes no line, so the comparison is on (source, label, target)
 * and the per-line detail is reported rather than asserted.
 *
 * NOT claimed: agreement about bash. Both walkers read the same tree, so a
 * grammar bug is invisible to the comparison — the limitation the lane's doc names
 * as item 12. What this file can establish is narrower and worth establishing: the
 * new edge class is either audited by the oracle or it is not, and the answer
 * decides whether round 8's change moved a DERIVATION finding.
 *
 * ## NO REGEX
 *
 * Node types and `charCodeAt` only; the file set comes from the analyzer's own
 * published edges.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-arithmetic-oracle.mts [--files 400]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveBashEdges } from "../../../../script/m14/differential"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(flag("files") ?? "400")

const opensWithDoubleParen = (t: string): boolean =>
  t.length >= 2 && t.charCodeAt(0) === 40 && t.charCodeAt(1) === 40
const endsWithDoubleParen = (t: string): boolean => {
  const s = t.trim()
  return s.length >= 2 && s.charCodeAt(s.length - 2) === 41 && s.charCodeAt(s.length - 1) === 41
}

type Admitted = { repo: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, rel, abs, text })
  }
}
const byHash = (a: Admitted, b: Admitted): number => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
}
admitted.sort(byHash)
const files = admitted.slice(0, SAMPLE)

const parser = await ASTEngine.getParser("bash")
let arithLines = 0
let unparsed = 0
let filesWithArith = 0
let analyzerUses = 0
let oracleHas = 0
let oracleMisses = 0
const misses: string[] = []
const hits: string[] = []

for (const f of files) {
  const parsed = await parseFile(f.abs, f.text)
  const moduleName = path.basename(f.abs)
  let lines = new Set<number>()
  const tree = (() => {
    try {
      return parser!.parse(f.text)
    } catch {
      unparsed++
      return null
    }
  })()
  if (tree) {
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      if (n.type === "compound_statement" && opensWithDoubleParen(n.text) && endsWithDoubleParen(n.text)) {
        const visit = (m: any): void => {
          if (m.type === "variable_name" || m.type === "special_variable_name") {
            lines.add(m.startPosition.row + 1)
            return
          }
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (c) visit(c)
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) visit(c)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
  }
  if (lines.size === 0) continue
  arithLines += lines.size
  filesWithArith++
  const oracle = new Set<string>()
  try {
    for (const row of deriveBashEdges(tree?.rootNode ?? {}, moduleName)) {
      oracle.add(`${row.from}\u0000${row.label}\u0000${row.target}`)
    }
  } catch (e: any) {
    console.log(`  oracle threw on ${f.repo}/${f.rel}: ${e?.message ?? String(e)}`)
    continue
  }
  for (const r of parsed.relationships ?? []) {
    if (!String(r.type).endsWith("uses") && !String(r.type).endsWith("Uses")) continue
    const line = (r as { line_number?: number }).line_number ?? 0
    if (!lines.has(line)) continue
    analyzerUses++
    const key = `${r.source}\u0000uses\u0000${r.target}`
    if (oracle.has(key)) {
      oracleHas++
      if (hits.length < 8) hits.push(`${f.repo}/${f.rel} @${line}: uses -> ${r.target}`)
    } else {
      oracleMisses++
      if (misses.length < 8) misses.push(`${f.repo}/${f.rel} @${line}: uses -> ${r.target}`)
    }
  }
}

console.log(`\n--- is a bare (( ... )) operand audited by the oracle? ---`)
console.log(`sample                                  : ${files.length} files, hash order`)
console.log(`files the wasm could not parse (excluded): ${unparsed}`)
console.log(`files contributing arithmetic lines     : ${filesWithArith}`)
console.log(`arithmetic operand lines located         : ${arithLines}`)
console.log(`analyzer uses edges ON those lines       : ${analyzerUses}`)
console.log(`  … the oracle publishes the same row    : ${oracleHas}`)
console.log(`  … the oracle does NOT publish it       : ${oracleMisses}`)
console.log(`\noracle hits:`)
for (const h of hits) console.log(`  ${h}`)
console.log(`\noracle misses:`)
for (const m of misses) console.log(`  ${m}`)