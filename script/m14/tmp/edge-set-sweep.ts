// Set-wise edge sweep. Prints (and optionally writes) every relationship as
// `label|source|target` for one corpus under `--root=`, so the effect of an
// analyzer change is measured as a SET DELTA — gains and losses both — instead
// of as a headline count. Prints per-label totals so a shape change is visible.
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = process.argv.find((a) => a.startsWith("--corpus="))?.slice("--corpus=".length) ?? ""
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)
const EXTS = (process.argv.find((a) => a.startsWith("--exts="))?.slice("--exts=".length) ?? ".ts,.tsx").split(",")

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (EXTS.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const files = walk(CORPUS).sort()
  const edges: string[] = []
  const perLabel: Record<string, number> = {}
  const noLineByLabel: Record<string, number> = {}
  const noLineEdges: string[] = []
  const failed: string[] = []
  for (const f of files) {
    try {
      const res: any = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
      for (const r of res?.relationships ?? []) {
        const label = String(r.type)
        perLabel[label] = (perLabel[label] ?? 0) + 1
        const ln = r?.line_number
        if (typeof ln !== "number" || ln <= 0) {
          noLineByLabel[label] = (noLineByLabel[label] ?? 0) + 1
          noLineEdges.push(`${path.relative(CORPUS, f)} | ${label} | ${r.source} -> ${r.target}`)
        }
        edges.push(`${label}|${r.source}|${r.target}`)
      }
    } catch (e) {
      failed.push(`${f}: ${(e as Error).message}`)
    }
  }
  edges.sort()
  console.log(`root=${ROOT}`)
  console.log(`corpus=${CORPUS}  files=${files.length}  parseFailures=${failed.length}  edges=${edges.length}`)
  console.log(
    "per-label: " +
      Object.entries(perLabel)
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  )
  if (process.argv.includes("--show-noline")) {
    for (const e of noLineEdges) console.log(`  NOLINE ${e}`)
  }
  const noLine = Object.entries(noLineByLabel).sort((a, b) => b[1] - a[1])
  console.log(
    "no-line: " + (noLine.length ? noLine.map(([k, v]) => `${k}=${v}/${perLabel[k]}`).join(" ") : "(every relationship carries a line)"),
  )
  for (const f of failed.slice(0, 5)) console.log(`  FAILED ${f}`)
  if (OUT) {
    writeFileSync(OUT, edges.join("\n") + "\n")
    console.log(`wrote ${OUT}`)
  }
}

main()
