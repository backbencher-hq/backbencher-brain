/** Relationship and symbol COUNTS over one fixed draw, and a digest of every edge's
 *  (type, source, target, line). The digest is what proves a metadata-only change
 *  changed no edge: metadata does not enter the key, so the two digests must be
 *  byte-identical while the marked count is not. */
import { execFileSync } from "node:child_process"
import { readdirSync, existsSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const MAX = Number(process.argv.includes("--files") ? process.argv[process.argv.indexOf("--files") + 1] : 5000)
const files: string[] = []
for (const repo of (() => { try { return readdirSync(CR) } catch { return [] } })().sort()) {
  const dir = path.join(CR, repo)
  try { if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, ".git"))) continue } catch { continue }
  let ls = ""; try { ls = execFileSync("git", ["ls-files", "*.lua"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 }) } catch { continue }
  for (const p of ls.split("\n").map(s => s.trim()).filter(Boolean).sort().slice(0, MAX)) files.push(path.join(repo, p))
}
files.sort()
let rels = 0, syms = 0, marked = 0, parsed = 0, errs = 0
const h = createHash("sha256")
for (const rel of files) {
  let pf: any; try { pf = await parseFile(path.join(CR, rel)) } catch { errs++; continue }
  if (!pf) { errs++; continue }
  parsed++
  syms += (pf.symbols ?? []).length
  for (const e of (pf.relationships ?? []) as any[]) {
    rels++
    if (e.metadata?.external === true) marked++
    h.update(`${rel}\t${e.type}\t${e.source}\t${e.target}\t${e.line_number ?? ""}\n`)
  }
}
console.log(JSON.stringify({ parsed, errs, files: files.length, symbols: syms, relationships: rels, markedExternal: marked, edgeDigest: h.digest("hex") }))
