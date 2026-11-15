/**
 * WHAT DOES A DART IMPORT/EXPORT EDGE NAME, AND CAN THAT NAME BE RESOLVED? — dart lane.
 *
 * `real-dart-analyzer.ts` `processImportExport` writes THREE shapes into the relationship
 * target, and the incoming gate can resolve none of them, because it resolves a target
 * against a symbol key space:
 *
 *     import  'uri'   -> target `${uri}:*`     (the production `<module>:<item>` convention,
 *                                               with a STAR item, which `planImportResolutions`
 *                                               DECLINES by design: "a namespace/star import
 *                                               has no single target symbol")
 *     export  'uri'   -> target `uri`          (a path, never a symbol name)
 *     part    'uri'   -> target `${uri}:*`     (same as import)
 *
 * So these edges are unresolvable as WRITTEN, at any quality of analyzer: the question is
 * what they should name instead. This census answers that with the population they are drawn
 * from, before any analyzer change — it measures DIRECTIVES (the upper bound of the edge
 * population: one `imports` edge per import/part/part-of directive, one `exports` edge per
 * export directive), and it measures them against the SAME file population the gate admits.
 *
 * METHOD, and its limits, stated because the number is only as good as its denominator:
 *   · Population: `git ls-files` per checkout (tracked files), `.dart` only — the gate's own
 *     discovery — minus files absent from disk. Over-cap files (>1 MB) are COUNTED SEPARATELY
 *     rather than silently dropped: the engine extracts those structurally, not as an analyzer.
 *   · Textual scan with a comment/string state machine, so a directive written inside a
 *     block comment or after a line comment is not counted. It cannot see conditional
 *     compilation; a directive is counted wherever it appears in code.
 *   · Resolution is a PATH question, and each scheme has one honest rule:
 *       relative / bare  `path.resolve(dirname(importer), uri)` — climbing above the checkout
 *                        root is `escapes_repo`, never clamped to a false in-repo hit.
 *       package:         `<packageRoot>/lib/<rest>`, where the package root comes from the
 *                        `pubspec.yaml` files TRACKED IN THE SAME CHECKOUT. A package that
 *                        this checkout does not declare is a dependency, i.e. not in it.
 *       dart:            `<repo>/sdk/lib/<lib>/<lib>.dart` — the SDK's own layout, verified on
 *                        this corpus (187 files match exactly). A `dart:` import in a checkout
 *                        with no `sdk/` is outside that checkout; the same import inside
 *                        dart-sdk names a file the population HAS, and the split is reported.
 *   · `exists` is checked against the tracked file set, so a target that is present on disk
 *     but untracked is reported as absent — the gate's population is tracked files.
 *
 * The point of the census is the last table: how many directives could be resolved by a
 * PROJECT-RELATIVE PATH key (unique by construction — one file, one path), and how many name
 * something no file in that checkout answers to, which is the genuinely-external part and
 * must be marked, not resolved.
 *
 * Run: npx tsx validation/m14/fixtures/dart/import-target-paths.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const FULL_AST_LIMIT = 1024 * 1024

type Directive = { kind: "import" | "export" | "part" | "part_of"; uri: string; line: number }

/**
 * Every directive in the file that is really in code. States: code, line comment, block
 * comment, and the three Dart string forms (single, double, triple-quoted). Escape handling
 * is the one case that matters here: a `\'` inside a string must not close it.
 */
function scanDirectives(text: string): Directive[] {
  const out: Directive[] = []
  const n = text.length
  // Pass 1: which bytes are CODE (not comment, not string). A directive keyword whose first
  // byte is not code is a directive the compiler never sees, so it must not be counted.
  const codeAt = new Uint8Array(n)
  {
    let i = 0
    let state: "code" | "line" | "block" = "code"
    let quote = ""
    while (i < n) {
      const c = text[i]
      const c2 = text[i + 1]
      if (state === "code") {
        codeAt[i] = 1
        if (c === "/" && c2 === "/") { state = "line"; i += 2; continue }
        if (c === "/" && c2 === "*") { state = "block"; i += 2; continue }
        if (c === "'" || c === '"') {
          // A triple-quoted string changes nothing for this scan: the first quote opens a
          // string, the second closes it and the third reopens it, and directive text inside
          // either window is correctly not code.
          quote = c
          i++
          while (i < n) {
            if (text[i] === "\\") { i += 2; continue }
            if (text[i] === quote) { i++; break }
            i++
          }
          continue
        }
        i++
        continue
      }
      if (state === "line") {
        if (c === "\n") state = "code"
        i++
        continue
      }
      if (c === "*" && c2 === "/") { state = "code"; i += 2; continue }
      i++
    }
  }
  // Pass 2: line-anchored directive starts in code, and the line number of each.
  const re = /^[ \t]*(import|export|part[ \t]+of|part)\b/gm
  let m: RegExpExecArray | null
  let line = 1
  let scanFrom = 0
  while ((m = re.exec(text)) !== null) {
    for (let k = scanFrom; k < m.index; k++) if (text[k] === "\n") line++
    scanFrom = m.index
    const kw = m.index + m[0].indexOf(m[1])
    if (!codeAt[kw]) continue
    const rest = text.slice(m.index, Math.min(n, m.index + 400))
    const q = /^[ \t]*(?:import|export|part[ \t]+of|part)\b[^'"]*['"]([^'"]+)['"]/.exec(rest)
    if (!q) continue
    const kind = m[1].startsWith("part of") ? "part_of" : (m[1] as Directive["kind"])
    out.push({ kind, uri: q[1], line })
  }
  return out
}

type Repo = {
  name: string
  root: string
  /** repo-relative path -> bytes on disk */
  tracked: Map<string, number>
  absent: number
  overCap: number
  /** package name -> repo-relative package root (the dir holding pubspec.yaml + lib/) */
  pkgRoots: Map<string, string>
  /** `dart:<lib>` -> repo-relative sdk lib file, for the SDK layouts this checkout has */
  sdkLibs: Map<string, string>
}

function loadRepo(name: string): Repo | null {
  const root = path.join(CR, name)
  try { if (!statSync(root).isDirectory()) return null } catch { return null }
  try { execFileSync("git", ["-C", root, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { return null }
  let files: string[]
  try {
    files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { return null }
  const tracked = new Map<string, number>()
  let absent = 0, overCap = 0
  for (const rel of files) {
    if (!rel.endsWith(".dart")) continue
    let st: any
    try { st = statSync(path.join(root, rel)) } catch { absent++; continue }
    if (st.size > FULL_AST_LIMIT) { overCap++; continue }
    tracked.set(rel, st.size)
  }
  if (tracked.size === 0) return null

  const pkgRoots = new Map<string, string>()
  const sdkLibs = new Map<string, string>()
  for (const rel of files) {
    if (!rel.endsWith("pubspec.yaml")) continue
    // `name:` at the top level of the pubspec — a dependency's name is nested and indented,
    // so an anchored match is the package's own name and not a dependency's.
    let nm: string | null = null
    try { nm = /^name:[ \t]*(\S+)[ \t]*$/m.exec(readFileSync(path.join(root, rel), "utf8"))?.[1] ?? null } catch { /* unreadable */ }
    if (nm) pkgRoots.set(nm, path.dirname(rel) === "." ? "" : path.dirname(rel))
  }
  for (const rel of files) {
    const m = /^(.*\/)?sdk\/lib\/([a-z0-9_]+)\/\2\.dart$/.exec(rel)
    if (m) sdkLibs.set(m[2], rel)
  }
  return { name, root, tracked, absent, overCap, pkgRoots, sdkLibs }
}

const repos: Repo[] = []
for (const name of readdirSync(CR).sort()) {
  const r = loadRepo(name)
  if (r) repos.push(r)
}

const rows = new Map<string, number>()
const bump = (k: string, by = 1) => rows.set(k, (rows.get(k) ?? 0) + by)
type Target = { scheme: "relative" | "bare" | "package" | "dart" | "http" | "other"; rel: string | null; exists: boolean }
const perRepo = new Map<string, { directives: number; inRepo: number; targets: Set<string> }>()
let totalDirectives = 0
let stemCollisions = 0
const sdkOnly = { inDartSdk: 0, outsideDartSdk: 0, mappedInDartSdk: 0 }

for (const repo of repos) {
  const acc = { directives: 0, inRepo: 0, targets: new Set<string>() }
  perRepo.set(repo.name, acc)
  const stemCount = new Map<string, number>()
  for (const rel of repo.tracked.keys()) {
    const stem = path.basename(rel).replace(/\.dart$/, "")
    stemCount.set(stem, (stemCount.get(stem) ?? 0) + 1)
  }
  for (const [rel, size] of repo.tracked) {
    if (size === 0) continue
    let text: string
    try { text = readFileSync(path.join(repo.root, rel), "utf8") } catch { continue }
    const dir = path.dirname(rel)
    for (const d of scanDirectives(text)) {
      totalDirectives++
      acc.directives++
      const kind = d.kind === "part_of" ? "part" : d.kind
      let t: Target
      if (d.uri.startsWith("package:")) {
        const rest = d.uri.slice("package:".length)
        const slash = rest.indexOf("/")
        const pkg = slash === -1 ? rest : rest.slice(0, slash)
        const sub = slash === -1 ? "" : rest.slice(slash + 1)
        const proot = repo.pkgRoots.get(pkg)
        const cand = proot === undefined ? null : (proot === "" ? `lib/${sub}` : `${proot}/lib/${sub}`)
        t = { scheme: "package", rel: cand, exists: cand !== null && repo.tracked.has(cand) }
        if (proot === undefined) bump(`package: names a package this checkout does not declare`)
        else {
          // IS THE IMPORTED PACKAGE'S ROOT AN ANCESTOR OF THE IMPORTER? That is exactly the
          // question a walk up from the importing file can answer, so this split says how much
          // of the in-repo `package:` half such a walk reaches without scanning the tree.
          // A SIBLING package in a monorepo (its root is a cousin directory) cannot be found
          // that way, and needs a project-wide package map instead.
          const prootAbs = proot === "" ? "." : proot
          const reachableByWalkUp = prootAbs === "." || dir === prootAbs || dir.startsWith(prootAbs + "/")
          bump(`package: target package is ${reachableByWalkUp ? "on the importer's own ANCESTOR path" : "a SIBLING of the importer's package"}`)
        }
      } else if (d.uri.startsWith("dart:")) {
        const lib = d.uri.slice("dart:".length).replace(/\..*$/, "")
        const cand = repo.sdkLibs.get(lib) ?? null
        t = { scheme: "dart", rel: cand, exists: cand !== null && repo.tracked.has(cand) }
        if (repo.name === "dart-sdk") { sdkOnly.inDartSdk++; if (t.exists) sdkOnly.mappedInDartSdk++ } else sdkOnly.outsideDartSdk++
      } else if (d.uri.startsWith("http:") || d.uri.startsWith("https:")) {
        t = { scheme: "http", rel: null, exists: false }
      } else if (d.uri.startsWith("./") || d.uri.startsWith("../") || d.uri === "." || d.uri === "..") {
        const abs = path.resolve(path.join(repo.root, dir), d.uri)
        const relRel = path.relative(repo.root, abs)
        const escapes = relRel.startsWith("..")
        t = { scheme: "relative", rel: escapes ? null : relRel, exists: !escapes && repo.tracked.has(relRel) }
        if (escapes) bump(`relative directive that climbs ABOVE the checkout root`)
      } else {
        // A bare specifier is a same-directory relative URI in Dart.
        const abs = path.resolve(path.join(repo.root, dir), d.uri)
        const relRel = path.relative(repo.root, abs)
        const escapes = relRel.startsWith("..")
        t = { scheme: "bare", rel: escapes ? null : relRel, exists: !escapes && repo.tracked.has(relRel) }
      }
      const bucket = t.exists ? "in_repo_file" : t.rel !== null && t.scheme !== "package" && t.scheme !== "dart"
        ? "in_repo_file_absent" : "outside_repo"
      bump(`${kind} ${t.scheme} -> ${bucket}`)
      if (bucket === "in_repo_file") {
        acc.inRepo++
        acc.targets.add(t.rel!)
        const stem = path.basename(t.rel!).replace(/\.dart$/, "")
        if ((stemCount.get(stem) ?? 0) > 1) stemCollisions++
      }
    }
  }
}

const totalTracked = repos.reduce((n, r) => n + r.tracked.size, 0)
const totalAbsent = repos.reduce((n, r) => n + r.absent, 0)
const totalOverCap = repos.reduce((n, r) => n + r.overCap, 0)
const inRepoFile = [...rows.entries()].filter(([k]) => k.endsWith("in_repo_file")).reduce((n, [, v]) => n + v, 0)

console.log(`dart import/export/part directive census (TEXT scan of tracked files, comment/string aware)`)
console.log(`population: ${repos.length} checkout(s), ${totalTracked} admitted .dart files` +
  ` (${totalAbsent} tracked-but-absent, ${totalOverCap} over the 1 MB analyzer cap, counted separately)`)
console.log(`directives: ${totalDirectives}   naming a file in the same checkout: ${inRepoFile}` +
  ` (${((inRepoFile / Math.max(1, totalDirectives)) * 100).toFixed(1)}%)`)
console.log(`of those in-repo targets, whose bare file STEM is not unique in its checkout: ${stemCollisions}` +
  ` — unreachable by a file-stem key, reachable by a project-relative path key (one file, one path)`)
console.log(`\nper directive kind + uri scheme:`)
for (const [k, v] of [...rows.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(8)}  ${k}`)
console.log(`\ndart: URIs — dart-sdk (the SDK's own layout is IN this checkout): ${sdkOnly.inDartSdk}` +
  `, of which mapped to an sdk/lib file present here: ${sdkOnly.mappedInDartSdk}` +
  `; everywhere else (the SDK is not in that checkout): ${sdkOnly.outsideDartSdk}`)
console.log(`\nper checkout (directives / in-repo targets / distinct target files):`)
for (const [name, a] of [...perRepo.entries()].sort((x, y) => y[1].directives - x[1].directives)) {
  if (a.directives === 0) continue
  console.log(`  ${String(a.directives).padStart(7)} ${String(a.inRepo).padStart(7)} ${String(a.targets.size).padStart(6)}  ${name}`)
}
