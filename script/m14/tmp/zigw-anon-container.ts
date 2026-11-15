/**
 * ZIG WAVE 2 PROBE — ANONYMOUS CONTAINER EXPRESSIONS (Z-class, found by the
 * post-fix residual of the executable-body sweep).
 *
 * A container declaration is only recognised as a container when it is the RIGHT
 * HAND SIDE of a `const`/`var`. The same node reached as an EXPRESSION — the
 * branch of an `if`/`switch`, a struct literal in a prune
 * (`(struct { inline fn assert(…) void {…} }).assert`) — establishes no
 * container, so the declarations inside it are published at the enclosing scope:
 * `pub const RtPreExecInfo = if (c) A else struct { pub inline fn init(…) }`
 * publishes `init` as a free file-scope Function.
 *
 * The analyzer already ruled this SHAPE for the generic-function case ("methods
 * of an anonymous struct returned by a generic function must not become
 * file-scope functions"), so the question is only whether the rule reaches the
 * expression path. This probe counts the population both ways.
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

const CONTAINERS = new Set(["struct_declaration", "union_declaration", "enum_declaration", "error_set_declaration", "opaque_declaration"])

async function main(): Promise<void> {
  await init()
  const limit = Number(process.argv[2] ?? 900)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)
  let containers = 0
  let asRhs = 0
  let asExpression = 0
  const exprEx: string[] = []
  const insideByKind = new Map<string, number>()
  let insideOwned = 0
  let insideTotal = 0
  const insideEx: string[] = []

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const syms = res.symbols as any[]
    const visit = (n: any): void => {
      if (CONTAINERS.has(n.type)) {
        containers++
        const p = n.parent
        const isRhs = !!p && p.type === "variable_declaration" && p.namedChildCount > 0 && p.namedChild(p.namedChildCount - 1)?.id === n.id
        if (isRhs) asRhs++
        else {
          asExpression++
          if (exprEx.length < 8) {
            const line = src.split("\n")[n.startPosition.row] ?? ""
            exprEx.push(`${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}  ${n.type} in ${p?.type}  |  ${line.trim().slice(0, 76)}`)
          }
          // symbols whose range falls inside this container
          for (const s of syms) {
            const ln = s.range?.startLine ?? 0
            if (ln > n.startPosition.row + 1 && ln <= n.endPosition.row + 1) {
              insideByKind.set(s.kind, (insideByKind.get(s.kind) ?? 0) + 1)
              insideTotal++
              if (s.ownerName) insideOwned++
              if (insideEx.length < 8) insideEx.push(`${f.split("/").slice(-2).join("/")}:${ln} ${s.kind} ${s.name} owner=${s.ownerName ?? "-"}`)
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  console.log(`container declarations: ${containers} (as a const RHS: ${asRhs}, as an EXPRESSION: ${asExpression})`)
  console.log(`\n=== expression-position containers (first 8) ===`)
  for (const e of exprEx) console.log(`   ${e}`)
  console.log(`\n=== symbols inside expression-position containers: ${insideTotal} (owned ${insideOwned}) ===`)
  for (const [k, v] of [...insideByKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(5)}  ${k}`)
  for (const e of insideEx) console.log(`   ${e}`)
}
void main()
