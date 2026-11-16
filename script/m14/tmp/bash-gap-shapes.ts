/**
 * READ-ONLY PROBE — the exact tree shape of every node type the rewritten
 * F8 census reports as a `gap`, on the pinned corpus.
 *
 * The census says six types own names the analyzer never reaches, 63 names in
 * all. A count says there is a loss; only the tree says what the loss IS, and
 * the fix has to be designed from the shape rather than from the count. This
 * dumps, per gap type: the node, its field names, its subtree, the line, and
 * what the production analyzer actually emitted on that line.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const CORPUS = process.env.BB_BASH_CORPUS ?? "<corpus-root>/bb_tests/repositories/fsharp"
const ROOT = process.cwd()
const GAPS = ["array", "file_redirect", "unset_command", "postfix_expression", "unary_expression", "ERROR"]

const parser = await ASTEngine.getParser("bash")
const files = execFileSync("git", ["-C", CORPUS, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

/** Distinct shapes, deduped by a structural signature so 44 sites read as ~6 shapes. */
const shapes = new Map<string, { gap: string; signature: string; example: string; line: number; file: string; tree: string; emitted: string[] }>()

for (const file of files) {
  const text = execFileSync("git", ["-C", CORPUS, "show", `HEAD:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const res = await parseFile(`${CORPUS}/${file}`, ROOT).catch(() => null)
  const rels = (res?.relationships ?? []) as any[]
  const tree = parser.parse(text)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n: any = stack.pop()
    if (!n) continue
    if (GAPS.includes(n.type)) {
      // structural signature: type + child types + field names, no text
      const kids: string[] = []
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        const f = n.fieldNameForChild(i)
        kids.push(f ? `${f}:${c.type}` : c.type)
      }
      const signature = `${n.type}(${kids.join(",")})`
      if (!shapes.has(signature)) {
        const line = n.startPosition.row + 1
        shapes.set(signature, {
          gap: n.type,
          signature,
          example: file,
          line,
          file,
          tree: n.toString().slice(0, 400),
          emitted: rels
            .filter((r) => (r.line_number ?? -1) === line)
            .map((r) => `${r.type} ${r.source}->${r.target}`)
            .slice(0, 6),
        })
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

console.log("=== gap shapes, deduped by structure (no text) ===\n")
for (const gap of GAPS) {
  const rows = [...shapes.values()].filter((s) => s.gap === gap)
  if (rows.length === 0) {
    console.log(`--- ${gap}: no distinct shape observed`)
    continue
  }
  console.log(`--- ${gap}: ${rows.length} distinct shape(s)`)
  for (const r of rows) {
    console.log(`  shape : ${r.signature}`)
    console.log(`  site  : ${r.file}:${r.line}`)
    console.log(`  tree  : ${r.tree.replace(/\n\s*/g, " ")}`)
    console.log(`  emitted on that line: ${r.emitted.length ? r.emitted.join(" | ") : "(NOTHING)"}`)
    console.log()
  }
}
