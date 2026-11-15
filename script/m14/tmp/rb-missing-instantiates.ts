/**
 * Are the 207 MISSING `instantiates` edges ANALIZER GAPS or ORACLE FABRICATIONS?
 *
 * The largest single gap in the ruby differential is 207 truth `instantiates`
 * edges the analyzer does not emit. "Fix the analyzer" is the obvious move and
 * is very likely wrong: the oracle's `X.new` rule has a `!receiver` branch that
 * fires whenever no `constant` / `scope_resolution` / `identifier` / variable
 * sibling appears before the method node — and a CHAINED receiver
 * (`current_account.account_moderation_notes.new(x)`) has a `call` node there,
 * not an identifier, so it is classified as RECEIVERLESS and fabricates
 * `instantiates <enclosing class>`.
 *
 * So every MISSING edge is classified by the receiver shape actually present at
 * that line, read from the tree. If they are chained/`self`-rooted receivers,
 * the analyzer is right to stay silent and the truth side is inventing.
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
import { deriveRubyEdges } from "../../../script/m14/differential"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let e: fs.Dirent[]; try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const x of e) { if (x.name.startsWith(".")) continue; const p = path.join(d, x.name)
      if (x.isDirectory()) { if (!skip.has(x.name)) walk(p) } else if (x.isFile() && x.name.endsWith(".rb")) out.push(p) }
  }
  walk(root); return out.sort()
}

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser(); parser.setLanguage(lang as any)
  const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }

  const classes = new Map<string, number>()
  const samples = new Map<string, any[]>()
  let missing = 0
  for (const f of files) {
    let content: string; try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any; try { tree = parser.parse(content) } catch { continue }
    let res: any, truth: any[]
    try {
      res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f)
      truth = deriveRubyEdges(tree.rootNode)
    } catch { continue }
    const rel = path.relative(roots[0], f)
    const emitted = new Set((res.relationships ?? []).map((r: any) => `${r.type}|${r.target}`))
    for (const te of truth) {
      if (te.label !== "instantiates") continue
      if (emitted.has(`instantiates|${te.target}`)) continue
      missing++
      let shape = "unclassified"
      let body = ""
      const lines = content.split("\n")
      // Enumerate EVERY `.new` call in the file and record its receiver's node
      // TYPE. The first version of this probe tried to match the truth edge to
      // the line that produced it and reported all 38 as "no .new found" — while
      // the file plainly contains six `new` tokens. Matching a derived edge to a
      // line requires the oracle to record a line, which it does not (`from` is
      // the literal "(expr)"), so the probe invented a correspondence that does
      // not exist and then reported its own failure as a finding. The receiver
      // SHAPE is the question, and it does not need a line.
      const rcvTypes: string[] = []
      // The body kept is the one belonging to the OFFENDING receiver — a
      // `constant` receiver yields `instantiates <that constant>`, which the
      // analyzer emits, so it cannot be the source of a MISSING edge. Printing the
      // file's FIRST `.new` instead showed `AccountFilter.new(...)` as evidence
      // for a fabrication about `AccountsController`, which is worse than no
      // sample: the line does not support the claim beside it.
      const offending: string[] = []
      {
        const stack: any[] = [tree.rootNode]
        while (stack.length) {
          const n = stack.pop()!
          if (n.type === "call") {
            const mn = n.childForFieldName?.("method") ?? [...(n.children ?? [])].find((c: any) => c?.text === "new")
            if (mn && mn.text === "new") {
              const rcv = n.childForFieldName?.("receiver")
              const rt = rcv ? rcv.type : "(NONE)"
              rcvTypes.push(rt)
              let row = 0; try { row = mn.startPosition.row } catch { /* ignore */ }
              if (rt !== "constant" && rt !== "scope_resolution") {
                offending.push(`L${row + 1} receiver=${rt}: ${(rcv?.text ?? "(none)").slice(0, 50)}.new(...)`)
              }
            }
          }
          for (const c of n.children) { if (c) stack.push(c) }
        }
      }
      if (rcvTypes.length === 0) shape = "no .new call in the file at all"
      else if (rcvTypes.some((t) => t === "(NONE)")) shape = "has a genuinely receiverless .new — oracle may be right"
      else if (rcvTypes.some((t) => t === "call")) shape = "CHAINED receiver (call node) — oracle reads this as receiverless and FABRICATES"
      else if (rcvTypes.every((t) => t === "constant" || t === "scope_resolution")) shape = "all constant receivers — analyzer should emit; real gap"
      else shape = `other shapes: ${[...new Set(rcvTypes)].join(", ")}`
      body = offending.slice(0, 2).join("  ;;  ")
      classes.set(shape, (classes.get(shape) ?? 0) + 1)
      const a = samples.get(shape) ?? []; if (a.length < 5) { a.push({ file: rel, target: te.target, body }); samples.set(shape, a) }
    }
  }
  console.log("=".repeat(94))
  console.log("M60 — THE 207 MISSING `instantiates`: ANALYZER GAP OR ORACLE FABRICATION?")
  console.log("=".repeat(94))
  console.log(`corpus files parsed: ${files.length}   MISSING instantiates: ${missing}\n`)
  for (const [k, n] of [...classes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${((n / Math.max(1, missing)) * 100).toFixed(1).padStart(5)}%  ${k}`)
    for (const s of samples.get(k) ?? []) console.log(`        ${s.file}  -> ${s.target}\n          | ${s.body}`)
  }
  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-missing-instantiates.json"),
    JSON.stringify({ at: new Date().toISOString(), filesParsed: files.length, missing, classes: Object.fromEntries(classes), samples: Object.fromEntries(samples) }, null, 2))
  console.log("\nevidence: validation/m60/results/ruby-missing-instantiates.json")
}
main()
