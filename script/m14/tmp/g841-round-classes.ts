// #841 residual: reduce the two biggest remaining first-error classes to minimal
// triggers. `@T` (19 files) and the class-declaration line (11 + 10 files) are
// recovery points; the cause has to be found by reducing the surrounding source.
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const CASES: Array<{ name: string; src: string }> = [
  { name: "annotated class, one annotation", src: `@Slf4j\nclass A {}\n` },
  { name: "annotated class, two annotations", src: `@Slf4j\n@CompileStatic\nclass A {}\n` },
  { name: "annotated class, annotation with args", src: `@SuppressWarnings("x")\nclass A {}\n` },
  { name: "annotated class, two annotations with dot names", src: `@java.lang.SuppressWarnings("x")\n@grails.compiler.GrailsCompileStatic\nclass A {}\n` },
  { name: "static star import", src: `package p\n\nimport static org.junit.jupiter.api.Assertions.*\n\nclass A {\n}\n` },
  { name: "static star import + static member import", src: `import static org.junit.jupiter.api.Assertions.*\nimport static java.util.Collections.emptyList\n\nclass A {}\n` },
  { name: "plain star import", src: `import org.junit.jupiter.api.*\n\nclass A {}\n` },
  { name: "static import no star", src: `import static org.junit.jupiter.api.Assertions.assertEquals\n\nclass A {}\n` },
]

async function main() {
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const dir = mkdtempSync(path.join(tmpdir(), "g841r-"))
  for (const c of CASES) {
    const file = path.join(dir, "T.groovy")
    writeFileSync(file, c.src)
    let verdict: string
    try {
      const res: any = await ASTEngine.parseFile(file, c.src)
      const errs = (res as any)?.parseErrors ?? (res as any)?.errorFiles
      verdict = `OK symbols=${res?.symbols?.length ?? "?"} rels=${res?.relationships?.length ?? "?"}${errs !== undefined ? ` parseErrors=${errs}` : ""}`
    } catch (e: any) {
      verdict = `THROW ${String(e?.message ?? e).slice(0, 80)}`
    }
    console.log(`${verdict.padEnd(46)} ${c.name}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
