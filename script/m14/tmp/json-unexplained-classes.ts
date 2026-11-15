/**
 * READ-ONLY PROBE — what ARE the 8,074 "unexplained" edges?
 *
 * A count this large is either a mass of fabrications or a hole in the oracle, and
 * the two demand opposite responses, so it gets classified by SHAPE before anything
 * is concluded. Concluding "fabrications" from a raw count is how a differential
 * convicts correct behaviour, which is the one failure it must never produce.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveJsonEdges } from "../differential"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_REPOS ?? "terraform,otp,ansible,clj-kondo,svelte,kubernetes").split(",").map((x) => x.trim()).filter(Boolean)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(process.cwd(), "wasm/tree-sitter-json.wasm"))))

const jobs: { repo: string; dir: string; abs: string; rel: string; text: string }[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    jobs.push({ repo, dir, abs, rel, text })
  }
}

const classify = (label: string, target: string, source: string): string => {
  if (label === "uses" && (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("/"))) return "uses -> a URL / server location (an OpenAPI `servers` entry)"
  if (label === "uses") return "uses -> something else"
  if (label === "references" && target.includes("#/")) return "references -> a '#/…' pointer the oracle could not resolve locally"
  if (label === "references" && (target.startsWith("http://") || target.startsWith("https://"))) return "references -> an EXTERNAL schema URL (correct: it names nothing in this file)"
  if (label === "references") return "references -> a bare name with no local match"
  return `${label} -> unclassified`
}

let idx = 0
const classes = new Map<string, { n: number; files: Set<string>; ex: string[] }>()
let total = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= jobs.length) return
    const j = jobs[i]
    let truth: { label: string; from: string; target: string }[] = []
    try {
      const t = parser.parse(j.text)
      if (t) { truth = deriveJsonEdges(t.rootNode, path.basename(j.rel).replace(/\.[^.]+$/, ""), { manifest: /(^|\/)(package|composer)\.json$/.test(j.rel) }); t.delete?.() }
    } catch { continue }
    let r: any
    try { r = await parseFile(j.abs, j.dir) } catch { continue }
    const truthSet = new Set(truth.map((t2) => `${t2.label}|${t2.target}`))
    for (const x of r.relationships ?? []) {
      const label = String(x.type ?? x.relationshipType ?? "").toLowerCase()
      const target = String(x.target ?? x.to ?? "")
      if (truthSet.has(`${label}|${target}`)) continue
      total++
      const k = classify(label, target, String(x.source ?? ""))
      const g = classes.get(k) ?? { n: 0, files: new Set<string>(), ex: [] }
      g.n++
      if (g.files.size < 2) g.files.add(`${j.repo}/${j.rel}`)
      if (g.ex.length < 3) g.ex.push(`${label}: ${JSON.stringify(String(x.source ?? "")).slice(0, 42)} -> ${JSON.stringify(target).slice(0, 58)}`)
      classes.set(k, g)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
console.log(`unexplained edge classes — ${total} instances over ${jobs.length} files\n`)
for (const [k, g] of [...classes.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(g.n).padStart(6)}  ${k}`)
  for (const e of g.ex) console.log(`            ${e}`)
  for (const f of g.files) console.log(`            in ${f}`)
  console.log()
}
