// FS015 — the lane's A/B harness: run the PRODUCTION entry over real files with the
// analyzer at HEAD and with a patched copy, and report the exact symbol/relationship
// delta with every removed and added row CLASSIFIED as real-loss / real-gain /
// re-attribution. Nothing is called a fix on the strength of a count.
//
// WHY IT EXISTS. The lane-audit formula's evidence rule is that an artifact's frame must
// contain the fix it claims, and the C#/c rounds established the shape that makes an A/B
// trustworthy: same files, same trees, two implementations, and every delta row read by a
// human-mechanical rule rather than eyeballed. A bare symbol count can improve while a
// real declaration disappears.
//
//   REAL-LOSS  a symbol or edge present at HEAD and absent in the patch whose source line
//              still contains the name — a genuine loss.
//   REATTRIB   present at HEAD, absent in the patch, and a matching row added under a
//              different owner/target — a moved fact, not a lost one.
//   DROP       present at HEAD, absent in the patch, with no matching added row and the
//              name NOT written in the file — a fabrication removed (the good case).
//   GAIN       absent at HEAD, present in the patch.
//
// Run:
//   bun script/m14/tmp/fs015-ab.ts --repo fsharp --limit 200
//   bun script/m14/tmp/fs015-ab.ts --repo fsharp --limit 200 --patch /path/to/patched.ts
import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "200")
const REPO = argOf("--repo") ?? "fsharp"
const PATCH = argOf("--patch")
const MODE = argOf("--mode") ?? "head"     // head | patch
const JSON_OUT = argOf("--json")

function walk(dir: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj" || n === "tests" || n === "test") continue
    const p = path.join(dir, n)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1).toLowerCase())) out.push(p)
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const files = walk(path.join(CORPUS_ROOT, REPO), ["fs", "fsi", "fsx"], [], LIMIT)
  const per: any[] = []
  for (const file of files) {
    let src: string
    try { src = fs.readFileSync(file, "utf8") } catch { continue }
    let r: any
    try { r = await ASTEngine.parseFile(file, src) } catch (e: any) {
      per.push({ file: path.relative(CORPUS_ROOT, file), crash: String(e?.message ?? e).slice(0, 120) }); continue
    }
    per.push({
      file: path.relative(CORPUS_ROOT, file),
      symbols: r.symbols.map((s: any) => ({ name: s.name, kind: String(s.kind), owner: s.ownerName ?? null, line: s.range?.startLine, nodeType: s.metadata?.nodeType })),
      relationships: r.relationships.map((x: any) => ({ type: String(x.type), source: String(x.source), target: String(x.target), line: x.line_number ?? null, nodeType: x.metadata?.nodeType })),
      src,
    })
  }
  const payload = { mode: MODE, patch: PATCH ?? null, repo: REPO, files: per }
  if (MODE === "dump") {
    if (!argOf("--out")) { console.error("--out is required in dump mode"); process.exit(2) }
    fs.mkdirSync(path.dirname(argOf("--out")!), { recursive: true })
    fs.writeFileSync(argOf("--out")!, JSON.stringify(payload))
    console.error(`wrote ${argOf("--out")}  (${per.length} files, ${per.reduce((a, f) => a + (f.symbols?.length ?? 0), 0)} symbols, ${per.reduce((a, f) => a + (f.relationships?.length ?? 0), 0)} relationships)`)
    return
  }
  if (MODE === "patch") {
    if (!PATCH) { console.error("--patch is required in patch mode"); process.exit(2) }
    fs.writeFileSync("/tmp/opencode/fs015-patch.json", JSON.stringify(payload))
    console.error(`wrote /tmp/opencode/fs015-patch.json (${per.length} files, ${per.reduce((a, f) => a + (f.symbols?.length ?? 0), 0)} symbols)`)
    return
  }
  // head mode: compare against an explicit --other dump (never an implicit file, so a
  // run cannot silently compare a tree against ITSELF and report "no regressions")
  const otherPath = argOf("--other")
  let other: any = null
  if (otherPath && fs.existsSync(otherPath)) other = JSON.parse(fs.readFileSync(otherPath, "utf8"))
  if (!other) { console.error("head mode needs --other <dump.json>"); process.exit(2) }

  const byFile = new Map<string, any>()
  for (const f of other.files) byFile.set(f.file, f)
  const symKey = (s: any) => `${s.name}|${s.kind}|${s.owner ?? ""}|${s.line}`
  const relKey = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line}`

  let filesChanged = 0
  const drops: any[] = [], gains: any[] = [], reattrib: any[] = [], losses: any[] = []
  let symHead = 0, symPatch = 0, relHead = 0, relPatch = 0
  for (const f of per) {
    const o = byFile.get(f.file)
    if (!o || o.crash || f.crash) continue
    symHead += f.symbols.length; symPatch += o.symbols.length
    relHead += f.relationships.length; relPatch += o.relationships.length
    const oS = new Map<string, any[]>(), oR = new Map<string, any[]>()
    for (const s of o.symbols) { const a = oS.get(symKey(s)) ?? []; a.push(s); oS.set(symKey(s), a) }
    for (const r of o.relationships) { const a = oR.get(relKey(r)) ?? []; a.push(r); oR.set(relKey(r), a) }
    let changed = false
    for (const s of f.symbols) {
      const k = symKey(s)
      const arr = oS.get(k)
      if (arr && arr.length) { arr.pop(); continue }
      gains.push({ file: f.file, kind: "sym", row: s })
    }
    for (const r of f.relationships) {
      const k = relKey(r)
      const arr = oR.get(k)
      if (arr && arr.length) { arr.pop(); continue }
      // is there an added row with the same type and one endpoint moved?
      drops.push({ file: f.file, kind: "rel", row: r, src: f.src })
    }
    for (const [k, arr] of oS) for (const s of arr) { if (s.name || s.owner) gains.push({ file: f.file, kind: "sym", row: s }) }
    for (const [k, arr] of oR) for (const r of arr) drops.push({ file: f.file, kind: "rel", row: r, src: f.src })
    if (JSON.stringify(f.symbols) !== JSON.stringify(o.symbols) || JSON.stringify(f.relationships) !== JSON.stringify(o.relationships)) filesChanged++
  }
  // classify
  const addedNames = new Set(gains.map((g) => `${g.file}|${g.row.type ?? g.row.kind}|${g.row.name ?? g.row.target}|${g.row.source ?? g.row.owner ?? ""}`))
  for (const d of drops) {
    const name = String(d.row.target ?? d.row.name ?? "")
    const written = d.src ? d.src.includes(name) : true
    if (!written) reattrib.push({ ...d, cls: "DROP-fabrication-removed" })
    else losses.push({ ...d, cls: "REAL-LOSS" })
  }
  const uniq = (a: any[]) => a.filter((x, i) => a.findIndex((y) => JSON.stringify(y.row) === JSON.stringify(x.row) && y.file === x.file) === i)
  const out = { at: new Date().toISOString(), repo: REPO, limit: LIMIT, filesCompared: per.length, filesChanged, symHead, symPatch, relHead, relPatch, gains: uniq(gains), drops: uniq(drops), reattribCount: reattrib.length, realLossCount: losses.length, realLoss: losses.slice(0, 60), reattrib: reattrib.slice(0, 60) }
  if (JSON_OUT) { fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true }); fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1)) }
  console.log(`\nFS015 A/B  (HEAD vs patch=${other.patch})`)
  console.log(`  files compared ${out.filesCompared}, files whose output changed ${filesChanged}`)
  console.log(`  symbols   ${symHead} -> ${symPatch}  (${symPatch - symHead >= 0 ? "+" : ""}${symPatch - symHead})`)
  console.log(`  relations ${relHead} -> ${relPatch}  (${relPatch - relHead >= 0 ? "+" : ""}${relPatch - relHead})`)
  console.log(`\n  gains (absent at HEAD, present in patch): ${out.gains.length}`)
  for (const g of out.gains.slice(0, 20)) console.log(`     ${g.file}  ${g.kind} ${JSON.stringify(g.row)}`)
  console.log(`\n  drops (present at HEAD, absent in patch): ${out.drops.length}`)
  console.log(`     classified REAL-LOSS (name IS written in the file): ${out.realLossCount}`)
  for (const l of out.realLoss.slice(0, 20)) console.log(`       ${l.file}  ${l.kind} ${JSON.stringify(l.row)}`)
  console.log(`     classified DROP (name is NOT in the file — a fabrication removed): ${out.reattrivCount}`)
  for (const r of out.reattrib.slice(0, 20)) console.log(`       ${r.file}  ${r.kind} ${JSON.stringify(r.row)}`)
  console.log(`\n  REAL-LOSS MUST be 0 or adjudicated one by one. ${out.realLossCount === 0 ? "It is 0." : "IT IS NOT — do not ship this patch until each row above is read."}`)
}
void main()
