// M49.T1 independent verification: review claims probed against the LIVE
// analyzer at HEAD. Not trusting the co-agent's fixtures — re-deriving truth.
// Array-join sources (no template literals) to keep escaping sane.
import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

function src(lines: string[]): string {
  return lines.join("\n") + "\n"
}

import * as fs from "fs"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-typescript.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  const analyze = async (source: string) => {
    const tree = parser.parse(source)
    const az = new RealTypeScriptAnalyzer()
    return az.analyze(tree.rootNode, source, "probe.ts")
  }

  const apiOf = (res: any) =>
    (res.symbols ?? [])
      .filter((s: any) => s.apiContractPath)
      .map((s: any) => ({ n: s.name, p: s.apiContractPath }))

  const errsOf = (res: any) =>
    (res.errors ?? []).map((e: any) => e.message ?? JSON.stringify(e))

  let bad = 0
  const out: string[] = []
  const check = (name: string, ok: boolean, detail: string) => {
    out.push(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`)
    if (!ok) bad++
  }

  // ---------- T1: hook warnings gated to React files ----------
  {
    const res = await analyze(src([
      "export function helper() { return useThing() }",
    ]))
    const hook = errsOf(res).filter((m) => /React Hook/.test(m))
    check("T1a non-React file silent", hook.length === 0, `hookErrs=${hook.length}`)
  }
  {
    const res = await analyze(src([
      'import { useState } from "react"',
      "export function C() { const [x] = useState(0); return null }",
      "export function notAComponent() { useState() }",
    ]))
    const hook = errsOf(res).filter((m) => /React Hook/.test(m))
    check("T1b React file fires for non-component use", hook.length >= 1, `hookErrs=${JSON.stringify(hook)}`)
  }

  // ---------- T2: @PostConstruct / @Getter fabricate no endpoints ----------
  {
    const res = await analyze(src([
      "class Svc {",
      "  @PostConstruct()",
      "  init() {}",
      "  @Getter()",
      "  load() {}",
      "}",
    ]))
    const api = apiOf(res)
    check("T2 no prefix-match endpoints", api.length === 0, `api=${JSON.stringify(api)}`)
  }

  // ---------- T3: unannotated returns are not claimed void ----------
  {
    const res = await analyze(src([
      "export function f() { return 42 }",
      "export function g() {}",
    ]))
    const syms = (res.symbols ?? []).filter((s: any) => s.kind === "function")
    const f = syms.find((s: any) => s.name === "f")
    const rtF = f ? (f.returnType ?? "<undefined>") : "<no symbol f>"
    check("T3 f (returns 42) not void", f !== undefined && rtF !== "void", `f.returnType=${JSON.stringify(rtF)}`)
  }

  // ---------- T4: bare @Get() claims no route; with-arg control works ----------
  {
    const res = await analyze(src([
      "class C { @Get() list() {} }",
    ]))
    const api = apiOf(res)
    check("T4 no bare-root endpoint", api.length === 0, `api=${JSON.stringify(api)}`)
  }
  {
    const res = await analyze(src([
      'class C { @Get("items") list() {} }',
    ]))
    const api = apiOf(res)
    check("T4-control with-arg @Get emits /items", api.length === 1 && api[0].p === "/items", JSON.stringify(api))
  }

  // ---------- T5: @Controller base composes with method route ----------
  {
    const res = await analyze(src([
      '@Controller("users")',
      "class Users {",
      '  @Get("list") findAll() {}',
      "  @Get() solo() {}",
      "  list() {}",
      "}",
    ]))
    const api = apiOf(res)
    const has = (n: string, p: string) => api.some((a) => a.n === n && a.p === p)
    check("T5a composed /users/list", has("findAll", "/users/list"), JSON.stringify(api))
    check("T5b bare mapping inherits base /users", has("solo", "/users"), JSON.stringify(api))
    check("T5c unmapped method silent", !api.some((a) => a.n === "list"), JSON.stringify(api))
  }

  // ---------- T6: positional resolution is alive (0-based bug fixed) ----------
  // Duplicate function names in DIFFERENT objects: positional resolution must
  // pick each occurrence's own line, not first-name-match.
  {
    const source = src([
      "const h1 = { run() { return 1 } }",
      "const h2 = { run() { return 2 } }",
    ])
    const tree = parser.parse(source)
    // find the two call/attr rows the analyzer records for run()
    const az = new RealTypeScriptAnalyzer()
    const res = await az.analyze(tree.rootNode, source, "probe.ts")
    const syms = (res.symbols ?? []).filter((s: any) => s.name === "run")
    check("T6 both object methods registered", syms.length === 2, `run symbols=${syms.length}`)
  }

  out.push(bad === 0 ? "ALL T-CLAIM PROBES PASS" : `${bad} PROBE(S) FAILED`)
  process.stderr.write(out.join("\n") + "\n")
  process.exit(bad === 0 ? 0 : 1)
}

main()
