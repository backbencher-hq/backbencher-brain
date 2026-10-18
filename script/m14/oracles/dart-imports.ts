/**
 * The Dart `imports` / `exports` oracle — LANE-OWNED.
 *
 * Beside `dart-contains.ts` and `dart-overrides.ts`, for the reason those files'
 * headers record: `differential.ts` is edited by several lanes at once, and every
 * line a lane keeps out of it is a line that cannot conflict.
 *
 * ## Why this oracle exists
 *
 * `imports` (7,155) and `exports` (185) are the last Dart relationship classes
 * with no Dart-derived truth. They come from the generic family walker, and they
 * are the edges a consumer uses to answer "what does this file reach for" and
 * "what does this library publish" — the questions a dependency graph exists to
 * answer, on a codebase whose imports are 7,107 directives deep.
 *
 * ## The rule
 *
 * A file IMPORTS a URI when it names that URI in an `import`, a `part`, or a
 * `part of` directive, and EXPORTS a URI when it names it in an `export`.
 *
 * ## Four things the grammar does not tell you
 *
 * 1. **The target is a URI, and it carries a suffix that depends on the
 *    relationship.** An import target is `<uri>:*` — the `:��` is the family marker
 *    meaning "everything this module publishes". An export target is the bare
 *    `<uri>`, with no marker. Two edges from the same file to the same module
 *    therefore differ only in that suffix, and dropping it collapses an import
 *    and an export of one module into one indistinguishable row.
 * 2. **EVERY import form collapses to the same row.** `as`, `show`, `hide`,
 *    `show … as`, and `deferred as` all yield the identical `<uri>:*`. The
 *    combinators narrow what is VISIBLE, not what is depended upon, so none of
 *    them belongs in the edge. A relative URI (`../other.dart`) is kept verbatim —
 *    normalizing it would invent a module identity the file does not write.
 * 3. **The URI lives at three different depths.** `import_specification` carries
 *    the string directly; `library_export` wraps it in a `configurable_uri`; and
 *    both `part_directive` and `part_of_directive` wrap it in a `uri` node. Only
 *    `part`/`part of` are direct children of `program` — `import` and `export`
 *    arrive wrapped in `import_or_export`, and `export` has an extra
 *    `library_import`-shaped hop that `import` does not.
 * 4. **A SELF-IMPORT is still an import.** `import 'self.dart';` in the file
 *    `self.dart` publishes `imports:self->self.dart:*` rather than being dropped.
 *    That is defensible — the directive is written and the compiler honours it —
 *    and it is recorded here because "self-imports are filtered" is the kind of
 *    thing a reader assumes and this lane does not do.
 *
 * ## One class recorded as unresolved rather than ruled
 *
 * `part of 'b.dart';` publishes `imports:this->b.dart:*`. The directive names the
 * file's **PARENT** — it says "I am a part of b.dart", not "I import b.dart" — so
 * publishing it in the same class as an import states the dependency backwards.
 * 24 such rows in ProxiCall/lib, every one of them a generated `*.freezed.dart` /
 * `*.g.dart` naming its source. Whether that is a defect or a deliberate
 * uniformity choice (every module-level URI is an `imports` row, so a consumer finds
 * one edge class rather than three) is a family decision, and the oracle mirrors
 * the analyzer here rather than making the call itself.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

export interface TruthEdge {
  label: string
  from: string
  target: string
}

const named = (n: any): any[] => (n?.namedChildren ?? [])

/**
 * Strip one layer of surrounding quotes, by character test rather than by pattern.
 *
 * This was `/^['"]/` then `/['"]$/` — the last two regexes in this lane. It is
 * replaced because a regex over node text is the wrong instrument here for a
 * reason that is not about taste: it is two passes over the string to express one
 * comparison, and the pattern form invites the next edit to widen it into a shape
 * match, at which point it is matching source text rather than the grammar's
 * `string_literal` node. The grammar already told us this is a literal; all that
 * is left is the delimiter.
 *
 * Same shape as `unquote` in src/ast/real-dart-analyzer.ts, so the oracle and the
 * analyzer strip delimiters identically rather than by two independently-drifting
 * rules. Behaviour on every input this oracle sees is unchanged, and the
 * differential's 7,340-row agreement is the check.
 */
function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

/**
 * First `string_literal` in document order, quotes stripped.
 *
 * ITERATIVE. The recursive form is one stack frame per tree level, and this
 * descends an entire file subtree from whatever node it is handed; on deeply
 * nested input it overflows, and an oracle that throws reports nothing for that
 * file — which the differential reads as agreement rather than as absence. The
 * explicit stack below cannot overflow.
 */
function firstStringLiteral(node: any): string | null {
  const stack: any[] = [node]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n?.type === "string_literal") return unquote(String(n.text ?? ""))
    const kids = named(n)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  return null
}

/** The file's own module name — the basename with its extension removed. */
function moduleName(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

// ============================================================================
// THE RESOLVED TARGET — a MIRROR of the analyzer's `dartImportTargetPath` rule
// ============================================================================
//
// 2026-10-18 (exact-path matcher, Lead commit 174f35fda): the differential now compares path-like
// `imports`/`exports` targets AS WRITTEN, because `normTarget` collapsed `./A.sol`, `../B.sol` and
// `pkg/C.sol` to "sol" and every path covered every other. That exposed the real gap this lane had
// recorded knowingly: the analyzer publishes the FILE A SPECIFIER NAMES (project-relative path) when
// the checkout can answer, and the oracle published the specifier itself (`<uri>:*`). The Lead's
// direction is explicit — **the analyzer's spelling is the contract; the oracle aligns to it**.
//
// WHY A MIRROR AND NOT A SHARED CALL: `imports` is now audited by comparing two derivations, and a
// truth derivation that imported the analyzer's own function would compare the rule with itself.
// This copy is written from the analyzer's source but is the ORACLE side of the test: if the analyzer's
// resolution changes and this does not, the differential reports MISSING/UNEXPLAINED instead of
// agreeing. The independent anchor for the rule itself stays `validation/m14/fixtures/dart/
// import-identity-pairing.ts` (real on-disk paths, both ends meet) and the fixture
// `dart/import-resolution` (which pins the analyzer's published targets for synthetic paths).
//
// The three inputs are exactly the analyzer's: the importing `filePath` as the caller supplied it
// (the harness passes `fixtures/dart/<name>.dart` for fixtures and a repo-relative path from the
// differential), the nearest checkout root above it (`.git` walk, as the analyzer does), and the
// checkout's own pubspec map plus SDK presence. NOTHING here reads the analyzer module.
const DART_WALK_SKIP = new Set([
  ".git", ".hg", ".svn", "node_modules", ".dart_tool", ".symlinks", "build", "coverage", ".pub-cache", "out",
])

/** `[a-z][a-z0-9_]*` by char code — the pub and `dart:` library name shape. No regex. */
function isDartLibraryName(name: string): boolean {
  if (name.length === 0) return false
  const c0 = name.charCodeAt(0)
  if (c0 < 97 || c0 > 122) return false
  for (let i = 1; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}

const ROOT_CACHE = new Map<string, string | null>()
function projectRootOfFile(filePath: string): string | null {
  const start = path.dirname(path.resolve(filePath))
  const seen: string[] = []
  let dir = start
  for (let i = 0; i < 64; i++) {
    const hit = ROOT_CACHE.get(dir)
    if (hit !== undefined) { for (const d of seen) ROOT_CACHE.set(d, hit); return hit }
    seen.push(dir)
    if (existsSync(path.join(dir, ".git"))) {
      if (ROOT_CACHE.size > 20000) ROOT_CACHE.clear()
      for (const d of seen) ROOT_CACHE.set(d, dir)
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const d of seen) ROOT_CACHE.set(d, null)
  return null
}

function pubspecName(file: string): string | null {
  let text: string
  try { text = readFileSync(file, "utf8") } catch { return null }
  let lineStart = 0
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text.charCodeAt(i) !== 10) continue
    const line = text.slice(lineStart, i)
    lineStart = i + 1
    if (!line.startsWith("name:")) continue
    let v = 5
    while (v < line.length && (line.charCodeAt(v) === 32 || line.charCodeAt(v) === 9)) v++
    let end = v
    while (end < line.length) {
      const c = line.charCodeAt(end)
      if (c === 32 || c === 9 || c === 13 || c === 35) break
      end++
    }
    const value = line.slice(v, end)
    return isDartLibraryName(value) ? value : null
  }
  return null
}

interface Facts { packageRoots: Map<string, string>; sdkLib: boolean; dartLibs: Map<string, string | null> }
const FACTS_CACHE = new Map<string, Facts>()
function projectFacts(projectRoot: string): Facts {
  const hit = FACTS_CACHE.get(projectRoot)
  if (hit) return hit
  const facts: Facts = { packageRoots: new Map(), sdkLib: existsSync(path.join(projectRoot, "sdk", "lib")), dartLibs: new Map() }
  const stack: string[] = [projectRoot]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DART_WALK_SKIP.has(entry.name)) continue
        stack.push(path.join(dir, entry.name))
        continue
      }
      if (entry.name !== "pubspec.yaml" || !entry.isFile()) continue
      const name = pubspecName(path.join(dir, entry.name))
      if (name === null || facts.packageRoots.has(name)) continue
      const rel = path.relative(projectRoot, dir)
      facts.packageRoots.set(name, rel.split(path.sep).join("/"))
    }
  }
  if (FACTS_CACHE.size >= 64) FACTS_CACHE.clear()
  FACTS_CACHE.set(projectRoot, facts)
  return facts
}

function repoRelPath(projectRoot: string, absPath: string): string | null {
  const rel = path.relative(projectRoot, path.resolve(absPath))
  if (rel.length === 0 || path.isAbsolute(rel)) return null
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) return null
  return rel.split(path.sep).join("/")
}

function joinInside(baseRel: string, tail: string): string | null {
  const base = baseRel.length === 0 ? "" : `${baseRel}/`
  const norm = path.posix.normalize(`${base}${tail}`)
  if (norm.length === 0 || norm === "." || norm === ".." || norm.startsWith("../")) return null
  return norm
}

/**
 * The file a directive names, as the analyzer spells it — or null when the checkout cannot answer
 * (dependency package, `dart:` without an SDK, an outside path, a non-path scheme). Every branch is
 * the analyzer's branch; the caller compares the result with the analyzer's published target.
 */
function resolvedTarget(projectRoot: string, filePath: string, uri: string): string | null {
  if (uri.length === 0) return null
  if (uri.startsWith("package:")) {
    const rest = uri.slice(8)
    const slash = rest.indexOf("/")
    if (slash <= 0 || slash === rest.length - 1) return null
    const pkg = rest.slice(0, slash)
    const sub = rest.slice(slash + 1)
    if (!isDartLibraryName(pkg)) return null
    const packageRoot = projectFacts(projectRoot).packageRoots.get(pkg)
    if (packageRoot === undefined) return null
    return joinInside(packageRoot, `lib/${sub}`)
  }
  if (uri.startsWith("dart:")) {
    const lib = uri.slice(5)
    if (!isDartLibraryName(lib)) return null
    const facts = projectFacts(projectRoot)
    if (!facts.sdkLib) return null
    const cached = facts.dartLibs.get(lib)
    if (cached !== undefined) return cached
    const rel = `sdk/lib/${lib}/${lib}.dart`
    const found = existsSync(path.join(projectRoot, rel)) ? rel : null
    facts.dartLibs.set(lib, found)
    return found
  }
  if (uri.indexOf(":") >= 0) return null
  return repoRelPath(projectRoot, path.resolve(path.dirname(path.resolve(filePath)), uri))
}

function resolvedOrNull(filePath: string, uri: string): string | null {
  const projectRoot = projectRootOfFile(filePath)
  if (projectRoot === null) return null
  return resolvedTarget(projectRoot, filePath, uri)
}

export function deriveDartImportsTruth(root: any, filePath: string): TruthEdge[] {
  const source = moduleName(filePath)
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const add = (label: string, target: string): void => {
    const k = `${label}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from: source, target } as TruthEdge)
  }

  const visit = (node: any): void => {
    if (!node) return
    if (node.type === "import_specification") {
      const uri = firstStringLiteral(node)
      if (uri) add("imports", resolvedOrNull(filePath, uri) ?? `${uri}:*`)
    } else if (node.type === "library_export") {
      const uri = firstStringLiteral(node)
      if (uri) add("exports", resolvedOrNull(filePath, uri) ?? uri)
    } else if (node.type === "part_directive" || node.type === "part_of_directive") {
      // 2026-10-18 — A PART DIRECTIVE IS NO LONGER AN IMPORT, and this truth derivation must
      // move with the analyzer in the same commit. The analyzer now publishes `part_of`
      // (canonical vocabulary, Lead df5a03eb2) with `metadata.partRole`, replacing the old
      // `imports{isPart,isPartOf}` rows. Two different facts were sharing one label; leaving
      // this branch in place would derive an `imports` truth row for a clause the analyzer no
      // longer emits on that label, and the differential would report it as MISSING —
      // a truth row with no emission is the fabricated-half of the harness gap this programme
      // keeps recording.
      //
      // The part graph's truth is NOT derived here yet, deliberately: `part_of` is compared
      // only once the differential allowlist admits it (a harness change owned by the Lead),
      // and a truth derivation pushed with no allowlist entry compares nothing while reading
      // as coverage. When that wiring lands, the truth rule is: source = the file's module,
      // target = the resolved project-relative path of the named file, label `part_of`,
      // with `partRole` from the NODE TYPE (`part_of_directive` -> part,
      // `part_directive` -> library). The resolution is the one open question — the analyzer
      // resolves package/relative specifiers through the checkout's own pubspec map, and a
      // truth derivation that re-implemented that would be a second copy of the rule under
      // test rather than an independent one.
    }
    for (const c of named(node)) visit(c)
  }
  visit(root)

  return edges
}
