/**
 * ELIXIR lane differential — a FIXED-SAMPLE, per-file, error-visible re-run of
 * the F5 lane's comparison for this language only.
 *
 * WHY THIS TOOL EXISTS (2026-09-28). The F5 harness
 * (script/m14/differential.ts) compares the analyzer against the same exported
 * oracle this tool uses, but three of its properties make an ELIXIR-lane number
 * untrustworthy on a shared box right now:
 *   1. its per-file `catch { continue }` turns an analyzer exception into a
 *      silent COVERAGE COLLAPSE (measured this session: a lane reporting
 *      4.6% / MISSING=3483 with 0 unexplained, no error, while the analyzer ran
 *      clean over 559/559 corpus files);
 *   2. its cold pool DRAWS A DIFFERENT 60 files per run, so two numbers are two
 *      file sets unless BB_F5_FREEZE_POOL=1 pins it (the harness's own comment
 *      records a 98.4% -> 92.4% "movement" caused by exactly that);
 *   3. the file is under active edit by another lane, so a run can read a
 *      half-written harness and print nothing.
 * This tool takes the same inputs — the real analyzer via ASTEngine.parseFile
 * and the harness's own exported `deriveElixirEdges` oracle + `normTarget`
 * normalization — and reports per FILE, on a sample that is a pure function of
 * (repo, file list), with nothing swallowed.
 *
 * CLI: npx tsx script/m14/tmp/elixir-lane-diff.ts --repos=ecto_sql,ash --per-repo=60 [--verbose]
 *
 * ORACLE SOURCE. By default the live `script/m14/differential.ts`; point
 * BB_DIFF_SNAPSHOT at a snapshot to name the exact bytes a number was taken
 * against while another lane is editing the shared harness (recorded with its
 * md5 in the output).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPOS = (arg("repos") ?? "elixir,phoenix,ecto,ecto_sql,ash,wallaby").split(",").filter(Boolean)
const PER = Number(arg("per-repo") ?? "60")
const VERBOSE = process.argv.includes("--verbose")

/** The labels the F5 lane compares for elixir (mirrored from its filter chain:
 *  extends/implements/instantiates/overrides + calls + references; `contains` is
 *  deliberately outside the compared set — the adversarial wave registered those
 *  9,029 corpus edges as gate-invisible, and the deep audit audits them instead). */
const COMPARABLE = new Set(["extends", "implements", "instantiates", "overrides", "calls", "references"])

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}

/** Deterministic sample: sort, then take every stride-th file. Independent of
 *  run order, of the cold pool, and of any other lane. */
function pick(files: string[], n: number): string[] {
  if (n <= 0 || n >= files.length) return files
  const step = files.length / n
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(files[Math.floor(i * step)]!)
  return [...new Set(out)]
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const oraclePath = process.env.BB_DIFF_SNAPSHOT ?? path.join(ROOT, "script/m14/differential.ts")
  if (!fs.existsSync(oraclePath)) throw new Error(`oracle source missing: ${oraclePath}`)
  const diff: any = await import(oraclePath)
  const deriveElixirEdges = diff.deriveElixirEdges
  const normTarget = diff.normTarget ?? ((t: string) => t.split(".").pop() ?? t)
  if (typeof deriveElixirEdges !== "function") throw new Error("deriveElixirEdges is not exported — the oracle harness is mid-edit")
  const oracleMd5 = createHash("md5").update(fs.readFileSync(oraclePath)).digest("hex")
  console.log(`oracle=${oraclePath} md5=${oracleMd5}`)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const parser = new P(); parser.setLanguage(g)

  let truthTotal = 0, covTotal = 0, missTotal = 0, unexpTotal = 0, anTotal = 0
  const perRepo: any[] = []
  const allMissing: string[] = []
  const allUnexp: string[] = []

  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) { console.log(`[skip] ${repo} not present`); continue }
    const files = walk(dir).sort()
    const sample = pick(files, PER)
    let truth = 0, cov = 0, miss = 0, unexp = 0, an = 0, threw = 0
    for (const f of sample) {
      const content = fs.readFileSync(f, "utf8")
      const root = parser.parse(content).rootNode
      let truthEdges: any[] = []
      let rels: any[] = []
      try { truthEdges = deriveElixirEdges(root) as any[] } catch (e: any) { console.log(`  ORACLE THREW ${path.relative(dir, f)}: ${e?.message}`); continue }
      try {
        const res: any = await ASTEngine.parseFile(f, content)
        rels = (res.relationships ?? []).map((r: any) => ({ label: r.type, target: String(r.target), source: r.source }))
      } catch (e: any) { threw++; console.log(`  ANALYZER THREW ${path.relative(dir, f)}: ${e?.constructor?.name}: ${e?.message}`); continue }
      const tEdges = truthEdges.filter((e: any) => COMPARABLE.has(e.label))
      // collapse analyzer duplicates per (label|target) — the harness's rule
      const seen = new Set<string>()
      const aEdges = rels.filter((r: any) => {
        if (!COMPARABLE.has(r.label)) return false
        const k = `${r.label}|${r.target}`
        if (seen.has(k)) return false
        seen.add(k); return true
      })
      truth += tEdges.length; an += aEdges.length
      for (const te of tEdges) {
        if (aEdges.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) cov++
        else { miss++; if (allMissing.length < 40) allMissing.push(`${path.relative(dir, f)}  MISSING ${te.label} ${te.from} -> ${te.target}`) }
      }
      for (const ae of aEdges) {
        if (!tEdges.some((te: any) => te.label === ae.label && normTarget(te.target) === normTarget(ae.target))) {
          unexp++
          if (allUnexp.length < 40) allUnexp.push(`${path.relative(dir, f)}  UNEXPLAINED ${ae.label} ${ae.source} -> ${ae.target}`)
        }
      }
    }
    truthTotal += truth; covTotal += cov; missTotal += miss; unexpTotal += unexp; anTotal += an
    const pct = truth ? (cov / truth) * 100 : 100
    perRepo.push({ repo, files: sample.length, treeTruth: truth, covered: cov, coveragePct: Math.round(pct * 10) / 10, missing: miss, analyzerEdges: an, unexplained: unexp, pctUnexplained: an ? Math.round((unexp / an) * 1000) / 10 : 0, analyzerThrew: threw })
    console.log(`${repo.padEnd(10)} files=${String(sample.length).padStart(4)} tree-truth=${String(truth).padStart(6)} covered=${String(cov).padStart(6)} (${pct.toFixed(1)}%) MISSING=${String(miss).padStart(5)} | analyzer-edges=${String(an).padStart(5)} unexplained=${unexp}${threw ? ` ANALYZER-THREW=${threw}` : ""}`)
  }

  const hash = createHash("sha256")
  for (const r of perRepo) hash.update(`${r.repo}:${r.files}:${r.treeTruth}:${r.analyzerEdges}\n`)
  console.log(`\nTOTAL tree-truth=${truthTotal} covered=${covTotal} (${((covTotal / Math.max(1, truthTotal)) * 100).toFixed(1)}%) MISSING=${missTotal} | analyzer-edges=${anTotal} unexplained=${unexpTotal}`)
  console.log(`sample fingerprint = ${hash.digest("hex").slice(0, 16)}`)
  if (allMissing.length) { console.log("\n--- MISSING (oracle edge the analyzer does not emit) ---"); for (const m of allMissing) console.log("  " + m) }
  if (allUnexp.length) { console.log("\n--- UNEXPLAINED (analyzer edge the oracle does not derive) ---"); for (const m of allUnexp) console.log("  " + m) }
  console.log(JSON.stringify(perRepo))
}
main().catch((e) => { console.error(e); process.exit(1) })
