import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const scan = (repo: string, exts: string[], wasm: string, take: number) => {
    const L2 = L
    return L2.load(fs.readFileSync("wasm/" + wasm)).then((langObj: any) => {
      const parser = new P(); parser.setLanguage(langObj)
      const files: string[] = []
      const collect = (dir: string): void => {
        if (files.length >= 400) return
        let entries: fs.Dirent[] = []
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          const p = dir + "/" + e.name
          if (e.isDirectory()) collect(p)
          else if (exts.some((x) => e.name.endsWith(x))) files.push(p)
        }
      }
      collect("/home/ishaq2321/bb_tests/repositories/" + repo)
      const lines: Record<string, number> = {}
      let errFiles = 0
      for (const f of files) {
        const src = fs.readFileSync(f, "utf8")
        const tree = parser.parse(src)
        if (!(tree.rootNode as any).hasError) continue
        errFiles++
        const walk = (n: any): void => {
          if (n.type === "ERROR" && n.startPosition) {
            const t = (src.split("\n")[n.startPosition.row] ?? "").trim().slice(0, 70)
            if (t) lines[t] = (lines[t] ?? 0) + 1
          }
          for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
        }
        walk(tree.rootNode)
      }
      const top = Object.entries(lines).sort((a, b) => b[1] - a[1]).slice(0, take)
      process.stdout.write("=== " + repo + " (" + errFiles + "/" + files.length + " files with errors) — top ERROR lines ===\n")
      for (const [t, c] of top) process.stdout.write("  " + String(c).padStart(3) + "x  " + t + "\n")
    })
  }
  await scan("nlohmann-json", [".hpp", ".cpp", ".cc", ".h"], "tree-sitter-cpp.wasm", 8)
  await scan("jq", [".c"], "tree-sitter-c.wasm", 8)
}
main().catch((e) => { console.error(e); process.exit(1) })
