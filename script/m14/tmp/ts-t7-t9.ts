import * as fs from "fs"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-typescript.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealTypeScriptAnalyzer()
  const out: string[] = []

  // T7: hook warning line must be 1-based like syntax errors
  {
    // hook call on LINE 4 (1-based); lines 1-2 imports, line 3 blank
    const src = [
      'import { useState } from "react"',
      'import { useEffect } from "react"',
      "",
      "export function bad() { useEffect(() => {}, []) }",
    ].join("\n") + "\n"
    const tree = parser.parse(src)
    const res: any = az.analyze(tree.rootNode, src, "probe.ts")
    const hookErrs = (res.errors ?? []).filter((e: any) => /React Hook/.test(e.message ?? ""))
    const rows = hookErrs.map((e: any) => e.range?.startLine ?? e.startLine)
    // syntax error control on line 4 too: add a broken line? use existing error-ranges contract instead
    out.push(`T7 hook rows (expect [4]): ${JSON.stringify(rows)} hookErrs=${hookErrs.length}`)
  }

  // T9: myreq.body must NOT be a taint source; req.body must be
  {
    const src = [
      "export function h(myreq: any, req: any) {",
      "  const a = myreq.body",
      "  const b = req.body",
      "  return a + b",
      "}",
    ].join("\n") + "\n"
    const tree = parser.parse(src)
    const res: any = az.analyze(tree.rootNode, src, "probe.ts")
    const fns = (res.symbols ?? []).filter((s: any) => s.kind === "function")
    const h = fns.find((s: any) => s.name === "h")
    const ts = h?.taintSources ?? []
    const snippets = ts.map((t: any) => t.snippet)
    const hasMyreq = snippets.some((s: string) => /myreq/.test(s))
    const hasReq = snippets.some((s: string) => s === "req.body")
    out.push(`T9 myreq.body flagged (expect false): ${hasMyreq}; req.body flagged (expect true): ${hasReq}; sources=${JSON.stringify(snippets)}`)
  }

  // T10 status: is resolveModulePath still doing sync I/O?
  process.stderr.write(out.join("\n") + "\n")
  process.exit(0)
}
main()
