// Narrow the two ambiguous residual classes.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  // class: method ref inside a typed-param closure (+ trailing chain)
  ["A1 full", "gdoc.classpath = files(sources.collect { SourceSet it -> it.compileClasspath.filter(File.&isDirectory) }.flatten().unique())\n"],
  ["A2 no-chain", "def x = sources.collect { SourceSet it -> it.compileClasspath.filter(File.&isDirectory) }\n"],
  ["A3 typed-param-only", "def x = sources.collect { SourceSet it -> it.name }\n"],
  ["A4 methodref-outside", "def x = sources.collect { it.compileClasspath.filter(File.&isDirectory) }\n"],
  ["A5 methodref-plain", "def x = list.filter(File.&isDirectory)\n"],
  ["A6 typed-param-methodref", "def x = list.collect { SourceSet it -> File.&isDirectory }\n"],
  ["A7 chain-after-closure", "def x = sources.collect { SourceSet it -> it.name }.flatten().unique()\n"],
  // class: replace with an escaped backslash in a single-quoted string
  ["B1 full", "tasks.named(n).get().classpath.files.collect { it.absolutePath.replace('\\\\', '/') }\n"],
  ["B2 assign", "def x = list.collect { it.absolutePath.replace('\\\\', '/') }\n"],
  ["B3 plain", "def x = a.replace('\\\\', '/')\n"],
  ["B4 no-escape", "def x = a.replace('x', '/')\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`${name.padEnd(24)} ${root?.hasError ? "FAIL" : "ok  "}  ${src.trim().slice(0, 70)}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
