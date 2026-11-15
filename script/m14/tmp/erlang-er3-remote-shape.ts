// Probe: exact shape of `Mod:type()` (remote type application) and of a record
// TYPE, in the pinned grammar — the ER3 walk must push `mod:type` and must not
// treat a record type as a construction.
import { Parser, Language } from "web-tree-sitter"

const SRC = `-module(p).
-type ext() :: dict:dict().
-type ext2() :: dict:dict(atom).
-type ext3() :: sets:set(_).
-type rt() :: #ctx{server :: pid()}.
-record(ctx, {server = self()}).
`

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const tree = parser.parse(SRC)!
  const dump = (n: any, depth: number, max: number) => {
    if (depth > max) return
    const pad = "  ".repeat(depth)
    console.log(`${pad}${n.type}${n.isNamed ? "" : " (anon)"} ${n.childCount === 0 ? JSON.stringify(n.text) : ""}`)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), depth + 1, max)
  }
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "type_alias") { dump(n, 0, 5); console.log("---") }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
  parser.delete()
}

main().catch((e) => { console.error(e); process.exit(1) })
