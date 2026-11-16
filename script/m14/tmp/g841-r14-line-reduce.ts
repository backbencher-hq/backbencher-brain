// #841 round 14: minimal degrading source by brace-balanced line deletion.
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import * as os from "node:os"
import * as fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

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

const full = readFileSync(FILE, "utf8").split("\n")
// drop comments (measured not load-bearing)
const lines = full.filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && !/^\s*\*\/\s*$/.test(l))
console.log(`start: ${lines.length} lines, degraded=${degraded(lines.join("\n"))}`)

function balancedLine(l: string): boolean {
  // only delete lines whose braces balance and which are not class/import lines
  if (/^\s*(package|import)\b/.test(l)) return false
  if (/\bclass\s+\w+/.test(l)) return false
  let depth = 0
  for (const ch of l) { if (ch === "{") depth++; if (ch === "}") depth-- }
  return depth === 0 && l.trim().length > 0
}

let current = lines.slice()
let changed = true
let passes = 0
while (changed && passes < 12) {
  changed = false
  passes++
  for (let i = current.length - 1; i >= 0; i--) {
    if (!balancedLine(current[i])) continue
    const trial = current.filter((_, k) => k !== i)
    if (degraded(trial.join("\n"))) {
      current = trial
      changed = true
    }
  }
  // whole-block pass: delete any contiguous run [i..j] whose braces balance
  // (this removes whole members, which the single-line pass cannot)
  let blockChanged = true
  let blockPasses = 0
  while (blockChanged && blockPasses < 6) {
    blockChanged = false
    blockPasses++
    for (let i = 0; i < current.length; i++) {
      let depth = 0
      for (let j = i; j < current.length && j < i + 80; j++) {
        for (const ch of current[j]) { if (ch === "{") depth++; if (ch === "}") depth-- }
        if (depth === 0 && j > i) {
          // candidate block [i..j]; keep header/package/import lines
          const block = current.slice(i, j + 1)
          if (block.some((l) => /^\s*(package|import)\b/.test(l))) break
          const trial = [...current.slice(0, i), ...current.slice(j + 1)]
          if (degraded(trial.join("\n"))) {
            current = trial
            blockChanged = true
            changed = true
          }
          break
        }
      }
    }
  }
}
const minimal = current.join("\n")
console.log(`reduced: ${current.length} lines, degraded=${degraded(minimal)}`)
writeFileSync("/tmp/g841-r14-minimal.groovy", minimal)
console.log("---- reduced source ----")
console.log(minimal)

const lib = process.env.BB_GROOVY_LIB ?? findGradleGroovyLib()
if (!lib) console.log("oracle: UNAVAILABLE")
else {
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
