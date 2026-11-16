// FS025 — the R10 QUALIFIED-TARGET SPELLING census for fsharp: how many emitted
// relationship TARGETS carry a dotted path, and does a symbol of that name exist in the
// file? R10's rule ("a qualified type USE is published under the name the lane would
// publish for that type as a symbol — io.Writer -> Writer — with the qualified spelling
// kept in metadata") was applied to ten lanes; fsharp was never asked.
import * as fs from "fs"; import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
function walk(d: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let ns: string[]; try { ns = fs.readdirSync(d) } catch { return out }
  for (const n of ns) { if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj") continue
    const p = path.join(d, n); let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1))) out.push(p) }
  return out
}
const c = new Map<string, number>(); const samples: any[] = []
let files = 0
for (const file of walk(path.join(CORPUS_ROOT, argOf("--repo") ?? "fsharp"), ["fs","fsi","fsx"], [], parseInt(argOf("--limit") ?? "400"))) {
  let src: string; try { src = fs.readFileSync(file, "utf8") } catch { continue }
  files++
  let r: any; try { r = await ASTEngine.parseFile(file, src) } catch { continue }
  const names = new Set((r.symbols ?? []).map((s: any) => String(s.name)))
  for (const x of r.relationships ?? []) {
    const t = String(x.target ?? "")
    if (!t.includes(".")) continue
    const k = String(x.type)
    c.set(k, (c.get(k) ?? 0) + 1)
    if (samples.length < 20) samples.push({ file: path.relative(CORPUS_ROOT, file), line: x.line_number, label: k, target: t, leafIsASymbol: names.has(t.split(".").pop() as string) })
  }
}
console.log(`dotted relationship TARGETS over ${files} files:`)
for (const [k, v] of [...c.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`\nsamples (leafIsASymbol says whether the LEAF matches a symbol in the same file):`)
for (const s of samples) console.log(`  ${s.label.padEnd(12)} ${s.target.padEnd(34)} leafIsASymbol=${s.leafIsASymbol}  ${s.file}:${s.line}`)
