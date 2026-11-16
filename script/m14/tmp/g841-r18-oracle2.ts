import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
const LIB = "<corpus-root>/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"
function oracle(source: string): string {
  const tmp = `/tmp/g841-r18o2-${Math.random().toString(36).slice(2)}.groovy`
  fs.writeFileSync(tmp, source)
  const code = "import org.codehaus.groovy.control.CompilationUnit; import org.codehaus.groovy.control.Phases; def f = new File(System.getenv('BB_ORACLE_FILE')); def cu = new CompilationUnit(); cu.addSource(f.name, f.text); try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }"
  const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "-e", code], { env: { ...process.env, BB_ORACLE_FILE: tmp }, encoding: "utf8", timeout: 120_000 })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  return out.includes("ACCEPTS") ? "ACCEPTS" : out.includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"
}
const cases: Array<[string, string]> = [
  ["interp command expr", "class C { static foo(a) { a }; static void main(String[] a) { def p = 'P'; println \"x ${C.foo p} y\" } }"],
  ["interp plain", "class C { static void main(String[] a) { def x = 1; println \"v=${x}\" } }"],
  ["interp dotted call", "class C { static void main(String[] a) { def s = 'ab'; println \"${s.toUpperCase()}\" } }"],
  ["interp decl (SELECT family)", "class C { static void main(String[] a) { def p = 1; println \"${def q = p}\" } }"],
  ["interp assignment", "class C { static void main(String[] a) { def p = 1; def q = 0; println \"${q = p}\" } }"],
  ["interp closure literal", "class C { static void main(String[] a) { println \"${123}\" } }"],
]
for (const [name, src] of cases) console.log(`  ${name.padEnd(30)} ${oracle(src)}`)
