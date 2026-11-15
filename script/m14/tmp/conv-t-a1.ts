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
  // A1: explicit "/" route — inspect symbols payloads (apiContractPath rides symbols)
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
    if (s.name === "list" || s.metadata?.apiContractPath) {
      process.stdout.write("sym " + s.name + " apiContractPath=" + JSON.stringify(s.metadata?.apiContractPath) + "\n")
    }
  }
  // A4: bracket taint — where does taintSources land?
  const src2 = "export function handler(req) {\n  const b = req['body'];\n  return b;\n}\n"
  const r2: any = az.analyze(parser.parse(src2).rootNode, src2, "p2.ts")
  for (const s of r2.symbols ?? []) {
    if (s.name === "b" || s.name === "handler") {
      process.stdout.write("sym " + s.name + " taintSources=" + JSON.stringify(s.metadata?.taintSources) + " taintSinks=" + JSON.stringify(s.metadata?.taintSinks) + "\n")
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
