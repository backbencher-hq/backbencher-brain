/**
 * The Dart `part_of` oracle — LANE-OWNED, and WRITTEN TO BE WIRED BY THE LEAD.
 *
 * ## Why this file exists
 *
 * `part_of` is the canonical label for the two library-coupling directives
 * (`part 'x.dart';` on the library side, `part of 'lib.dart';` on the part side, plus the
 * named form `part of my.lib;`). The analyzer emits the rows; the differential compares
 * labels that have a TRUTH — and admitting a label with no truth charges every analyzer row
 * as a fabrication. The old imports oracle derived part directives as `imports`; when the
 * relabel landed (commit 440e673b1) that derivation was REMOVED, not re-spelled, because
 * `imports` was no longer the label. This file is the independent derivation for the new
 * label, written so the Lead can push it in `differential.ts`'s dart arm next to
 * `deriveDartImportsTruth` and admit `part_of` in the same commit.
 *
 * ## What "independent" means here, and what it does not
 *
 * It does not import `RealDartAnalyzer`, read its tables, or call its helpers. It walks the
 * parse tree with its own recursion, scans the project's own `pubspec.yaml` files with its own
 * reader, resolves specifiers with its own path normalisation over the project's own file
 * list, and derives the module name from the grammar. The RISOLUTION RULES are of course the
 * same language rules — a specifier is resolved the way Dart resolves it — but they are stated
 * here from the language and checked against the analyzer by a caller, not shared with it.
 *
 * ## The rules, and why each refusal is a first-class result
 *
 *   `part 'x.dart'` / `part of 'lib.dart'` — the URI is resolved against the DIRECTIVE FILE's
 *   own directory. A relative specifier that climbs out of the project root is REFUSED (no
 *   row): a path outside the checkout is not a file this project can contain. A relative
 *   specifier that normalises INSIDE the root is published even when the file does not exist —
 *   a dangling internal reference is a fact about the code, and the gate's resolver is what
 *   reports that it does not bind.
 *
 *   `package:<pkg>/<path>` — resolved only when the CHECKOUT ITSELF declares `<pkg>` (a
 *   top-level `name:` in a pubspec.yaml found by walking the project). An undeclared package is
 *   a pub dependency: no row. The package's root is its own pubspec directory, and the file is
 *   `<root>/lib/<path>`.
 *
 *   `dart:<lib>` — resolved only when the checkout carries `sdk/lib` AND
 *   `sdk/lib/<lib>/<lib>.dart` exists; otherwise no row.
 *
 *   any other scheme (`http:`, `file:`, …) — no row: no path in the checkout can be it.
 *
 *   the NAMED form `part of my.lib;` (no URI at all) — the target is the library NAME as
 *   written, whitespace-stripped, which is the module symbol's name the owning file publishes
 *   (`library my.lib;`). Unresolvable by file list, resolvable by name at project scope — this
 *   branch is exactly why a file-path-only truth walk would MISS these rows.
 *
 *   `partRole` is carried on the truth edge because the ROLE is metadata the analyzer states
 *   (`part_of_directive` -> "part", `part_directive` -> "library"); a truth row without it could
 *   not tell a consumer checking that half whether the source end is right.
 *
 * ## Usage (the shape the Lead wires)
 *
 *   for (const e of deriveDartPartOfTruth(root, {
 *     filePath,            // the file's path, absolute or project-relative
 *     projectRoot,         // the checkout root
 *     projectFiles,        // admitted project-relative files (used for containment proof only)
 *   })) truth.push({ label: e.label, from: e.from, target: e.target })
 *
 * The module derives the package map / SDK presence itself (memoised per project root) when the
 * caller does not supply them, so a caller only needs the file's path and the project root.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

export interface PartOfTruthEdge {
  label: "part_of"
  from: string
  target: string
  partRole: "part" | "library"
}

export interface PartOfTruthOptions {
  /** the directive file's path — absolute, or project-relative when projectRoot is given */
  filePath: string
  /** the checkout root; when omitted the file's OWN directory is used as the root */
  projectRoot?: string
  /** the project's admitted files (project-relative, posix) — accepted for the caller's benefit
   *  and for future containment checks; the derivation below needs only the filesystem */
  projectFiles?: readonly string[]
  /** pre-built package map (name -> project-relative directory holding its pubspec.yaml) */
  packageRoots?: Map<string, string>
  /** pre-computed "does this checkout carry sdk/lib" */
  sdkLib?: boolean
}

type ProjectFacts = { packageRoots: Map<string, string>; sdkLib: boolean }
const FACTS = new Map<string, ProjectFacts>()

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", ".dart_tool", ".symlinks", "build", "coverage",
  ".pub-cache", "out",
])

/** The package name a pubspec declares: a line starting at column 0 with `name:`. A dependency's
 *  name is indented, so a column-0 line is the package's own name. Pure char scan, no regex. */
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

/** `[a-z][a-z0-9_]*` by char code — the pub and `dart:` library name shape. */
function isDartLibraryName(text: string): boolean {
  if (text.length === 0) return false
  const first = text.charCodeAt(0)
  if (first < 97 || first > 122) return false
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (!ok) return false
  }
  return true
}

/** Walk the checkout for pubspec.yaml files: the project's own statement of its packages. */
function projectFacts(projectRoot: string): ProjectFacts {
  const hit = FACTS.get(projectRoot)
  if (hit) return hit
  const facts: ProjectFacts = {
    packageRoots: new Map(),
    sdkLib: existsSync(path.join(projectRoot, "sdk", "lib")),
  }
  const stack: string[] = [projectRoot]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: import("fs").Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const child = path.join(dir, entry.name)
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try { isDir = statSync(child).isDirectory() } catch { isDir = false }
      }
      if (isDir) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (seen.has(child)) continue
        seen.add(child)
        stack.push(child)
        continue
      }
      if (entry.name !== "pubspec.yaml") continue
      const name = pubspecName(child)
      if (name === null || facts.packageRoots.has(name)) continue
      const rel = path.relative(projectRoot, dir)
      facts.packageRoots.set(name, rel.split(path.sep).join("/"))
    }
  }
  FACTS.set(projectRoot, facts)
  return facts
}

/** The file's own module name, the way this lane's module symbol is named: the DECLARED library
 *  name when the directive has one, else the file stem. Read from the `library_name` node. */
function moduleNameOf(root: any, fileRel: string): string {
  const stem = path.basename(fileRel, path.extname(fileRel))
  const named = root.namedChildren?.find((c: any) => c?.type === "library_name")
  if (!named) return stem
  const dotted = named.namedChildren?.find((c: any) => c?.type === "dotted_identifier_list")
  if (!dotted) return stem
  return stripWhitespace(String(dotted.text ?? "")) || stem
}

function stripWhitespace(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13) continue
    out += text[i]
  }
  return out
}

/** The URI a directive names, from its own `string_literal`/`uri` child; "" when the directive
 *  has no URI (the named `part of my.lib;` form). */
function directiveUri(node: any): string {
  const stack: any[] = [node]
  let literal: any = null
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "string_literal" || n.type === "uri") { literal = n; break }
    for (const c of n.namedChildren ?? []) stack.push(c)
  }
  if (!literal) return ""
  let text = String(literal.text ?? "")
  if (text.length >= 2) {
    const q = text[0]
    if ((q === "'" || q === '"') && text[text.length - 1] === q) text = text.slice(1, -1)
  }
  return text
}

/** Project-relative path of `abs`, or null when it climbs out / is absolute. */
function relInside(projectRoot: string, abs: string): string | null {
  const rel = path.relative(projectRoot, path.resolve(abs))
  if (rel.length === 0 || path.isAbsolute(rel)) return null
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) return null
  return rel.split(path.sep).join("/")
}

/** Resolve a part/library URI to the project-relative file it names, or null (no row). */
function resolveSpecifier(projectRoot: string, fileRel: string, uri: string, facts: ProjectFacts): string | null {
  if (uri.length === 0) return null
  if (uri.startsWith("package:")) {
    const rest = uri.slice(8)
    const slash = rest.indexOf("/")
    if (slash <= 0 || slash === rest.length - 1) return null
    const pkg = rest.slice(0, slash)
    const sub = rest.slice(slash + 1)
    if (!isDartLibraryName(pkg)) return null
    const packageRoot = facts.packageRoots.get(pkg)
    if (packageRoot === undefined) return null
    const joined = path.posix.normalize(`${packageRoot === "" ? "" : `${packageRoot}/`}lib/${sub}`)
    if (joined.length === 0 || joined === ".." || joined.startsWith("../")) return null
    return joined
  }
  if (uri.startsWith("dart:")) {
    const lib = uri.slice(5)
    if (!isDartLibraryName(lib)) return null
    if (!facts.sdkLib) return null
    const rel = `sdk/lib/${lib}/${lib}.dart`
    return existsSync(path.join(projectRoot, rel)) ? rel : null
  }
  if (uri.indexOf(":") >= 0) return null
  const abs = path.resolve(projectRoot, path.dirname(fileRel), uri)
  return relInside(projectRoot, abs)
}

/**
 * Derive this file's `part_of` truth rows.
 *
 * The recursion is over the PROGRAM's direct children (directives are top-level), but it also
 * walks nested directives defensively: a `part` inside a malformed subtree is still a directive
 * the analyzer reads, and a truth walk that refused it would make the analyzer's row look
 * fabricated.
 */
export function deriveDartPartOfTruth(root: any, opts: PartOfTruthOptions): PartOfTruthEdge[] {
  const projectRoot = opts.projectRoot !== undefined
    ? path.resolve(opts.projectRoot)
    : path.dirname(path.resolve(opts.filePath))
  const fileAbs = path.isAbsolute(opts.filePath)
    ? path.resolve(opts.filePath)
    : path.resolve(projectRoot, opts.filePath)
  const fileRel = relInside(projectRoot, fileAbs) ?? path.basename(fileAbs)
  const facts: ProjectFacts = {
    packageRoots: opts.packageRoots ?? projectFacts(projectRoot).packageRoots,
    sdkLib: opts.sdkLib ?? projectFacts(projectRoot).sdkLib,
  }
  const from = moduleNameOf(root, fileRel)
  const out: PartOfTruthEdge[] = []
  const seen = new Set<string>()
  const visit = (node: any): void => {
    if (!node) return
    if (node.type === "part_directive" || node.type === "part_of_directive") {
      const partRole: "part" | "library" = node.type === "part_of_directive" ? "part" : "library"
      const uri = directiveUri(node)
      let target: string | null = null
      if (uri.length > 0) {
        target = resolveSpecifier(projectRoot, fileRel, uri, facts)
      } else if (partRole === "part") {
        // THE NAMED FORM: `part of my.lib;` — no URI, the library is named. The target is that
        // name exactly as the owning library publishes it (whitespace-stripped).
        const dotted = node.namedChildren?.find((c: any) => c?.type === "dotted_identifier_list")
        const named = dotted ? stripWhitespace(String(dotted.text ?? "")) : ""
        if (named.length > 0) target = named
      }
      if (target !== null) {
        const key = `${from}|${target}|${partRole}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ label: "part_of", from, target, partRole })
        }
      }
    }
    for (const c of node.namedChildren ?? []) visit(c)
  }
  visit(root)
  return out
}
