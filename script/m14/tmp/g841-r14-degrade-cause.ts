// #841 round 14: find the construct that degrades the class, then emit a
// minimal standalone source that still degrades — verified as valid Groovy by
// the real toolchain (Phases.CONVERSION) before it may become a fixture.
import { readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import * as os from "node:os"
import * as fs from "node:fs"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length) ?? "<corpus-root>/bb_tests/repositories/grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/TestTaskShardingPlugin.groovy"

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function isDegraded(src: string): boolean {
  const tree = parser.parse(src)
  const kids: string[] = []
  for (const c of tree.rootNode.children) if (c) kids.push(c.type)
  return kids.includes("ERROR") && kids.includes("class")
}

const full = readFileSync(FILE, "utf8")
console.log(`full file degraded: ${isDegraded(full)}`)
const lines = full.split("\n")

// collect member spans from the degraded tree
const spans: Array<{ kind: string; start: number; end: number }> = []
const collect = (node: any) => {
  if (node.type === "method_declaration" || node.type === "field_declaration" || node.type === "constructor_declaration") {
    spans.push({ kind: node.type, start: node.startPosition.row, end: node.endPosition.row })
    return
  }
  for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) collect(c) }
}
collect(parser.parse(full).rootNode)
const uniq = [...new Map(spans.map((s) => [`${s.start}-${s.end}`, s])).values()].sort((a, b) => (b.end - b.start) - (a.end - a.start))
console.log(`member spans: ${uniq.length}`)

const causes: typeof uniq = []
for (const s of uniq) {
  const without = lines.filter((_, i) => i < s.start || i > s.end).join("\n")
  if (!isDegraded(without)) causes.push(s)
}
console.log(`members whose deletion removes the degradation: ${causes.length}`)
for (const c of causes) console.log(`  ${c.kind} L${c.start + 1}-${c.end + 1}`)

// minimal standalone: header up to the class declaration + cause member(s)
if (causes.length > 0) {
  const headerEnd = lines.findIndex((l) => /^\s*(abstract\s+)?class\s+\w+/.test(l))
  const cls = lines[headerEnd]
  const header = lines.slice(0, headerEnd + 1).filter((l) => /^\s*(package|import|@|\s*$)/.test(l) || /class\s+\w+/.test(l))
  // re-emit the class header normalized + the cause member(s)
  const causeLines: string[] = []
  for (const c of causes) causeLines.push(...lines.slice(c.start, c.end + 1))
  const minimal = `${header.filter((l) => l.trim().length > 0).join("\n")}\n${causeLines.join("\n")}\n}\n`
  console.log(`\nminimal candidate degraded: ${isDegraded(minimal)}`)
  console.log(`---- candidate (${minimal.split("\n").length} lines) ----`)
  console.log(minimal)
  fs.writeFileSync("/tmp/g841-r14-minimal.groovy", minimal)
  // oracle
  const lib = process.env.BB_GROOVY_LIB ?? findGradleGroovyLib()
  if (!lib) { console.log("oracle: UNAVAILABLE (no groovy lib found)") } else {
    const code = [
      "import org.codehaus.groovy.control.CompilationUnit",
      "import org.codehaus.groovy.control.Phases",
      "def f = new File(System.getenv('BB_ORACLE_FILE'))",
      "def cu = new CompilationUnit()",
      "cu.addSource(f.name, f.text)",
      "try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }",
    ].join("; ")
    const r = spawnSync("java", ["-cp", path.join(lib, "*"), "groovy.ui.GroovyMain", "-e", code], {
      env: { ...process.env, BB_ORACLE_FILE: "/tmp/g841-r14-minimal.groovy" },
      encoding: "utf8",
      timeout: 120_000,
    })
    console.log(`oracle: ${((r.stdout ?? "") + (r.stderr ?? "")).includes("ACCEPTS") ? "ACCEPTS" : ((r.stdout ?? "") + (r.stderr ?? "")).includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"}  (${(r.stdout ?? "").trim().split("\n").pop()})`)
  }
}

function findGradleGroovyLib(): string | null {
  const roots = [path.join(os.homedir(), ".gradle", "wrapper", "dists"), path.join(os.homedir(), ".gradle", "caches")]
  for (const root of roots) {
    let dists: string[] = []
    try { dists = fs.readdirSync(root) } catch { continue }
    for (const d of dists) {
      const libDir = path.join(root, d)
      try {
        const inner = fs.readdirSync(libDir)
        for (const i of inner) {
          const cand = path.join(libDir, i, "lib")
          try {
            const fs2 = fs.readdirSync(cand)
            if (fs2.some((x) => x.startsWith("groovy-3") || x.startsWith("groovy-core"))) return cand
          } catch {}
        }
      } catch {}
    }
  }
  return null
}
