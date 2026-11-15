import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["exact line", 'throw new IllegalArgumentException("Invalid type specified. ${type.name()} is not a valid query type")\n'],
  ["assign-call", 'def s = "${type.name()}"\n'],
  ["assign-call-suffix", 'def s = "${type.name()} is not"\n'],
  ["ctor-arg", 'throw new IllegalArgumentException("a ${type.name()} b")\n'],
  ["parens-arg", 'foo("a ${type.name()} b")\n'],
  ["new-simple", 'def e = new IllegalArgumentException("a ${x} b")\n'],
  ["method-arg", 'def e = f("a ${x.y()} b")\n'],
  ["dotted-in-args", 'foo("a ${a.b.c()} b")\n'],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`${name.padEnd(20)} ${root?.hasError ? "FAIL" : "ok  "}`)
    if (root?.hasError) console.log(`   ${(root?.toString() ?? "").replace(/\n/g, " ").slice(0, 200)}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
