/**
 * IMPORT-CLAIM ROWS — the ten hand-reads' evidence list for the import-evidence external claim,
 * and nothing else.
 *
 * WHY IT EXISTS. `certifyImportEvidenceClaims` marks an edge `isExternalTarget` when the target
 * (or its written route) is a name this file binds by a module-level import. The M14 standard
 * requires TEN of those edges to be read by hand — file:line, the emitted target, the route, the
 * module specifier, and the declaration the code actually MEANS — and this instrument prints
 * exactly that list rather than a page a reader has to filter by eye. It reads the PRODUCTION
 * path (`parseFile`, the same call the pool worker makes).
 *
 * READ-ONLY. It writes nothing unless --out is given.
 * Population: the corpus's admitted `.py` files in `git ls-files` order, bounded by --limit
 * (default 400: the same first-N slice `python-endpoint-resolution.ts --limit 400` measures).
 *
 *   bun run validation/m14/fixtures/python/import-claim-rows.mts [--limit N] [--type calls]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(argOf("--limit") ?? "400")
const ONLY_TYPE = argOf("--type")
const MAX_BYTES = 1024 * 1024

const all: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "python") continue
    all.push(abs)
  }
}
const FILE_ARG = argOf("--file")
const admitted = FILE_ARG ? [path.resolve(FILE_ARG)] : LIMIT ? all.slice(0, LIMIT) : all

const byType = new Map<string, number>()
const rows: string[] = []
let total = 0
for (const f of admitted) {
  let r: any
  try {
    r = await parseFile(f, path.dirname(f), { projectRoot: path.dirname(f) } as any)
  } catch { continue }
  const text = readFileSync(f, "utf8")
  for (const rel of r?.relationships ?? []) {
    const md = (rel?.metadata ?? {}) as Record<string, any>
    if (md.isExternalTarget !== true) continue
    if (!String(md.externalReason ?? "").startsWith("imported-")) continue
    const type = String(rel?.type ?? "")
    if (ONLY_TYPE && type !== ONLY_TYPE) continue
    total++
    byType.set(type, (byType.get(type) ?? 0) + 1)
    const line = Number(rel?.line_number ?? 0)
    const srcLine = line > 0 ? (text.split("\n")[line - 1] ?? "").trim() : ""
    rows.push([
      path.relative(CR, f).split(path.sep).join("/") + ":" + line,
      type,
      String(rel?.source ?? ""),
      String(rel?.target ?? ""),
      String(md.qualified ?? ""),
      String(md.externalReason ?? ""),
      String(md.externalSpecifier ?? ""),
      srcLine.slice(0, 110),
    ].join("\t"))
  }
}
console.log(`import-evidence claimed edges — ${admitted.length} files admitted, ${total} claimed`)
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(14)} ${n}`)
const show = rows.slice(0, Number(argOf("--show") ?? "120"))
for (const row of show) console.log(row)
if (rows.length > show.length) console.log(`… ${rows.length - show.length} more row(s) not shown (--show N)`)
const out = argOf("--out")
if (out) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(out, rows.join("\n") + "\n")
  console.log(`wrote ${rows.length} row(s) to ${out}`)
}
