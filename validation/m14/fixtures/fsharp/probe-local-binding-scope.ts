#!/usr/bin/env npx tsx
/**
 * MEASURE — does the FILE-WIDE `localNames` actually over-fire?
 *
 * The rule is right BY NAME, not by scope: `localNames` is accumulated once per file
 * (`real-fsharp-analyzer.ts:383`, populated at `:1176`) and consulted at `:472`, so a name that is a
 * local ANYWHERE in the file is claimed as a binding at EVERY call that spells it. The scope-aware
 * change is owed on that reasoning — but no measurement has shown the reasoning has a population, and
 * a change no measurement justifies must not claim a number.
 *
 * This probe asks the narrowest question that can settle it, and it is a LOWER BOUND by construction:
 *
 *   for every `calls` edge the analyzer marks `local-binding`, is there a local declaration of that
 *   name in the same file at a line AT OR BEFORE the edge?
 *
 * A binding cannot be READ before it is declared, so an edge with no such declaration is over-fired
 * beyond argument — no scope analysis is needed to say so. Edges that pass this test are NOT thereby
 * proved correct (the declaration may be in a sibling scope); the probe reports them separately as
 * "not settled by this test" rather than counting them as clean.
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/probe-local-binding-scope.ts --files 300
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealFsharpAnalyzer } from "../../../../src/ast/real-fsharp-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string, d: string): string => {
  const i = argv.indexOf(f)
  return i >= 0 ? (argv[i + 1] ?? d) : d
}
const PER = Number(argOf("--files", "300"))

const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".fs")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const stride = Math.max(1, Math.floor(found.length / PER))
const draw: string[] = []
for (let i = 0; i < found.length && draw.length < PER; i += stride) draw.push(found[i])

/** Local binding declarations: a `value_declaration`/`function_or_value_defn` that has a callable
 *  ancestor (so it is inside a body), with the NAME it declares and the line it declares it on. */
const LOCAL_DECLS = new Set(["value_declaration", "function_or_value_defn"])
const CALLABLE = new Set(["function_or_value_defn", "member_defn", "additional_constr_defn"])

let files = 0
let localBindingEdges = 0
let noDeclarationBefore = 0
const examples: string[] = []
const byName = new Map<string, number>()

for (const abs of draw) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = await ASTEngine.parseTree(abs, text) } catch { continue }
  const a: any = new RealFsharpAnalyzer().analyze(tree.tree.rootNode, text, abs)

  // every line on which a local binding is declared, by name
  const declLines = new Map<string, number[]>()
  const collect = (n: any, insideCallable: boolean): void => {
    if (!n) return
    const nowInside = insideCallable || CALLABLE.has(n.type)
    if (insideCallable && LOCAL_DECLS.has(n.type)) {
      // Strip the keyword AND the modifiers. A first cut stripped only `let|and|member`, so
      // `let rec loop guard body = …` yielded "rec" and every lookup missed — which is how this
      // probe reported 571 of 571 as undeclared when `loop` is declared at :158 for an edge at :159.
      // A collector that cannot read the name it is looking for reports a defect in the CODE.
      let nmText = String(n.text ?? "")
      for (let k = 0; k < 6; k++) {
        const next = nmText.replace(/^(let|and|member|rec|inline|mutable|private|internal|public|static)\s+/, "")
        if (next === nmText) break
        nmText = next
      }
      const nm = nmText.split(/[\s(=:]/)[0]
      if (nm && /^[A-Za-z_][A-Za-z0-9_']*$/.test(nm)) {
        declLines.set(nm, [...(declLines.get(nm) ?? []), n.startPosition.row + 1])
      }
    }
    for (const c of n.namedChildren ?? []) if (c) collect(c, nowInside)
  }
  collect(tree.tree.rootNode, false)
  tree.tree.delete?.()
  files++

  for (const r of a?.relationships ?? []) {
    if (String(r.type) !== "calls" || (r as any).metadata?.localBinding !== true) continue
    localBindingEdges++
    const raw = String(r.target ?? "")
    const name = raw.includes("#") ? raw.slice(raw.lastIndexOf("#") + 1) : raw.slice(raw.lastIndexOf(".") + 1)
    const line = Number(r.line_number ?? 0)
    const lines = declLines.get(name) ?? []
    const before = lines.some((l) => l <= line)
    if (!before) {
      noDeclarationBefore++
      byName.set(name, (byName.get(name) ?? 0) + 1)
      if (examples.length < 15) examples.push(`${path.relative(CR, abs)}:${line}  -> ${raw}   (declarations of '${name}' in file: ${lines.length ? lines.join(",") : "none"})`)
    }
  }
}

console.log("=".repeat(88))
console.log("MEASURE — `local-binding` claims with NO declaration of that name at or before the call")
console.log("=".repeat(88))
console.log(`population: ${found.length} .fs files; draw ${draw.length} by even stride ${stride}; parsed ${files}`)
console.log(`calls edges marked localBinding: ${localBindingEdges}`)
console.log(`  of those, NO local declaration of that name at or before the edge: ${noDeclarationBefore}`)
console.log(`  not settled by this test (a declaration exists earlier; scope not checked): ${localBindingEdges - noDeclarationBefore}`)
console.log("")
if (byName.size) {
  console.log("by name (top 15):")
  for (const [k, v] of [...byName.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`  ${String(v).padStart(5)}  ${k}`)
  console.log("")
  console.log("examples:")
  for (const e of examples) console.log(`  ${e}`)
}
process.exit(0)
