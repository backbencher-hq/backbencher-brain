// #841 demand-side probe: minimal repros for the classes the LIVE corpus shows,
// extending the synthetic g841-repro. Run: bun script/m14/tmp/g841-repro2.ts
import * as fs from "fs"

const WASM = "wasm/tree-sitter-groovy.wasm"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(WASM))
  const parser = new P(); parser.setLanguage(lang)

  const cases: { cls: string; src: string }[] = [
    {
      cls: "A. leading-dot chain continuation (Groovy 3)",
      src: `def b = X.f()\n    .g(1)\n    .h(2)\n`,
    },
    {
      cls: "B. license header /* ... */ with @author lines",
      src: `/*\n * Licensed to the Apache Software Foundation (ASF) under one\n * or more contributor license agreements.\n *\n * Licensed under the Apache License, Version 2.0 (the "License");\n */\ndef k = 1\n`,
    },
    {
      cls: "C. string containing } alone-ish line: label('}')",
      src: `def l = '}'\ndef m = "{"\n`,
    },
    {
      cls: "D. range with negative literal [1..-2]",
      src: `def s = 'abc'\ndef p = s[1..-2]\n`,
    },
    {
      cls: "D2. range-by negative",
      src: `def r = (5..1).step(-1)\n`,
    },
    {
      cls: "E. license header with license URL quotes + parens",
      src: `/*\n * Licensed under the Apache License, Version 2.0 (the "License");\n * you may not use this file except in compliance with the License.\n * You may obtain a copy of the License at\n *\n *     http://www.apache.org/licenses/LICENSE-2.0\n *\n */\ndef go() {}\n`,
    },
    {
      cls: "F. triple-quoted dollar-slashy control",
      src: `def rx = $/a/b/$\ndef t = '''multi\nline'''\n`,
    },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
    if (bad) {
      // print the ERROR/MISSING nodes with rows
      const rows: string[] = []
      const walk = (n: any) => {
        if (n.type === "ERROR" || n.isMissing) rows.push(`  row ${n.startPosition.row + 1} ${n.type}${n.isMissing ? " (missing " + n.type + ")" : ""}: ${JSON.stringify((n.text || "").slice(0, 60))}`)
        const nc = n.namedChildren ?? []
        for (const ch of nc) walk(ch)
      }
      walk(tree.rootNode)
      console.log(rows.slice(0, 4).join("\n"))
    }
  }
}
main()
