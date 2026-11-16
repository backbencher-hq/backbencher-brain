// #841 round 15: isolate families A (juxt as assignment RHS) and B (type-keyword members).
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const LIB = "<corpus-root>/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function errs(src: string): number {
  const t = parser.parse(src)
  let n = 0
  const walk = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
  walk(t.rootNode)
  return n
}
function oracle(source: string): string {
  const tmp = `/tmp/g841-r15-ab-${Date.now()}.groovy`
  fs.writeFileSync(tmp, source)
  const code = [
    "import org.codehaus.groovy.control.CompilationUnit",
    "import org.codehaus.groovy.control.Phases",
    "def f = new File(System.getenv('BB_ORACLE_FILE'))",
    "def cu = new CompilationUnit()",
    "cu.addSource(f.name, f.text)",
    "try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }",
  ].join("; ")
  const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "-e", code], {
    env: { ...process.env, BB_ORACLE_FILE: tmp }, encoding: "utf8", timeout: 120_000,
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  return out.includes("ACCEPTS") ? "ACCEPTS" : out.includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"
}
const body = (l: string) => `class C {\n    void m() {\n        ${l}\n    }\n}\n`

const CASES: Array<[string, string]> = [
  // A — command call in expression positions
  ["A1 stmt juxt control: log a", "log a"],
  ["A2 RHS simple: def x = to UploadPage", "def x = to UploadPage"],
  ["A3 RHS dotted: def m = ev.evaluateMappings mappings", "def m = ev.evaluateMappings mappings"],
  ["A4 field assign: gen.holder = getHolder mappings", "gen.holder = getHolder mappings"],
  ["A5 RHS literal arg: def x = foo 1", "def x = foo 1"],
  ["A6 RHS closure arg: def x = foo { }", "def x = foo { }"],
  ["A7 return juxt: return foo bar", "return foo bar"],
  ["A8 if-cond juxt: if (foo bar) { }", "if (foo bar) { }"],
  // B — type keywords as member names
  ["B1 .int('x'): def t = attrs.int('total')", "def t = attrs.int('total')"],
  ["B2 .boolean('x'): def b = attrs.boolean('omitNext')", "def b = attrs.boolean('omitNext')"],
  ["B3 .long('x'): def l = params.long('id')", "def l = params.long('id')"],
  ["B4 control non-kw: def t = attrs.integer('total')", "def t = attrs.integer('total')"],
  ["B5 kw as call name: def t = int('x')", "def t = int('x')"],
  ["B6 field read: def t = foo.int", "def t = foo.int"],
  ["B7 .class control: def t = foo.class", "def t = foo.class"],
  // F — multi-index assignment
  ["F1 multi-index: em.properties['a', 'b'] = p", "em.properties['firstName', 'lastName'] = params"],
  ["F2 single-index control: em.properties['a'] = p", "em.properties['firstName'] = params"],
  // H — Spock mock
  ["H1 spock: _ * builder.isPaginated() >> false", "_ * builder.isPaginationEnabledList() >> false"],
  ["H2 spock control: 1 * builder.isPaginated() >> false", "1 * builder.isPaginationEnabledList() >> false"],
]

for (const [name, line] of CASES) {
  const src = body(line)
  const n = errs(src)
  const o = n > 0 ? oracle(src) : "(clean)"
  console.log(`${n > 0 ? "FAIL" : "ok  "} ${String(n).padStart(2)}  oracle=${o.padEnd(9)}  ${name}`)
}
