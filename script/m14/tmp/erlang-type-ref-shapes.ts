// Probe: what does the pinned Erlang grammar produce for the type expressions
// the ER-D10 walk visits? Settles whether a map field KEY is distinguishable
// from a type NAME by shape — i.e. whether `-type job() :: #{id := job_id(),
// kind := atom()}` really is two type references plus two field declarations,
// or four atoms the walk cannot tell apart. ER3 adjudication evidence.
import { Parser, Language } from "web-tree-sitter"

const SRC = `-module(probe).

-type job_id() :: integer().
-type job() :: #{id := job_id(), kind := atom()}.
-type pair(A, B) :: {A, B}.
-type rec() :: #state{q :: [job()]}.
-opaque hid() :: binary().
-type extern() :: Mod:type().

-record(state, {q :: [job()], r :: #job{}}).

f() -> ok.
`

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const tree = parser.parse(SRC)!

  const dump = (n: any, depth: number, max: number) => {
    if (depth > max) return
    const pad = "  ".repeat(depth)
    const text = n.childCount === 0 ? JSON.stringify(n.text) : ""
    console.log(`${pad}${n.type}${n.isNamed ? "" : " (anon)"} ${text}`)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), depth + 1, max)
  }
  dump(tree.rootNode, 0, 7)

  console.log("\n== every atom node, with its parent chain ==")
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "atom" || n.type === "type_name") {
      const parents: string[] = []
      let p = n.parent
      while (p && parents.length < 6) { parents.push(p.type); p = p.parent }
      console.log(`  ${n.type} ${JSON.stringify(n.text)} <- ${parents.join(" < ")}`)
    }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
