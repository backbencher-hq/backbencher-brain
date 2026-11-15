/**
 * C audit probe: separate the PROVABLE same-pair duplicates from the ones a
 * line-based site key cannot tell apart.
 *
 * A line is not a site. Two calls to the same callee on one physical line are two
 * real call sites, and nothing in the payload can tell them from one call emitted
 * twice. So a (source, type, target, line) collision is a LOWER BOUND only.
 *
 * What IS provable from the payload: two edges with the same pair and line that
 * carry DIFFERENT `metadata.relationshipType` values came from two different
 * emission branches, and the analyzer emits one branch per name occurrence. Two
 * branches disagreeing about the same (source, target, line) is two truths for one
 * fact, and that is a defect whatever the site count is.
 *
 *   bun run script/m14/tmp/c-audit/duplicate-classes.ts --dir <corpus> [--max-files N]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DIR = arg("dir", "/home/sano/ishaq/bb_tests/repositories/redis/src")
const MAX_FILES = Number(arg("max-files", "200"))

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git") continue
    const full = path.join(d, e.name)
    if (e.isDirectory()) walk(full)
    else if (e.name.endsWith(".c") && files.length < MAX_FILES) files.push(full)
  }
}
walk(DIR)

const provable: any[] = []
const unprovable: Record<string, number> = {}
let totalEdges = 0
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = (new RealCAnalyzer() as any).analyze(parser.parse(src).rootNode, src, f)
  const groups = new Map<string, any[]>()
  for (const r of res.relationships ?? []) {
    totalEdges++
    const ln = (r as any).line_number
    const key = `${r.source}|${r.type}|${r.target}|${typeof ln === "number" ? ln : "none"}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  for (const [key, g] of groups) {
    if (g.length < 2) continue
    const relTypes = new Set(g.map((r) => String((r.metadata as any)?.relationshipType ?? "-")))
    const confs = new Set(g.map((r) => String(r.confidence)))
    const srcLines = src.split("\n")
    if (relTypes.size > 1) {
      const [source, type, target, ln] = key.split("|")
      provable.push({
        file: path.relative(DIR, f),
        line: Number(ln),
        type,
        source,
        target,
        variants: g.map((r) => ({
          relType: (r.metadata as any)?.relationshipType,
          nodeType: (r.metadata as any)?.nodeType,
          conf: r.confidence,
        })),
        sourceText: (srcLines[Number(ln) - 1] ?? "").trim().slice(0, 120),
      })
    } else {
      const k = `${key.split("|")[1]}/${[...relTypes][0]}/count=${g.length}`
      unprovable[k] = (unprovable[k] ?? 0) + 1
    }
  }
}

console.log(`files: ${files.length}  edges: ${totalEdges}`)
console.log(`PROVABLE cross-branch duplicates: ${provable.length}`)
console.log(`same-branch collisions (not provable from the payload): ${JSON.stringify(unprovable, null, 1)}`)
const byClass: Record<string, number> = {}
for (const p of provable) {
  const k = p.variants.map((v: any) => `${v.relType}/${v.nodeType ?? "-"}@${v.conf}`).sort().join("  +  ")
  byClass[k] = (byClass[k] ?? 0) + 1
}
console.log("provable classes:", JSON.stringify(byClass, null, 1))
console.log("\n--- first 15 ---")
for (const p of provable.slice(0, 15)) {
  console.log(`${p.file}:${p.line}  ${p.type}  ${p.source} -> ${p.target}`)
  console.log(`   variants: ${p.variants.map((v: any) => `${v.relType}/${v.nodeType ?? "-"}@${v.conf}`).join("  +  ")}`)
  console.log(`   | ${p.sourceText}`)
}
