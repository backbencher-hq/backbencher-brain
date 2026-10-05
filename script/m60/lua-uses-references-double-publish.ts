/**
 * M14 ONTOLOGY — LUA WAVE-2. Is a qualified access published TWICE?
 *
 * The A/B in lua-grammar-shape.ts measured, on `local v = t.reset`:
 *
 *     references: global -> reset @L2
 *     uses:       global -> reset @L2
 *
 * One member access, one span, two labels. `emitNameRead` excludes only
 * `namedChild(0)` — the RECEIVER — so the FIELD identifier reaches `uses`
 * as well, and `emitMemberRead` publishes the same member as `references`.
 * Pass 1's own doc states the exclusion as "the head of a qualified name is not
 * read on its own account", which is true and is about the head; it does not
 * claim the field is excluded, and the field is not.
 *
 * That makes it a double publication: the same fact under two labels, which is
 * the class the JSON lane was convicted of. Whether it is a DEFECT or a
 * deliberate two-label encoding is decided by what the analyzer does with the
 * two labels downstream, so this measures the PAIRING directly: for every
 * member access in the corpus, is there a `uses` edge AND a `references` edge
 * for the same member on the same line?
 *
 * Multi-character names only. lua-grammar-shape.ts saw `M.a.b` produce
 * `references -> b` and NO `uses -> b`, while `t.reset` produced both, so
 * something downstream is dropping short targets and the size of the class
 * cannot be read off a two-name fixture.
 *
 * USAGE: npx tsx script/m60/lua-uses-references-double-publish.ts [--cap N]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.resolve(ROOT, process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]!
  : "validation/m60/lua/uses-references-double-publish.json")
const CAPN = Number(process.argv.includes("--cap") ? process.argv[process.argv.indexOf("--cap") + 1] : "0")

// ── fixture A/B, multi-character names only
const DIR = "/tmp/opencode/lua-lane/double-publish"
mkdirSync(DIR, { recursive: true })
const FIX: Record<string, string> = {
  "one-level-read": `local tbl = {}\nlocal value = tbl.member\n`,
  "two-level-read": `local tbl = {}\nlocal value = tbl.inner.member\n`,
  "method-read": `local tbl = {}\nlocal value = tbl:method()\n`,
  "bracket-read": `local tbl = {}\nlocal value = tbl["member"]\n`,
  "call-of-member": `local tbl = {}\ntbl.member()\n`,
  "bare-read": `local name = "x"\nlocal other = name\n`,
}
const fixReport: Record<string, any> = {}
for (const [k, src] of Object.entries(FIX)) {
  const p = path.join(DIR, `${k}.lua`)
  writeFileSync(p, src)
  const r: any = await parseFile(p, DIR)
  const rels = (r.relationships ?? []).map((x: any) => `${String(x.type).toLowerCase()}:${x.source}->${x.target}@L${x.line_number}`)
  fixReport[k] = { source: src.replace(/\n/g, " \\n "), edges: rels }
  console.log(`\n${k}:  ${src.replace(/\n/g, " \\n ")}`)
  for (const e of rels) console.log(`    ${e}`)
}

// ── corpus: does a `uses` edge pair with a `references` edge on the same member?
const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked) files.push({ repo: e, rel, abs: path.join(dir, rel) })
}
const draw = CAPN > 0 ? files.slice(0, CAPN) : files

let memberAccesses = 0
let pairedBoth = 0
let usesOnly = 0
let refsOnly = 0
const examples: string[] = []
const pairsByRepo: Record<string, number> = {}
for (const f of draw) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo)) } catch { continue }
  const rels: any[] = r.relationships ?? []
  // Key on (target, line) rather than (source, target, line): the two labels are
  // emitted from the same member node, so the line is the discriminator that
  // survives pool-worker's per-file dedupe.
  const uses = new Set<string>()
  const refs = new Set<string>()
  for (const x of rels) {
    const t = String(x.type).toLowerCase()
    if (t !== "uses" && t !== "references") continue
    const k = `${x.target}\u0000${x.line_number}`
    if (t === "uses") uses.add(k)
    else refs.add(k)
  }
  let fileBoth = 0
  for (const k of uses) {
    memberAccesses++
    if (refs.has(k)) { pairedBoth++; fileBoth++ } else usesOnly++
  }
  for (const k of refs) { memberAccesses++; if (!uses.has(k)) refsOnly++ }
  if (fileBoth) {
    pairsByRepo[f.repo] = (pairsByRepo[f.repo] ?? 0) + fileBoth
    if (examples.length < 30) {
      for (const k of uses) if (refs.has(k)) { examples.push(`${f.repo}/${f.rel}: ${k.replace("\u0000", " @L")}`); break }
    }
  }
}

const out = {
  schemaVersion: 1, kind: "lua-uses-references-double-publish",
  claim: "a qualified member access is published BOTH as `references -> field` and as `uses -> field`, because emitNameRead excludes only the receiver (namedChild(0)) and not the field identifier.",
  fixture: fixReport,
  corpus: {
    filesScanned: draw.length,
    memberEdgesTotal: memberAccesses,
    pairedOnSameMemberAndLine: pairedBoth,
    usesOnly, referencesOnly: refsOnly,
    pairedPctOfMemberEdges: memberAccesses ? Number(((pairedBoth / memberAccesses) * 100).toFixed(2)) : 0,
    filesWithPairs: Object.values(pairsByRepo).filter((v) => v > 0).length,
    pairsByRepo, examples,
  },
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\n=== CORPUS over ${draw.length} files ===`)
console.log(`uses+references edges on the same member AND line: ${pairedBoth}`)
console.log(`uses-only: ${usesOnly}   references-only: ${refsOnly}   total member edges: ${memberAccesses}`)
console.log(`paired share: ${out.corpus.pairedPctOfMemberEdges}%   files with >=1 pair: ${out.corpus.filesWithPairs}`)
for (const [k, v] of Object.entries(pairsByRepo).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(v).padStart(7)}  ${k}`)
console.log(`-> ${OUT}`)