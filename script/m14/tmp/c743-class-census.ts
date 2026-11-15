// Current MISSING/ERROR class census for c and cpp at HEAD (#743 paperwork).
//
// The issue being filed must carry the classes that exist NOW, not the ones #743c
// censused before #907/#912/#917/#919/#920 landed. Uses the PINNED wasm and the
// same deterministic hash-ordered sample rule as M14.0.F10, so the sample digest
// can be compared with that gate's rows.
//
// Run: bun script/m14/tmp/c743-class-census.ts
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const CAP = 400

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const SKIP = new Set([".git", "node_modules", "dist", "build", "out", "target", "vendor", "third_party", "__pycache__"])

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= CAP * 4) break
    if (SKIP.has(e)) continue
    const p = path.join(dir, e)
    let st
    try {
      st = fs.statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, exts, out)
    else if (exts.includes(path.extname(e)) && st.size > 0 && st.size <= 400_000) out.push(p)
  }
  return out
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex")

async function census(label: string, repo: string, exts: string[], wasm: string) {
  const files = walk(path.join(CORPUS, repo), exts)
    .map((f) => ({ f, h: hash(path.relative(CORPUS, f)) }))
    .sort((a, b) => (a.h < b.h ? -1 : 1))
    .slice(0, CAP)
    .map((x) => x.f)

  const lang = await (L as any).load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const parser = new P()
  parser.setLanguage(lang)

  const missing = new Map<string, { sites: number; files: Set<string> }>()
  const errors = new Map<string, { sites: number; files: Set<string> }>()
  const bump = (m: Map<string, any>, key: string, rel: string) => {
    const cur = m.get(key) ?? { sites: 0, files: new Set<string>() }
    cur.sites++
    cur.files.add(rel)
    m.set(key, cur)
  }

  let missingTotal = 0
  let errorTotal = 0
  let damagedFiles = 0
  for (const f of files) {
    const rel = path.relative(CORPUS, f)
    const src = fs.readFileSync(f, "utf8")
    const root = parser.parse(src).rootNode
    let damaged = false
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.isMissing) {
        damaged = true
        missingTotal++
        bump(missing, `${n.parent?.type ?? "-"} > MISSING "${n.type}"`, rel)
      } else if (n.isError) {
        damaged = true
        errorTotal++
        bump(errors, `${n.parent?.type ?? "-"} > ERROR (first=${n.child(0)?.type ?? "-"})`, rel)
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
    if (damaged) damagedFiles++
  }

  const digest = hash(files.map((f) => path.relative(CORPUS, f)).join("\n")).slice(0, 16)
  const top = (m: Map<string, any>) =>
    [...m.entries()]
      .sort((a, b) => b[1].sites - a[1].sites)
      .slice(0, 8)
      .map(([k, v]) => `      ${String(v.sites).padStart(5)} sites / ${String(v.files.size).padStart(3)} files — ${k}`)

  console.log(`\n=========== ${label} (${files.length} files, digest ${digest}) ===========`)
  console.log(`  damaged files ${damagedFiles}/${files.length} | MISSING ${missingTotal} | ERROR ${errorTotal}`)
  console.log("  top MISSING classes:")
  for (const line of top(missing)) console.log(line)
  console.log("  top ERROR classes:")
  for (const line of top(errors)) console.log(line)
}

await census("cpp / fmt", "fmt", [".cc", ".cpp", ".h", ".hpp"], "tree-sitter-cpp.wasm")
await census("cpp / nlohmann-json", "nlohmann-json", [".cc", ".cpp", ".h", ".hpp"], "tree-sitter-cpp.wasm")
await census("c / jq", "jq", [".c", ".h"], "tree-sitter-c.wasm")
await census("c / sqlite", "sqlite", [".c", ".h"], "tree-sitter-c.wasm")
