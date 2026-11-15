/**
 * THE RESIDUE'S SHAPE ON THE THREE NEAR-ZERO LANES — fsharp, r, hcl.
 *
 * The fleet ceiling showed their file claim buys ~nothing (0.5% / 0.4% / 0.0%). That makes their
 * `imports` residue a BOUNDARY FOR A DIFFERENT CAUSE — and that cause is currently unnamed. This names
 * it per lane, with a count and a split, the way the ceiling measurement worked: VERIFY / refute /
 * residue, with residue broken out BY SHAPE rather than left as a remainder.
 *
 * IT IS A COPY, NOT AN EDIT OF THOSE LANES' FILES. hcl-lane owns hcl and is mid-flight; r and fsharp
 * have their own owners. Nothing here writes to `src/ast/real-{r,hcl,fsharp}-analyzer.ts` or to their
 * specs — it reads their analyzers' output through the production path, exactly as the sibling-root
 * census did.
 *
 * SHAPES, decided by the TARGET's own spelling (no grammar knowledge, so the classification cannot
 * inherit a lane's assumptions):
 *   URL_SCHEME     a scheme or a registry host  (git::https://…, registry.terraform.io/…, github.com/…)
 *   NAME           no slash and no file extension: a package ("dplyr") or a module/namespace
 *                  ("System.IO", "FSharp.Core") — a DECLARATION name, not a file
 *   PATH_SRC_EXT   path-shaped with a source extension this lane admits (.R/.r/.fs/.fsx/.tf…) that is
 *                  not in the admitted set and not on disk
 *   PATH_OTHER_EXT path-shaped with an extension this lane CANNOT admit (.cpp/.h/.json/…): the
 *                  admitted-extension clause's territory — if it exists on disk it lands in `refute`
 *   PATH_NO_EXT    path-shaped with no extension at all
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/near-zero-residue-shapes.mts --files=60
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

const LANES = [
  { lane: "fsharp", exts: ["fs", "fsi", "fsx"] },
  { lane: "r", exts: ["r"] },
  { lane: "hcl", exts: ["tf", "hcl", "tfvars", "tofu"] },
]

const isFile = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }
const dirOf = (rel: string): string => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i + 1) }
function normalise(c: string): string | null {
  const out: string[] = []
  for (const seg of c.split("/")) {
    if (seg.length === 0 || seg === ".") continue
    if (seg === "..") { if (out.length === 0) return null; out.pop(); continue }
    out.push(seg)
  }
  return out.length > 0 ? out.join("/") : null
}
const SOURCE_EXTS = new Set([...LANES.flatMap((l) => l.exts), "scss", "sass", "css", "php", "proto", "graphql", "gql", "toml", "json", "yaml", "yml", "zig"])

type Kind = "URL_SCHEME" | "NAME" | "DOTTED_NAME" | "PATH_SRC_EXT" | "PATH_OTHER_EXT" | "PATH_NO_EXT"

/**
 * A DOTTED IDENTIFIER IS NOT A PATH WITH AN EXTENSION — and the first version of this classifier READ
 * IT AS ONE. `System.IO`, `NUnit.Framework`, `System.Threading.Tasks` were filed as PATH_OTHER_EXT
 * (extension `.IO`, `.Framework`, `.Tasks`), which turned fsharp's namespace names into a path-shaped
 * 5,079 and would have reported the lane's cause as "paths that are absent" when it is "names that are
 * not files at all". A file extension has to be KNOWN to count: no slash plus an unrecognised suffix is
 * a DOTTED NAME, which is what a namespace or module looks like.
 */
const KNOWN_FILE_EXTS = new Set([
  ...SOURCE_EXTS,
  "dll", "exe", "so", "dylib", "a", "o", "obj", "lib", "pdb", "wasm", "jar", "class",
  "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "properties", "lock", "sum", "mod",
  "md", "txt", "csv", "tsv", "sql", "sh", "bat", "ps1", "py", "js", "ts", "c", "h", "cc", "cpp", "hpp", "cs", "java", "kt", "go", "rs", "rb", "pl", "lua", "zig", "nim", "jl", "ex", "exs", "erl", "ml", "mli", "hs", "fs", "fsx", "fsi", "r", "R", "tf", "tfvars", "proto", "gql", "graphql", "scss", "sass", "css", "php", "tpl", "tmpl", "html", "htm", "vue", "svelte", "map", "min",
])
function shapeOf(t: string): Kind {
  if (t.includes("://") || t.startsWith("git::") || t.includes("github.com/") || t.startsWith("app.terraform.io")) return "URL_SCHEME"
  const slash = t.includes("/")
  const base = slash ? t.slice(t.lastIndexOf("/") + 1) : t
  const dot = base.lastIndexOf(".")
  const hasExt = dot > 0 && dot < base.length - 1
  const ext = hasExt ? base.slice(dot + 1).toLowerCase() : ""
  const knownExt = hasExt && KNOWN_FILE_EXTS.has(ext)
  if (!slash && !knownExt) return hasExt ? "DOTTED_NAME" : "NAME"
  if (!knownExt) return "PATH_NO_EXT"
  return SOURCE_EXTS.has(ext) ? "PATH_SRC_EXT" : "PATH_OTHER_EXT"
}

for (const spec of LANES) {
  if (ONLY !== null && ONLY !== spec.lane) continue
  const extSet = new Set(spec.exts)
  let files = 0, population = 0
  const counts: Record<string, number> = { VERIFY: 0, refute: 0 }
  const byKind: Record<string, number> = {}
  const top: Record<string, Map<string, number>> = {}
  const refuteEx: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const repo = path.join(CR, name)
    try { if (!statSync(repo).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    const admitted = new Set<string>()
    let wanted: string[] = []
    for (const rel of tracked) {
      if (!extSet.has(rel.slice(rel.lastIndexOf(".") + 1).toLowerCase())) continue
      const abs = path.join(repo, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      admitted.add(rel.split("/").join("/"))
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
        if (t.length === 0) continue
        const fileDir = dirOf(rel).replace(/\/$/, "")
        const bases = [fileDir, "", ...(() => { const o: string[] = []; let d = fileDir; while (d.length > 0) { o.push(d); d = dirOf(d).replace(/\/$/, "") } return o })()]
        const cands = [...new Set(bases.map((b) => normalise(b.length === 0 ? t : `${b}/${t}`)).filter((x): x is string => x !== null && x.length > 0))]
        if (cands.some((c) => admitted.has(c))) { counts.VERIFY++; continue }
        const fsHit = cands.find((c) => isFile(path.join(repo, c)))
        if (fsHit !== undefined) {
          counts.refute++
          if (refuteEx.length < 3) refuteEx.push(`${t.slice(0, 40)} -> ${fsHit}`)
          continue
        }
        const kind = shapeOf(t)
        byKind[kind] = (byKind[kind] ?? 0) + 1
        const m = top[kind] ?? new Map<string, number>()
        m.set(t, (m.get(t) ?? 0) + 1)
        top[kind] = m
      }
    }
  }
  const residue = Object.values(byKind).reduce((a, b) => a + b, 0)
  const total = counts.VERIFY + counts.refute + residue
  console.log(`\n===== ${spec.lane} — ${files}/${population} files · imports ${total}`)
  console.log(`  VERIFY ${counts.VERIFY} · refute ${counts.refute} · RESIDUE ${residue} (${total > 0 ? ((100 * residue) / total).toFixed(1) : "-"}%)`)
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    const tops = [...(top[k] ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n.slice(0, 34)}×${c}`).join("  ")
    console.log(`    ${k.padEnd(15)} ${String(v).padStart(6)}  ${tops}`)
  }
  for (const e of refuteEx) console.log(`    refute e.g. ${e}`)
}
