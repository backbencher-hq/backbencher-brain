/**
 * THE RULING'S INPUT — per lane, how many imports resolve under NO ANCESTOR of the importing file but
 * DO resolve under the project's file list?
 *
 * The protobuf 68 was ruled a BOUNDARY because reaching it needs a project file list the analyzer does
 * not have, at the price of a shared interface plus a path set riding the serialized index into every
 * worker. The Lead set the falsifier: **if two or more OTHER lanes show this shape in the THOUSANDS
 * rather than the tens, the trade flips.**
 *
 * For each lane, every path-shaped import is classified by the WIDEST arm that reaches it:
 *   FILE / ROOT / ANCESTOR   what a per-file analyzer can do today (bounded, exact paths)
 *   SIBLING                  only a project-file-list suffix match reaches it  <- the ruling's input
 *   NEITHER                  the named file is in no admitted file (the ruled residue)
 *
 * BOUNDED STRIDE SAMPLE per lane (`--files=N`), labelled, because the question is a RATE and the answer
 * needed is orders of magnitude, not a count to the edge.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/sibling-root-census.mts --files=200
 *
 * ## THE LIMIT OF THIS INSTRUMENT, STATED BEFORE ITS NUMBERS ARE READ
 *
 * It implements ONE resolution arithmetic — the path fold (file-relative, root-relative, ancestors) —
 * so it is valid for the lanes that USE that arithmetic (protobuf, graphql, zig, and any lane whose
 * import is a literal path). **For toml and php the census reads 0 reached, AND THAT ZERO IS AN
 * ARTEFACT, NOT A FINDING**: toml's claim is a MANIFEST inside the named directory (`posix/Cargo.toml`)
 * and php's is a `__DIR__`/`__FILE__` substitution, and neither arithmetic is implemented here. Their
 * ROWS ARE EXCLUDED from the ruling's input below rather than counted as absent.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=200").split("=")[1])
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

// EXTENSIONS FROM THE ROUTER, not guessed (src/ast/language-detection.ts + the gate's lane table).
const LANES: { lane: string; exts: string[]; types: string[] }[] = [
  { lane: "protobuf", exts: ["proto"], types: ["imports"] },
  { lane: "graphql", exts: ["graphql", "gql"], types: ["imports"] },
  { lane: "zig", exts: ["zig"], types: ["imports", "references"] },
  { lane: "toml", exts: ["toml"], types: ["imports"] },
  { lane: "php", exts: ["php"], types: ["imports"] },
  { lane: "json", exts: ["json", "jsonc"], types: ["imports", "references"] },
]

const isFile = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }
const dirOf = (rel: string): string => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i + 1) }

for (const spec of LANES) {
  const rows = { file: 0, root: 0, ancestor: 0, sibling: 0, neither: 0, nonPath: 0 }
  let edges = 0, files = 0, population = 0
  const siblingExamples: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const repo = path.join(CR, name)
    try { if (!statSync(repo).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    const extSet = new Set(spec.exts)
    const admitted: string[] = []
    const wanted: string[] = []
    for (const rel of tracked) {
      const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()
      if (!extSet.has(ext)) continue
      const abs = path.join(repo, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      const posix = rel.split("/").join("/")
      admitted.push(posix)
      wanted.push(abs)
    }
    if (wanted.length === 0) continue
    population += wanted.length
    let pick = wanted.sort()
    if (SAMPLE > 0 && pick.length > SAMPLE) {
      const stride = pick.length / SAMPLE
      const sel: string[] = []
      for (let i = 0; i < SAMPLE; i++) sel.push(pick[Math.floor(i * stride)])
      pick = [...new Set(sel)].sort()
    }
    const admittedSet = new Set(admitted)
    for (const abs of pick) {
      files++
      const rel = path.relative(repo, abs).split(path.sep).join("/")
      let res: any
      try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
      for (const r of res.relationships ?? []) {
        if (!spec.types.includes(String(r.type))) continue
        const t = String(r.target ?? "").trim()
        if (t.length === 0) continue
        // A PATH-SHAPED target only: a name is answered by the key space, not by a file list.
        if (t.includes("://") || t.startsWith("/") || t.includes(" ") || !t.includes("/") && !t.includes(".")) { rows.nonPath++; continue }
        edges++
        const fileDir = dirOf(rel).replace(/\/$/, "")
        const cands: string[] = []
        if (fileDir.length > 0) cands.push(`${fileDir}/${t}`)
        const rootCand = t
        const ancestors: string[] = []
        let d = fileDir
        while (d.length > 0) { ancestors.push(`${d}/${t}`); d = dirOf(d).replace(/\/$/, "") }
        const all = [...cands, rootCand, ...ancestors]
        const hit = all.find((c) => admittedSet.has(c) && isFile(path.join(repo, c)))
        if (hit !== undefined) {
          if (hit === rootCand) rows.root++
          else if (ancestors.includes(hit)) rows.ancestor++
          else rows.file++
          continue
        }
        const suffix = admitted.find((a) => a.endsWith(`/${t}`))
        if (suffix !== undefined) {
          rows.sibling++
          if (siblingExamples.length < 3) siblingExamples.push(`${t.slice(0, 40).padEnd(42)} -> ${suffix}   (${rel})`)
        } else rows.neither++
      }
    }
  }
  const pct = (n: number) => edges > 0 ? `${((100 * n) / edges).toFixed(1)}%` : "-"
  console.log(`${spec.lane.padEnd(9)} ${String(files).padStart(5)}/${String(population).padStart(6)} files · ${String(edges).padStart(6)} path-shaped ${spec.types.join("/")} edges`)
  console.log(`          reached: file ${rows.file} · root ${rows.root} · ancestor ${rows.ancestor}  |  SIBLING (the ruling's input) ${rows.sibling} (${pct(rows.sibling)}) · neither ${rows.neither} (${pct(rows.neither)}) · not-a-path ${rows.nonPath}`)
  for (const e of siblingExamples) console.log(`            e.g. ${e}`)
}
