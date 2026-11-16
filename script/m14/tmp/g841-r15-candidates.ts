// #841 round 15 recon: reproduce the top genuine-gap candidates live.
// Each candidate is wrapped in a minimal class; our parser must REJECT and the
// real Groovy 3.0.24 must ACCEPT (the §7b rule) before it can be a target.
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
  const tmp = `/tmp/g841-r15-${Date.now()}.groovy`
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

const CANDIDATES: Array<{ name: string; line: string; wrap: (l: string) => string }> = [
  { name: "assertTrue x < y", line: "assertTrue yesterdayIndex < twoDaysAgoIndex", wrap: (l) => `class C {\n    void m() {\n        ${l}\n    }\n}\n` },
  { name: "@Query(gstring-typed-interp)", line: '@Query("update ${Product p} set $p.amount = $newAmount where $p.name = $name")', wrap: (l) => `class C {\n    ${l}\n    def q\n}\n` },
  { name: "elvis-quoted-arg", line: "def x = cache.get('k') ?: Fallback", wrap: (l) => `class C {\n    void m() {\n        ${l}\n    }\n}\n` },
  { name: "promise-then-chain", line: "promise = promise.then { it * 2 } then { it + 6 }", wrap: (l) => `class C {\n    void m() {\n        ${l}\n    }\n}\n` },
  { name: "qualified-const-arg", line: "register(a.b.c(Foo.Bar))", wrap: (l) => `class C {\n    void m() {\n        ${l}\n    }\n}\n` },
  { name: "if-call-quoted-arg", line: "if (currentstep < laststep && !attrs.boolean('omitNext')) { }", wrap: (l) => `class C {\n    void m() {\n        ${l}\n    }\n}\n` },
  { name: "chained-ternary-elvis", line: "def x = a.b('s') ?: Foo", wrap: (l) => `class C {\n    void m() {\n        ${l}\n    }\n}\n` },
  { name: "render-quoted-arg-call", line: "render(view: 'x') { }", wrap: (l) => `class C {\n    void m() {\n        ${l}\n    }\n}\n` },
]

for (const c of CANDIDATES) {
  const src = c.wrap(c.line)
  const n = errs(src)
  const o = n > 0 ? oracle(src) : "(parses clean — not a gap)"
  console.log(`${n > 0 ? "FAIL" : "ok  "}  ${String(n).padStart(2)} nodes  oracle=${o.padEnd(9)}  ${c.name}`)
}
