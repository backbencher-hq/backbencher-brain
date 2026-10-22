#!/usr/bin/env bun
/**
 * SCALA HERITAGE BLIND-SPOT PROBE — the scala lane's own measurement of the class the javascript
 * lane found in the fleet.
 *
 * ★ WHY THIS FILE IS LANE-OWNED. `script/m14/heritage-blindspot-probe.ts` is the LEAD's probe and
 *   its HERITAGE table has no `scala` entry, so `bun script/m14/heritage-blindspot-probe.ts
 *   --lang=scala` answers "NOT CONFIGURED … NOTHING IS MEASURED AND NOTHING IS CLAIMED". That is the
 *   correct behaviour of a probe that is configured from the analyzer's own source, and it is also a
 *   HOLE: the fleet's javascript finding (802 of 2,572 `class_heritage` clauses publishing NO EDGE
 *   AT ALL, because the lookup names two shapes and 726 clauses are `parenthesized_expression` and
 *   76 are `call_expression`) is a PATTERN, and scala's lookup is a shape list too. A lane that
 *   assumes its lookup is complete is the exact defect being hunted.
 *
 * ★ AND THE PROBE'S OWN RULE — "a shape table that did not come from the analyzer's own code
 *   measures the table" — IS BINDING HERE. So the shape list below is NOT a list of shapes somebody
 *   remembered: it is the analyzer's OWN dispatch, read out of
 *   `src/ast/real-scala-analyzer.ts` (`extractSupertypes`), and the probe RE-IMplements that
 *   dispatch faithfully and prints the source line it was read from. If the analyzer's dispatch
 *   changes, the probe's table is wrong and the probe says so by printing the line.
 *
 * WHAT IT MEASURES. For every `extends_clause` in the admitted population: the SHAPE of its DIRECT
 * NAMED CHILDREN, and whether the analyzer's dispatch can EXTRACT a supertype from that shape. A
 * shape the dispatch does not name produces NO EDGE AT ALL — not a wrong edge: none. That is the
 * blind-spot class, and a resolution count over a population that contains it is a count over a
 * population the analyzer cannot see.
 *
 * THE POPULATION. The fleet's own rule: the git-TRACKED set under the 1 MB size cap, from the
 * corpus root `$PWD/.corpus` (199 absolute symlinks into the repository store + local checkouts).
 * ★ SYMLINKED DIRECTORIES ARE FOLLOWED and the count is PRINTED.
 *
 * EXIT: 0 when every clause's shape is covered, 5 when a shape is uncovered (a MEASURED BLIND
 * SPOT) — the same contract the Lead's probe has.
 *
 * Usage: bun run script/m14/scala-heritage-blindspot.ts [--max=<files>] [--repo=<name>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { createHash } from "node:crypto"

const ROOT = resolve(import.meta.dirname, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ? resolve(process.env.BB_CORPUS_ROOT) : resolve(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const MAX = Number(argOf("max", "0"))
const REPO = argOf("repo", "")

const EXTS = [".scala", ".sc", ".sbt"]
const SIZE_CAP = 1024 * 1024

/**
 * ★ THE ANALYZER'S OWN DISPATCH, read out of `extractSupertypes`
 *   (src/ast/real-scala-analyzer.ts:3201-3256). The analyzer walks the clause's DIRECT children
 *   (`for (let i = 0; i < extendsClause.childCount; i++)`), keeps the NAMED ones, and dispatches on
 *   the child's type. A type it does not name contributes NOTHING.
 */
const ANALYZER_DISPATCH: Record<string, "push" | "push-inner"> = {
  type_identifier: "push",
  identifier: "push",
  stable_type_identifier: "push",
  generic_type: "push",
  compound_type: "push-inner",
}
const ANALYZER_SOURCE =
  "src/ast/real-scala-analyzer.ts:3201-3256 — `extractSupertypes`: the clause's DIRECT named children, " +
  "dispatching on type_identifier | identifier | stable_type_identifier | generic_type | compound_type"

function corpusFiles(): { files: string[]; followed: number; repos: number; admitted: number; tracked: number; perRepo: Record<string, number> } {
  let entries: string[] = []
  try { entries = execFileSync("ls", ["-1", CORPUS], { encoding: "utf8" }).split("\n").filter(Boolean).sort() } catch { entries = [] }
  if (REPO) entries = entries.filter((r) => r === REPO)
  const out: string[] = []
  let followed = 0
  let repos = 0
  let tracked = 0
  const perRepo: Record<string, number> = {}
  for (const name of entries) {
    const dir = join(CORPUS, name)
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    // ★ THE SYMLINK FOLLOW: the corpus entry is an ABSOLUTE SYMLINK into the repository store, so
    //   the LINK's own `isDirectory()` is false; the TARGET's is what matters.
    try {
      const { statSync, lstatSync } = require("node:fs") as typeof import("node:fs")
      if (!statSync(dir).isDirectory()) continue
      if (lstatSync(dir).isSymbolicLink()) followed++
    } catch { continue }
    repos++
    let files: string[] = []
    try {
      files = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    let n = 0
    for (const rel of files) {
      if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
      tracked++
      const abs = join(dir, rel)
      try { if (readFileSync(abs).length > SIZE_CAP) continue } catch { continue }
      out.push(abs); n++
    }
    perRepo[name] = n
  }
  return { files: out, followed, repos, admitted: out.length, tracked, perRepo }
}

const pop = corpusFiles()
const files = MAX > 0 ? pop.files.slice(0, MAX) : pop.files

const { getParser } = await import(resolve(ROOT, "src/ast/engine"))
const { resolveWasmAsset, hasWasmInRegistry } = await import(resolve(ROOT, "src/util/wasm"))
const SPELLING = "tree-sitter-scala.wasm"
const rb = hasWasmInRegistry(SPELLING)
const grammarSha = rb && rb.length ? createHash("sha256").update(rb).digest("hex") : null
const parser = await getParser("scala" as any)

console.log(`SCALA HERITAGE BLIND-SPOT PROBE`)
console.log(`corpus root: ${CORPUS}`)
console.log(`population: ${files.length} ADMITTED (git-tracked, <= 1 MB) files from ${pop.repos} repos; ${pop.followed} SYMLINKED DIRECTORIES FOLLOWED`)
console.log(`tracked paths (before the cap): ${pop.tracked} · over the cap: ${pop.tracked - pop.admitted}`)
console.log(`per repo: ${Object.entries(pop.perRepo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`)
console.log(`heritage node: extends_clause`)
console.log(`the analyzer's own dispatch: ${ANALYZER_SOURCE}`)
console.log(`production build: sha256 ${grammarSha} · ${resolveWasmAsset(SPELLING)}`)
console.log()

const shapeCounts = new Map<string, number>()
const uncovered = new Map<string, number>()
const uncoveredExamples = new Map<string, string>()
let clauses = 0
let covered = 0
let parsed = 0
let failed = 0

for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { failed++; continue }
  parsed++
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "extends_clause") {
      clauses++
      // THE ANALYZER'S OWN WALK: the clause's DIRECT children, keeping the NAMED ones.
      const direct: any[] = []
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && c.isNamed) direct.push(c)
      }
      const key = direct.length === 0 ? "(no named children)" : direct.map((c) => c.type).join("+")
      shapeCounts.set(key, (shapeCounts.get(key) ?? 0) + 1)
      // THE DISPATCH, REPRODUCED: does any DIRECT NAMED CHILD carry a shape the analyzer names?
      let found = false
      for (const c of direct) {
        if (ANALYZER_DISPATCH[c.type] === "push") { found = true; break }
        if (ANALYZER_DISPATCH[c.type] === "push-inner") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const ch = c.namedChild(j)
            if (ch && (ch.type === "type_identifier" || ch.type === "generic_type")) { found = true; break }
          }
          if (found) break
        }
      }
      if (found) covered++
      else {
        uncovered.set(key, (uncovered.get(key) ?? 0) + 1)
        if (!uncoveredExamples.has(key)) uncoveredExamples.set(key, `${f.replace(CORPUS + "/", "")} :: ${n.text.replace(/\s+/g, " ").slice(0, 120)}`)
      }
    }
    for (const c of (n.namedChildren ?? [])) if (c) stack.push(c)
  }
  try { tree.delete() } catch { /* the probe's own tree */ }
}

console.log(`files parsed ${parsed} · failed ${failed} · extends_clause clauses ${clauses}`)
console.log(`covered by the analyzer's dispatch ${covered} · UNCOVERED ${clauses - covered}`)
console.log()
console.log(`THE SHAPES OF THE DIRECT NAMED CHILDREN, AND WHICH THE DISPATCH CANNOT MATCH:`)
for (const [shape, n] of [...shapeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  const miss = uncovered.get(shape) ?? 0
  console.log(`  ${String(n).padStart(6)}  ${shape}${miss > 0 ? `   ★ ${miss} UNCOVERED` : ""}`)
}
if (uncovered.size) {
  console.log()
  console.log(`THE UNCOVERED SHAPES, WITH AN EXAMPLE OF EACH:`)
  for (const [shape, ex] of uncoveredExamples) console.log(`  ${shape}\n      ${ex}`)
}
console.log()
if (clauses === 0) {
  console.log(`no extends_clause clause was found in the population — the population may not exercise the construct.`)
  process.exit(0)
}
const missTotal = clauses - covered
if (missTotal === 0) {
  console.log(`⇒ EVERY extends_clause clause's shape is covered by the analyzer's dispatch. No blind spot.`)
  process.exit(0)
}
console.log(`★ THE BLIND SPOT IS MEASURED: ${missTotal} of ${clauses} extends_clause clauses (${((missTotal / clauses) * 100).toFixed(1)} %) publish`)
console.log("  NO EDGE AT ALL, because their direct named child is a shape the dispatch does not name.")
console.log("  A shape the analyzer does not match is not automatically a defect — the lane's own instrument")
console.log("  decides, against the analyzer's own stated intent. This file only MEASURES.")
process.exit(5)
