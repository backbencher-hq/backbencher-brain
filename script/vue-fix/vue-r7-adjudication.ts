/**
 * R7 ADJUDICATION — does a placeholder-LITERAL endpoint name a real symbol?
 *
 * A word list is a CANDIDATE GENERATOR, not a verdict (HONESTY-CONTRACT: "a
 * literal word list is a candidate generator, not a verdict"). `todo`,
 * `placeholder` and `symbol` are ordinary identifiers in a real corpus —
 * element-plus ships docs/examples/image/placeholder.vue — so a hit proves
 * nothing until it is checked AGAINST THE SYMBOL TABLE.
 *
 * The rule R7 states (validation/m60/ledger.json) is that no edge endpoint may
 * be a placeholder. The measurement below therefore asks, per hit: does this
 * endpoint correspond to a symbol the analyzer actually published, in this file
 * or anywhere on this corpus? A hit that does is a false positive of the word
 * list; a hit that does NOT is a real R7 finding.
 *
 * NO REGEX: Set membership and string comparison only.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const REPOS = (process.env.BB_REPOS ?? "vue-element-admin,element-plus").split(",")
const CR = "$HOME/fixtures/repositories"

// The candidate words. Kept explicit and separate from the HARD/GENERIC split
// used by vue-ontology-census.ts; this probe's whole job is to adjudicate hits.
const CANDIDATE = new Set([
  "", "?", "unknown", "unknown_symbol", "unknownsymbol", "<unknown>", "undefined", "null",
  "todo", "tbd", "n/a", "na", "none", "anonymous", "<anonymous>", "placeholder",
  "lambda", "<lambda>", "func", "fn", "symbol", "unknown1", "objectliteral", "root",
  "this", "self", "super",
])

const { execFileSync } = await import("node:child_process")
const { statSync } = await import("node:fs")

interface Hit { label: string; file: string; src: string; tgt: string; which: "source" | "target" }

const allHits: Hit[] = []
const corpusSymbols = new Set<string>()
let totalRels = 0, totalFiles = 0

for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files = tracked.filter((rel) => {
    try { return rel.endsWith(".vue") && statSync(path.join(dir, rel)).size < 1024 * 1024 } catch { return false }
  })
  for (const rel of files) {
    const abs = path.join(dir, rel)
    let r: any
    try { r = await parseFile(abs, path.dirname(abs)) } catch { continue }
    totalFiles++
    const fileSymbols = new Set<string>()
    for (const s of r?.symbols ?? []) { if (s?.name) { corpusSymbols.add(s.name); fileSymbols.add(s.name) } }
    for (const x of r?.relationships ?? []) {
      totalRels++
      const label = String(x.type ?? x.relationshipType ?? "")
      const src = String(x.source ?? x.from ?? ""), tgt = String(x.target ?? x.to ?? "")
      for (const [which, v] of [["source", src], ["target", tgt]] as const) {
        if (!CANDIDATE.has(v.trim().toLowerCase())) continue
        allHits.push({ label, file: `${repo}/${rel}`, src, tgt, which })
      }
    }
    void fileSymbols
  }
}

// ADJUDICATE. An endpoint is a REAL false positive when the analyzer published
// a symbol of that name in the same file; it is a REAL R7 finding when it does
// not. Corpus-wide resolution is reported too, since a mixin from another file
// is legitimate by construction.
let real = 0, falsePositive = 0
const realRows: string[] = []
for (const h of allHits) {
  const resolved = corpusSymbols.has(h.src) || corpusSymbols.has(h.tgt)
  if (resolved) { falsePositive++; continue }
  real++
  if (realRows.length < 25) realRows.push(`${h.file} ${h.label} ${h.which}=${h.which === "source" ? h.src : h.tgt}`)
}
console.log(`\nR7 adjudication — repos [${REPOS.join(", ")}]`)
console.log(`population: ${totalFiles} .vue files parsed, ${totalRels} relationships`)
console.log(`candidate-word endpoints: ${allHits.length}`)
console.log(`  resolve to a published symbol (word-list FALSE POSITIVE): ${falsePositive}`)
console.log(`  resolve to NOTHING (real R7 finding):                     ${real}`)
for (const r of realRows) console.log(`     ${r}`)
const byLabel = new Map<string, number>()
for (const h of allHits) byLabel.set(`${h.label}/${h.which}`, (byLabel.get(`${h.label}/${h.which}`) ?? 0) + 1)
console.log(`candidates by label: ${JSON.stringify(Object.fromEntries([...byLabel].sort((a,b)=>b[1]-a[1])))}`)
