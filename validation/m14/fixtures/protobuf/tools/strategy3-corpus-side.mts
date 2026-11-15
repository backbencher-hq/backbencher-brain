/**
 * STRATEGY 3'S BLAST RADIUS, CORPUS-SIDE — the per-language share r-lane could not measure.
 *
 * r-lane's number (hcl's banked 13 repos, ONE store): `uses` 501 signature rows, 471 other-file;
 * `references` 8,572, 2,883 other-file. Its own artifact says the per-language fleet number **needs a
 * store run per language** — and a whole-population store per lane does not fit this machine tonight.
 *
 * SO THIS MEASURES THE SAME POPULATION FROM THE OTHER SIDE, on the production path, with NO store:
 * Strategy 3's query is `sym.name = SUBSTR(target_external, INSTR(target_external,'.')+1)` — the
 * substring after the FIRST dot. A row CAN carry that signature only if the PROJECT publishes a
 * declaration named that substring. So for every edge whose target has a dot:
 *
 *   CANDIDATE      the project publishes `SUBSTR(target, after the first dot)`
 *     SAME-FILE      ... and the edge's own file is where it is published (unchanged by construction)
 *     OTHER-FILE     ... and only OTHER files publish it  <- the fix's re-pointable population
 *   NOT-A-CANDIDATE  nothing publishes the substring, so the signature cannot bind
 *
 * IT IS AN UPPER BOUND ON THE BLAST RADIUS and is the same kind of number as r-lane's "population the fix
 * COULD re-point"; the STORE column (whether a row was ACTUALLY bound that way) still needs a store run
 * per language, and this is what says which lanes that run is worth spending on.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/strategy3-corpus-side.mts --files=60
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=60").split("=")[1])
const ONLY = (process.argv.find((a) => a.startsWith("--lane=")) ?? "").split("=")[1] ?? null
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

// Extensions from the gate's LANES_B table.
const LANES: { lane: string; exts: string[] }[] = [
  { lane: "protobuf", exts: ["proto"] },
  { lane: "graphql", exts: ["graphql", "gql"] },
  { lane: "clean", exts: ["icl", "dcl"] },
  { lane: "scss", exts: ["scss"] },
  { lane: "r", exts: ["r"] },
  { lane: "hcl", exts: ["tf", "hcl", "tfvars", "tofu"] },
  { lane: "lua", exts: ["lua"] },
  { lane: "fsharp", exts: ["fs", "fsi", "fsx"] },
  { lane: "php", exts: ["php"] },
  { lane: "toml", exts: ["toml"] },
]

for (const spec of LANES) {
  if (ONLY !== null && ONLY !== spec.lane) continue
  const extSet = new Set(spec.exts)
  // name -> the files that publish it (own-file vs other-file needs the FILE, not just the name)
  let edges = 0, dotted = 0, candidate = 0, sameFile = 0, otherFile = 0
  const examples: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const repo = path.join(CR, name)
    try { if (!statSync(repo).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    const wanted: string[] = []
    for (const rel of tracked) {
      if (!extSet.has(rel.slice(rel.lastIndexOf(".") + 1).toLowerCase())) continue
      const abs = path.join(repo, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      wanted.push(abs)
    }
    if (wanted.length === 0) continue
    wanted.sort()
    let pick = wanted
    if (SAMPLE > 0 && pick.length > SAMPLE) {
      const stride = pick.length / SAMPLE
      const sel: string[] = []
      for (let i = 0; i < SAMPLE; i++) sel.push(pick[Math.floor(i * stride)])
      pick = [...new Set(sel)].sort()
    }
    const publishers = new Map<string, Set<string>>()
    const parsed: { rel: string; rels: any[] }[] = []
    for (const abs of pick) {
      const rel = path.relative(repo, abs).split(path.sep).join("/")
      let res: any
      try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
      parsed.push({ rel, rels: res.relationships ?? [] })
      for (const s of res.symbols ?? []) {
        for (const nm of [String(s.name ?? ""), String(s.qualifiedName ?? "")]) {
          if (nm.length === 0) continue
          const set = publishers.get(nm) ?? new Set<string>()
          set.add(rel)
          publishers.set(nm, set)
        }
      }
    }
    for (const { rel, rels } of parsed) {
      for (const r of rels) {
        const type = String(r.type ?? "")
        if (type !== "uses" && type !== "references") continue
        const t = String(r.target ?? "").trim()
        if (t.length === 0) continue
        edges++
        const dot = t.indexOf(".")
        if (dot <= 0 || dot >= t.length - 1) continue
        dotted++
        const sub = t.slice(dot + 1)
        const files = publishers.get(sub)
        if (files === undefined || files.size === 0) continue
        candidate++
        const others = [...files].filter((f) => f !== rel)
        if (others.length > 0) {
          otherFile++
          if (examples.length < 3) examples.push(`${t.slice(0, 34).padEnd(36)} -> ${sub} declared in ${others[0]}   (${rel})`)
        } else sameFile++
      }
    }
  }
  const pct = (n: number) => edges > 0 ? `${((100 * n) / edges).toFixed(2)}%` : "-"
  console.log(`${spec.lane.padEnd(9)} uses+references ${String(edges).padStart(6)} · dotted ${String(dotted).padStart(6)} · CANDIDATE ${String(candidate).padStart(5)} (${pct(candidate)}) · otherFile ${String(otherFile).padStart(5)} · sameFile ${sameFile}`)
  for (const e of examples) console.log(`            e.g. ${e}`)
}
