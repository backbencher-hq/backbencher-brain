// go (round 4) — the OWNER of the 2 `calls` rows the depth comparison keeps
// finding (go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/
// slicesbackward.go: `s[i].Lock()` / `s[i].Unlock()`).
//
// The snippet form of that function IS emitted by the analyzer and derived by the
// oracle (`go-799-lockcall.ts`), so the mechanism is in the FILE, not the shape.
// This prints, for the real file: every ERROR node's line span, and for the calls
// the analyzer does and does not publish, the ASCII ancestor chain — so the
// suppression is read off the tree instead of guessed at.
//
// Run: bun script/m14/tmp/go-799-errline.ts [file]
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const REAL =
  process.argv[2] ??
  "<corpus-root>/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go"
const src = fs.readFileSync(REAL, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree: any = parser.parse(src)
const root = tree.rootNode

const errs: Array<{ start: number; end: number; text0: string }> = []
const stack: any[] = [root]
while (stack.length) {
  const n: any = stack.pop()
  if (n.type === "ERROR" || n.isMissing) {
    errs.push({
      start: n.startPosition.row + 1,
      end: n.endPosition.row + 1,
      text0: n.text.split("\n")[0].slice(0, 60),
    })
  }
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
}
errs.sort((a, b) => a.start - b.start)
console.log(`ERROR/missing node(s): ${errs.length}`)
for (const e of errs) console.log(`  lines ${e.start}-${e.end}: ${JSON.stringify(e.text0)}`)

const res: any = await new RealGoAnalyzer().analyze(root, src, REAL)
const emitted = new Set(
  (res.relationships ?? [])
    .filter((r: any) => String(r.type) === "calls")
    .map((r: any) => `${String(r.target)}`),
)

// Every call whose text names Lock/Unlock/String/StringPtr, with its ancestors.
const calls: any[] = []
const stack2: any[] = [root]
while (stack2.length) {
  const n: any = stack2.pop()
  if (n.type === "call_expression") calls.push(n)
  for (let i = 0; i < n.namedChildCount; i++) stack2.push(n.namedChild(i))
}
calls.sort((a, b) => a.startPosition.row - b.startPosition.row)
for (const c of calls) {
  const txt = c.text.replace(/\s+/g, " ").slice(0, 40)
  const leaf = c.text.split("(")[0].split(".").pop()!.trim()
  const chain: string[] = []
  for (let p: any = c.parent; p; p = p.parent) chain.push(p.type)
  const inError = chain.includes("ERROR")
  const line = c.startPosition.row + 1
  const published = emitted.has(leaf) ? "EMITTED" : "absent "
  const mark = inError || published === "EMITTED" ? " <--" : ""
  console.log(
    `line ${String(line).padStart(4)}  ${published}  ${JSON.stringify(txt)}  under=${chain.slice(0, 4).join(">")}${inError ? " [IN-ERROR]" : ""}${mark}`,
  )
}
