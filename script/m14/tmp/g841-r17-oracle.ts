import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
const LIB = "/home/ishaq2321/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"
function oracle(source: string): string {
  const tmp = `/tmp/g841-r17-oracle-${Date.now()}.groovy`
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
const cases: Array<[string, string]> = [
  ["decl-RHS to UploadPage", "class C { def m() { def x = to UploadPage\nreturn x } }"],
  ["decl-RHS foo bar", "class C { def m() { def x = foo bar\nreturn x } }"],
  ["assign-RHS foo bar", "class C { def m() { def foo; def bar; foo = bar\ndef y = 1\ny = foo bar\nreturn y } }"],
  ["assign-RHS evaluateMappings", "class C { def m(evaluator) { def x = evaluator.evaluateMappings mappings\nreturn x } }"],
  ["return foo bar (control)", "class C { def m() { def foo; def bar; return foo bar } }"],
  ["decl-RHS with closure arg", "class C { def m() { def x = validator validate it\nreturn x } }"],
  ["field-decl-RHS foo bar", "class C { def x = foo bar\ndef foo; def bar }"],
  ["decl-RHS dotted callee arg", "class C { def m() { def x = evaluator.evaluateMappings mappings\nreturn x } }"],
]
for (const [name, src] of cases) console.log(`  ${name.padEnd(34)} ${oracle(src)}`)
