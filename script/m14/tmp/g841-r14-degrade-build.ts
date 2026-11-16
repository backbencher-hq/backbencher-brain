// #841 round 14: additive search for the minimal degrading source.
import { readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import * as os from "node:os"
import * as fs from "node:fs"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length) ?? "<corpus-root>/bb_tests/repositories/grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/TestTaskShardingPlugin.groovy"

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function degraded(src: string): boolean {
  const tree = parser.parse(src)
  const kids: string[] = []
  for (const c of tree.rootNode.children) if (c) kids.push(c.type)
  return kids.includes("ERROR") && kids.includes("class")
}

const full = readFileSync(FILE, "utf8")
const lines = full.split("\n")

// member spans from the tree; nested members are separate spans
const spans: Array<{ kind: string; start: number; end: number }> = []
const collect = (node: any) => {
  if (node.type === "method_declaration" || node.type === "field_declaration" || node.type === "constructor_declaration") {
    spans.push({ kind: node.type, start: node.startPosition.row, end: node.endPosition.row })
    return
  }
  for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) collect(c) }
}
collect(parser.parse(full).rootNode)
const uniq = [...new Map(spans.map((s) => [`${s.start}-${s.end}`, s])).values()].sort((a, b) => a.start - b.start)

const headerEnd = lines.findIndex((l) => /^\s*(abstract\s+)?class\s+\w+/.test(l))
const header = lines.slice(0, headerEnd + 1).filter((l) => /^\s*(package|import)\b/.test(l) || /^\s*@/.test(l) || /class\s+\w+/.test(l))
const mk = (idxs: number[]) => {
  const body = idxs.flatMap((i) => lines.slice(uniq[i].start, uniq[i].end + 1))
  return `${header.join("\n")}\n${body.join("\n")}\n}\n`
}
console.log(`members: ${uniq.length}`)
console.log(`header-only degraded: ${degraded(mk([]))}`)
for (let i = 0; i < uniq.length; i++) console.log(`  member ${i}: ${uniq[i].kind} L${uniq[i].start + 1}-${uniq[i].end + 1} alone-degraded=${degraded(mk([i]))}`)
// pairs
for (let i = 0; i < uniq.length; i++) {
  for (let j = i + 1; j < uniq.length; j++) {
    if (degraded(mk([i, j]))) {
      console.log(`PAIR DEGRADES: ${i} & ${j}  (${uniq[i].kind} L${uniq[i].start + 1}, ${uniq[j].kind} L${uniq[j].start + 1})`)
      const src = mk([i, j])
      fs.writeFileSync("/tmp/g841-r14-minimal.groovy", src)
      console.log("---- minimal pair source ----")
      console.log(src)
      oracle(src)
      process.exit(0)
    }
  }
}
console.log("no pair degrades")
// try growing sets greedily
let set: number[] = []
for (let i = 0; i < uniq.length; i++) {
  set.push(i)
  if (degraded(mk(set))) {
    console.log(`first degrading prefix of members: ${set.join(",")}`)
    const src = mk(set)
    fs.writeFileSync("/tmp/g841-r14-minimal.groovy", src)
    console.log("---- prefix source ----")
    console.log(src)
    oracle(src)
    break
  }
}

function oracle(src: string) {
  const lib = process.env.BB_GROOVY_LIB ?? findGradleGroovyLib()
  if (!lib) { console.log("oracle: UNAVAILABLE"); return }
  fs.writeFileSync("/tmp/g841-r14-minimal.groovy", src)
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
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  console.log(`oracle: ${out.includes("ACCEPTS") ? "ACCEPTS" : out.includes("REJECTS") ? "REJECTS" : "UNAVAILABLE"}`)
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
          try { if (fs.readdirSync(cand).some((x) => x.startsWith("groovy-3") || x.startsWith("groovy-core"))) return cand } catch {}
        }
      } catch {}
    }
  }
  return null
}
