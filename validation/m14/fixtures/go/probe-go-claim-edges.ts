/**
 * GO-CLAIM-EDGES — bounded, read-only, foreground: the hand-read half of the `isStdlib` claim.
 *
 * WHAT IT DOES. Discovers the SAME stride population the incoming gate measures (git ls-files per
 * corpus repo, `.go`, 1 MiB cap, sorted, stride) and parses with the production entry point. For each
 * edge carrying the claim it prints the file:line, the emitted target, the qualified spelling, the
 * import path that proves it, and the SOURCE LINE — so the claim can be read against the code rather
 * than trusted. It also audits every claimed edge mechanically: the qualifier must be a package this
 * file imports, the module must be a stdlib path by the closed top-level set, and the edge must not
 * name a declaration the file itself publishes (the two guards in `goStdlibCallClaim` /
 * `goStdlibTypeClaim`).
 *
 * RUN: bun run validation/m14/fixtures/go/probe-go-claim-edges.ts [--files N] [--show N]
 * Defaults: the first 60 files of the stride (a bounded sample of the same population), 12 examples.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const MAX_FILES = 400
const LANE = "go"
const argv = process.argv.slice(2)
const fileLimit = Number(argv[argv.indexOf("--files") + 1] ?? 60)
const showLimit = Number(argv[argv.indexOf("--show") + 1] ?? 12)

const GO_STDLIB_TOP_LEVEL = new Set<string>([
  "archive", "bufio", "bytes", "cmp", "compress", "container", "context", "crypto", "database",
  "debug", "embed", "encoding", "errors", "expvar", "flag", "fmt", "go", "hash", "html", "image",
  "index", "io", "iter", "log", "maps", "math", "mime", "net", "os", "path", "plugin", "reflect",
  "regexp", "runtime", "slices", "sort", "strconv", "strings", "structs", "sync", "syscall",
  "testing", "text", "time", "unicode", "unique", "unsafe", "weak",
])
const isStdlib = (m: string) => GO_STDLIB_TOP_LEVEL.has(m.split("/")[0])

function discover() {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${LANE}`)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const stride = Math.max(1, Math.floor(found.length / MAX_FILES))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
  return picked
}

const repoOf = (f: string) => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
const files = discover().slice(0, fileLimit)
console.log(`population: ${files.length} of the gate's ${MAX_FILES}-file stride (parsed with production parseFile)`)

type Claimed = {
  file: string; line: number | undefined; type: string; target: string
  qualified: string; module: string; source: string
}
const claimed: Claimed[] = []
let preexistingImportClaims = 0
let badQualifier = 0
let badModule = 0
let badShadow = 0
let unqualifiedClaim = 0
const badQualifierSamples: string[] = []
const byType = new Map<string, number>()
const byModule = new Map<string, number>()

for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
  if (!r) continue
  const content: string = readFileSync(f, "utf8")
  const lines = content.split("\n")
  const declared = new Set<string>((r.symbols ?? []).map((s: any) => String(s.name ?? "")))
  // ── THE SOURCE-LEVEL BINDING TEST ────────────────────────────────────────────────────────────
  // The audit reads the WRITTEN import specs, not `parseFile`'s normalised imports: the normalised
  // form (`{name, path}`) keeps the imported package NAME and loses the alias, so a file importing
  // `crypto/ed25519` unaliased AND `wrappingEd "…/v2/ed25519"` normalises to one entry and cannot
  // tell the auditor which spelling the call site used. The source line can: an unaliased spec
  // binds the package's own name (the last path segment for the stdlib), and an aliased spec binds
  // exactly the alias before the quoted path. Bounded to single-line specs — Go's grammar permits
  // several specs on one line, and none of the claims below depends on that shape.
  const sourceBindsQualifier = (qualifier: string, module: string): boolean => {
    const needle = `"${module}"`
    for (const raw of lines) {
      const at = raw.indexOf(needle)
      if (at < 0) continue
      const before = raw.slice(0, at).trim()
      const toks = before.length === 0 ? [] : before.split(/[ \t]+/).filter(Boolean)
      const last = toks.length > 0 ? toks[toks.length - 1] : ""
      if (last === "" || last === "import" || last === "(") {
        if (module.split("/").pop() === qualifier) return true
      } else if (last === qualifier) return true
    }
    return false
  }
  for (const rel of r.relationships ?? []) {
    const md = rel?.metadata ?? {}
    if (md.isStdlib !== true) continue
    const t = String(rel.type ?? "")
    // The pre-existing IMPORT claim has its own (module-path) shape and no qualified spelling;
    // it is out of scope for this probe, which audits the NEW leaf-target claims only.
    if (t === "imports") { preexistingImportClaims++; continue }
    const target = String(rel.target ?? "")
    const qualified = String(md.callExpression ?? md.qualifiedType ?? "")
    const module = String(md.stdlibPath ?? "")
    const line = typeof rel.line_number === "number" ? rel.line_number : undefined
    byType.set(t, (byType.get(t) ?? 0) + 1)
    byModule.set(module, (byModule.get(module) ?? 0) + 1)
    // ── THE MECHANICAL AUDIT: the claim's own proof must hold on every claimed edge ──
    const firstDot = qualified.indexOf(".")
    const qualifier = firstDot > 0 ? qualified.slice(0, firstDot) : ""
    if (firstDot <= 0) unqualifiedClaim++
    else if (!sourceBindsQualifier(qualifier, module)) {
      badQualifier++
      if (badQualifierSamples.length < 10) {
        badQualifierSamples.push(`${path.relative(CR, f)}:${line ?? "?"} ${t} ${qualified} -> ${module} · no import spec binds ${qualifier} to that path`)
      }
    }
    if (!isStdlib(module)) badModule++
    if (qualifier && declared.has(qualifier)) badShadow++
    if (declared.has(target)) badShadow++
    if (claimed.length < showLimit) {
      claimed.push({
        file: path.relative(CR, f), line, type: t, target,
        qualified, module,
        source: line !== undefined ? String(lines[line - 1] ?? "").trim() : "",
      })
    }
  }
}

let total = 0
for (const n of byType.values()) total += n
console.log(`claimed edges in this bounded sample: ${total} (leaf-target claims; ${preexistingImportClaims} pre-existing import claims excluded)`)
console.log(`  by type:   ${[...byType].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`)
console.log(`  by module: ${[...byModule].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k || "(none)"} ${v}`).join(" · ")}`)
console.log(`AUDIT: qualifier-not-imported ${badQualifier} · module-not-stdlib ${badModule} · shadowed-by-file-declaration ${badShadow} · claim-without-qualifier ${unqualifiedClaim}`)
for (const s of badQualifierSamples) console.log(`  BAD: ${s}`)
console.log(`\n${Math.min(showLimit, claimed.length)} CLAIMED EDGES, hand-read against the source:`)
for (const c of claimed) {
  console.log(`  ${c.file}:${c.line ?? "?"}  ${c.type} -> ${c.target}   [${c.qualified} · ${c.module}]`)
  console.log(`      ${c.source}`)
}
