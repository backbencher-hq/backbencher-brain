// #841 round 23: oracle probes — closure param varargs/defaults + adjacent ranked shapes
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
const LIB = "/home/ishaq2321/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"
function oracle(source: string): string {
  const tmp = "/tmp/g841-r23-oracle-input.groovy"
  fs.writeFileSync(tmp, source)
  const code = "import org.codehaus.groovy.control.CompilationUnit; import org.codehaus.groovy.control.Phases; def f = new File(System.getenv('BB_ORACLE_FILE')); def cu = new CompilationUnit(); cu.addSource(f.name, f.text); try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }"
  const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "-e", code], { env: { ...process.env, BB_ORACLE_FILE: tmp }, encoding: "utf8", timeout: 120_000 })
  return (r.stdout ?? "").trim() || `ERR:${(r.stderr ?? "").slice(0, 80)}`
}
const CASES: Array<[string, string]> = [
  ["varargs closure param", `def create = { String... names -> names.each { println it } }\ncreate('a', 'b')\n`],
  ["default-valued closure param", `def shouldSkipClass = { boolean includeTests, String filePath = null -> println filePath }\nshouldSkipClass(true)\n`],
  ["varargs + default combo", `def f = { String prefix = 'x', String... rest -> println rest }\nf()\n`],
  ["plain typed (r22 control)", `def g = { String name -> println name }\ng('a')\n`],
  ["leading-dot comparison", `def h(Object o) {\n  .size() == 1\n}\n`],
  ["abstract method no body", `abstract class A {\n  abstract applyManualFlush(Session session)\n}\n`],
  ["subscript-call", `def k = [:]\nk['show']()\n`],
  ["bind-as-listener", `class C {\n  def m(obj, listener) {\n    binder.bind obj, [a: '1'] as S, listener\n  }\n}\n`],
]
for (const [name, src] of CASES) {
  console.log(`${name.padEnd(30)} ${oracle(src)}`)
}
