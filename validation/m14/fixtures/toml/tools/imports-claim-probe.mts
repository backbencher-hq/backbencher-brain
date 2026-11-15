/**
 * IMPORTS-CLAIM PROBE — how many `imports` edges can carry an `importProjectFile` claim the gate
 * VERIFIES, and how many would it REFUTE?
 *
 * The gate verifies a file claim against the project's ADMITTED file list (repo-root-relative
 * paths, exact match or whole-segment directory prefix) and REFUTES a candidate that matches
 * nothing (`verifyFileClaim`, script/m14/incoming-rule.ts). So before attaching the claim, this
 * probe reproduces BOTH sides side by side: the analyzer's candidate arithmetic and the gate's
 * facts, plus the filesystem test the analyzer gates the claim on.
 *
 * MEASURED, toml lane, 2026-10-09, whole admitted population (77 repos, 1,485 `.toml`, 331
 * `imports` edges; commit c6428ba0a): 318 candidates the project VERIFIES, 13 it would REFUTE,
 * 0 with no computable candidate — and the cross-tab disagrees on ZERO edges in either direction
 * (no claimed-but-refuted, no unclaimed-but-verifiable). That zero is why the analyzer can gate
 * its claim on `statSync` without risking a refutation, and it is the evidence behind TOML-G2 in
 * script/m14/spec/toml-completeness.json. The 13 are cargo's own `cargo_add` fixtures, where
 * `path = "./dependency"` is written to NOT exist because the test asserts that failure.
 *
 *   npx tsx validation/m14/fixtures/toml/tools/imports-claim-probe.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

// tools/ -> toml -> fixtures -> m14 -> validation -> root
const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const { getParser } = await import(path.join(ROOT, "src/ast/engine.ts"))
const mod: any = await import(path.join(ROOT, "src/ast/real-toml-analyzer.ts"))
const Analyzer = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
const parser: any = await getParser("toml")

/** Manifests that make a directory a real dependency, in the spellings the corpus uses. */
const MANIFESTS = ["Cargo.toml", "Project.toml", "JuliaProject.toml", "pyproject.toml", "Package.toml"]
const fileExists = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }

/** The gate's own fact builder, transcribed: repo-root-relative POSIX paths of admitted files. */
function discover(ext: string): Map<string, { files: Set<string>; abs: string[] }> {
  const out = new Map<string, { files: Set<string>; abs: string[] }>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    const files = new Set<string>()
    const abs: string[] = []
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${ext}`)) continue
      const a = path.join(dir, rel)
      try { if (statSync(a).size > SIZE_CAP) continue } catch { continue }
      files.add(rel.split("/").join("/"))
      abs.push(a)
    }
    if (files.size > 0) out.set(dir, { files, abs })
  }
  return out
}

function relOf(abs: string, root: string): string | null {
  const a = abs.split("\\").join("/")
  const r = root.split("\\").join("/").replace(/\/+$/, "")
  if (!a.startsWith(r + "/")) return null
  return a.slice(r.length + 1)
}

/** The candidate the analyzer computes — kept in step with `dependencyFileClaim` by construction:
 *  same spellings, same refusals, same manifest list. */
function manifestCandidate(written: string, filePath: string, projectRoot: string): { rel: string; exists: boolean } | null {
  const w = written.trim()
  if (w.length === 0 || w.length > 300) return null
  for (const ch of [" ", "\t", "*", "?", "<", ">", "|", "{", "}", "$"]) if (w.includes(ch)) return null
  if (w.startsWith("/") || w.startsWith("~") || w.includes("://")) return null
  const root = path.resolve(projectRoot)
  const abs = path.resolve(path.dirname(filePath), w)
  const posix = path.relative(root, abs).split(path.sep).join("/")
  if (posix === ".." || posix.startsWith("../")) return null // escapes the project
  for (const m of MANIFESTS) {
    const cand = posix.length === 0 ? m : `${posix}/${m}`
    if (fileExists(path.join(root, cand))) return { rel: cand, exists: true }
  }
  if (posix.length > 0 && fileExists(path.join(root, posix))) return { rel: posix, exists: true }
  return { rel: posix, exists: false }
}

const repos = discover("toml")
let edges = 0, noCandidate = 0
let verified = 0, refuted = 0
let fsTrue = 0, fsFalse = 0, fsTrueButRefuted = 0, fsFalseButVerified = 0
const verifyExamples: string[] = []
const refuteExamples: string[] = []
const noCandExamples: string[] = []
const crossExamples: string[] = []

for (const [repo, facts] of repos) {
  for (const abs of facts.abs) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    let res: any
    try { res = new Analyzer().analyze((await parser.parse(content, abs)).rootNode, content, abs, { projectRoot: repo } as any) } catch { continue }
    for (const r of res.relationships ?? []) {
      if (String(r.type) !== "imports") continue
      edges++
      const tgt = String(r.target)
      const cand = manifestCandidate(tgt, abs, repo)
      if (cand === null) {
        noCandidate++
        if (noCandExamples.length < 12) noCandExamples.push(`${tgt.padEnd(24)} (${relOf(abs, CR) ?? abs})`)
        continue
      }
      const admitted = facts.files.has(cand.rel)
      if (cand.exists) fsTrue++; else fsFalse++
      if (admitted) { verified++; if (verifyExamples.length < 6) verifyExamples.push(`${tgt.padEnd(24)} -> ${cand.rel}   (${relOf(abs, CR) ?? abs})`) }
      else { refuted++; if (refuteExamples.length < 12) refuteExamples.push(`${tgt.padEnd(24)} -> ${cand.rel}   (${relOf(abs, CR) ?? abs})`) }
      if (cand.exists && !admitted) {
        fsTrueButRefuted++
        if (crossExamples.length < 12) crossExamples.push(`fs TRUE but gate REFUTES: ${tgt} -> ${cand.rel}  (${relOf(abs, CR) ?? abs})`)
      }
      if (!cand.exists && admitted) {
        fsFalseButVerified++
        if (crossExamples.length < 12) crossExamples.push(`fs FALSE but gate VERIFIES: ${tgt} -> ${cand.rel}  (${relOf(abs, CR) ?? abs})`)
      }
    }
  }
}

console.log(`repos with admitted .toml: ${repos.size}`)
console.log(`imports edges: ${edges}`)
console.log(`  candidate computable and the project VERIFIES it : ${verified}`)
console.log(`  candidate computable but the project REFUTES it  : ${refuted}`)
console.log(`  no candidate (no root / escapes / not a path)    : ${noCandidate}`)
console.log(`\nFS CROSS-TAB: fs test true ${fsTrue} · false ${fsFalse}`)
console.log(`  fs TRUE but gate REFUTES  : ${fsTrueButRefuted}`)
console.log(`  fs FALSE but gate VERIFIES: ${fsFalseButVerified}`)
for (const e of crossExamples) console.log(`  ${e}`)
console.log(`\nVERIFY examples:`)
for (const e of verifyExamples) console.log(`  ${e}`)
console.log(`\nNO-CANDIDATE examples (${noCandidate}):`)
for (const e of noCandExamples) console.log(`  ${e}`)
console.log(`\nwould-REFUTE examples (${refuted}):`)
for (const e of refuteExamples) console.log(`  ${e}`)
