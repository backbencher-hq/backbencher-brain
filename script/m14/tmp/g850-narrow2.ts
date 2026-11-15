import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  // A: typed closure param + call-taking-methodref
  ["A10 typed+methodrefarg", "def x = a.collect { SourceSet it -> it.cp.filter(File.&isDir) }\n"],
  ["A11 typed+methodrefarg2", "def x = a.collect { T it -> it.b.c(File.&d) }\n"],
  ["A12 typed+plainarg", "def x = a.collect { SourceSet it -> it.cp.filter(File) }\n"],
  ["A13 untyped+methodrefarg", "def x = a.collect { it.cp.filter(File.&isDir) }\n"],
  ["A14 typed+mref-decl", "def x = a.collect { SourceSet it -> f(File.&isDir) }\n"],
  // B: chain tail calling with a closure
  ["B10 chain-conf-tail", "def x = tasks.named(n).get().cp.files.collect { it.name }\n"],
  ["B11 short-chain", "def x = a.b.c() { it.name }\n"],
  ["B12 chain-two", "def x = a.b().c() { it.name }\n"],
  ["B13 chain-no-closure", "def x = tasks.named(n).get().cp.files\n"],
  ["B14 chain-props", "def x = a.b.c.d.collect { it.name }\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`${name.padEnd(26)} ${root?.hasError ? "FAIL" : "ok  "}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
