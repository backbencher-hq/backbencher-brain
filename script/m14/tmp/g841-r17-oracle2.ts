import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
const LIB = "<corpus-root>/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"
function oracle(source: string): string {
  const tmp = `/tmp/g841-r17-oracle2-${Date.now()}.groovy`
  fs.writeFileSync(tmp, source)
  const code = "import org.codehaus.groovy.control.CompilationUnit; import org.codehaus.groovy.control.Phases; def f = new File(System.getenv('BB_ORACLE_FILE')); def cu = new CompilationUnit(); cu.addSource(f.name, f.text); try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }"
  const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "-e", code], {
    env: { ...process.env, BB_ORACLE_FILE: tmp }, encoding: "utf8", timeout: 120_000,
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  return out.includes("ACCEPTS") ? "ACCEPTS" : out.includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"
}
// semantic check via runtime echo: what did the comma bind to?
const cases: Array<[string, string]> = [
  ["comma-arg: def x = foo bar, baz", "class C { def m(f) { def x = f bar, baz; return x } }"],
  ["comma-decl: def a = foo bar, b = 2", "class C { def m(f) { def a = f bar, b = 2; return a + b } }"],
  ["assign: y = foo bar, baz", "class C { def m(f) { def foo; def y; y = foo bar, baz; return y } }"],
]
for (const [name, src] of cases) console.log(`  ${name.padEnd(38)} ${oracle(src)}`)
// runtime semantics: how many params did the command call bind?
const semi = "class C { static f(a, b) { return a * 10 + b }; static void main(String[] a) { def x = f 3, 4; println x } }"
console.log("  runtime f 3, 4 => (expect 34 if foo(3,4)):", oracle(semi) === "ACCEPTS" ? (() => { const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", fs.mkdtempSync("/tmp/g841-r17-rt") + "/t.groovy"], { encoding: "utf8", timeout: 120_000 }); return (r.stdout ?? "").trim() || "NOOUTPUT" })() : "REJECTS")
fs.writeFileSync("/tmp/g841-r17-rt-semi.groovy", semi)
const rr = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "/tmp/g841-r17-rt-semi.groovy"], { encoding: "utf8", timeout: 120_000 })
console.log("  runtime direct:", (rr.stdout ?? "").trim(), (rr.stderr ?? "").split("\n")[0] ?? "")
