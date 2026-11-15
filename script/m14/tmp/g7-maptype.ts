import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["(Integer)", "def m = [(Integer): 1]\n"],
  ["(Byte[])", "def m = [(Byte[]): 1]\n"],
  ["(String[])", "def m = [(String[]): 1]\n"],
  ["(int[])", "def m = [(int[]): 1]\n"],
  ["(a.b[])", "def m = [(a.b[]): 1]\n"],
  ["bare-array-class", "def x = Byte[].class\n"],
  ["new-map-paren-key", "def m = new HashMap<Integer, String>([(Byte[]): 1])\n"],
  ["(x)", "def m = [(x): 1]\n"],
  ["(x.y)", "def m = [(x.y): 1]\n"],
  ["(1+2)", "def m = [(1 + 2): 1]\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`${name.padEnd(22)} ${root?.hasError ? "FAIL" : "ok  "}  ${JSON.stringify(src.trim())}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
