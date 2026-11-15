// The round-11 change adds `\` + newline to `extras`. An `extras` token is
// visible to the lexer everywhere, so the risk is that it interferes with
// backslashes INSIDE literals. These are the cases that would break, written in
// real source files rather than through shell quoting.
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const CASES: Array<[string, string]> = [
  ["trailing backslash continuation (the fix)",
    'class W {\n    def m(a, b) {\n        def t = a + \\\n            b\n        return t\n    }\n}\n'],
  ["lone backslash on its own line (the corpus case)",
    'class W {\n    def m() {\n        def a = 1\n\\\n        def b = 2\n        return b\n    }\n}\n'],
  ["escaped double quote in a string",
    'class W {\n    def m() {\n        return "a\\"b"\n    }\n}\n'],
  ["escaped backslash in a string",
    'class W {\n    def m() {\n        return "a\\\\b"\n    }\n}\n'],
  ["backslash-newline INSIDE a string (must stay literal)",
    'class W {\n    def m() {\n        return "a\\\nb"\n    }\n}\n'],
  ["slashy regex with escapes",
    'class W {\n    def m() {\n        return ~/a\\d+\\s*b/\n    }\n}\n'],
  ["dollar-slashy with escapes",
    'class W {\n    def m() {\n        return $/a\\d+$/\n    }\n}\n'],
  ["triple-quoted string with escapes",
    'class W {\n    def m() {\n        return """a\\"b"""\n    }\n}\n'],
  ["single-quoted with escaped quote",
    "class W {\n    def m() {\n        return 'a\\'b'\n    }\n}\n"],
  ["character escape in a GString",
    'class W {\n    def m(x) {\n        return "a\\"${x}"\n    }\n}\n'],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  for (const [name, src] of CASES) {
    const root = parser.parse(src)?.rootNode
    console.log(`${(root?.hasError ? "REJECTS" : "accepts").padEnd(8)} ${name}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
