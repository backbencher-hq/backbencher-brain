/** Echo of firing-check.mjs's OWN loop, for cross-checking another probe's counts on the
 *  identical file list. Read-only. CLI: npx tsx … [--nf 120] */
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
const REPO = join(import.meta.dirname, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const dir = join(CORPUS, "bash-completion")
const exts = [".sh", ".bash"]
const want = Number(process.argv[process.argv.indexOf("--nf") + 1] ?? process.env.NFILES ?? 120)
function pickFiles(d: string, want: number, cap = 400) {
  const out: string[] = []
  const walk = (dd: string, depth: number) => {
    if (out.length >= want || depth > 20) return
    let ents; try { ents = readdirSync(dd, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(dd, e.name)
      if (e.isDirectory()) { const nm = e.name; if (!nm.includes("node_modules") && !nm.includes(".git")) walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) { try { if (statSync(p).size < 400_000) out.push(p) } catch {} }
    }
  }
  walk(d, 0); return out.slice(0, cap)
}
const files = pickFiles(dir, want)
const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const m = await import(`${REPO}/src/ast/real-bash-analyzer.ts`)
const Cls: any = Object.values(m).find((v: any) => typeof v === "function" && v.name.endsWith("Analyzer"))
const tally = new Map<string, number>()
for (const f of files) {
  const content = readFileSync(f, "utf8")
  const parser = await getParser("bash")
  const pr = await parser.parse(content, f)
  const res = new Cls().analyze(pr.rootNode, content, f)
  for (const r of res.relationships || []) { const t = r.relationshipType ?? r.type; if (!t) continue; tally.set(t, (tally.get(t) || 0) + 1) }
}
console.log("files:", files.length, "listHash:", createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 16))
console.log([...tally.entries()].sort().map(([t, n]) => `${t}:${n}`).join("  "))
console.log("first:", files[0], "\nlast:", files[files.length - 1])
