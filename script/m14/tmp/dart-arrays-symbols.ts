import fs from "node:fs"
import path from "node:path"
import { LANGS } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories/dart-http"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cfg: any = (LANGS as any).dart
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const parser = new P(); parser.setLanguage(gl)
const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
const analyzer = new (mod as any)[cfg.className]()

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out.sort()
}
const target = process.argv[2] ?? "Arrays"
for (const f of walk(CORPUS)) {
  const src = fs.readFileSync(f, "utf8")
  let res: any
  try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
  const syms = (res.symbols ?? []).filter((s: any) => s.ownerName === target)
  if (syms.length < 5) continue
  console.log(`\n# ${path.relative(CORPUS, f)}  (${syms.length} symbols owned by ${target})`)
  const byKind = new Map<string, number>()
  for (const s of syms) byKind.set(String(s.kind), (byKind.get(String(s.kind)) ?? 0) + 1)
  console.log("kinds:", [...byKind].map(([k, v]) => `${k}=${v}`).join(" "))
  console.log("sample symbols:")
  for (const s of syms.slice(0, 14)) {
    console.log(`  ${String(s.kind).padEnd(12)} name=${JSON.stringify(s.name).padEnd(26)} line=${s.range?.startLine} scope=${s.scope ?? "-"}`)
  }
  break
}
