/**
 * RUBY LANE — multiple-assignment ivar write probe (M60 deep round 2).
 *
 * The finding, stated precisely because the first statement of it was wrong.
 *
 * `@height, @width = h, w` parses as
 *   assignment
 *     left_assignment_list     <- the LHS: the two instance_variables
 *     right_assignment_list    <- the RHS: `h, w`
 * so the WRITE targets sit under **`left_assignment_list`**, and their parent is
 * that list — not the `assignment`. The analyzer's write guard is
 *
 *   isLhsOfAssign = (parentType === "assignment" || parentType === "operator_assignment")
 *                   && parent.childForFieldName("left").id === node.id
 *
 * whose FIRST conjunct is false for a multiple assignment, so the guard never
 * fires and each LHS ivar is published as a `uses` READ.
 *
 * The differential cannot see it, for a reason worth stating: `deriveRubyEdges`
 * emits UNIQUE `(label, target)` truth per file, and `differential.ts` collapses
 * the analyzer side to one edge per `(label, target)`. A genuine read of the same
 * ivar later in the file therefore satisfies the truth edge, and the write edges
 * are duplicates of it by target. Both sides agree, so coverage is 100% and
 * fabrication is 0 while two false edges sit in the payload. This is the same
 * shared-blind-spot shape as RUBD12 (`pair`) and as the bare-`private` finding.
 *
 * This probe counts the edges that are actually false — an ivar in ASSIGNMENT
 * LHS position — which is a different number from "occurrences of the node type".
 *
 * Usage: npx tsx script/m14/tmp/rb-multi-assign-uses.ts <corpus-root> [--limit N]
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p) }
      else if (e.isFile() && e.name.endsWith(".rb")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

async function main() {
  const { RealRubyAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts"))
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a, i) => !a.startsWith("--") && !(i > 0 && process.argv[i - 1] === "--limit"))
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }

  /**
   * ivar nodes that are a BARE WRITE TARGET — a write with no read in it.
   *
   * An earlier revision of this predicate collected every variable anywhere in
   * the assignment's LHS subtree and reported 426 false reads on the rails
   * stride. That number was wrong: `@cfg.limit = x` puts `call > @cfg` in the
   * LHS subtree, and `@list[i] = v` puts `element_reference > @list` there, and
   * BOTH genuinely READ the receiver — you cannot assign through an ivar without
   * reading it. Only the bare-target forms are false:
   *
   *   @h, @w = h, w     left_assignment_list > instance_variable   <- false read
   *   @dep, * = x       left_assignment_list > instance_variable   <- false read
   *   @cfg.limit = x    call > instance_variable                   <- a real read
   *   @list[i] = v      element_reference > instance_variable       <- a real read
   *
   * So the rule is: a direct child of `left`, or of a `left_assignment_list`
   * that is `left` — and never a child of a `call` or `element_reference`.
   */
  const writeTargets = (root: any): Set<number> => {
    const ids = new Set<number>()
    const mark = (q: any) => {
      if (q.type === "instance_variable" || q.type === "class_variable" || q.type === "global_variable") {
        ids.add((q as any).id)
      }
    }
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "assignment" || n.type === "operator_assignment") {
        const left = n.childForFieldName?.("left")
        if (left) {
          if (left.type === "left_assignment_list") {
            for (let i = 0; i < left.namedChildCount; i++) { const c = left.namedChild(i); if (c) mark(c) }
          } else {
            // `left` is itself the target, or a call/element_reference whose
            // receiver is a genuine read — only the direct-variable form counts.
            if (left.type !== "call" && left.type !== "element_reference") mark(left)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    return ids
  }

  let falseReads = 0, totalUses = 0, filesAffected = 0
  const examples: any[] = []
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    const writes = writeTargets(tree.rootNode)
    let n = 0
    for (const r of res.relationships ?? []) {
      if (r.type !== "uses") continue
      totalUses++
      // The edge is false if the read it names is an assignment-LHS node. The
      // edge's line is the read's line; re-locate the node at that line.
      const ln = r.line_number
      if (typeof ln !== "number") continue
      let found: any = null
      const stack: any[] = [tree.rootNode]
      while (stack.length > 0 && !found) {
        const q = stack.pop()!
        if (q.type === "instance_variable" && q.text === r.target && q.startPosition.row + 1 === ln) found = q
        else for (let i = 0; i < q.namedChildCount; i++) { const c = q.namedChild(i); if (c) stack.push(c) }
      }
      if (found && writes.has((found as any).id)) {
        n++
        falseReads++
        if (examples.length < 12) {
          examples.push({ file: path.relative(roots[0], f), line: ln, target: r.target, text: content.split("\n")[ln - 1]?.trim() })
        }
      }
    }
    if (n) filesAffected++
  }

  console.log(`corpus: ${roots.join(", ")}`)
  console.log(`files=${files.length}  uses edges total=${totalUses}`)
  console.log(`FALSE reads (ivar published as a read while in assignment-LHS position): ${falseReads} in ${filesAffected} files`)
  const pct = totalUses ? ((falseReads / totalUses) * 100).toFixed(3) : "0.000"
  console.log(`share of all \`uses\` edges: ${pct}%`)
  for (const e of examples) console.log(`  ${e.file}:${e.line} uses -> ${e.target}   ${e.text}`)
}

main()
