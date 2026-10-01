/**
 * Which symbols does the C++ lane publish with a FUNCTION as their owner, and of
 * what kind?
 *
 * A C++ declaration has no owner that is a function: there is no nested-function
 * declaration, so a symbol whose `ownerKind` is `function` is either
 *   (a) a LOCAL CLASS defined inside a function body — legitimate, a local type has
 *       no other owner, or
 *   (b) a member of a class the grammar truncated, which the walk then attributes to
 *       whatever `function_definition` swallowed it — the D5 fabrication.
 *
 * The two are told apart by KIND: (a) is class/struct/enum, (b) is
 * method/property/variable/function. This probe counts both so the ruling is drawn
 * on the measurement rather than on a guess about which shapes exist.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 10) return out
  let es: string[]
  try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.some((x) => p.endsWith(x)) && st.size > 0) out.push(p)
  }
  return out
}

const LEGIT_KINDS = new Set(["class", "struct", "enum", "union"])
const byKind = new Map<string, number>()
const sample: any[] = []
const legitSample: any[] = []
let files = 0, total = 0
const t0 = Date.now()

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let r: any, content: string
    try { content = readFileSync(f, "utf8"); r = await parseFile(f, content) } catch { continue }
    files++
    const rel = f.replace(CORPUS + "/", "")
    for (const s of (r.symbols ?? []) as any[]) {
      if (String(s.ownerKind ?? "") !== "function" || !s.ownerName) continue
      total++
      const k = String(s.kind ?? "")
      byKind.set(k, (byKind.get(k) ?? 0) + 1)
      const rec = { repo, file: rel, line: s.range?.startLine, name: s.name, kind: k, owner: s.ownerName, src: (content.split("\n")[(s.range?.startLine ?? 1) - 1] ?? "").trim().slice(0, 80) }
      if (LEGIT_KINDS.has(k)) { if (legitSample.length < 15) legitSample.push(rec) }
      else if (sample.length < 25) sample.push(rec)
    }
  }
  process.stderr.write(`${repo} done files=${files} fnOwned=${total}\n`)
}

const out = {
  generatedAt: new Date().toISOString(), files, wallMs: Date.now() - t0,
  totalFnOwnedSymbols: total,
  byKind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])),
  fabricationByKind: Object.fromEntries([...byKind].filter(([k]) => !LEGIT_KINDS.has(k)).sort((a, b) => b[1] - a[1])),
  legitimateLocalTypes: [...byKind].filter(([k]) => LEGIT_KINDS.has(k)).reduce((a, [, v]) => a + v, 0),
  sample, legitSample,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "d5-fnowner.json"), JSON.stringify(out, null, 2))
console.log(`files=${files} symbolsOwnedByAFunction=${total}`)
console.log(`by kind: ${JSON.stringify(out.byKind)}`)
console.log(`legitimate (local types): ${out.legitimateLocalTypes}   fabrication: ${total - out.legitimateLocalTypes}`)
console.log("\n--- FABRICATION sample (owner is a function, kind is not a local type) ---")
for (const s of sample) console.log(`  ${s.file}:${s.line} ${s.kind} ${JSON.stringify(s.name)} owner=${s.owner} | ${s.src}`)
console.log("\n--- LEGITIMATE local-type sample ---")
for (const s of legitSample) console.log(`  ${s.file}:${s.line} ${s.kind} ${JSON.stringify(s.name)} owner=${s.owner} | ${s.src}`)
