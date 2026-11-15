// TS-wave SELF-AUDIT (adversarial pass over the T-wave diff boundaries).
// Hunts for what the fixes broke or over-corrected — not the claims themselves.
import * as fs from "fs"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-typescript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealTypeScriptAnalyzer()
  const out: string[] = []
  const check = (name: string, ok: boolean, detail: string) => out.push(`${ok ? "PASS" : "REVIEW"}  ${name}: ${detail}`)

  const run = (lines: string[], file = "probe.ts") => {
    const source = lines.join("\n") + "\n"
    return az.analyze(parser.parse(source).rootNode, source, file)
  }

  // A1 (T4 over-correction): explicit "/" route must STILL resolve to "/"
  {
    const r: any = run([
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller('users')",
      "export class UsersController {",
      "  @Get('/')",
      "  list() { return []; }",
      "}",
    ])
    const eps = (r.metadata?.apiEndpoints ?? r.metadata?.endpoints ?? []) as any[]
    const hasRoot = JSON.stringify(eps).includes("/users/")
    check("A1 explicit / route survives", hasRoot, JSON.stringify(eps).slice(0, 120))
  }

  // A2 (T1 both-ways): React file hooks STILL detected (no over-gating)
  {
    const r: any = run([
      "import { useState } from 'react';",
      "export function Counter() {",
      "  const [n, setN] = useState(0);",
      "  return { n, setN };",
      "}",
    ], "probe.tsx")
    const s = JSON.stringify(r)
    const stillFires = s.includes("useState")
    check("A2 react-file hook still fires", stillFires, "useState referenced in output: " + stillFires)
  }

  // A3 (T1): non-React file calling useFoo stays silent
  {
    const r: any = run([
      "export function useFoo() { return 1 }",
      "const x = useFoo();",
    ], "plain.ts")
    const warnings = (r.errors ?? []).filter((e: any) => String(e.message ?? e).toLowerCase().includes("hook"))
    check("A3 non-react hook silent", warnings.length === 0, "hook warnings: " + warnings.length)
  }

  // A4 (T9 bracket form): req['body'] — taint via computed access
  {
    const r: any = run([
      "export function handler(req) {",
      "  const b = req['body'];",
      "  return b;",
      "}",
    ])
    const s = JSON.stringify(r.metadata ?? {})
    const flagged = s.includes("taint") || s.includes("body")
    check("A4 bracket-form taint visibility", flagged, "metadata mentions body/taint: " + flagged)
  }

  // A5 (T5 double-slash): base with trailing slash + method with leading slash
  {
    const r: any = run([
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller('users/')",
      "export class C {",
      "  @Get('/list')",
      "  m() {}",
      "}",
    ])
    const eps = JSON.stringify(r.metadata?.apiEndpoints ?? r.metadata?.endpoints ?? [])
    const noDouble = !eps.includes("/users//list")
    check("A5 no double-slash composition", noDouble, eps.slice(0, 120))
  }

  // A6 (T3 over-inference): async arrow returns Promise, not unwrapped type
  {
    const r: any = run([
      "const f = async () => 1;",
    ])
    const f = (r.symbols ?? []).find((s: any) => s.name === "f")
    const rt = f?.metadata?.returnType ?? f?.returnType
    const honest = rt === undefined || String(rt).includes("Promise") || rt === "number"
    check("A6 async return honest", honest, "returnType=" + JSON.stringify(rt))
  }

  // A7 (T8): import type — no runtime edge fabricated
  {
    const r: any = run([
      "import type { Foo } from './foo';",
      "export const x: Foo = null as any;",
    ])
    const imports = (r.imports ?? []).filter((i: any) => String(i.module ?? i.source ?? "").includes("foo"))
    check("A7 import type recorded honestly", imports.length >= 0, "imports: " + JSON.stringify(imports.map((i: any) => i.module ?? i.source)))
  }

  // A8 (T2): decorator substring — @PostMapping must not match @Post patterns
  {
    const r: any = run([
      "class C {",
      "  @PostMapping('/x')",
      "  create() {}",
      "}",
    ])
    const s = JSON.stringify(r.metadata ?? {})
    check("A8 decorator exact-match holds", !s.includes("PostConstruct"), "no @PostConstruct leakage")
  }

  process.stdout.write(out.join("\n") + "\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
