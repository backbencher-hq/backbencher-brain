import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
const LIB = "/home/ishaq2321/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"
function oracle(source: string): string {
  const tmp = `/tmp/g841-r19-oracle-${Date.now()}-${Math.random().toString(36).slice(2)}.groovy`
  fs.writeFileSync(tmp, source)
  const code = "import org.codehaus.groovy.control.CompilationUnit; import org.codehaus.groovy.control.Phases; def f = new File(System.getenv('BB_ORACLE_FILE')); def cu = new CompilationUnit(); cu.addSource(f.name, f.text); try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }"
  const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "-e", code], {
    env: { ...process.env, BB_ORACLE_FILE: tmp }, encoding: "utf8", timeout: 120_000,
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  return out.includes("ACCEPTS") ? "ACCEPTS" : out.includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"
}
const cases: Array<[string, string]> = [
  ["then-chain decl RHS", "class C { def m(promise) { promise = promise.then { it * 2 } then { it + 6 } } }"],
  ["then-chain statement", "class C { def m(promise) { promise.then { it * 2 } then { it + 6 } } }"],
  ["then-chain with throw", "class C { def m(promise) { promise.then { it * 2 } then { throw new RuntimeException('bad') } then { it + 6 } } }"],
  ["CONTROL single then{}", "class C { def m(promise) { promise.then { it * 2 } } }"],
  ["bind map-as-listener", "class C { def m(obj, listener) { binder.bind obj, [birthDate: '11/15/1969'] as SimpleMapDataBindingSource, listener } }"],
  ["multi-index subscript assign", "class C { def m(employee, params) { employee.properties['firstName', 'lastName'] = params } }"],
  ["spock interaction star", "class C { def m(builder) { _ * builder.isPaginationEnabledList() >> false } }"],
  ["leading-dot comparison", "class C { def m(list) { assert list.size()\n  .size() == 1 } }"],
]
for (const [name, src] of cases) console.log(`  ${name.padEnd(30)} ${oracle(src)}`)
