/**
 * THE FLEET `imports` CEILING — does it GENERALISE?
 *
 * Eight lanes share one cause (protobuf · graphql · clean · scss · r · hcl · lua · fsharp, 15,410
 * edges): a language import names a FILE (or a module that maps to one), and the declaration key space
 * cannot answer a file. lua has already moved its share, so the cause is fixable one lane at a time.
 * **THE QUESTION HERE IS THE CEILING: for each lane, how many imports name a file the lane's ADMITTED
 * population actually carries — and how many would REFUTE if claimed?**
 *
 * A claim that misses is REFUTED, so the refute column is not decoration: it is why the guard's
 * admitted-extension clause exists (by shape alone, 392 edges would have refuted across five lanes).
 *
 * THE ARITHMETIC IS PER LANE AND IS STATED BESIDE ITS RESULT — a shared rule would have mis-bound
 * clean, whose targets are `Module:item` and not paths at all, and lua, whose `require("a.b")` means
 * `a/b.lua`.
 *
 * Prints EACH LANE as it completes, so a bounded run that times out still leaves every finished lane's
 * number. Extensions come from the gate's own `LANES_B` table, not from a guess.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/fleet-imports-ceiling.mts --files=100
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=100").split("=")[1])
const ONLY = (process.argv.find((a) => a.startsWith("--lane=")) ?? "").split("=")[1] ?? null
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

type Rule = "path" | "lua" | "clean" | "scss"
const LANES: { lane: string; exts: string[]; rule: Rule }[] = [
  { lane: "protobuf", exts: ["proto"], rule: "path" },
  { lane: "graphql", exts: ["graphql", "gql"], rule: "path" },
  { lane: "clean", exts: ["icl", "dcl"], rule: "clean" },
  { lane: "scss", exts: ["scss"], rule: "scss" },
  { lane: "r", exts: ["r"], rule: "path" },
  { lane: "hcl", exts: ["tf", "hcl", "tfvars", "tofu"], rule: "path" },
  { lane: "lua", exts: ["lua"], rule: "lua" },
  { lane: "fsharp", exts: ["fs", "fsi", "fsx"], rule: "path" },
]

const isFile = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }
const dirOf = (rel: string): string => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i + 1) }
/**
 * NORMALISE A CANDIDATE THE WAY THE GUARD DOES — collapse `.` and `..`, refuse an escape.
 *
 * WITHOUT THIS THE REFUTE COLUMN IS AN INSTRUMENT ARTEFACT: a candidate like
 * `pkg/import-fragments/./fragments/b.gql` EXISTS on disk (`path.join` normalises it) while the
 * admitted set spells it `pkg/import-fragments/fragments/b.gql`, so the probe counted a refutation that
 * the real guard — which folds first — never makes. The first run of this probe reported 37 graphql,
 * 234 scss and 12 lua refutations that were all this, and the gate's own `extFAIL 0` for those lanes is
 * the evidence they are not real.
 */
function normalise(c: string): string | null {
  const out: string[] = []
  for (const seg of c.split("/")) {
    if (seg.length === 0 || seg === ".") continue
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  return out.length > 0 ? out.join("/") : null
}
const plain = (t: string): boolean => t.length > 0 && t.length <= 300 && !t.includes("://") && !t.startsWith("/") && !t.startsWith("~")

/** The candidate spellings a lane's own arithmetic produces, all PROJECT-RELATIVE-ish (folded here). */
function candidatesFor(rule: Rule, t: string, rel: string): string[] {
  const fileDir = dirOf(rel).replace(/\/$/, "")
  const bases = [fileDir, "", ...(() => { const out: string[] = []; let d = fileDir; while (d.length > 0) { out.push(d); d = dirOf(d).replace(/\/$/, "") } return out })()]
  const uniq = (xs: string[]) => [...new Set(xs.map(normalise).filter((x): x is string => x !== null && x.length > 0))]
  const withBases = (spelling: string) => uniq(bases.map((b) => (b.length === 0 ? spelling : `${b}/${spelling}`)))
  if (rule === "path") return withBases(t)
  if (rule === "lua") {
    const dotted = t.split(".").join("/")
    return uniq([...withBases(t), ...withBases(`${dotted}.lua`), ...withBases(`${dotted}/init.lua`)])
  }
  if (rule === "clean") {
    const mod = (t.includes(":") ? t.slice(0, t.indexOf(":")) : t).split(".").join("/")
    return uniq([...withBases(`${mod}.icl`), ...withBases(`${mod}.dcl`)])
  }
  // scss: the specifier plus Sass partial/index spellings, `.sass` EXCLUDED (another language).
  const cut = t.lastIndexOf("/")
  const dir = cut < 0 ? "" : t.slice(0, cut + 1)
  const leaf = cut < 0 ? t : t.slice(cut + 1)
  const stems = [t, ...(leaf.startsWith("_") ? [] : [`${dir}_${leaf}`])]
  const out: string[] = []
  for (const st of stems) {
    for (const ext of [".scss", ""]) if (ext === "" ? /\.(scss|sass|css)$/i.test(st) : true) out.push(...withBases(st + ext))
    for (const idx of ["_index.scss", "index.scss"]) out.push(...withBases(`${st}/${idx}`))
  }
  return uniq(out)
}

for (const spec of LANES) {
  if (ONLY !== null && ONLY !== spec.lane) continue
  const extSet = new Set(spec.exts)
  let edges = 0, verify = 0, refute = 0, residue = 0, files = 0, population = 0
  const verifyEx: string[] = []
  const refuteEx: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const repo = path.join(CR, name)
    try { if (!statSync(repo).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    const admitted = new Set<string>()
    let wanted: string[] = []
    for (const r of tracked) {
      if (!extSet.has(r.slice(r.lastIndexOf(".") + 1).toLowerCase())) continue
      const abs = path.join(repo, r)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      admitted.add(r.split("/").join("/"))
      wanted.push(abs)
    }
    if (wanted.length === 0) continue
    population += wanted.length
    wanted = wanted.sort()
    if (SAMPLE > 0 && wanted.length > SAMPLE) {
      const stride = wanted.length / SAMPLE
      const sel: string[] = []
      for (let i = 0; i < SAMPLE; i++) sel.push(wanted[Math.floor(i * stride)])
      wanted = [...new Set(sel)].sort()
    }
    for (const abs of wanted) {
      files++
      const rel = path.relative(repo, abs).split(path.sep).join("/")
      let res: any
      try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
      for (const r of res.relationships ?? []) {
        if (String(r.type) !== "imports") continue
        const t = String(r.target ?? "").trim()
        if (!plain(t)) continue
        edges++
        const cands = candidatesFor(spec.rule, t, rel)
        const hit = cands.find((c) => admitted.has(c)) ?? null
        if (hit !== null) { verify++; if (verifyEx.length < 2) verifyEx.push(`${t.slice(0, 34)} -> ${hit}`); continue }
        const fsHit = cands.find((c) => isFile(path.join(repo, c))) ?? null
        if (fsHit !== null) { refute++; if (refuteEx.length < 2) refuteEx.push(`${t.slice(0, 34)} -> ${fsHit} (on disk, not admitted)`); continue }
        residue++
      }
    }
  }
  const pct = edges > 0 ? `${((100 * verify) / edges).toFixed(1)}%` : "-"
  console.log(`${spec.lane.padEnd(9)} [${spec.rule.padEnd(5)}] ${String(files).padStart(5)}/${String(population).padStart(6)} files · imports ${String(edges).padStart(6)} · VERIFY ${String(verify).padStart(5)} (${pct}) · would-REFUTE ${String(refute).padStart(4)} · residue ${String(residue).padStart(5)}`)
  for (const e of verifyEx) console.log(`            e.g. ${e}`)
  for (const e of refuteEx) console.log(`            REFUTE ${e}`)
}
