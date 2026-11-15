// The member bisection says the MEMBERS ARE INNOCENT: rebuilding every member as
// `class W { … }` parses clean while the file fails. So the trigger lives in what the
// rebuild dropped — package, imports, the javadoc, the annotations, or the class
// declaration. This probe adds them back one group at a time, from the real file.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("usage: bun script/m14/tmp/g841-header-probe.ts <file.groovy>")
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const parser = await ASTEngine.getParser("groovy")
  const lines = readFileSync(file, "utf8").split("\n")
  const dir = mkdtempSync(path.join(tmpdir(), "g841h-"))

  const slice = (a: number, b: number) => lines.slice(a - 1, b).join("\n")
  const CASES: Array<{ name: string; src: string }> = [
    { name: "package only", src: slice(16, 16) + "\nclass X {}\n" },
    { name: "imports only", src: slice(18, 37) + "\nclass X {}\n" },
    { name: "annotations + class decl, empty body", src: slice(45, 47) + "\n}\n" },
    { name: "javadoc + annotations + class decl, empty body", src: slice(39, 47) + "\n}\n" },
    { name: "package + imports + annotations + empty class", src: slice(16, 47) + "\n}\n" },
    // THE DECISIVE PAIR: the same body text, once under the REAL class declaration
    // (annotations + name) and once under a RENAMED one. If the renamed copy parses
    // while the real one does not, the failure is header/body interaction; if both
    // fail, the body itself carries it and the member sweep was not faithful.
    { name: "REAL class decl + raw body verbatim", src: slice(45, lines.length) },
    { name: "RENAMED class decl + same raw body verbatim", src: `@Slf4j\n@CompileStatic\nclass W {\n` + lines.slice(47, lines.length - 1).join("\n") + "\n}\n" },
    { name: "no annotations, renamed, same raw body", src: `class W {\n` + lines.slice(47, lines.length - 1).join("\n") + "\n}\n" },
    { name: "everything except the license header", src: slice(16, lines.length) },
    { name: "the whole file", src: lines.join("\n") },
  ]

  for (const c of CASES) {
    const f = path.join(dir, "C.groovy")
    writeFileSync(f, c.src)
    const root = parser.parse(c.src)?.rootNode
    const bad = !!root?.hasError
    let where = ""
    if (bad) {
      const err = (function first(n: any): any {
        if (n.type === "ERROR" || n.isMissing) return n
        for (const k of n.namedChildren ?? []) {
          const hit = first(k)
          if (hit) return hit
        }
        return null
      })(root)
      where = err ? ` first failing node row ${err.startPosition.row + 1}: ${JSON.stringify((err.text || "").split("\n")[0].slice(0, 60))}` : ""
    }
    console.log(`${(bad ? "FAIL" : "ok  ").padEnd(5)} ${c.name.padEnd(48)} (${c.src.split("\n").length} lines)${where}`)
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
