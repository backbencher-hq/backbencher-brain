/**
 * SCSS — EVERY unresolved edge, UNCAPED, WITH ITS CONSTRUCT.
 *
 * WHY THIS EXISTS. `incoming-gate.ts` prints a worklist capped at 25 names per type and
 * displays 4. A capped worklist is a sample, and a sample of a residual cannot be
 * reported as its cause split. This probe walks the SAME admitted population, with the
 * SAME discovery rule (git-tracked, `.scss`, <= 1 MiB, sorted) and the SAME stride rule,
 * classifies every edge with the gate's OWN rule module (`classifyEdge`, `externalClaimOf`),
 * and then prints the residual EDGE BY EDGE: type, file:line, target, metadata keys, and
 * THE SOURCE LINE at the edge's own line, so the construct that emitted it is readable.
 *
 * It also prints, for each residual target, how many declarations of that exact name the
 * run's key space holds — the counterfactual that decides whether the target is a
 * NO-DECLARATION case or a spelling the lane got wrong.
 *
 * READ-ONLY. Writes nothing but stdout.
 *
 * USAGE  bun validation/m14/fixtures/scss/unresolved-buckets.mts [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

/** the gate's own clause (`incoming-gate.ts:316`), restated because it is module-private there */
const admitByExtension = (rel: string, exts: string[], lang: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

const CR = "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const maxFiles = Number(process.argv[2] ?? 400)

// ── discovery: the gate's own rule, copied from incoming-gate.ts discoverFiles ─────────
const found: { repo: string; rel: string; abs: string }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel, ["scss"], "scss")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    found.push({ repo: name, rel, abs })
  }
}
/** byte-for-byte the gate's own order: `found.sort()` on absolute paths (code-unit order) */
found.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
const total = found.length
let picked = found
if (maxFiles > 0 && total > maxFiles) {
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const out: typeof found = []
  for (let i = 0; i < found.length && out.length < maxFiles; i += stride) out.push(found[i])
  picked = out
}

type Edge = { repo: string; file: string; abs: string; type: string; tgt: string; line?: number; keys: string[]; claim: unknown; meta: any }
const decl = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
const declFiles = new Map<string, Map<string, Set<string>>>()
/** project -> published symbol NAME -> the files that publish that exact name. The joined
 *  comma-list names are what the `@extend` member fix has to see. */
const symNames = new Map<string, Map<string, Set<string>>>()
const edges: Edge[] = []
let parsed = 0, failed = 0
for (const f of picked) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (!decl.has(f.repo)) { decl.set(f.repo, new Map()); kinds.set(f.repo, new Map()); declFiles.set(f.repo, new Map()); symNames.set(f.repo, new Map()) }
  const d = decl.get(f.repo)!, k = kinds.get(f.repo)!, df = declFiles.get(f.repo)!
  const bump = (key: string, kind: string) => {
    d.set(key, (d.get(key) ?? 0) + 1)
    let s = k.get(key); if (!s) k.set(key, (s = new Set())); s.add(kind)
    let fs = df.get(key); if (!fs) df.set(key, (fs = new Set())); fs.add(f.rel)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name) continue
    bump(name, String(s?.kind ?? ""))
    let sn = symNames.get(f.repo)!.get(name); if (!sn) symNames.get(f.repo)!.set(name, (sn = new Set())); sn.add(f.rel)
    const q = String(s?.qualifiedName ?? ""); if (q && q !== name) bump(q, String(s?.kind ?? ""))
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!type || !tgt) continue
    const meta: any = rel?.metadata ?? {}
    edges.push({
      repo: f.repo, file: f.rel, abs: f.abs, type, tgt,
      line: Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || undefined,
      keys: Object.keys(meta), claim: externalClaimOf(rel), meta,
    })
  }
}

const CLAIM_KEY_RE = /^(zigExternalRef|nimStdlibModule|isExternal|isExternalTarget|external|externalRef|isStdlib|stdlibModule|moduleNamingEdges|markAsExternal|importOutsideProject|isExternalBase|importProjectFile)$/
const claimKeys = (e: Edge) => e.keys.filter((key) => CLAIM_KEY_RE.test(key) && e.meta[key])

const byType = new Map<string, { edges: number; resolved: number; amb: number; unres: number; claimed: number; unclaimed: number }>()
const residual: Edge[] = []
for (const e of edges) {
  const c: any = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.tgt, null)
  const outcome = String(c?.outcome ?? "")
  let row = byType.get(e.type); if (!row) byType.set(e.type, (row = { edges: 0, resolved: 0, amb: 0, unres: 0, claimed: 0, unclaimed: 0 }))
  row.edges++
  const claimed = claimKeys(e).length > 0 || e.claim !== null
  if (claimed) row.claimed++
  if (outcome === "resolved") row.resolved++
  else if (outcome.startsWith("amb")) row.amb++
  else if (outcome === "unresolved") { row.unres++; if (!claimed) { row.unclaimed++; residual.push(e) } }
}
console.log(`population: ${parsed} parsed of ${picked.length} sampled (corpus has ${total} .scss files; stride)   parse failures ${failed}`)
console.log(`edges ${edges.length}`)
for (const [t, r] of [...byType].sort()) console.log(`  ${t.padEnd(14)} edges ${String(r.edges).padStart(5)}  resolved ${String(r.resolved).padStart(5)}  amb ${String(r.amb).padStart(4)}  unresolved ${String(r.unres).padStart(4)}  of which CLAIMED ${String(r.claimed).padStart(5)} -> residual(unclaimed) ${r.unclaimed}`)
console.log(`\nRESIDUAL (unresolved and UNCLAIMED): ${residual.length} edges\n`)

// ── SELF-AUDIT: A CLAIM MUST NEVER HIDE A RESOLUTION ────────────────────────────────────
// Only SOME claim kinds are consulted before the declaration count (`sourcePath`, `namespace`,
// `binding`, `remoteRef`, and a conflicting `cause`) — the rest, including this lane's own
// `importProjectFile`, are read only in the `decls === 0` branch and so cannot hide anything.
// This lists the edges in the dangerous set whose target DOES name a declaration.
const PRE_COUNT_CLAIMS = /^(sourcePathClaim|languageNamespace|localBinding|remoteRef|baseBeyondRunScope)$/
const laundering = edges.filter((e) => {
  if (!(e.keys.some((k) => PRE_COUNT_CLAIMS.test(k) && e.meta[k]) || (e.claim !== null && ["sourcePath", "namespace", "binding", "remoteRef"].includes((e.claim as any).kind)))) return false
  const c: any = classifyEdge(decl.get(e.repo)!, kinds.get(e.repo)!, e.tgt, null)
  return String(c?.outcome ?? "") === "resolved"
})
console.log(`CLAIM-HIDES-RESOLUTION AUDIT (pre-count claim kinds only): ${laundering.length} claimed edge(s) whose target DOES name a declaration`)
for (const e of laundering) console.log(`  ${e.type} ${e.repo}/${e.file}:${e.line} ${JSON.stringify(e.tgt)} claims=${e.keys.filter((k) => PRE_COUNT_CLAIMS.test(k)).join(",") || String((e.claim as any)?.kind ?? "?")}`)

const srcCache = new Map<string, string[]>()
const srcLine = (e: Edge): string => {
  let lines = srcCache.get(e.abs)
  if (!lines) { try { lines = readFileSync(e.abs, "utf8").split("\n") } catch { lines = [] } ; srcCache.set(e.abs, lines) }
  return e.line && lines[e.line - 1] !== undefined ? lines[e.line - 1]!.trim() : "(no line)"
}

for (const e of residual.sort((a, b) => a.type.localeCompare(b.type) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))) {
  const files = declFiles.get(e.repo)!.get(e.tgt)
  const n = decl.get(e.repo)!.get(e.tgt) ?? 0
  console.log(`${e.type.padEnd(10)} ${e.repo}/${e.file}:${e.line ?? "?"}`)
  console.log(`    target   ${JSON.stringify(e.tgt)}`)
  console.log(`    source   ${JSON.stringify(srcLine(e))}`)
  console.log(`    declarations of that exact key in project: ${n}${files && files.size ? ` in ${[...files].join(", ")}` : ""}`)
  console.log(`    metadata keys: ${e.keys.join(", ") || "(none)"}`)
}

// ── THE DISK COUNTERFACTUAL ────────────────────────────────────────────────────────────
//
// The run's key space is a stride SAMPLE, so "0 declarations" here can mean two different
// things: nothing declares it, or the declaring file was not sampled. The project's own
// tracked file list answers the difference without parsing anything.
const repoFiles = new Map<string, string[]>()
const trackedOf = (repo: string): string[] => {
  let list = repoFiles.get(repo)
  if (!list) {
    try {
      list = execFileSync("git", ["-C", path.join(CR, repo), "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { list = [] }
    repoFiles.set(repo, list)
  }
  return list
}
const inSample = new Set(picked.map((f) => `${f.repo}/${f.rel}`))
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const extending = residual.filter((e) => e.type === "extends")
const importing = residual.filter((e) => e.type === "imports")
console.log(`\n── DISK COUNTERFACTUAL: ${extending.length} extends, ${importing.length} imports ──\n`)

const clause = new Map<string, number>()
const tally = (k: string) => clause.set(k, (clause.get(k) ?? 0) + 1)
const detail = new Map<string, string[]>()

for (const e of extending) {
  const t = e.tgt.trim()
  // a selector declaration is `T` followed by `,` or `{`, at a selector position
  const re = new RegExp(`(^|[\\s,{}(])${esc(t)}\\s*[,{]`)
  const hits: string[] = []
  const anyExt: string[] = []
  for (const rel of trackedOf(e.repo)) {
    if (!/\.(scss|sass|css)$/i.test(rel)) continue
    let text: string
    try { text = readFileSync(path.join(CR, e.repo, rel), "utf8") } catch { continue }
    if (re.test(text)) anyExt.push(rel)
    if (/\.scss$/i.test(rel) && re.test(text)) hits.push(rel)
  }
  const key = hits.length > 0
    ? (hits.some((h) => inSample.has(`${e.repo}/${h}`)) ? "DECLARED-IN-SAMPLE" : "DECLARED-ONLY-OUTSIDE-SAMPLE")
    : (anyExt.length > 0 ? "DECLARED-ONLY-IN-A-NON-ADMITTED-EXT" : "NO-DECLARATION-ANYWHERE")
  tally(`${key} :: ${t.startsWith("%") ? "PLACEHOLDER %" : t.startsWith(".") ? "CLASS ." : "OTHER"}`)
  ;(detail.get(key) ?? detail.set(key, []).get(key)!).push(`${e.repo}/${e.file}:${e.line} ${t}${hits.length ? ` <- ${hits.slice(0, 3).join(", ")}` : ""}${anyExt.length && !hits.length ? ` <- ${anyExt.slice(0, 3).join(", ")}` : ""}`)

  // ── THE JOINED COMMMA-LIST CAUSE ───────────────────────────────────────────────
  // The delegate publishes a comma-separated selector list as ONE symbol name. So a
  // declaration of `%a, %b { }` is a symbol called `%a, %b`, and an `@extend %b` names a
  // member no symbol answers to. This asks the KEY SPACE (not the disk) whether the target
  // is a member of a published joined name, and how many FILES would declare it if the
  // members were published separately — 1 means the fix resolves it uniquely, 2+ means the
  // fix would hand production a tie-break to make.
  const carriers = new Set<string>()
  for (const [name, files] of symNames.get(e.repo)!) {
    if (name === t) continue
    if (name.split(",").some((part) => part.trim() === t)) for (const f of files) carriers.add(f)
  }
  if (carriers.size > 0) {
    const own = carriers.has(e.file)
    tally(`MEMBER-OF-JOINED-LIST (${carriers.size} declaring file(s))${own ? " IN-OWN-FILE" : " CROSS-FILE"} :: ${t.startsWith("%") ? "PLACEHOLDER %" : t.startsWith(".") ? "CLASS ." : "OTHER"}`)
    ;(detail.get("MEMBER-OF-JOINED-LIST") ?? detail.set("MEMBER-OF-JOINED-LIST", []).get("MEMBER-OF-JOINED-LIST")!).push(`${e.repo}/${e.file}:${e.line} ${t} <- ${[...carriers].join(", ")}`)
  }
}
for (const e of importing) {
  // the specifier is the quoted string on the edge's own source line
  const src = srcLine(e)
  const m = src.match(/["']([^"']+)["']/)
  const spec = m ? m[1]! : ""
  const dir = path.posix.dirname(e.file)
  const tracked = new Set(trackedOf(e.repo))
  const isUrl = /^https?:\/\//.test(spec) || spec.startsWith("//")
  const specAbs = spec.startsWith("/") ? spec.slice(1) : path.posix.normalize(path.posix.join(dir, spec))
  const hasExt = /\.(scss|sass|css)$/i.test(spec)
  // SASS'S OWN SPELLINGS. A specifier WITH an extension names ONE file (plus its partial
  // variant) — the first version of this probe swapped `.sass` for `.scss` and "found" a file
  // the import does NOT name, which invented a fixable cause out of a dangling import.
  const cands: string[] = hasExt
    ? [specAbs, path.posix.join(path.posix.dirname(specAbs), `_${path.posix.basename(specAbs)}`)]
    : [
        `${specAbs}.scss`,
        path.posix.join(path.posix.dirname(specAbs), `_${path.posix.basename(specAbs)}.scss`),
        `${specAbs}/_index.scss`,
        `${specAbs}/index.scss`,
      ]
  const hit = cands.find((c) => tracked.has(c))
  const identityOf = (rel: string) => `${rel.replace(/\.(scss|sass|css)$/i, "")}::${path.posix.basename(rel)}`
  // A file the project carries under an extension THIS LANE DOES NOT ADMIT. `.sass` and `.css`
  // are other languages' populations (`language-detection.ts:78`), so this is not a spelling
  // repair — the declaration is simply outside the run's population.
  const otherExt = "/\\.(sass|css)$/i"
  const otherHit = !hit && !hasExt
    ? [`${specAbs}.sass`, path.posix.join(path.posix.dirname(specAbs), `_${path.posix.basename(specAbs)}.sass`), `${specAbs}/_index.sass`, `${specAbs}/index.sass`,
      `${specAbs}.css`, `${specAbs}/_index.css`, `${specAbs}/index.css`].find((c) => tracked.has(c))
    : !hit && hasExt ? [specAbs.replace(/\.sass$/i, ".css")].find((c) => tracked.has(c)) : undefined
  void otherExt
  const key = isUrl ? "REMOTE-STYLESHEET-URL"
    : hit ? (e.tgt === identityOf(hit) ? "TARGET-IS-THE-FILE'S-OWN-IDENTITY (declaring file outside the run)" : "WRONG-TARGET-SPELLING (file exists + admitted)")
      : otherHit ? "FILE-EXISTS-ONLY-OUTSIDE-THIS-LANE'S-EXTENSIONS"
        : /(^|\/)node_modules\//.test(spec) || spec.startsWith("~") || /^@[a-z0-9-]+\//i.test(spec) ? "EXTERNAL-PACKAGE (node_modules/~/@scope)"
          : hasExt && /^\.{0,2}\//.test(spec) ? "DANGLING-RELATIVE (specifier names a file the project does not have)"
            : "PROJECT-SPECIFIER-NO-FILE (includePaths / package-internal spelling)"
  tally(`${key} :: imports`)
  ;(detail.get(key) ?? detail.set(key, []).get(key)!).push(`${e.repo}/${e.file}:${e.line} ${JSON.stringify(e.tgt)} spec=${JSON.stringify(spec)}${hit ? ` -> ${hit} (identity ${identityOf(hit)})` : otherHit ? ` -> ${otherHit}` : ""}`)
}

console.log("CAUSE BUCKETS (over the residual):")
for (const [k, v] of [...clause].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`)
console.log("\nEVIDENCE:")
for (const [k, v] of [...detail].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k}:`)
  for (const line of v) console.log(`      ${line}`)
}
