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
  const src = [
    "import { Controller, Get } from '@nestjs/common';",
    "@Controller('users')",
    "export class UsersController {",
    "  @Get('/')",
    "  list() { return []; }",
    "}",
  ].join("\n") + "\n"
  const r: any = az.analyze(parser.parse(src).rootNode, src, "probe.ts")
  for (const s of r.symbols ?? []) {
    if (s.name === "list") process.stdout.write("A1 list apiContractPath=" + JSON.stringify(s.apiContractPath) + " apiMethod=" + JSON.stringify(s.metadata?.apiMethod) + "\n")
  }
  const src3 = ["const f = async () => 1;"].join("\n") + "\n"
  const r3: any = az.analyze(parser.parse(src3).rootNode, src3, "p3.ts")
  const f = (r3.symbols ?? []).find((s: any) => s.name === "f")
  process.stdout.write("A6 f returnType=" + JSON.stringify(f?.returnType) + " isAsync=" + JSON.stringify(f?.isAsync) + "\n")
  const src4 = ["function g(): Promise<number> { return Promise.resolve(1) }"].join("\n") + "\n"
  const r4: any = az.analyze(parser.parse(src4).rootNode, src4, "p4.ts")
  const g = (r4.symbols ?? []).find((s: any) => s.name === "g")
  process.stdout.write("A6b g returnType=" + JSON.stringify(g?.returnType) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
