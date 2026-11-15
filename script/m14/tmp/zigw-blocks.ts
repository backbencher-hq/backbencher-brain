/**
 * ZIG WAVE 1 PROBE — EXECUTABLE-BODY LEAKS and OPAQUE OWNERSHIP.
 *
 * Usage: npx tsx script/m14/tmp/zigw-blocks.ts [files]
 *
 * The analyzer's own contract (ZGD3): a `var`/`const` inside an EXECUTABLE body
 * is an execution artifact and must NOT become a symbol. `test` and `comptime`
 * blocks set the executable flag. A LABELED BLOCK on the RHS of a
 * container-scope declaration (`const Val = blk: { var tmp: u32 = 3; ... };`)
 * is the same kind of body reached by a different grammar path, so it is
 * measured here: how many declaration-site symbols does it mint, and who owns
 * them?
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer, sym } from "./zigw-harness"

const BLOCKISH = new Set(["block", "block_expression", "labeled_type_expression", "switch_expression", "if_expression", "while_expression", "for_expression", "catch_expression"])

async function main(): Promise<void> {
  await init()
  const limit = Number(process.argv[2] ?? 400)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)
  let rhsBlocks = 0
  let rhsBlockEx: string[] = []
  const leaked = new Map<string, { n: number; ex: string[] }>()
  let opaqueContainers = 0
  let opaqueMembers = 0
  let opaqueMembersOwned = 0
  const opaqueEx: string[] = []
  let comptimeExprs = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const res: any = analyzer().analyze(root, src, f)
    const syms = res.symbols as any[]
    const symbolLines = new Map<number, any[]>()
    for (const s of syms) {
      const ln = s.range?.startLine
      if (ln) {
        const list = symbolLines.get(ln) ?? []
        list.push(s)
        symbolLines.set(ln, list)
      }
    }
    // find container-scope variable_declarations whose RHS contains a block
    const visit = (n: any, inFn: boolean): void => {
      if (n.type === "variable_declaration" && !inFn) {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        if (kids.length > 0 && kids[0].type === "identifier" && kids[0].text !== "_") {
          const rhs = kids[kids.length - 1]
          if (BLOCKISH.has(rhs.type)) {
            rhsBlocks++
            if (rhsBlockEx.length < 8) rhsBlockEx.push(`${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}  ${n.text.replace(/\s+/g, " ").slice(0, 88)}`)
            // what symbols were minted INSIDE this declaration's span?
            for (const s of syms) {
              const ln = s.range?.startLine ?? 0
              if (ln > n.startPosition.row + 1 && ln <= n.endPosition.row + 1) {
                const key = `${rhs.type}|${s.kind}|owned=${s.ownerName ? "yes" : "no"}`
                const d = leaked.get(key)
                if (d) { d.n++; if (d.ex.length < 3) d.ex.push(`${f.split("/").slice(-2).join("/")}:${ln} ${s.name}`) }
                else leaked.set(key, { n: 1, ex: [`${f.split("/").slice(-2).join("/")}:${ln} ${s.name}`] })
              }
            }
          }
          if (rhs.type === "opaque_declaration") {
            opaqueContainers++
            if (opaqueEx.length < 5) opaqueEx.push(`${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}  ${rhs.text.replace(/\s+/g, " ").slice(0, 60)}`)
            for (const s of syms) {
              const ln = s.range?.startLine ?? 0
              if (ln > n.startPosition.row + 1 && ln <= n.endPosition.row + 1) {
                opaqueMembers++
                if (s.ownerName === kids[0].text) opaqueMembersOwned++
              }
            }
          }
        }
        if (kids.length > 0 && kids[0].type === "identifier" && kids[kids.length - 1].type === "comptime_expression") comptimeExprs++
      }
      const childInFn = inFn || n.type === "function_declaration" || n.type === "test_declaration" || n.type === "comptime_declaration" || n.type === "function_signature"
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, childInFn)
      }
    }
    visit(root, false)
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  console.log(`\n=== container-scope declarations whose RHS is a block-ish expression: ${rhsBlocks} ===`)
  for (const e of rhsBlockEx) console.log(`   ${e}`)
  console.log(`\n=== symbols minted INSIDE those bodies (the leak) ===`)
  for (const [k, v] of [...leaked.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`\n${String(v.n).padStart(6)}  ${k}`)
    for (const e of v.ex) console.log(`        ${e}`)
  }
  console.log(`\n=== opaque containers: ${opaqueContainers}; members inside: ${opaqueMembers}; owned by the opaque type: ${opaqueMembersOwned} ===`)
  for (const e of opaqueEx) console.log(`   ${e}`)
  console.log(`\n=== container-scope comptime RHS: ${comptimeExprs} ===`)
  void sym
}
void main()
