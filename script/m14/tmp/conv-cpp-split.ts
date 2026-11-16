import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const langObj = await L.load(fs.readFileSync("wasm/tree-sitter-cpp.wasm"))
  const parser = new P(); parser.setLanguage(langObj)
  const files: string[] = []
  const collect = (dir: string): void => {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = dir + "/" + e.name
      if (e.isDirectory()) collect(p)
      else if (e.name.endsWith(".hpp") || e.name.endsWith(".cpp") || e.name.endsWith(".cc") || e.name.endsWith(".h")) files.push(p)
    }
  }
  collect("<corpus-root>/bb_tests/repositories/nlohmann-json")
  const buckets: Record<string, { err: number; tot: number }> = {}
  for (const f of files) {
    const rel = f.replace("<corpus-root>/bb_tests/repositories/nlohmann-json/", "")
    const bucket = rel.startsWith("tests/") ? "tests/" : (rel.startsWith("src/") || rel.startsWith("include/")) ? "src+include/" : "other/"
    const src = fs.readFileSync(f, "utf8")
    if (!buckets[bucket]) buckets[bucket] = { err: 0, tot: 0 }
    buckets[bucket].tot++
    if ((parser.parse(src).rootNode as any).hasError) buckets[bucket].err++
  }
  for (const b of Object.keys(buckets)) {
    const v = buckets[b]
    process.stdout.write(b + ": " + v.err + "/" + v.tot + " (" + (100 * v.err / v.tot).toFixed(1) + "%)\n")
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
