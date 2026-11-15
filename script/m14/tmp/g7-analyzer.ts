import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const SRC = `class Notifier {
    String templateField
    String style

    String render(user, count) {
        def local = 1
        def text = "a \${templateField} b \$style c \${local} d \${user.name} e \${count} f"
        def extra = "g \${user.notify()} h"
        def closureRead = { -> "\$local and \$it" }
        def single = '\${templateField} \$style'
        return text + extra + closureRead + single
    }

    String nested() {
        def inner = { ->
            def outerLocal = "x"
            return "\$outerLocal"
        }
        return "\$templateField"
    }
}
`

async function main(): Promise<void> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const root = parser.parse(SRC)?.rootNode
  const a = new RealGroovyAnalyzer()
  const res: any = a.analyze(root!, SRC, "t.groovy")
  console.log("hasError:", root?.hasError)
  console.log("--- uses / calls edges ---")
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType)
    if (t === "uses" || t === "calls") {
      console.log(`${t.padEnd(6)} ${String(r.source).padEnd(14)} -> ${String(r.target).padEnd(18)} line=${r.line_number} ${JSON.stringify(r.metadata ?? {})}`)
    }
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
