#!/usr/bin/env npx tsx
/**
 * SIZE — how many pipeline `calls` edges name the LEFT operand instead of the callee?
 *
 * ## The defect
 *
 * `real-fsharp-analyzer.ts:1935-1944` builds the pipeline callee from the direct children that are
 * NAME-like:
 *
 *     const named = this.filterChildren(node, n => n.type === "long_identifier" || "identifier"
 *                                              || "long_identifier_or_op" || "dot_expression")
 *     const calleeNode = side === "right" ? named[named.length - 1] : named[0]
 *
 * For `x |> ignore` the right operand IS a bare name, so `named` holds it and the edge is right.
 * For `x |> f y` — the ordinary pipeline — the right operand is an `application_expression`, which is
 * NOT one of those four types, so it never enters `named` and `named[named.length - 1]` is the LEFT
 * OPERAND. The edge then names `x` as the callee of a call it does not make.
 *
 * MEASURED INSTANCE: `Tests.LanguageService.Completion.fs:215`,
 * `let found = completions |> Array.exists(fun … -> …)`, emits
 * `calls …AssertCtrlSpaceCompletionContains -> …#completions` with
 * `{nodeType: infix_expression, isPipelineCall: true, pipelineOperator: "|>"}`, while
 * `PIPELINE_CALLEE_SIDE` maps `|>` to "right" and the callee is `Array.exists`. The oracle derives no
 * such edge, which is where it was found.
 *
 * ## What this counts
 *
 * Over an even-stride draw: every pipe `infix_expression`, whether its callee-side operand is an
 * application (the buggy shape) or a bare name (the working shape), and — for the buggy shape — how
 * many of them actually produced an edge naming the OTHER operand.
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/probe-pipeline-callee.ts --files 400
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
const PER = Number(argOf("--files", "400"))

/** repo-relative .fs files, sorted, even stride. */
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

const PIPE = new Map<string, "left" | "right">([["|>", "right"], ["|>>", "right"], [">>=", "right"], ["<|", "left"], ["<<", "left"]])
const NAMEY = new Set(["long_identifier", "identifier", "long_identifier_or_op", "dot_expression"])

let pipes = 0
let bareCallee = 0
let appCallee = 0
let emittedOnLeft = 0
const examples: string[] = []

for (const abs of draw) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = await ASTEngine.parseTree(abs, text) } catch { continue }
  const a: any = new RealFsharpAnalyzer().analyze(tree.tree.rootNode, text, abs)
  // NOTE: the tree must be WALKED before it is deleted — a first cut of this probe freed it here and
  // then read `namedChildren` from a dead tree, which reported 0 pipe nodes in 400 real files.

  // the pipeline edges this file emitted: (line, target)
  const pipelineEdges = (a?.relationships ?? []).filter((r: any) => r?.metadata?.isPipelineCall === true)
  const targetsByLine = new Map<number, string[]>()
  for (const r of pipelineEdges) {
    const l = Number(r.line_number ?? 0)
    targetsByLine.set(l, [...(targetsByLine.get(l) ?? []), String(r.target)])
  }

  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "infix_expression") {
      let op = ""
      let opIdx = -1
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && c.type === "infix_op") { op = c.text; opIdx = i; break }
      }
      const side = PIPE.get(op)
      if (side) {
        pipes++
        const operand = side === "right" ? n.child(opIdx + 1) : n.child(opIdx - 1)
        const other = side === "right" ? n.child(opIdx - 1) : n.child(opIdx + 1)
        const operandIsName = !!operand && NAMEY.has(operand.type)
        // The CALLEE NAME this node can yield: the operand itself, or an application's first
        // name-like child. A node that yields none cannot be the source of a pipeline edge, so it is
        // not counted — the first cut of this probe flagged `force << f << force`, where the `<<`
        // takes its callee from the LEFT and the emitted target is that left operand, correctly.
        const yieldsName = operandIsName
          || (!!operand && (operand.type === "application_expression" || operand.type === "prefixed_expression")
              && (operand.namedChildren ?? []).some((c: any) => c && NAMEY.has(c.type)))
        if (operandIsName) bareCallee++
        else if (operand) {
          appCallee++
          if (!yieldsName) { for (const c of n.namedChildren ?? []) if (c) walk(c); return }
          // did the analyzer emit, on this line, a pipeline edge naming the OTHER operand instead?
          const otherText = other ? String(other.text) : ""
          const leafOfOther = otherText.split(".").pop() ?? ""
          const hits = (targetsByLine.get(n.startPosition.row + 1) ?? []).filter(
            (t) => t === otherText || t.endsWith(`#${leafOfOther}`) || t.endsWith(`.${leafOfOther}`) || t === leafOfOther,
          )
          if (hits.length) {
            emittedOnLeft++
            if (examples.length < 10) {
              examples.push(`${path.relative(CR, abs)}:${n.startPosition.row + 1}  ${op}  left=${JSON.stringify(otherText.slice(0, 40))}  right=${JSON.stringify(String(operand.text).slice(0, 40))}  -> emitted ${JSON.stringify(hits[0])}`)
            }
          }
        }
      }
    }
    for (const c of n.namedChildren ?? []) if (c) walk(c)
  }
  walk(tree.tree.rootNode)
  tree.tree.delete?.()
}

console.log("=".repeat(88))
console.log("SIZE — pipeline edges that name the LEFT operand instead of the callee")
console.log("=".repeat(88))
console.log(`population: ${found.length} .fs files; draw ${draw.length} by even stride ${stride}`)
console.log(`pipe infix_expression nodes: ${pipes}`)
console.log(`  callee-side operand is a bare NAME (works today):      ${bareCallee}`)
console.log(`  callee-side operand is NOT name-like (application etc): ${appCallee}`)
console.log(`OF THOSE, one emitted a pipeline edge naming the OTHER operand: ${emittedOnLeft}`)
console.log("")
for (const e of examples) console.log(`  ${e}`)
process.exit(0)
