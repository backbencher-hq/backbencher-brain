// M60.P1 / #873 — the two line bases on one relationship row, measured through
// the PRODUCTION pipeline (pool-worker.parseFile) on real corpus files.
//
// For every relationship that carries BOTH `line_number` and a numeric
// `metadata.line`, it records whether the two agree, differ by exactly one (a
// base mismatch: one is 0-based, the other 1-based), or differ by something
// else — per language, so the fix names the analyzers that actually do it
// instead of assuming from a grep.
//
// Usage: bun script/m59/probe-metadata-line-base.ts [--per-lang N] [--show N]
import * as fs from "fs"
import * as path from "path"

const ROOTS = [
  "$HOME/fixtures/repositories/grails-core",
  "$HOME/fixtures/repositories/scala3",
  "$HOME/fixtures/repositories/lodash",
  "$HOME/fixtures/repositories/element-plus",
  "$HOME/fixtures/repositories/nlohmann-json",
]
const EXTS = ["java", "kt", "scala", "groovy", "gradle", "ts", "tsx", "js", "vue", "cpp", "hpp", "cs", "dart", "swift", "php", "py", "go", "rs", "rb"]

function argNum(flag: string, dflt: number): number {
  return process.argv.includes(flag) ? Number(process.argv[process.argv.indexOf(flag) + 1]) : dflt
}

/** First N files per extension, walking each root breadth-first and skipping .git. */
function pickFiles(perLang: number): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const ext of EXTS) out.set(ext, [])
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue
    const queue = [root]
    while (queue.length > 0) {
      const dir = queue.shift()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === ".git" || e.name === "node_modules") continue
          queue.push(full)
        } else {
          const ext = path.extname(e.name).slice(1).toLowerCase()
          const list = out.get(ext)
          if (list && list.length < perLang) list.push(full)
        }
      }
      if ([...out.values()].every((v) => v.length >= perLang)) break
    }
  }
  return out
}

async function main(): Promise<void> {
  const perLang = argNum("--per-lang", 3)
  const show = argNum("--show", 4)
  const { parseFile } = await import("../../src/ast/pool-worker")
  const files = pickFiles(perLang)
  let totalBoth = 0
  let totalAgree = 0
  let totalOffByOne = 0
  let totalOther = 0
  const examples: string[] = []

  for (const [ext, list] of files) {
    if (list.length === 0) continue
    let both = 0
    let agree = 0
    let offByOne = 0
    let other = 0
    let rows = 0
    for (const file of list) {
      const root = ROOTS.find((r) => file.startsWith(r)) ?? path.dirname(file)
      let res: any
      try {
        res = await parseFile(file, root)
      } catch (e) {
        console.log(`  (${ext}) parseFile threw on ${path.basename(file)}: ${String(e).slice(0, 80)}`)
        continue
      }
      const rels: any[] = res?.result?.relationships ?? res?.relationships ?? []
      rows += rels.length
      for (const r of rels) {
        const meta = r.metadata as any
        const metaLine = meta && typeof meta.line === "number" ? meta.line : undefined
        const rowLine = typeof r.line_number === "number" ? r.line_number : undefined
        if (metaLine === undefined || rowLine === undefined) continue
        both++
        const diff = rowLine - metaLine
        if (diff === 0) agree++
        else if (diff === 1) {
          offByOne++
          if (examples.length < show) {
            examples.push(`  ${ext}: ${path.basename(file)}  ${r.type} ${r.source} -> ${r.target}  line_number=${rowLine} metadata.line=${metaLine}`)
          }
        } else {
          other++
          if (examples.length < show) {
            examples.push(`  ${ext}: ${path.basename(file)}  ${r.type} ${r.source} -> ${r.target}  line_number=${rowLine} metadata.line=${metaLine} (diff=${diff})`)
          }
        }
      }
    }
    totalBoth += both
    totalAgree += agree
    totalOffByOne += offByOne
    totalOther += other
    console.log(
      `${ext.padEnd(7)} files=${String(list.length).padStart(2)} rows=${String(rows).padStart(5)}  both=${String(both).padStart(4)}  agree=${String(agree).padStart(4)}  off-by-one=${String(offByOne).padStart(4)}  other=${String(other).padStart(3)}`,
    )
  }
  console.log(`\nTOTAL rows with both fields: ${totalBoth}  agree ${totalAgree}  off-by-one ${totalOffByOne}  other ${totalOther}`)
  if (examples.length) {
    console.log("examples:")
    for (const e of examples) console.log(e)
  }
}
main()
