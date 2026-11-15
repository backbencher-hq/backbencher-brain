/**
 * r LANE — THE ADDITIVITY PROOF: the analyzer at HEAD against the analyzer as changed.
 *
 * The standard this lane is held to is xml's: *"every pre-existing type byte-identical"*. A
 * before/after gate table cannot prove that on its own — a table is an aggregate, and two changes
 * can cancel inside one cell. So this loads BOTH analyzers in one process
 * (`real-r-analyzer.HEAD-copy.ts` is `git show HEAD:src/ast/real-r-analyzer.ts` with its relative
 * imports rewritten, a copy in the FIXTURE directory; the repo's own file is untouched by it),
 * parses the same files through the harness's own `getParser`, and compares EVERY field of EVERY
 * symbol, import and relationship.
 *
 * The ONE permitted difference is the key this change adds: `metadata.languageNamespace`. Anything
 * else that differs is a regression and is printed.
 *
 * READ-ONLY. `bun run validation/m14/fixtures/r/additivity-proof.ts [maxFiles]`.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { RealRAnalyzer } from "../../../../src/ast/real-r-analyzer"
import { RealRAnalyzer as HeadRAnalyzer } from "./real-r-analyzer.HEAD-copy"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.argv[2] ?? 60)
const SIZE_CAP = 1024 * 1024

function admit(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

function discover(exts: string[], maxFiles: number): { files: string[]; total: number } {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admit(rel, exts, "r")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  if (maxFiles <= 0 || total <= maxFiles) return { files: found, total }
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
  return { files: picked, total }
}

/** Every field EXCEPT the one additive key, as canonical JSON. */
function canonical(x: any): string {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") {
      const out: Record<string, any> = {}
      for (const k of Object.keys(v).sort()) {
        if (k === "languageNamespace") continue
        out[k] = walk(v[k])
      }
      return out
    }
    return v
  }
  return JSON.stringify(walk(x))
}

async function main(): Promise<void> {
  const { getParser } = await import("../../../../src/ast/engine")
  const { files, total } = discover(["r"], MAX_FILES)
  const head = new HeadRAnalyzer()
  const now = new RealRAnalyzer()
  let compared = { symbols: 0, imports: 0, relationships: 0, exports: 0 }
  let certified = 0
  const diffs: string[] = []
  let idempotent = 0

  for (const f of files) {
    let content = ""
    try { content = readFileSync(f, "utf8") } catch { continue }
    const parser = await getParser("r")
    const root = parser.parse(content).rootNode
    const a: any = head.analyze(root, content, f)
    const b: any = now.analyze(root, content, f)
    for (const key of ["symbols", "imports", "relationships", "exports"] as const) {
      const xs = Array.isArray(a[key]) ? a[key] : []
      const ys = Array.isArray(b[key]) ? b[key] : []
      compared[key] += ys.length
      if (xs.length !== ys.length) {
        diffs.push(`${path.relative(CR, f)}: ${key} COUNT ${xs.length} -> ${ys.length}`)
        continue
      }
      for (let i = 0; i < xs.length; i++) {
        const cx = canonical(xs[i])
        const cy = canonical(ys[i])
        if (cx !== cy) {
          diffs.push(`${path.relative(CR, f)}: ${key}[${i}] DIFFERS\n      HEAD ${cx.slice(0, 300)}\n      NOW  ${cy.slice(0, 300)}`)
        }
      }
    }
    // how many edges the new arm certified, and whether a second run is idempotent
    for (const r of Array.isArray(b.relationships) ? b.relationships : []) {
      if ((r as any)?.metadata?.languageNamespace !== undefined) certified++
    }
    const again: any = now.analyze(root, content, f)
    if (canonical(again.relationships) === canonical(b.relationships)) idempotent++
    else diffs.push(`${path.relative(CR, f)}: NOT IDEMPOTENT — a second analyze() over the same tree differs`)
  }

  console.log(`r ADDITIVITY PROOF — ${files.length} of ${total} .r files, both analyzers in ONE process`)
  console.log(`  compared: symbols ${compared.symbols} · imports ${compared.imports} · relationships ${compared.relationships} · exports ${compared.exports}`)
  console.log(`  edges carrying the ONE additive key (metadata.languageNamespace): ${certified}`)
  console.log(`  files where a SECOND analyze() over the same tree is byte-identical: ${idempotent} of ${files.length}`)
  console.log(`  DIFFERENCES OUTSIDE metadata.languageNamespace: ${diffs.length}`)
  for (const d of diffs.slice(0, 20)) console.log(`    ${d}`)
}

main().catch((e) => { console.error(e); process.exit(2) })
