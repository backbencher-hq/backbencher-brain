/**
 * TOML analyzer — M14 (#289).
 *
 * Enters a lane that had a grammar and nothing else: `toml` was absent from
 * `getAnalyzer`, so a `.toml` file was walked by the generic AST fallback and a
 * ten-line Cargo.toml published **28 symbols and 0 relationships**, every one of
 * them `kind=variable` with `owner=null`. Eleven of those 28 names contained
 * whitespace — one was literally `[package]\nname = "demo"\nversion = "0.1.0"\n\n`
 * — and two collided. A name is an identity, and source text is not one.
 *
 * ## The rulings
 *
 * **TOML-IDENTITY — a symbol is the FILE, a TABLE, or a KEY.** The file is the
 * `module`; every `[table]` and `[[array-of-tables]]` header is a symbol; every
 * `key = value` is a symbol whose owner is the table that declares it. Keys are
 * symbols because a key is what a consumer actually targets: `cargo build
 * --features X` reaches `features.X`, and a graph that cannot name that is a
 * graph of the file rather than of the document.
 *
 * **A symbol's NAME is its full dotted path from the document root.**
 * `[workspace.lints.rust]` is ONE symbol named `workspace.lints.rust`, and the
 * key `rust-version` inside it is `workspace.package.rust-version`. Not the last
 * segment: cargo's own `[workspace.lints.rust]` and `[workspace.lints.rustdoc]`
 * both end in a distinct segment but `[package]` and a `[[bin]]` element both
 * contain a key literally named `name`, so a leaf-only name collides in the very
 * first manifest anyone would write. The full path is also what makes the file's
 * names unique, which is the property the html lane needed its suffix rule for.
 *
 * **IMPLIED PARENTS ARE RECORDED, NOT MATERIALISED.** `[a.b.c]` implies `a` and
 * `a.b` whether or not the file declares them. Fabricating symbols for headers
 * the file never wrote is a guess dressed as a fact, so the table records them
 * in `metadata.impliedParents` and the graph stays honest about what was written.
 *
 * **AN INLINE TABLE'S KEYS ARE NOT SYMBOLS.** `x = { a = 1, b = "two" }` makes `x`
 * the symbol; `a` and `b` are part of a single value expression. A Cargo.toml with
 * 200 dependencies declared as `{ version = "...", features = [...] }` would
 * otherwise publish 600+ symbols naming nothing a consumer can navigate to on its
 * own. The key NAMES are still recorded on the enclosing key's
 * `metadata.inlineKeys`, so nothing is lost — it is a scoping decision, not a
 * deletion.
 *
 * **THE RELATIONSHIP VOCABULARY IS `contains`, `imports` AND `references` — MEASURED.** The
 * early version of this header claimed `contains` alone was "the whole truth"; two later
 * rulings overturned it, each on a corpus measurement rather than an argument, and the
 * coverage block in `script/m14/spec/toml-completeness.json` is now the record of all ten
 * types. `imports` is emitted for a Cargo path dependency (`[dependencies] foo = { path =
 * "../foo" }`, 331 edges over the corpus, 317 of them naming a real manifest directory).
 * `references` is emitted for a Gradle version-catalogue alias (`version.ref = "groovy"`
 * inside an inline table, 167 edges over 5 files). The other six — `calls`, `uses`,
 * `exports`, `extends`, `implements`, `instantiates`, `overrides` — are `grammar-absence`:
 * 0 of the pinned grammar's 19 named node types can carry them, and the corpus corroborates
 * with 0 occurrences or 0 referents. `exports` is the one that is NOT ruled out: 174
 * publish-shaped key sites exist, so it stays in the denominator as an unimplemented gap.
 * A value like `path = "src/main.rs"` is still a *string*: the analyzer never treats a
 * path-shaped string as a reference from an arbitrary key, which is why `imports` is
 * restricted to dependency sections and why the unresolved-path spelling is deliberate.
 * OPEN, not folded into any number: the workspace-inheritance half of `references`
 * (`x.workspace = true`, 1,269 sites in 138 documents) is unimplemented — TOML-G1.
 *
 * Pure-String throughout: `segmentsOf`, `joinPath`, `asciiLower` are index loops.
 * No regex, no source-text scraping — the analyzer reads AST nodes and never the
 * file's characters.
 */
import * as path from "path"
import { readFileSync, statSync } from "fs"
import { ASTEngine } from "./engine"
import { dirOf, fileClaimForTarget, projectRelativeOf } from "./file-claim"
import { applyDocumentScope, documentDirScope } from "./project-scoped-identity"
import type { Node } from "web-tree-sitter"

/**
 * THE MANIFESTS A PATH DEPENDENCY POINTS AT. A `path` dependency names a DIRECTORY in every tool
 * that reads these formats (Cargo, Julia's Pkg, pyproject), and the directory is a real dependency
 * because of the manifest inside it — so the FILE is what a project's own admitted list can confirm
 * by EXACT match, and the directory is not (the gate's prefix arm would need an admitted file under
 * it anyway, which is the same fact one step less precise).
 */
const DEPENDENCY_MANIFESTS = ["Cargo.toml", "Project.toml", "JuliaProject.toml", "pyproject.toml", "Package.toml"]

/**
 * THE CONVENTIONAL PUBLISH-SURFACE LEAVES — a CANDIDATE GENERATOR for `exports`, never the decision.
 *
 * These are the same eleven leaves the lane's census counts (module, publish, main, public, exposed,
 * entrypoint, export(s), expose, pub, mod). A TOML key carries no grammar for "this is what I publish",
 * so candidates must come from ecosystem conventions; what must NOT come from a name is the DECISION.
 * See `pendingPublishSurface` in `analyze` for the data test that decides, and for why the name list
 * alone was the ruled defect.
 */
const PUBLISH_SURFACE_KEYS = new Set([
  "export", "exports", "expose", "exposed", "pub", "public", "publish", "main", "module", "mod", "entrypoint",
])

/**
 * THE FILE CLAIM for a path dependency, or null when no claim can be MADE.
 *
 * `imports` targets are paths as written, and the graph has to say something true about them. The
 * gate can verify one statement — "this target names a file of the project" — against the
 * project's own admitted file list (`FILE_CLAIM_KEY`, incoming-rule.ts), and it REFUTES a
 * candidate that names nothing. So the claim is emitted only where the manifest is really there,
 * which is the condition under which the gate will verify it; a target that names nothing stays
 * UNCLAIMED and unresolved rather than carrying a statement the project would refute.
 *
 * MEASURED over the whole admitted population (`.tmp-toml/imports-claim-probe2.mts`, 331 `imports`
 * edges): 318 candidates verify, 13 name nothing, and the filesystem test below agrees with the
 * gate's admitted-list verdict on all 331 — zero claimed-but-refuted, zero unclaimed-but-verifiable.
 * The 13 are cargo's own `cargo_add` fixtures and Pkg.jl's `WorkspacePathResolution` fixture, whose
 * `path` intentionally names a directory that does not exist beside the declaring manifest; they are
 * ruled with a count rather than marked external to make the number smaller.
 *
 * THE COUNT MOVED ON 2026-10-13, and the direction is the point: 8 of those fixtures declared Cargo's
 * `base =`, and THREE of them resolve through the nearest `.cargo/config.toml` `[path-bases]` entry
 * (see the fallback in the body) into a manifest the project carries. Measured over the SAME whole
 * population, that took the unresolved column from 13 to 10 and `extOK` from 318 to 321, with the
 * edge count unchanged at 331. The other five `base` sites have no config in their ancestor chain —
 * the base is undefined and Cargo itself would refuse — so they stay unresolved along with the five
 * paths that name nothing beside their manifest, and those 10 are the ruling.
 *
 * Null is returned — never a guess — when there is no project root, when the value is not a plain
 * relative path (a URL, an absolute path, a glob, whitespace), or when it escapes the project.
 * A WRONG claim is worse than no claim: the gate counts a refutation against the lane exactly as it
 * counts an unresolved edge, and a fabricated candidate would manufacture the refutation.
 */
function dependencyFileClaim(written: string, filePath: string, projectRoot: string | null, base: string | null): string | null {
  // ON THE SHARED GUARD since 2026-10-11. The arithmetic stays TOML's own — a `path` dependency names
  // a DIRECTORY, and the file the project can confirm is the manifest inside it — while the admitting
  // (admitted extension, project boundary, `statSync`) is `fileClaimForTarget`.
  //
  // THE EXTENSION CLAUSE IS NEW HERE AND IT IS THE POINT OF THE SHARED GUARD: the arbiter's facts are
  // the lane's admitted `.toml` files, so a candidate of any other extension can never verify while a
  // miss still REFUTES. The old fallback returned `posix` when it was merely *a file* — the guard now
  // requires that file to be one this lane's population can hold.
  //
  // BEHAVIOUR IS MEASURED, NOT ASSUMED: whole population, the lane's `imports` row must keep
  // `extOK 318` and `extFAIL 0`. If the count moves, the extension clause dropped a claim the old
  // arithmetic made, and that claim would have been about a file outside the admitted list.
  if (projectRoot === null || projectRoot.length === 0) return null
  const root = path.resolve(projectRoot)
  const fileRel = path.relative(root, filePath).split(path.sep).join("/")
  // THE WORKAROUND IS GONE, and the row must stay at 318 without it. `projectRelativeOf` answers `""`
  // for a path that lands exactly on the project root (`path = ".."` in `docs/Project.toml`), where
  // the manifest really is — the case `foldProjectPath` refuses, correctly, because the root is not a
  // file. Before it existed this lane carried a local `path.resolve(...) === root` branch to recover
  // the ten edges the fold lost; that branch is deleted here and the lane's own row is its control.
  const posix = projectRelativeOf(dirOf(fileRel), written.trim())
  const extraCandidates: string[] = []
  if (posix !== null) {
    for (const m of DEPENDENCY_MANIFESTS) extraCandidates.push(posix.length === 0 ? m : `${posix}/${m}`)
    if (posix.length > 0) extraCandidates.push(posix)
  }
  const standard = fileClaimForTarget({
    projectRoot: root,
    filePath,
    written,
    admittedExtensions: ["toml"],
    extraCandidates,
  })
  if (standard !== null) return standard
  // ── CARGO'S `path-bases` SPELLING, tried ONLY as a fallback ───────────────────────────────────
  //
  // A path dependency may name a BASE instead of spelling the whole path:
  //
  //     cargo-features = ["path-bases"]
  //     [dependencies]
  //     dep = { version = "0.0.0", base = "my_base", path = "./dependency" }
  //
  // and the base is a `[path-bases]` entry in a `.cargo/config.toml`:
  //
  //     [path-bases]
  //     my_base = "deps"
  //
  // Cargo resolves the dependency at `resolve(base, path)` (`src/workspace/parser/mod.rs:2456-2483`,
  // `lookup_path_base`), with a config path itself relative to the directory CONTAINING `.cargo`
  // (`ConfigRelativePath::resolve_path`). MEASURED over the whole admitted population: 8 `imports`
  // edges declared a `base`, and THREE of them resolve to a manifest the project really carries
  // (`cargo_add/detect_workspace_inherit_path_base/in/Cargo.toml` → `in/deps/dependency/Cargo.toml`;
  // two more fixtures with `my_base = "."`). For those the edge is a REAL dependency whose claim was
  // simply not computable without this rule; the other five name a base their fixture tree does not
  // define, so no spelling of them names anything and they stay unresolved on purpose.
  //
  // FALLBACK-ONLY, and that is the safety property rather than a nicety: the standard spellings are
  // tried first and returned unchanged when one of them names a file, so this rule can only ever ADD
  // a claim where the lane previously emitted NOTHING. It cannot move, replace or re-point a claim
  // that already existed, which is what makes a wrong pick here impossible to reach through a path
  // the old code already handled.
  if (base === null) return null
  const baseCandidates = pathBaseCandidates(base, written, filePath, root)
  if (baseCandidates.length === 0) return null
  return fileClaimForTarget({
    projectRoot: root,
    filePath,
    written,
    admittedExtensions: ["toml"],
    extraCandidates: [...baseCandidates, ...extraCandidates],
  })
}

/**
 * THE VALUE A `.cargo/config.toml` GIVES A `[path-bases]` NAME, or null when this reader will not
 * vouch for it.
 *
 * WHY A TEXT READ OF THE CONFIG, when the analyzer's own header says it reads AST nodes and never a
 * file's characters: the config is NOT the document under analysis. It is an external artifact
 * consulted to decide whether a CLAIM IS TRUE, exactly like the `statSync` the file claim already
 * performs; the analyzed document is still read as AST nodes only. This is the same boundary the
 * lane already crossed for the manifest's presence, and it is stated rather than implied.
 *
 * THE READER IS NARROW ON PURPOSE AND REFUSES RATHER THAN GUESSES. Null is returned for: a dotted
 * or array-of-tables header, an unterminated quote, a line with no `=`, a value that is not a plain
 * quoted string, any backslash inside a value, and TWO entries for the same base. Every one of those
 * refusals leaves the edge in the state it is in today (unresolved) — a mis-read would attach a
 * claim to the wrong file, which the arbiter cannot see and which this lane's bar counts as worse
 * than a gap. Pure String throughout: no regex, no backtracking.
 */
function pathBaseValueIn(configText: string, base: string): string | null {
  let inSection = false
  let found: string | null = null
  for (const raw of configText.split("\n")) {
    const uncommented = stripCommentOutsideQuotes(raw)
    if (uncommented === null) return null
    const line = uncommented.trim()
    if (line.length === 0) continue
    if (line.charCodeAt(0) === 91) {
      // 91 `[` — a table header. Only the exact `[path-bases]` form is understood.
      const close = line.indexOf("]")
      if (close < 0) return null
      inSection = line.slice(1, close).trim() === "path-bases"
      continue
    }
    if (!inSection) continue
    const eq = line.indexOf("=")
    if (eq < 0) return null
    if (unquoteKey(line.slice(0, eq).trim()) !== base) continue
    const value = line.slice(eq + 1).trim()
    if (value.length < 2) return null
    const q = value.charCodeAt(0)
    if ((q !== 34 && q !== 39) || value.charCodeAt(value.length - 1) !== q) return null
    const inner = value.slice(1, -1)
    if (inner.includes("\\")) return null
    if (found !== null) return null
    found = inner
  }
  return found
}

/**
 * The part of a line before a `#` that is OUTSIDE quotes, or null when the line's quoting is not
 * understood. 92 is `\`, 34 `"`, 39 `'`, 35 `#`.
 */
function stripCommentOutsideQuotes(line: string): string | null {
  let quote = 0
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i)
    if (quote !== 0) {
      if (c === 92) { i++; continue }
      if (c === quote) quote = 0
      continue
    }
    if (c === 34 || c === 39) { quote = c; continue }
    if (c === 35) return line.slice(0, i)
  }
  return quote === 0 ? line : null
}

/**
 * The project-relative candidate paths a `base`-carrying dependency resolves to, or an empty array.
 *
 * Cargo's config discovery walks UP from the working directory; a per-file analyzer has no working
 * directory, so it walks up from the MANIFEST's directory to the project root, nearest first, and
 * takes the first config that defines the base. A config that exists but does not define the base is
 * passed over rather than treated as authoritative, because Cargo MERGES the config chain and a
 * higher level may define it. A candidate that escapes the project is refused, and an empty result
 * means "no claim" — never a guess.
 */
function pathBaseCandidates(base: string, written: string, filePath: string, projectRoot: string): string[] {
  const root = path.resolve(projectRoot)
  let dir = path.dirname(path.resolve(filePath))
  // 64 levels is a bound on a pathological tree, not a policy: the walk already stops at the project
  // root, and at the filesystem root for a `projectRoot` that is not an ancestor.
  for (let depth = 0; depth < 64; depth++) {
    const configPath = path.join(dir, ".cargo", "config.toml")
    let text: string | null = null
    try {
      if (statSync(configPath).isFile()) text = readFileSync(configPath, "utf8")
    } catch { text = null }
    if (text !== null) {
      const value = pathBaseValueIn(text, base)
      if (value !== null) {
        const joined = path.resolve(path.resolve(dir, value), written.trim())
        const rel = path.relative(root, joined).split(path.sep).join("/")
        if (rel.length === 0 || rel === ".." || rel.startsWith("../")) return []
        const out: string[] = []
        for (const m of DEPENDENCY_MANIFESTS) out.push(`${rel}/${m}`)
        out.push(rel)
        return out
      }
    }
    const parent = path.dirname(dir)
    if (dir === root || parent === dir) break
    dir = parent
  }
  return []
}

/**
 * THE DECLARED KEY PATHS OF A WORKSPACE ROOT, as full dotted paths — the fact that decides whether a
 * workspace-inheritance edge can be emitted.
 *
 * `x.workspace = true` says the value is declared by the workspace manifest, and the path it inherits
 * is `workspace.<section>.<field>` (Cargo's `[workspace.package]` / `[workspace.dependencies]`). The
 * edge is emitted ONLY when the root really declares that path, so the analyzer needs the root's key
 * paths. Three spellings exist in the corpus and all three must land on the same path:
 *
 *     [workspace.package]           [workspace]                    [workspace.dependencies]
 *     version = "3.0.0"             package.version = "3.0.0"      serde = "1"
 *
 * MEASURED, and this is why the reader is a full-path one: the first version of the lane's census
 * recorded `[table] -> bare keys` and read `hasura-engine/v3/Cargo.toml` — which uses the DOTTED form
 * — as NOT declaring the fields its members inherit, while the target it computed existed in the key
 * space. The analyzer publishes `workspace.package.version` for `package.version` under `[workspace]`,
 * so the target was right and the READER was wrong. 124 sites moved from "unresolvable" to "fixable"
 * when this was corrected, and that error is the reason the two columns are printed side by side.
 *
 * Pure String, and it REFUSES nothing: a line without `=` is a value continuation and is skipped.
 */
function workspaceDeclaredPaths(text: string): Set<string> {
  const paths = new Set<string>()
  let table = ""
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.length === 0 || line.charAt(0) === "#") continue
    if (line.charAt(0) === "[") {
      const close = line.indexOf("]")
      table = close < 0 ? "" : line.slice(1, close).trim()
      continue
    }
    const eq = line.indexOf("=")
    if (eq < 0) continue
    let key = line.slice(0, eq).trim()
    // One layer of TOML quoting, so `"rust-version"` and `rust-version` are one path.
    if (key.length >= 2) {
      const q = key.charCodeAt(0)
      if ((q === 34 || q === 39) && key.charCodeAt(key.length - 1) === q) key = key.slice(1, -1)
    }
    if (key.length === 0) continue
    paths.add(table.length > 0 ? `${table}.${key}` : key)
  }
  return paths
}

/** Does this manifest text declare a `[workspace]` table? */
function declaresWorkspace(text: string): boolean {
  for (const raw of text.split("\n")) if (raw.trim() === "[workspace]") return true
  return false
}

/** The nearest ancestor manifest declaring `[workspace]`, with the module name IT publishes under —
 *  the exact key prefix an inherited value resolves to. Null when there is none, or no project. */
function findWorkspaceRoot(filePath: string, projectRoot: string | null): { abs: string; moduleName: string } | null {
  if (projectRoot === null || projectRoot.length === 0) return null
  const root = path.resolve(projectRoot)
  let dir = path.dirname(path.resolve(filePath))
  for (let depth = 0; depth < 64; depth++) {
    for (const m of ["Cargo.toml", "Project.toml", "pyproject.toml", "Package.toml"]) {
      const abs = path.join(dir, m)
      let text: string | null = null
      try { if (statSync(abs).isFile()) text = readFileSync(abs, "utf8") } catch { text = null }
      if (text === null || !declaresWorkspace(text)) continue
      const stem = path.basename(abs, path.extname(abs)) || "document"
      return { abs, moduleName: applyDocumentScope(stem, documentDirScope(abs, root)) }
    }
    const parent = path.dirname(dir)
    if (dir === root || parent === dir) break
    dir = parent
  }
  return null
}

/** TOML's bare-key alphabet is A-Za-z0-9_-; a quoted key is anything in quotes. */
function isBareKeyChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 45 // -
  )
}

function asciiLower(text: string): string {
  let out = ""
  let changed = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 65 && c <= 90) {
      out += text[i].toLowerCase()
      changed = true
    } else out += text[i]
  }
  return changed ? out : text
}

/**
 * Strip one layer of TOML quoting from a `quoted_key` / `string` node's text.
 *
 * A quoted key may be a basic string (`"a.b"`) or a literal string (`'a.b'`), and
 * the QUOTES ARE PART OF ITS SPAN — so without this a key named `a.b` and a key
 * named `"a.b"` would be the same symbol, and the second would silently shadow
 * the first. A literal string has no escapes, so it is a pure slice; a basic
 * string unescapes only the forms that can appear in a key.
 */
function unquoteKey(text: string): string {
  if (text.length < 2) return text
  const first = text.charCodeAt(0)
  if (first !== 34 && first !== 39) return text // 34 `"`, 39 `'`
  const inner = text.slice(1, -1)
  if (first === 39) return inner // literal string: no escapes at all
  let out = ""
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charCodeAt(i)
    if (c !== 92) {
      out += inner[i]
      continue
    }
    // A backslash: the only escapes a KEY can carry are the ones TOML defines, and
    // an unknown one is passed through rather than dropped — silently discarding
    // half a key would invent a different identity.
    const n = inner.charCodeAt(i + 1)
    i++
    if (n === 110) out += "\n" // \n
    else if (n === 116) out += "\t" // \t
    else if (n === 114) out += "\r" // \r
    else if (n === 34) out += '"' // \"
    else if (n === 92) out += "\\" // \\
    else if (n === 117 || n === 85) {
      // \uXXXX — four hex digits, pure-String.
      const hex = inner.slice(i + 1, i + 5)
      if (hex.length === 4) {
        const v = Number.parseInt(hex, 16)
        if (Number.isFinite(v)) {
          out += String.fromCharCode(v)
          i += 4
          continue
        }
      }
      out += "\\u"
    } else {
      out += "\\"
      out += inner[i] ?? ""
    }
  }
  return out
}

/**
 * The SEGMENTS of a key node, outermost first.
 *
 * The grammar nests `dotted_key` left-associatively: `a.b.c` is
 * `dotted_key(dotted_key(dotted_key(a, b), c))` flattened to `dotted_key(a, dotted_key(b, c))`
 * in practice, so this walks down the FIRST child until it reaches a leaf key and
 * then unwinds. Recursion is bounded by the key's segment count, and a key with
 * 10,000 segments would be a file no tool can read — but the walk is iterative
 * anyway, so a pathological key cannot overflow the stack.
 *
 * **An EMPTY SEGMENT IS A SEGMENT.** A `quoted_key` of `""` is a real TOML key
 * — the empty name — and `joinPath` spells it back as `""`, so it round-trips.
 * This used to end in `.filter((s) => s.length > 0)`, which deleted it, and the
 * deletion was not neutral: inside a table the caller's path is built as
 * `${name}.${joinPath(...)}`, so `[tool.setuptools.package-dir]` followed by
 * `"" = "src/python/grpcio"` produced the published symbol name
 * `tool.setuptools.package-dir.` — a trailing dot, which is not a spelling TOML
 * can parse back. Measured on the corpus, not reasoned about:
 * `pb-grpc/pyproject.toml:53` is the one occurrence in 1,140 files, and the
 * lane's own differential oracle already had it right (`spell("")` returns
 * `""` and its `segmentsOf` does not filter), so the two disagreed by exactly
 * one edge on exactly one file — a file neither of the lane's two differential
 * corpora contains.
 *
 * The DOCUMENTED OMISSION is unchanged and is now applied at both levels by
 * `namesSomething`: a key that is `""` and nothing else produces no symbol,
 * because an identity needs a name. That is the lane's stated decision and
 * `toml/malformed-and-rejected` pins it at the document root; what changed is
 * that the in-table path now obeys the same rule instead of disagreeing with it.
 */
function segmentsOf(node: Node): string[] {
  // Collect the dotted_key chain from the root down.
  const chain: Node[] = []
  let cur: Node = node
  while (cur.type === "dotted_key") {
    chain.push(cur)
    const first = ((cur.namedChildren ?? []) as Node[])[0]
    if (!first) break
    cur = first
  }
  const out: string[] = []
  if (cur.type === "bare_key" || cur.type === "quoted_key") out.push(unquoteKey(cur.text))
  // Unwind: the deepest node contributed the FIRST segment, each level adds one.
  for (let i = chain.length - 1; i >= 0; i--) {
    const kids = chain[i].namedChildren ?? []
    const rest: Node | undefined = kids.length > 0 ? (kids[kids.length - 1] as Node) : undefined
    if (rest && (rest.type === "bare_key" || rest.type === "quoted_key")) {
      out.push(unquoteKey(rest.text))
    } else if (rest) {
      // A nested dotted_key we already consumed via the chain.
      for (const seg of segmentsOf(rest)) out.push(seg)
    }
  }
  return out
}

/**
 * Does this key NAME something? A key of `""` — and only `""` — does not, and
 * produces no symbol, which is the lane's recorded decision rather than an
 * oversight. It is asked of every key at every level so that the document root
 * and a table cannot disagree about the same rule: before this, the root asked
 * `segments.length === 0` (which an empty segment satisfies by accident) and a
 * table asked nothing at all.
 */
function namesSomething(segments: string[]): boolean {
  for (const s of segments) if (s.length > 0) return true
  return false
}

/**
 * Assemble a key's dotted path, re-quoting any segment that would otherwise be
 * ambiguous.
 *
 * A flat dotted path is only a faithful name if the segments can be read back.
 * Inside `[t]`, the bare key `a.b.c` and the quoted key `"a.b".c` are DIFFERENT TOML
 * keys — the first is the table `a` holding `b` holding `c`, the second is a table
 * whose name is literally `a.b`. Assembled naively both produce `t.a.b.c`, and the
 * collision is not cosmetic: the dedupe then invents `t.a.b.c#2`, which asserts
 * that the document declared one key twice when it declared two distinct ones.
 * That is the unresolvable-identity class arriving through the naming scheme
 * rather than through a missing edge.
 *
 * So a segment containing a dot — or a quote, or a backslash — is written back the
 * way TOML itself disambiguates it, in quotes. The name then round-trips: `a.b.c`
 * stays bare, `"a.b".c` keeps its quotes, and the two can never be confused. This
 * is the document's own spelling rather than an invented escape syntax.
 */
function joinPath(segments: string[]): string {
  let out = ""
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) out += "."
    out += spellSegment(segments[i])
  }
  return out
}

/** Spell ONE path segment: bare when TOML permits it, quoted otherwise.
 *
 *  The question is the SPEC's — may this segment be written BARE? — rather than
 *  "does it contain punctuation". TOML's bare-key alphabet is exactly A-Za-z0-9-_
 *  and a bare key may not be empty, so anything else is quoted.
 *
 *  The distinction is not pedantic. `[target."cfg(unix)".dependencies]` is real
 *  cargo syntax, and a test for `.`/`"`/`\` alone finds no punctuation in
 *  `cfg(unix)` at all — it has parentheses — so the segment was emitted UNQUOTED
 *  as `target.cfg(unix).dependencies`. The name then read back as three nested
 *  tables when the document declares two, and an unquoted path is not a spelling
 *  TOML can parse, so the name had lost the property that makes it faithful.
 *  Found by the differential oracle on cargo's own Cargo.toml, which is the
 *  argument for deriving the rule from the specification rather than from the
 *  characters that happen to matter in the sample you tested. The same rule
 *  catches a segment containing a SPACE, which is legal quoted and illegal bare.
 */
function spellSegment(seg: string): string {
  let bare = seg.length > 0
  for (let k = 0; bare && k < seg.length; k++) {
    const c = seg.charCodeAt(k)
    bare = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45
  }
  if (bare) return seg
  let out = '"'
  for (let k = 0; k < seg.length; k++) {
    const c = seg.charCodeAt(k)
    if (c === 34 || c === 92) out += "\\"
    out += seg[k]
  }
  return out + '"'
}

/** The value node of a `pair`, or null when the pair has none. */
function valueOf(pair: Node): Node | null {
  const kids = (pair.namedChildren ?? []) as Node[]
  // The KEY is first and the VALUE follows it — but a TRAILING COMMENT also follows
  // it, and a comment is a named child:
  //
  //     detekt = "1.23.8"   # When upgrading, also upgrade in detekt.yml ...
  //     pair > bare_key, string, comment
  //
  // So "the last named child" returned the COMMENT, not the value. That misreported
  // `valueType` as "comment" for a commented string, made every such key invisible to
  // scalar detection, and — worse — meant a key with an INLINE TABLE plus a trailing
  // comment was never recognised as an inline table, so its nested keys were dropped
  // from `inlineKeys` entirely.
  //
  // Found while implementing alias references: 3 of 82 `version.ref` aliases in
  // Exposed/gradle/libs.versions.toml silently failed to resolve because the version
  // key they name carried a trailing comment.
  //
  // Scanned backwards for the last child that is not a comment, which keeps the
  // original behaviour for every pair without a trailing comment.
  for (let i = kids.length - 1; i >= 1; i--) {
    const k = kids[i]
    if (k.type === "comment") continue
    return k
  }
  // Only a key, or a key and comments: a parse artefact, not a TOML document.
  return null
}

/** The key node of a `pair` — first child, which is always a key type. */
function keyOf(pair: Node): Node | null {
  const first = (pair.namedChildren ?? [])[0] as Node | undefined
  if (!first) return null
  return first.type === "bare_key" || first.type === "quoted_key" || first.type === "dotted_key" ? first : null
}

/** The header key of a `table` / `table_array_element`. */
function headerKeyOf(node: Node): Node | null {
  for (const child of (node.namedChildren ?? []) as Node[]) {
    if (child.type === "bare_key" || child.type === "quoted_key" || child.type === "dotted_key") return child
  }
  return null
}

/** A stable, human-meaningful `resourceType`-style label for a value node. */
/**
 * The string a TOML `string` node holds, or null if it is not a plain string.
 *
 * Single-quoted ('literal') and double-quoted ("basic") forms are both returned with
 * their quotes stripped. No escape processing is done for the basic form, which is
 * deliberate and is the conservative choice: an alias containing an escape sequence
 * will simply fail to resolve and produce NO edge, rather than resolving to a
 * half-decoded name. An edge to a name that does not exist is worse than a missing
 * edge, because it cannot be distinguished from a real reference by a reader.
 */
/**
 * Is this value node a SCALAR (not a table, array, or inline table)?
 *
 * Deliberately NOT `valueKind() !== "..."`. `valueKind` classifies the whole PAIR, so a
 * key whose value is a string with a TRAILING COMMENT comes back as "comment":
 *
 *     detekt = "1.23.8"   # When upgrading, also upgrade in detekt.yml ...
 *     -> versions.detekt  valueType "comment"
 *
 * Relying on that made alias resolution drop every version-scoped key that happens to
 * carry a comment, which silently cost 3 edges in the corpus — and it would have done
 * the same to any commented key in any file. The value node is the authority on what
 * the VALUE is; a comment is not part of it.
 *
 * (That `valueType: "comment"` for a commented string is itself questionable, but it is
 * the analyzer's published contract and changing it would shift counts across the lane,
 * so it is recorded rather than altered here. See the state doc.)
 */
function isScalarValueNode(node: Node | null): boolean {
  if (!node) return false
  return (
    node.type === "string" ||
    node.type === "integer" ||
    node.type === "float" ||
    node.type === "boolean"
  )
}

function stringValueOf(node: Node | null): string | null {
  if (!node || node.type !== "string") return null
  const text = (node.text ?? "").trim()
  if (text.length < 2) return null
  const q = text[0]
  if (q !== "'" && q !== '"') return null
  if (text[text.length - 1] !== q) return null
  return text.slice(1, -1)
}

/**
 * The `*.ref` aliases an INLINE TABLE declares, as `{ keyPath, alias }`.
 *
 * The construct is Gradle's version catalogue:
 *
 *     [versions]
 *     groovy = "4.0.26"
 *     groovy-bom = { module = 'org.apache.groovy:groovy-bom', version.ref = 'groovy' }
 *
 * `version.ref = 'groovy'` names a key of the SAME DOCUMENT, which is the only thing
 * that makes it a reference rather than a string. Only a key whose LAST segment is
 * `ref` qualifies — that is what makes it an alias of a sibling declaration rather
 * than an arbitrary nested field, and it is why `module` and `group` are ignored.
 *
 * The alias is looked up by FINAL SEGMENT, because the alias lives in `[versions]`
 * while the referencing key sits at the document root, so the two are never in the
 * same table scope. Matching on the last segment is the documented resolution and is
 * what the lane's corpus measurement used (167 occurrences in 5 files, all 167
 * resolving).
 */
function inlineRefAliases(inlineTable: Node): { keyPath: string; alias: string }[] {
  const out: { keyPath: string; alias: string }[] = []
  for (const child of (inlineTable.namedChildren ?? []) as Node[]) {
    if (child.type !== "pair") continue
    const ck = keyOf(child)
    if (!ck) continue
    const segs = segmentsOf(ck)
    if (segs.length === 0) continue
    if (segs[segs.length - 1] !== "ref") continue
    const alias = stringValueOf(valueOf(child))
    if (!alias) continue
    out.push({ keyPath: joinPath(segs), alias })
  }
  return out
}

function valueKind(node: Node | null): string {
  if (!node) return "none"
  switch (node.type) {
    case "string":
      return "string"
    case "integer":
      return "integer"
    case "float":
      return "float"
    case "boolean":
      return "boolean"
    case "array":
      return "array"
    case "inline_table":
      return "inline-table"
    case "offset_date_time":
    case "local_date_time":
    case "local_date":
    case "local_time":
      return "datetime"
    default:
      return node.type
  }
}

export class RealTomlAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult {
    // The engine hands over the PATH, not a module name — every analyzer derives
    // its own. `Cargo.toml` must be the module `Cargo`: a module whose name ends
    // in its own extension collides with nothing but reads as a filename wherever
    // it appears, and `Cargo` is what a user would search for.
    //
    // ## WHY THE MODULE NAME IS PROJECT-SCOPED (measured, 2026-10-09)
    //
    // The basename is the one part of a path that is NOT unique in a project. A cargo
    // workspace holds a `Cargo.toml` at the root and one under every member — every one of
    // them publishes `package`, `package.name`, `dependencies.serde` — so a `contains` edge
    // written `package -> package.name` names N declarations in its own project and cannot
    // be walked in either direction. Measured through `script/m14/residual-gate.ts --lane
    // toml` at HEAD: 25,530 edges, **18,971 ambiguous by declaration**, essentially all of it
    // `contains` (25,033 of the edges), residual 75.6%.
    //
    // Production resolves an edge target only by EXACT `qualified_name` match in the project,
    // or by a bare name whose project-wide count is exactly 1
    // (`parallel-indexer.ts resolveRelationships`, strategies 1 and 2) — so the fix is the one
    // json and dart already made: the file-scoped identity is the PROJECT-RELATIVE DIRECTORY
    // CHAIN plus the stem, and every qualified path under the document carries it. The rule
    // itself lives in `./project-scoped-identity` rather than here, so this lane cannot grow
    // a second spelling of it.
    //
    // A root-level file has no directory chain, so its scope is "" and its name is unchanged —
    // which is why the fixtures, which are handed no project root, spell exactly as before.
    const stem = path.basename(filePath, path.extname(filePath)) || "document"
    const moduleName = applyDocumentScope(stem, documentDirScope(filePath, context?.projectRoot))
    /** The project this file belongs to, when the caller said — the scope a `path` dependency is
     *  resolved against, and the only thing that makes a file claim computable at all. */
    const projectRoot = typeof context?.projectRoot === "string" && context.projectRoot.length > 0 ? context.projectRoot : null
    /** A symbol's identity as the RESOLVER sees it: file-scoped, unique in the project. The
     *  module keeps its own name (it is already scoped), every member is prefixed by it. */
    const qualified = (name: string): string => (name === moduleName ? moduleName : `${moduleName}.${name}`)
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const errors: ASTEngine.ParseError[] = []
    const patterns: string[] = []

    /** Per-file name allocation. TOML forbids redefining a key inside one table,
     *  but a file may still collide across constructs, and a NAME that is not
     *  unique is an identity that cannot be resolved — so allocation is tracked
     *  the same way html tracks it, including the watermark + occupancy PROBE:
     *  a document may literally declare a key called `bin#2`. */
    // The module OWNS its name in this file's name space, and relationships
    // address nodes by name, so a table that wants the same name makes every edge
    // to it ambiguous. `doc/book/book.toml` declares `[book]`, so without this the
    // module and the table are both `book` and a `contains` edge naming `book`
    // resolves to two nodes. Seeding the space makes the TABLE take the suffix
    // instead, which is the same precedence html uses (its `usedNames` starts as
    // `{ [moduleName]: 1 }`): the file's identity is derived from its PATH and is
    // not negotiable, while a document node is competing for a name that is
    // already taken. Measured on cargo: 2 such collisions in 684 files, both of the
    // form `<stem>.toml` containing `[<stem>]`.
    const usedNames: Record<string, number> = { [moduleName]: 1 }
    /** Declared table path -> allocated symbol name, in document order. */
    const declaredTables: Record<string, string> = {}
    const allocate = (want: string): string => {
      const seen = usedNames[want]
      if (seen === undefined) {
        usedNames[want] = 1
        return want
      }
      let n = seen
      let name = want
      do {
        n++
        name = `${want}#${n}`
      } while (usedNames[name] !== undefined)
      usedNames[name] = 1
      usedNames[want] = n
      return name
    }

    const range = (node: Node): ASTEngine.UniversalSymbol["range"] => ({
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    })


    // --- Error collection ----------------------------------------------------
    // The error-recovery contract is REPORTED / BYPASSED / KEEP PUBLISHING, and
    // this analyzer was honouring only the middle and last of those on its own:
    // it pushed no diagnostics at all, so the "reported" half was entirely the
    // ENGINE's, reached through `children` rather than anything this file does.
    // That is a contract resting on a caller — the same blindness the svelte lane
    // had, in the opposite direction. Measured over the whole 743-file pool, 2
    // files (0.27%) carry an ERROR node, and the spec claimed neither ERROR nor
    // MISSING ever occurred here, from twelve hand-made malformed documents. The
    // corpus says otherwise, so this walks the tree itself and reports each
    // recovery node at its OWN span, matching what the engine will also say.
    // `children`, not `namedChild`: the expected token of a MISSING node can be
    // anonymous, and a named-only walk is blind to exactly the case it exists for.
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: range(n),
            severity: "warning",
          })
        }
        for (let i = n.childCount - 1; i >= 0; i--) {
          const child = n.child(i)
          if (child) errStack.push(child)
        }
      }
    }

    // The file is the module. A TOML document is one root table, and without a
    // module every top-level key is parentless and the file has no identity.
    symbols.push({
      name: moduleName,
      qualifiedName: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      range: range(rootNode),
      scope: "",
      visibility: "public",
      ownerName: undefined,
      ownerKind: undefined,
      metadata: {
        tomlSpecific: true,
        isDocumentRoot: true,
        evidenceClass: "structural",
      },
    })

    let tableCount = 0
    let keyCount = 0
    let arrayOfTablesCount = 0
    let inlineTableCount = 0
    let maxDepth = 0
    /** Sections emitted by the single walk, so the second pass can re-own them. */
    const sectionRecords: { segments: string[]; owner: string; symbolIndex: number; relIndex: number }[] = []
    let reOwnedSections = 0

    /**
     * The nearest DECLARED ancestor of `segments`, which is the owner a table
     * reports. Walks the path prefix by prefix — O(depth), not O(declared) — and
     * returns the implied parents it passed over, so a header like `[a.b.c]` in a
     * file that never declares `a` records `a` and `a.b` as implied rather than
     * inventing symbols for them.
     */
    const resolveOwner = (
      segments: string[],
    ): { owner: string; implied: string[] } => {
      const implied: string[] = []
      let owner = moduleName
      // Accumulate the SEGMENTS and let `joinPath` do the spelling, rather than
      // concatenating strings here. An intermediate version split an already-joined
      // path on `.` to recover the segments, which is unsound for the same reason
      // indexing a raw string with decoded offsets was: a QUOTED segment contains
      // dots, so `target."cfg(windows)".dependencies`.split(".") cuts inside it and
      // returns fragments with unbalanced quotes. The segment array is the truth;
      // the joined string is only ever produced by the one function that owns it.
      const acc: string[] = []
      // The prefix MUST be assembled by the SAME function that keys
      // `declaredTables`, and it was not. `declaredTables` is keyed by `joinPath`,
      // which re-quotes any segment that cannot be written bare, while this built
      // its prefixes from the raw segments — so a lookup for
      // `target.cfg(windows).dependencies` never matched the stored
      // `target."cfg(windows)".dependencies` and the declared ancestor was
      // reported as implied. The visible effect was on cargo's OWN Cargo.toml,
      // where `[target.'cfg(windows)'.dependencies.windows-sys]` on line 254 was
      // filed under the module instead of under the `[target.'cfg(windows)'.
      // dependencies]` declared three lines earlier. The symbol's NAME was right —
      // it came from the emit path, which does use `joinPath` — so only the
      // CONTAINMENT was wrong, which is precisely the class of defect a
      // hand-written fixture misses and a differential finds: two paths through
      // the same file building the same key differently.
      for (let i = 0; i < segments.length - 1; i++) {
        acc.push(segments[i])
        const prefix = joinPath(acc)
        const declared = declaredTables[prefix]
        if (declared !== undefined) owner = declared
        else implied.push(prefix)
      }
      return { owner, implied }
    }

    /**
     * Emit a key symbol. `path` is its FULL dotted path from the document root,
     * which is what makes the file's names unique without a synthetic suffix on
     * every collision.
     */
    /**
     * Declared scalar keys, keyed by their FINAL segment, for alias resolution.
     * A `references` edge is only emitted where the alias is unambiguous.
     */
    const declaredByFinalSegment = new Map<string, string>()
    const ambiguousFinalSegments = new Set<string>()
    const pendingAliases: { source: string; keyPath: string; alias: string; line: number }[] = []

    /**
     * Sections that DECLARE A DEPENDENCY on another unit.
     *
     * Not every `path = "..."` is a dependency. `[bin] name = "x"` and
     * `[lib] path = "src/lib.rs"` name THIS crate's own source, and an edge to
     * them would assert that the manifest needs something it already is. These
     * six sections instead say "this manifest cannot be built without another
     * unit, and here is where it lives".
     *
     * `workspace.dependencies` and `[patch.<registry>]` are included because both
     * name a unit the workspace or the build genuinely takes from elsewhere;
     * Julia's `[sources]` overrides where a declared dependency is loaded from.
     */
    const DEPENDENCY_SECTIONS = new Set([
      "dependencies",
      "dev-dependencies",
      "build-dependencies",
      "workspace.dependencies",
      "sources",
      "patch.crates-io",
    ])
    /** `foo = { path = "../foo" }` sites, emitted after the walk. `base` is Cargo's `path-bases`
     *  name when the site declares one — `foo = { base = "my_base", path = "./dependency" }` — and it
     *  is what makes the claim computable at all (see `dependencyFileClaim`). */
    const pendingImports: { source: string; pathValue: string; section: string; line: number; base: string | null }[] = []

    /**
     * TOML-G1 — Cargo WORKSPACE INHERITANCE sites (`x.workspace = true`), emitted after the walk.
     *
     * MEASURED over the whole admitted population (1,485 files): **1,269 sites in 137 documents**, in
     * five shapes, and the split is what decided this implementation rather than a reading of Cargo's
     * docs — `validation/m14/fixtures/toml/tools/residual-whole-population.mts --workspace`:
     *
     *     dependency-inline   503 sites /  88 files   target exists in the project key space: 503
     *     package-field       417 sites / 101 files                                    : 417
     *     dependency-dotted   251 sites /  38 files                                    : 248
     *     lints                84 sites /  84 files                                    :   0
     *     dependency-table     14 sites /   8 files                                    :  12
     *
     * `target exists` is the test that separates a fix from a boundary: the edge the analyzer would
     * emit is `<rootModule>.workspace.<section>.<field>`, and that name must be a declaration the
     * project really publishes. 1,180 of the 1,269 pass. The 84 `lints` sites do not and are SKIPPED
     * on purpose: `[lints] workspace = true` inherits the WHOLE `[workspace.lints]` table, which the
     * corpus declares only as sub-tables (`[workspace.lints.clippy]`), so there is no single
     * declaration a single edge could name — one site would need N targets or an invented container
     * symbol, and inventing one is the guess this lane refuses.
     *
     * THE EMISSION IS CONDITIONAL ON THE ROOT DECLARING THE PATH, read from the root's own text: a
     * member may write `license.workspace = true` where the root declares no such field, and Cargo
     * itself errors on that. Emitting there would add an unresolved edge, so the analyzer checks the
     * same fact the gate would check, from the only place it exists.
     */
    const pendingWorkspace: { source: string; tableName: string; inherited: string | null; line: number }[] = []

    /**
     * `exports` CANDIDATES — and the ONE decision that may turn a candidate into an edge.
     *
     * LEAD RULING 2026-10-13: `exports` means A NAME THE UNIT PUBLISHES FOR OTHERS TO IMPORT, and a
     * manifest key whose VALUE is a path or a directory (`publish = "build"`) is a publish-surface fact
     * about an ARTIFACT, not an export of a name. Emitting one under `exports` is a TYPE ERROR IN
     * EMISSION, and the consumer-visible consequence is a dangling edge a consumer can follow and get
     * nothing back from.
     *
     * THE NAME LIST IS THE CANDIDATE GENERATOR, NEVER THE DECISION. A TOML key carries no grammar for
     * "this is what I publish", so candidates have to come from the conventions the ecosystem uses — the
     * same eleven leaves the lane's census counts (module, publish, main, public, exposed, entrypoint,
     * export(s), expose, pub, mod). MEASURED: 174 such sites over the whole admitted population.
     *
     * THE DECISION IS THE DATA, and it is json's standard, measured: json's `exports` edge targets a
     * DECLARATION THE SAME DOCUMENT PUBLISHES (29 of 29 edges over a 12-document sample). So a candidate
     * becomes an edge only when its VALUE NAMES A DECLARATION OF THIS DOCUMENT; the target is that
     * declaration. Under this test the corpus yields ZERO edges — 0 of the 174 sites' values name a
     * declaration here, and the single project-wide coincidence (`publish = "build"`, an output
     * directory) is not one of them — so the defect cannot occur by construction rather than by a name
     * filter that would have to be maintained.
     */
    const pendingPublishSurface: { siteName: string; sitePath: string; value: string; line: number }[] = []

    /** Is the pair's value the boolean `true`? */
    const isBooleanTrue = (pair: Node): boolean => {
      const v = valueOf(pair)
      return v !== null && v.type === "boolean" && String(v.text).trim() === "true"
    }
    /**
     * Does this pair CONTAIN a `workspace = true` member — the `foo = { workspace = true }` spelling?
     * The site's own key is the OUTER key, which is why this is a containment test and not a leaf test.
     */
    const containsWorkspaceTrue = (pair: Node): boolean => {
      const v = valueOf(pair)
      if (!v || v.type !== "inline_table") return false
      for (const inner of (v.namedChildren ?? []) as Node[]) {
        if (inner.type !== "pair") continue
        const ik = keyOf(inner)
        if (!ik) continue
        if (segmentsOf(ik)[0] !== "workspace") continue
        if (isBooleanTrue(inner)) return true
      }
      return false
    }
    /**
     * The `workspace.<section>.<field>` path this site inherits, or null when the shape is not one of
     * the measured families. Section-aware, because the target is NOT the site's own path with a prefix:
     * `[target.'cfg(windows)'.dependencies.windows-sys] workspace = true` inherits
     * `workspace.dependencies.windows-sys`, not `workspace.target.'cfg(windows)'...`.
     */
    const inheritedPathOf = (pathSegs: string[], keySegs: string[], tableForm: boolean): string | null => {
      const DEP = new Set(["dependencies", "dev-dependencies", "build-dependencies"])
      const depIndex = pathSegs.findIndex((s) => DEP.has(s))
      const last = keySegs[keySegs.length - 1]
      if (last !== "workspace") return null
      if (depIndex >= 0) {
        // The dependency's name: the table's last segment when the site IS the table
        // (`[...dependencies.windows-sys] workspace = true`), otherwise the key segment before
        // `workspace` (`serde.workspace = true`, `serde = { workspace = true }`).
        const name = tableForm ? pathSegs[pathSegs.length - 1] : keySegs.length >= 2 ? keySegs[keySegs.length - 2] : ""
        return name.length > 0 ? `workspace.dependencies.${name}` : null
      }
      if (pathSegs.length === 1 && pathSegs[0] === "package" && keySegs.length >= 2) {
        return `workspace.package.${keySegs.slice(0, -1).join(".")}`
      }
      if (pathSegs.length === 1 && pathSegs[0] === "lints") return "workspace.lints" // no single target — see above
      return null
    }

    /**
     * A STRING MEMBER of a dependency's inline table, by its FINAL key segment — or null.
     *
     * The DEPENDENCY is the outer key and `path` is the inner one, so a probe that
     * reads the outer key as `path` sees nothing at all — which is what the
     * applicability audit's first version did, and it reported 0 on a population
     * the corpus carries 331 times.
     *
     * `base` is read the same way and for the same reason: it is a member of the same inline table
     * and it decides WHICH DIRECTORY the `path` is relative to, so an analyzer that ignores it folds
     * the path against the wrong base and finds nothing.
     */
    const stringMemberOf = (pair: Node, leaf: string): string | null => {
      const value = valueOf(pair)
      if (!value || value.type !== "inline_table") return null
      for (const inner of (value.namedChildren ?? []) as Node[]) {
        if (inner.type !== "pair") continue
        const ik = keyOf(inner)
        if (!ik) continue
        const isegs = segmentsOf(ik)
        if (isegs[isegs.length - 1] !== leaf) continue
        const v = stringValueOf(valueOf(inner))
        if (v && v.length > 0) return v
      }
      return null
    }
    const pathDependencyOf = (pair: Node): string | null => stringMemberOf(pair, "path")

    const emitKey = (pair: Node, path: string, owner: string): void => {
      const keyNode = keyOf(pair)
      if (!keyNode) return
      const name = allocate(path)
      const value = valueOf(pair)
      const inlineKeys: string[] = []
      if (value && value.type === "inline_table") {
        inlineTableCount++
        for (const child of (value.namedChildren ?? []) as Node[]) {
          const ck = keyOf(child)
          if (ck) inlineKeys.push(joinPath(segmentsOf(ck)))
        }
      }
      const line = keyNode.startPosition.row + 1
      // An `exports` CANDIDATE: a publish-surface key with a STRING value. The DECISION is made after
      // the walk, when the document's own declaration set is complete — see `pendingPublishSurface`.
      {
        const ksegs = segmentsOf(keyNode)
        const leaf = ksegs.length > 0 ? ksegs[ksegs.length - 1] : ""
        if (PUBLISH_SURFACE_KEYS.has(leaf) && value !== null && value.type === "string") {
          const sv = stringValueOf(value)
          if (sv !== null && sv.length > 0) pendingPublishSurface.push({ siteName: name, sitePath: path, value: sv, line })
        }
      }
      symbols.push({
        name,
        qualifiedName: qualified(name),
        kind: ASTEngine.SymbolKind.Property,
        range: range(pair),
        scope: "",
        visibility: "public",
        ownerName: owner,
        ownerKind: owner === moduleName ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Namespace,
        metadata: {
          tomlSpecific: true,
          isDocumentRoot: owner === moduleName,
          keyText: joinPath(segmentsOf(keyNode)),
          valueType: valueKind(value),
          ...(inlineKeys.length > 0 ? { inlineKeys } : {}),
          evidenceClass: "structural",
        },
      })
      relationships.push({
        // BOTH ENDS CARRY THE FILE-SCOPED IDENTITY. A document-relative target names N
        // declarations the moment a project holds two manifests with the same shape, and
        // the resolver can only bind an exact qualified-name match — see the header note.
        source: qualified(owner),
        target: qualified(name),
        type: ASTEngine.RelationshipType.Contains,
        confidence: 1.0,
        line_number: line,
        metadata: {
          tomlSpecific: true,
          isKeyContainment: true,
          evidenceClass: "structural",
        },
      })
      keyCount++

      // Record the key for alias resolution. Only SCALAR keys are recorded: a table
      // named `groovy` is a namespace, not the version string that `version.ref`
      // names, and pointing a reference edge at a namespace would resolve to
      // something that exists but means something else.
      if (isScalarValueNode(value)) {
        const segs = segmentsOf(keyNode)
        if (segs.length > 0) {
          const finalSeg = segs[segs.length - 1]
          // First declaration wins, and that choice is recorded rather than being
          // last-wins silently: a document that declares the same final segment twice
          // in different tables has no single right answer, and picking one without
          // saying so is how an edge ends up pointing at an arbitrary declaration.
          if (!declaredByFinalSegment.has(finalSeg)) {
            declaredByFinalSegment.set(finalSeg, name)
          } else {
            ambiguousFinalSegments.add(finalSeg)
          }
        }
      }

      if (value && value.type === "inline_table") {
        for (const { keyPath, alias } of inlineRefAliases(value)) {
          pendingAliases.push({ source: name, keyPath, alias, line })
        }
      }
    }

    // The document's children are its sections and its implicit-root keys. TOML
    // tables are FLAT sections — a `table` never contains another `table` — so
    // this walk is one level deep and needs no stack at all.
    for (const node of (rootNode.namedChildren ?? []) as Node[]) {
      if (node.type === "table" || node.type === "table_array_element") {
        const header = headerKeyOf(node)
        if (!header) continue
        const segments = segmentsOf(header)
        if (!namesSomething(segments)) continue
        const path = joinPath(segments)
        const { owner, implied } = resolveOwner(segments)
        const isArray = node.type === "table_array_element"
        if (isArray) arrayOfTablesCount++
        // The name is the full path, suffixed only on a genuine collision (two
        // `[[bin]]` blocks), and the CHILDREN use the allocated name so a key
        // under the second `[[bin]]` is distinct from the first's.
        const name = allocate(path)
        declaredTables[path] = name
        tableCount++
        if (segments.length > maxDepth) maxDepth = segments.length
        // Captured BEFORE either push, because the indices have to address the
        // symbol and the edge this header is about to produce. Reading
        // `symbols.length` afterwards addresses the NEXT one, which is how the
        // first version of this pass moved the wrong symbols and still typechecked.
        const symbolIndex = symbols.length
        const relIndex = relationships.length
        symbols.push({
          name,
          qualifiedName: qualified(name),
          kind: ASTEngine.SymbolKind.Namespace,
          // The section's whole span, from its `[` to the line before the next
          // header — which is exactly the region its keys live in, so a key's
          // range is inside its table's and containment is checkable.
          range: range(node),
          scope: "",
          visibility: "public",
          ownerName: owner,
          ownerKind: owner === moduleName ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Namespace,
          metadata: {
            tomlSpecific: true,
            isDocumentRoot: owner === moduleName,
            isArrayOfTables: isArray,
            headerText: header.text,
            keyPath: path,
            ...(implied.length > 0 ? { impliedParents: implied } : {}),
            evidenceClass: "structural",
          },
        })
        relationships.push({
          source: qualified(owner),
          target: qualified(name),
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          line_number: node.startPosition.row + 1,
          metadata: {
            tomlSpecific: true,
            isTableHeader: true,
            isArrayOfTables: isArray,
            ...(implied.length > 0 ? { hasImpliedParents: true } : {}),
            evidenceClass: "structural",
          },
        })
        // The section's own key/value pairs. Comments and nested values are not
        // descended into — see the inline-table ruling. `namesSomething` is asked
        // here as well as at the document root, so a `"" = 1` inside a table is
        // omitted by the SAME rule that omits one at the root; before this the
        // root asked and the table did not, and the disagreement published a
        // symbol whose name ended in a bare `.`.
        sectionRecords.push({ segments, owner, symbolIndex, relIndex })
        for (const child of (node.namedChildren ?? []) as Node[]) {
          if (child.type !== "pair") continue
          const ck = keyOf(child)
          if (!ck) continue
          const segs = segmentsOf(ck)
          if (!namesSomething(segs)) continue
          emitKey(child, `${name}.${joinPath(segs)}`, name)
          if (DEPENDENCY_SECTIONS.has(path)) {
            const depPath = pathDependencyOf(child)
            if (depPath !== null) {
              pendingImports.push({
                source: `${name}.${joinPath(segs)}`,
                pathValue: depPath,
                section: path,
                line: ck.startPosition.row + 1,
                base: stringMemberOf(child, "base"),
              })
            }
          }
          // WORKSPACE INHERITANCE, both spellings that hang off a KEY: `version.workspace = true`
          // (the pair's own leaf is `workspace`) and `serde = { workspace = true }` (the pair's VALUE
          // holds it). The third spelling — `[target.'cfg(windows)'.dependencies.windows-sys]` with
          // `workspace = true` as a child — arrives through the same leaf test, with tableForm set
          // because the pair IS the table's only key and the dependency is the TABLE.
          {
            const keyLeafIsWorkspace = segs[segs.length - 1] === "workspace" && isBooleanTrue(child)
            const valueHoldsWorkspace = containsWorkspaceTrue(child)
            if (keyLeafIsWorkspace || valueHoldsWorkspace) {
              // The dependency's name comes from the TABLE when the site's whole key is `workspace`
              // (`[target.'cfg(unix)'.dependencies.windows-sys] workspace = true`), and from the KEY
              // otherwise (`serde.workspace = true`, `serde = { workspace = true }`).
              //
              // THE INLINE FORM NEEDS THE `workspace` SEGMENT SYNTHESISED, and the first version of
              // this missed every one of them: `serde = { workspace = true }` has key segments
              // `["serde"]`, so the "does the key end in workspace" test that drives the whole rule
              // rejected all 503 sites while the other 680 emitted. The gate caught it as an edge
              // COUNT that disagreed with the measurement, not as a wrong edge — which is exactly why
              // the count is checked against a pre-measured population.
              const tableForm = keyLeafIsWorkspace && segs.length === 1
              const keySegs = valueHoldsWorkspace ? [...segs, "workspace"] : segs
              const inherited = inheritedPathOf(segments, keySegs, tableForm)
              if (inherited !== null) {
                pendingWorkspace.push({
                  source: `${name}.${joinPath(segs)}`,
                  tableName: name,
                  inherited,
                  line: ck.startPosition.row + 1,
                })
              }
            }
          }
        }
      } else if (node.type === "pair") {
        // A key before any header belongs to the implicit root table.
        const ck = keyOf(node)
        if (!ck) continue
        const segs = segmentsOf(ck)
        if (!namesSomething(segs)) continue
        emitKey(node, joinPath(segs), moduleName)
        if (segs.length > maxDepth) maxDepth = segs.length
      }
    }

    // ---- SECOND PASS: TOML's declaration order is not significant ----------
    //
    // `[a.b]` written ABOVE `[a]` is valid TOML, and `a.b` is inside `a`. The
    // walk above resolves an owner from a document-order map, so such a section
    // is filed under the MODULE and its `contains` edge points at the file
    // instead of at the table that contains it. That is a containment edge with
    // the wrong source, which is the same defect class the lane's `resolveOwner`
    // comment already records for quoted segments ("the emit path does quote — so
    // only the CONTAINMENT was wrong").
    //
    // Measured: 1 occurrence in 1,140 files, `ansible/pyproject.toml`, where
    // `[tool.setuptools.dynamic]` is on line 45 and `[tool.setuptools]` on line
    // 49. One is still one, and it is the ONLY shape in the corpus where the
    // walk's order assumption is contradicted by the language, which is why it is
    // fixed rather than recorded.
    //
    // The fix is a re-own pass over the sections already emitted, using the
    // WHOLE declared-table map. It cannot loop: an owner is always a strict
    // PREFIX of the section's own path, so the containment it writes is acyclic by
    // construction, and a section's own keys are unaffected because they hang off
    // its allocated name rather than off its owner.
    //
    // The lane's differential oracle builds its `declared` map in document order
    // too, so it will disagree on exactly this file until
    // `deriveTomlEdges` in `script/m14/differential.ts` (supervisor-owned) gains
    // the same second pass. Neither of the lane's two differential corpora
    // contains a file with the shape, so the toml differential draw is unchanged;
    // the whole-pool draw is where the disagreement would appear.
    for (const rec of sectionRecords) {
      const { owner, implied } = resolveOwner(rec.segments)
      if (owner === rec.owner) continue
      const symbol = symbols[rec.symbolIndex] as { ownerName?: string; ownerKind?: unknown; metadata?: Record<string, unknown> }
      symbol.ownerName = owner
      symbol.ownerKind = owner === moduleName ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Namespace
      const meta = symbol.metadata ?? (symbol.metadata = {})
      meta.isDocumentRoot = owner === moduleName
      // The implied-parent record was computed against the incomplete map, so it
      // is recomputed rather than patched: with the full map a prefix the file
      // declares LATER is declared, and calling it implied would be the same
      // order-dependence one pass later.
      if (implied.length > 0) meta.impliedParents = implied
      else delete meta.impliedParents
      const rel = relationships[rec.relIndex] as { source: string; metadata?: Record<string, unknown> }
      rel.source = qualified(owner)
      const relMeta = rel.metadata ?? (rel.metadata = {})
      if (implied.length > 0) relMeta.hasImpliedParents = true
      else delete relMeta.hasImpliedParents
      reOwnedSections++
    }

    // ---- `references`: alias edges, emitted AFTER the document is walked -------
    //
    // Order matters and is the whole reason this is here rather than inside emitKey:
    // an alias may name a key declared LATER in the file, so resolving during the walk
    // would miss every forward reference. `groovy-bom` on line 40 of
    // `geb/gradle/libs.versions.toml` names `groovy`, declared on line 18 — fine — but
    // the reverse order occurs too and would silently produce nothing.
    //
    // An alias whose final segment is AMBIGUOUS (declared more than once in different
    // tables) emits NO edge and is counted, because picking one declaration would be a
    // guess. A reference to an arbitrary one of two candidates cannot be
    // distinguished from a correct one by anything downstream.
    let aliasEdges = 0
    let aliasUnresolved = 0
    let aliasAmbiguous = 0
    for (const { source, keyPath, alias, line } of pendingAliases) {
      const target = declaredByFinalSegment.get(alias)
      if (ambiguousFinalSegments.has(alias)) {
        aliasAmbiguous++
        continue
      }
      if (!target) {
        aliasUnresolved++
        continue
      }
      aliasEdges++
      relationships.push({
        source: qualified(source),
        target: qualified(target),
        type: ASTEngine.RelationshipType.References,
        confidence: 1.0,
        line_number: line,
        metadata: {
          tomlSpecific: true,
          isAliasReference: true,
          // WHICH key inside the owning inline table made the reference. The edge
          // is anchored at `source` because `source.keyPath` is NOT a node: the
          // analyzer publishes the inline table's keys as `inlineKeys` metadata on
          // the owning symbol and never as symbols of their own. Measured over the
          // corpus, 167 of 167 emitted edges carried a source that bound to 0
          // symbols in its own file, against 167 of 167 targets binding to exactly
          // 1 — an edge reachable by no incoming query, since `traceCallers` JOINs
          // `brain_symbol` on the source. The anchor was carrying the specificity
          // the metadata now carries.
          aliasKeyPath: keyPath,
          resolvedBy: "final-segment",
          evidenceClass: "structural",
        },
      })
    }
    if (aliasEdges > 0) patterns.push(`alias-refs x${aliasEdges}`)
    if (aliasUnresolved > 0) patterns.push(`alias-unresolved x${aliasUnresolved}`)
    if (aliasAmbiguous > 0) patterns.push(`alias-ambiguous x${aliasAmbiguous}`)

    // ---- `imports`: a path dependency, emitted AFTER the walk ---------------
    //
    // The target is the PATH AS WRITTEN, not a resolved symbol, and that is the
    // honest form rather than a shortcut. Measured on the corpus: 331 dependency
    // sites, 317 of which name a directory that really holds a `Cargo.toml` /
    // `Project.toml` (the applicability audit measures that with the filesystem).
    //
    // The module identity is file-scoped NOW (see the header note), so `qualified_name`
    // is no longer a within-document path that 744 `Cargo.toml` files collide on — but
    // that does not make this target resolvable, and the reason changed rather than
    // disappearing: the value is a DIRECTORY or a relative path (`../foo`), and the module
    // symbol of the file it points at is `<dir scope>.<stem>` — which this analyzer cannot
    // compute without reading the filesystem to learn that directory's own project-relative
    // chain. Guessing it from the string would manufacture a binding that the resolver's
    // exact-match strategy would then bind to whatever symbol happened to share the guess.
    //
    // So the edge names the path, matches no symbol, and the store keeps the NAME
    // with a NULL id — which is precisely the shape `traceCallees`'s unresolved
    // arm exists to read. Verified end to end against the real schema: the row
    // comes back as `ext:../b/Cargo.toml`. That is an edge a consumer can read and
    // traverse, where today the same dependency is not in the graph at all.
    //
    // THE CLAIM ON TOP OF THAT (2026-10-09). "Names no symbol" is not the same as "says nothing
    // checkable": the gate can verify that the target names a FILE OF THE PROJECT, and a `path`
    // dependency's directory is a real dependency precisely because of the manifest inside it. So
    // each edge carries `importProjectFile` with that manifest's project-relative path when the
    // file is really there — MEASURED over the whole admitted population: 318 of 331 verify, 13
    // name nothing, and the filesystem test agrees with the gate's admitted-list verdict on all
    // 331 (zero claimed-but-refuted, zero unclaimed-but-verifiable).
    //
    // WHY THE FILESYSTEM IS NOW READ, after a header note that said it deliberately was not: the
    // claim has to be TRUE for the gate to verify it, and the only way to know is to ask whether
    // the manifest is there. The earlier design could avoid the question because it claimed
    // nothing at all — an honest option that left every `imports` edge unresolved, which is exactly
    // the state this replaces. The check is one `statSync` per candidate on the ALREADY-COMPUTED
    // absolute path, it never decides a symbol identity, and it is the same fact the applicability
    // audit measures. The ones that name nothing are cargo's own `cargo_add` fixtures and Pkg.jl's
    // `WorkspacePathResolution` fixture; they are ruled with a count in the completeness spec rather
    // than marked external to shrink the number, and they stay unresolved on purpose. THREE of the
    // original thirteen are claimed since 2026-10-13 through Cargo's `[path-bases]` (see the
    // fallback in `dependencyFileClaim`), and each claim is VERIFIED by the project's own admitted
    // list — the row reads `extOK 321`, `unresolved 10` over the same whole population.
    let importEdges = 0
    // ---- `references`: Cargo WORKSPACE INHERITANCE, emitted AFTER the walk ---------------------
    //
    // The edge says: this key's value is declared by the workspace manifest, at
    // `<rootModule>.workspace.<section>.<field>`. It is emitted only when the root really declares
    // that path — read from the root's own text, the same fact the gate would resolve against — so
    // the emission cannot manufacture an unresolved edge. MEASURED, whole population: 1,180 sites
    // emit and every one resolves to the root's declaration; 84 `lints` sites are skipped because the
    // inherited table is declared only as sub-tables and no single declaration exists to name; 5 more
    // are skipped because the root does not declare the path (Cargo errors on those too).
    let workspaceRefs = 0
    let workspaceSkippedLints = 0
    let workspaceSkippedNoRoot = 0
    let workspaceSkippedNoDecl = 0
    if (pendingWorkspace.length > 0) {
      const wsRoot = findWorkspaceRoot(filePath, projectRoot)
      if (wsRoot === null) workspaceSkippedNoRoot = pendingWorkspace.length
      else {
        let declared: Set<string> | null = null
        for (const site of pendingWorkspace) {
          if (site.inherited === null || site.inherited === "workspace.lints") { workspaceSkippedLints++; continue }
          if (declared === null) {
            try { declared = workspaceDeclaredPaths(readFileSync(wsRoot.abs, "utf8")) } catch { declared = new Set<string>() }
          }
          if (!declared.has(site.inherited)) { workspaceSkippedNoDecl++; continue }
          workspaceRefs++
          relationships.push({
            source: qualified(site.source),
            target: `${wsRoot.moduleName}.${site.inherited}`,
            type: ASTEngine.RelationshipType.References,
            confidence: 1.0,
            line_number: site.line,
            metadata: {
              tomlSpecific: true,
              isWorkspaceInheritance: true,
              inheritedFrom: wsRoot.moduleName,
              inheritedPath: site.inherited,
              evidenceClass: "structural",
            },
          })
        }
      }
    }
    if (workspaceRefs > 0) patterns.push(`workspace-inheritance-refs x${workspaceRefs}`)
    // ---- `exports`: a published NAME, and only where THIS DOCUMENT declares it ------------------
    //
    // LEAD RULING 2026-10-13. The name-list predicate counts 174 publish-surface sites over the
    // corpus; the DATA decides that none of them is an export, because `exports` means a name the unit
    // publishes for others to import and each of those values names a path, a directory or a
    // coordinate. This pass makes that impossible by construction: a candidate becomes an edge only
    // when its value names a declaration of this document, and the edge targets that declaration —
    // json's measured standard (29 of 29 of its `exports` targets are declared in their own document).
    // MEASURED over the whole admitted population: 174 candidates, 0 emitted. The graph is unchanged;
    // what changed is that the type error can no longer be produced by a name filter.
    let publishSurfaceSites = 0
    let publishSurfaceExports = 0
    if (pendingPublishSurface.length > 0) {
      const declared = new Set<string>()
      for (const s of symbols) {
        const n = String(s.name ?? "")
        if (n.length > 0) declared.add(n)
      }
      const seenTargets = new Set<string>()
      for (const site of pendingPublishSurface) {
        publishSurfaceSites++
        // An export is not a self-loop, and it is not a reference to the site's OWN CONTEXT. The
        // document is not a name it publishes; the site's own key is not; and neither is an ancestor
        // table or a descendant of it. THAT LAST CLAUSE IS THE MEASURED COINCIDENCE, not a precaution:
        // the whole corpus emits exactly one candidate under the weaker test —
        //
        //     docs/netlify.toml   [build]  base = "docs"  publish = "build"
        //
        // — where the OUTPUT DIRECTORY happens to share its enclosing table's name. Under the weaker
        // test the analyzer emitted `docs.netlify -> docs.netlify.build`, a dangling export of a
        // build artifact. `publish` inside `[build]` names the section it configures; it does not
        // publish it. The ruling named this shape, and it is now a pinned fixture case.
        if (site.value === moduleName || site.value === site.siteName) continue
        if (site.value === site.sitePath || site.sitePath.startsWith(`${site.value}.`) || site.value.startsWith(`${site.sitePath}.`)) continue
        if (!declared.has(site.value)) continue
        const target = qualified(site.value)
        if (seenTargets.has(target)) continue
        seenTargets.add(target)
        publishSurfaceExports++
        relationships.push({
          source: moduleName,
          target,
          type: ASTEngine.RelationshipType.Exports,
          confidence: 1.0,
          line_number: site.line,
          metadata: {
            tomlSpecific: true,
            isPublishSurfaceExport: true,
            exportForm: "manifest_publish_surface",
            evidenceClass: "structural",
          },
        })
      }
    }
    if (publishSurfaceExports > 0) patterns.push(`publish-surface-exports x${publishSurfaceExports}`)
    for (const { source, pathValue, section, line, base } of pendingImports) {
      importEdges++
      // THE FILE CLAIM, or nothing. A `path` dependency names a directory, and the statement the
      // gate can CHECK is that this target names a file of the project (`FILE_CLAIM_KEY`). It is
      // emitted only where the manifest is really there (see `dependencyFileClaim`), so the gate
      // verifies it; a target naming nothing carries NO claim and stays an unresolved edge that
      // this lane rules with a count, rather than a statement the project would refute.
      const fileClaim = dependencyFileClaim(pathValue, filePath, projectRoot, base)
      relationships.push({
        source: qualified(source),
        target: pathValue,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1.0,
        line_number: line,
        metadata: {
          tomlSpecific: true,
          isPathDependency: true,
          dependencySection: section,
          // Still declared, not resolved: the consuming tool turns this path into a
          // module and nothing in the document does. The claim below is about the
          // PATH, not about a symbol.
          resolvedBy: null,
          ...(fileClaim !== null ? { importProjectFile: fileClaim } : {}),
          evidenceClass: "structural",
        },
      })
    }
    if (importEdges > 0) patterns.push(`path-deps x${importEdges}`)

    // Structural observations, published as `patterns` so a consumer can see the
    // document's SHAPE without re-parsing it. None of these is a defect claim.
    if (arrayOfTablesCount > 0) patterns.push(`array-of-tables x${arrayOfTablesCount}`)
    if (inlineTableCount > 0) patterns.push(`inline-tables x${inlineTableCount}`)

    return {
      language: "toml",
      symbols,
      relationships,
      imports: [],
      exports: [],
      errors,
      rawContent: content,
      metadata: {
        // Structural depth is the DEEPEST key path, not a node count: a flat
        // document with 10,000 sibling keys is not deeper than one with three
        // levels, and reporting the former as complexity would be meaningless.
        complexity: maxDepth,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1 + tableCount,
        framework: "TOML",
        patterns,
        detectedFrameworks: [],
        frameworkPatterns: [],
        architecturalInsights: [],
        architecturalScore: 0,
        codeQuality: "unknown",
        hasTypeInference: false,
        hasFrameworkIntelligence: false,
        analysisVersion: "m14-toml-identity-v1",
        documentMetrics: {
          tableCount,
          keyCount,
          arrayOfTablesCount,
          inlineTableCount,
          maxKeyPathDepth: maxDepth,
          // How many sections the second pass moved. Zero on every file whose
          // headers declare their ancestors first, which is the overwhelming
          // majority; a non-zero value names the count of sections in this file
          // whose `contains` source was corrected.
          reOwnedSections,
          // WORKSPACE-INHERITANCE ACCOUNTING — the four numbers behind TOML-G1, so a reader (and the
          // lane's own instrument) can sum them over the population instead of inferring the residual
          // from a difference. `refs` are the `references` edges this file emitted; the three skips are
          // the sites it deliberately did not, each with its own reason: `lints` has no single target,
          // `noDecl` means the root does not declare the inherited path (Cargo errors on those), and
          // `noRoot` means no ancestor manifest declares `[workspace]` (or no project root was given).
          workspaceInheritanceRefs: workspaceRefs,
          workspaceInheritanceSkippedLints: workspaceSkippedLints,
          workspaceInheritanceSkippedNoDecl: workspaceSkippedNoDecl,
          workspaceInheritanceSkippedNoRoot: workspaceSkippedNoRoot,
          // THE `exports` ACCOUNTING: candidates seen by the conventional leaves, and the ones the
          // DATA test turned into edges. Over the whole admitted population this reads 174 and 0 —
          // the number the ruling is about, measured at the emission site instead of counted by a
          // predicate that cannot tell a path from a name.
          publishSurfaceSites,
          publishSurfaceExports,
        },
      },
    }
  }
}
