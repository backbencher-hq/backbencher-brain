// script/m14/tmp/php-laravel-marker-probe.ts — does php's `App\` root marker ever fire?
//
// The marker table in real-php-analyzer.ts reads:
//     if (text.includes("Illuminate\\") || text === "App\\") detectedFrameworks.add("Laravel")
// `"App\\"` is the string `App\` — an exact match against a trailing backslash. This probe
// measures what text the call sites actually pass, so the question "is that branch
// reachable" is answered by observation and not by reading.
//
// Run: bun script/m14/tmp/php-laravel-marker-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function mkParser() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
  const p = new P()
  p.setLanguage(LANG)
  return p
}

const CASES: Record<string, string> = {
  "bare App namespace": `<?php\nnamespace App;\n\nclass User {}\n`,
  "App namespace, no use": `<?php\nnamespace App\\Http\\Controllers;\n\nclass UserController extends Controller\n{\n}\n`,
  "App namespace + Illuminate use": `<?php\nnamespace App\\Http\\Controllers;\n\nuse Illuminate\\Http\\Request;\n\nclass UserController extends Controller\n{\n}\n`,
  "Eloquent model (Illuminate)": `<?php\nnamespace App\\Models;\n\nuse Illuminate\\Database\\Eloquent\\Model;\n\nclass User extends Model\n{\n}\n`,
  "global-namespace Illuminate": `<?php\nuse Illuminate\\Support\\Facades\\Route;\n`,
  "Symfony root": `<?php\nnamespace Symfony\\Component\\HttpFoundation;\n`,
  "PHPUnit TestCase base": `<?php\nclass MyTest extends TestCase\n{\n}\n`,
  "PHPUnit use statement": `<?php\nnamespace Tests;\n\nuse PHPUnit\\Framework\\TestCase;\n\nclass MyTest extends TestCase\n{\n}\n`,
  "PHPUnit use, no namespace": `<?php\n\nuse PHPUnit\\Framework\\TestCase;\n\nclass MyTest extends TestCase\n{\n}\n`,
  "PHPUnit use alone": `<?php\n\nuse PHPUnit\\Framework\\TestCase;\n`,
}

async function main() {
  const p = await mkParser()
  for (const [name, src] of Object.entries(CASES)) {
    const root = p.parse(src).rootNode
    const r: any = await (new RealPhpAnalyzer() as any).analyze(root, src, "probe.php")
    const m = r.metadata ?? {}
    console.log(`\n=== ${name}`)
    console.log(`    detectedFrameworks: ${JSON.stringify(m.detectedFrameworks)}`)
    console.log(`    framework:          ${JSON.stringify(m.framework)}`)
    // Show the namespace text the analyzer sees, straight from the grammar.
    const ns: string[] = []
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "namespace_definition" || n.type === "namespace_name" || n.type === "qualified_name") ns.push(`${n.type}=${JSON.stringify(n.text)}`)
      for (const c of n.namedChildren ?? []) stack.push(c)
    }
    console.log(`    grammar texts:      ${ns.slice(0, 6).join("  ")}`)
  }
}

main()
