// hs-qualified-superclass-probe.ts — the hledger depth draw's one MISSING edge:
//
//   hledger-lib/Hledger/Write/Html/HtmlCommon.hs :: extends Lines -> Spr.Lines
//
// The source is `class (Spr.Lines border) => Lines border where`. #872 taught
// processClass to walk a constraint TREE (tuple, parens, forall, applied heads),
// but every shape it was taught carries a BARE class name in the context. This
// probe asks the only question that matters: is the gap the QUALIFIER, or is it
// the class-declaration body, or is the whole declaration unparsed? It prints the
// raw sexp of the context subtree beside the analyzer's own extends edges, so the
// answer is read off the pinned grammar rather than assumed from it.
//
//   bun script/m14/tmp/hs-qualified-superclass-probe.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const CASES: Array<{ id: string; src: string }> = [
  { id: "bare (known-good, #872)", src: `class (Lines border) => Loud border where\n  borderLines :: border -> Int\n` },
  { id: "qualified (the hledger shape)", src: `class (Spr.Lines border) => Lines border where\n  borderLines :: border -> [Int]\n` },
  { id: "qualified, no body", src: `class (Spr.Lines border) => Lines border where\n` },
  { id: "qualified in a tuple", src: `class (Spr.Lines a, Show a) => Two a where\n  two :: a -> Int\n` },
  { id: "multi-segment qualifier", src: `class (A.B.C a) => Deep a where\n  deep :: a -> Int\n` },
  { id: "bare + qualified mixed", src: `class (Show f, Spr.Lines b) => Mixed f b where\n  mixed :: f -> b -> Int\n` },
  { id: "qualified instance head (control)", src: `instance Spr.Lines Int where\n  borderLines _ = []\n` },
  { id: "pure bare tuple (control for #872)", src: `class (Show f, Eq f) => Both f where\n  both :: f -> Int\n` },
  { id: "bare, qualified second in tuple", src: `class (Show f, Spr.Lines f) => Mix2 f where\n  mix2 :: f -> Int\n` },
  { id: "qualified only, tuple of one", src: `class (Spr.Lines f) => One f where\n  one :: f -> Int\n` },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-haskell.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-haskell-analyzer"))

  for (const c of CASES) {
    const p = new P()
    p.setLanguage(LANG)
    const tree = p.parse(c.src)
    const root = tree.rootNode
    // Walk in: the grammar nests top-level declarations, so find the first
    // descendant the declaration actually is rather than assuming a depth.
    const all: any[] = []
    const walk = (n: any) => { all.push(n); for (const ch of n.namedChildren) walk(ch) }
    walk(root)
    const decl = all.find((n: any) => n.type === "class" || n.type === "instance")
    const ctx = decl?.namedChildren.find((n: any) => n.type === "context")
    console.log(`\n=== ${c.id} ===`)
    console.log(`  source: ${JSON.stringify(c.src.split("\n")[0])}`)
    console.log(`  root:  ${root.toString().replace(/\n/g, " ").slice(0, 260)}`)
    console.log(`  decl=${decl?.type ?? "(none)"}  errors=${root.hasError}`)
    console.log(`  ctx:   ${ctx ? ctx.toString().replace(/\n/g, " ") : "(no context node)"}`)
    const res = await new mod.RealHaskellAnalyzer().analyze(root, c.src, "Probe.hs")
    const rels = (res.relationships ?? [])
    console.log(`  analyzer relationships: ${rels.length === 0 ? "(none)" : rels.map((e: any) => `${e.type}[${e.source}->${e.target}]`).join(", ")}`)
  }
}
main()
