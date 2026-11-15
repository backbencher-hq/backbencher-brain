// #924 node shapes — WHICH node carries the name, and where the quoting syntax lives.
//
// The name-surface probe (`c924-name-surface-probe.ts`) says which published STRINGS are wrong
// and on which source lines; it cannot say which node type carries them, and that is what decides
// the fix: stripping at every `.text` site is a different change from descending to a
// `quoted_identifier`/`identifier` node, and for haskell/elixir the shape is not about quoting at
// all. This probe parses five snippets taken verbatim from the corpus sites the census flagged and
// prints the node that carries each offending string, its type, its parent chain, and whether its
// own `.text` includes the quoting characters.
//
// Read-only, production entry (`parseFile`), one snippet per lane. Run:
//   bun script/m14/tmp/c924-node-shapes.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../src/ast/engine"

const CASES: { lang: string; ext: string; what: string; src: string }[] = [
  {
    lang: "kotlin", ext: ".kt",
    what: "Q: a backticked function name; E: a call chain ending in .single()",
    src: "class T {\n  fun `test char column read and write`() {\n    assertEquals(1, dest.selectAll().where { dest.id eq 1 }.single()[dest.id].value)\n  }\n}\n",
  },
  {
    lang: "scala", ext: ".scala",
    what: "Q: a backticked def name; E: an anonymous class whose parent is a call with arguments",
    src: "class T {\n  @Test def `object` = { assertEquals(1, 1) }\n  def f = new ScalaRandom(Applicative.pure(new JavaSecureRandom())) with SecureRandom\n}\n",
  },
  {
    lang: "zig", ext: ".zig",
    what: "Q: the @\"…\" sigil on a declaration and on a field access",
    src: "fn @\"weird function name\"() i32 {\n    return 1;\n}\ntest \"x\" {\n    _ = @TypeOf(a.foo).@\"fn\".return_type;\n}\n",
  },
  {
    lang: "haskell", ext: ".hs",
    what: "E: an instance head whose type application becomes the published class name",
    src: "instance (GArbitrarySum f, i ~ D) => GArbitrary (M1 i c f) where\n  gArbitrary = undefined\n",
  },
  {
    lang: "elixir", ext: ".ex",
    what: "E: a definition head split across lines by a comment",
    src: "defmodule M do\n  defp f([char | rest], counter)\n       # 7..13 is the range. 32..126 are ASCII printables.\n       when is_integer(char) and char >= 7 do\n    f(rest, counter)\n  end\nend\n",
  },
]

const strip = (s: string) => s.replace(/\s+/g, " ").slice(0, 88)

for (const c of CASES) {
  if (!fs.existsSync(path.dirname("x"))) { /* no-op: keeps path import used */ }
  const fake = `/tmp/c924-shape-probe/${c.lang}/sample${c.ext}`
  console.log(`\n=== ${c.lang} — ${c.what}`)
  let r: any
  try { r = await parseFile(fake, c.src) } catch (e: any) { console.log(`  parse threw: ${e?.message ?? e}`); continue }
  // The analyzer's own output for this snippet: which strings did IT publish?
  const names = (r.symbols ?? []).map((s: any) => String(s.name))
  const targets = (r.relationships ?? []).map((x: any) => `${x.type}:${String(x.target)}`)
  const bad = [...new Set([...names, ...targets.map((t) => t.split(":").slice(1).join(":"))].filter((t) => /`|@"|\s|[()[\]{},]/.test(t)))]
  console.log(`  published symbols: ${names.length}, relationships: ${(r.relationships ?? []).length}`)
  console.log(`  offending published strings (${bad.length}):`)
  for (const b of bad.slice(0, 8)) console.log(`     ${JSON.stringify(strip(b))}`)
  // And the TREE: the node whose text is the offending string, with its parent chain.
  const root = (r as any).rootNode ?? null
  if (!root) { console.log("  (no rootNode exposed by parseFile — tree walk skipped)"); continue }
  const hits: any[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    const t = String(n.text ?? "").replace(/\s+/g, " ")
    if (/`|@"/.test(t) && t.length < 80) hits.push(n)
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  for (const h of hits.slice(0, 6)) {
    const chain: string[] = []
    let p = h
    for (let d = 0; d < 4 && p; d++) { chain.push(String(p.type)); p = p.parent }
    console.log(`  tree: <${h.type}> ${JSON.stringify(strip(String(h.text)))}  chain=${chain.join(" <- ")}`)
  }
}
