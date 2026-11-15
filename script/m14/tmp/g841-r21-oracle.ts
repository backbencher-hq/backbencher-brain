import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
const LIB = "/home/ishaq2321/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"
function oracle(source: string): string {
  const tmp = `/tmp/g841-r21-oracle-${Date.now()}-${Math.random().toString(36).slice(2)}.groovy`
  fs.writeFileSync(tmp, source)
  const code = "import org.codehaus.groovy.control.CompilationUnit; import org.codehaus.groovy.control.Phases; def f = new File(System.getenv('BB_ORACLE_FILE')); def cu = new CompilationUnit(); cu.addSource(f.name, f.text); try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }"
  const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "-e", code], {
    env: { ...process.env, BB_ORACLE_FILE: tmp }, encoding: "utf8", timeout: 120_000,
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  return out.includes("ACCEPTS") ? "ACCEPTS" : out.includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"
}
const cases: Array<[string, string]> = [
  ["spock star underscore", "class C { def m(builder) { _ * builder.isPaginationEnabledList() >> false } }"],
  ["_ as identifier def", "class C { def m() { def _ = 5\n return _ } }"],
  ["_ bare expression", "class C { def m(_) { _ + 1 } }"],
  ["_ closure param", "class C { def m(list) { list.each { _ -> _ } } }"],
]
for (const [name, src] of cases) console.log(`  ${name.padEnd(24)} ${oracle(src)}`)
