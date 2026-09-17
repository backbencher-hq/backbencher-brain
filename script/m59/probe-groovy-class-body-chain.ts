// Bracket the leading-dot chain failure: which chain lengths / contexts fail.
// Each case is a full source; FAIL = tree.rootNode.hasError.
import { ASTEngine } from "../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["1: assign + 1 dot", `class A {
    void m() {
        def b = pm.builder()
            .excludeTimestamps()
    }
}
`],
  ["2: assign + 2 dots", `class A {
    void m() {
        def b = pm.builder()
            .excludeTimestamps()
            .excludeVersion()
    }
}
`],
  ["3: assign + 3 dots", `class A {
    void m() {
        def b = pm.builder()
            .excludeTimestamps()
            .excludeVersion()
            .excludeIdentifiers(true)
    }
}
`],
  ["4: typed assign + 1 dot", `class A {
    void m() {
        Foo.Builder b = pm.builder()
            .excludeTimestamps()
    }
}
`],
  ["5: bare stmt + 1 dot", `class A {
    void m() {
        pm.builder()
            .excludeTimestamps()
    }
}
`],
  ["6: bare stmt + 2 dots", `class A {
    void m() {
        pm.builder()
            .excludeTimestamps()
            .excludeVersion()
    }
}
`],
  ["7: class field + 1 dot", `class A {
    Foo b = pm.builder()
        .excludeTimestamps()
}
`],
  ["8: class field + 2 dots", `class A {
    Foo b = pm.builder()
        .excludeTimestamps()
        .excludeVersion()
}
`],
  ["9: 1 dot no args", `class A {
    void m() {
        def b = pm.builder()
            .exclude
    }
}
`],
  ["10: semicolon-terminated stmt + 2 dots", `class A {
    void m() {
        pm.builder();
            .excludeTimestamps()
            .excludeVersion()
    }
}
`],
  ["11: same-line chain (control)", `class A {
    void m() {
        def b = pm.builder().excludeTimestamps().excludeVersion()
    }
}
`],
  ["12: return + 2 dots", `class A {
    def m() {
        return pm.builder()
            .excludeTimestamps()
            .excludeVersion()
    }
}
`],
  ["13: assignment value = chain, 2 dots", `class A {
    void m() {
        x = pm.builder()
            .excludeTimestamps()
            .excludeVersion()
    }
}
`],
  ["14: elvis-assign + 2 dots", `class A {
    void m() {
        def b = pm.builder() ?: other
            .excludeTimestamps()
            .excludeVersion()
    }
}
`],
]

async function main(): Promise<void> {
  for (const [label, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    const bad = root?.hasError === true
    let first = ""
    if (bad) {
      const visit = (n: any) => {
        if (first) return
        if (n.type === "ERROR" || n.isMissing === true) {
          first = `${n.isMissing ? "MISSING" : "ERROR"} ${n.type} row ${n.startPosition.row + 1} :: ${JSON.stringify((n.text || "").slice(0, 40))}`
          return
        }
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
      }
      visit(root)
    }
    console.log(`${bad ? "FAIL" : "ok  "}  ${label.padEnd(38)} ${first}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
