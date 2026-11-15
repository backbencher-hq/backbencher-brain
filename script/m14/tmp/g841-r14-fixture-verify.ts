// #841 round 14: verify the fixture candidate — degraded shape, baseline loses
// the class, recovery restores it, and the real toolchain accepts the source.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ?? "/home/ishaq2321/mcp/backbencher-brain"
const LIB = "/home/ishaq2321/.gradle/wrapper/dists/gradle-8.14-all/c2qonpi39x1mddn7hk5gh9iqj/gradle-8.14/lib"

const full = readFileSync("/tmp/g841-r14-minimal.groovy", "utf8")
const noImports = full.split("\n").filter((l) => !/^\s*import\b/.test(l)).join("\n")
const noPackage = noImports.split("\n").filter((l) => !/^\s*package\b/.test(l)).join("\n").replace(/^\s*\n/, "")

const VARIANTS: Record<string, string> = { "reduced": full, "no-imports": noImports, "no-package": noPackage }

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function oracle(source: string): string {
  const tmp = `/tmp/bb-oracle-fixture-${Date.now()}.groovy`
  writeFileSync(tmp, source)
  const code = [
    "import org.codehaus.groovy.control.CompilationUnit",
    "import org.codehaus.groovy.control.Phases",
    "def f = new File(System.getenv('BB_ORACLE_FILE'))",
    "def cu = new CompilationUnit()",
    "cu.addSource(f.name, f.text)",
    "try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }",
  ].join("; ")
  const r = spawnSync("java", ["-cp", path.join(LIB, "*"), "groovy.ui.GroovyMain", "-e", code], {
    env: { ...process.env, BB_ORACLE_FILE: tmp },
    encoding: "utf8",
    timeout: 120_000,
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  return out.includes("ACCEPTS") ? "ACCEPTS" : out.includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"
}

for (const [name, src] of Object.entries(VARIANTS)) {
  const tree = parser.parse(src)
  const kids: string[] = []
  for (const c of tree.rootNode.children) if (c) kids.push(c.type)
  const deg = kids.includes("ERROR") && kids.includes("class")
  const res: any = await ASTEngine.parseFile("/tmp/fixture.groovy", src)
  const classes = (res.symbols ?? []).filter((s: any) => s.kind === "class" && !String(s.name).startsWith("anonymous"))
  const contains = (res.relationships ?? []).filter((r: any) => r.type === "contains")
  const callsType = (res.relationships ?? []).filter((r: any) => r.type === "calls" && /^[A-Z]/.test(String(typeof r.target === "object" ? r.target?.name : r.target)))
  console.log(`\n== ${name}  ROOT=${ROOT}`)
  console.log(`   degraded=${deg}  classes=${classes.length} [${classes.map((c: any) => c.name).join(",")}]  contains=${contains.length}  callsToType=${callsType.length}`)
  console.log(`   methods=${(res.symbols ?? []).filter((s: any) => s.kind === "method").map((s: any) => s.name).join(",")}`)
  if (name === "no-package") console.log(`   oracle=${oracle(src)}`)
}
