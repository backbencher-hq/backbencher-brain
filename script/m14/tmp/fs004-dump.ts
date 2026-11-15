// FS004 — dump what the fsharp analyzer (raw class and the production `parseFile`)
// publishes for a source string or a file, so every defect claim is read off real
// output rather than off the source.
//
// Run:
//   bun script/m14/tmp/fs004-dump.ts --src 'type X = class end'
//   bun script/m14/tmp/fs004-dump.ts --file a.fs --from 90 --to 145
//   ... --raw        # the analyzer class directly (no engine post-processing)
//   ... --rels calls,implements      # only these labels
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
  const srcArg = argOf("--src")
  const fileArg = argOf("--file") ?? "/tmp/opencode/fs004-case.fsx"
  let src = srcArg
  let base = fileArg
  if (!srcArg) {
    src = fs.readFileSync(fileArg, "utf8")
    const from = argOf("--from"), to = argOf("--to")
    if (from) {
      const lines = src.split("\n")
      const offset = parseInt(from) - 1
      src = lines.slice(offset, to ? parseInt(to) : undefined).join("\n")
      base = `/tmp/opencode/fs004-slice-${from}${to ? "-" + to : ""}.fsx`
      fs.writeFileSync(base, src)
    }
  }
  const relsFilter = (argOf("--rels") ?? "").split(",").filter(Boolean)
  const raw = process.argv.includes("--raw")

  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  let res: any
  if (raw) {
    const { RealFsharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-fsharp-analyzer.ts"))
    const wts: any = await import("web-tree-sitter")
    const P = wts.Parser ?? wts.default ?? wts
    const L = wts.Language ?? wts.default?.Language
    await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
    const parser = new P()
    parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
    const tree = parser.parse(src)
    res = new RealFsharpAnalyzer().analyze(tree.rootNode, src, base)
  } else {
    res = await ASTEngine.parseFile(base, src)
  }

  const errs = [...(res.errors ?? []), ...(res.metadata?.errors ?? [])]
  console.log(`# source: ${base} (${src.split("\n").length} lines)`)
  console.log(`# symbols ${res.symbols.length}  relationships ${res.relationships.length}  imports ${res.imports?.length ?? 0}  exports ${res.exports?.length ?? 0}  errors ${errs.length}`)
  if (errs.length) for (const e of errs.slice(0, 6)) console.log(`  ERROR ${e.line ?? "?"}: ${String(e.message ?? e).slice(0, 120)}`)

  console.log(`\n## symbols`)
  const byLine = [...res.symbols].sort((a: any, b: any) => (a.range?.startLine ?? 0) - (b.range?.startLine ?? 0) || String(a.name).localeCompare(String(b.name)))
  for (const s of byLine) {
    console.log(`  ${String(s.range?.startLine ?? 0).padStart(4)}:${String(s.range?.startColumn ?? 0).padStart(3)}  ${String(s.kind).padEnd(12)} ${JSON.stringify(s.name)}${s.ownerName ? `  owner=${s.ownerName}` : "  owner=<none>"}  meta=${JSON.stringify(s.metadata ?? {})}`)
  }
  console.log(`\n## relationships`)
  const byRelLine = [...res.relationships].sort((a: any, b: any) => (a.line_number ?? 0) - (b.line_number ?? 0) || String(a.type).localeCompare(String(b.type)))
  for (const r of byRelLine) {
    if (relsFilter.length && !relsFilter.includes(String(r.type))) continue
    console.log(`  ${String(r.line_number ?? "-").padStart(4)}  ${String(r.type).padEnd(13)} ${String(r.source)} -> ${String(r.target)}  conf=${r.confidence}  meta=${JSON.stringify(r.metadata ?? {})}`)
  }
  if ((res.imports ?? []).length) {
    console.log(`\n## imports`)
    for (const i of res.imports ?? []) console.log(`  ${i.module}  @${i.range?.startLine}  items=${JSON.stringify(i.items ?? [])}`)
  }
}
void main()
