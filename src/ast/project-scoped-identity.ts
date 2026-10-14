/**
 * PROJECT-SCOPED DOCUMENT IDENTITY — the shared rule for "what is this file called".
 *
 * ## The defect this exists to close
 *
 * A data-file analyzer publishes one symbol for the file itself, and it named that symbol by the
 * filesystem BASENAME. A basename is the one part of a path that is **not** unique in a project.
 * Measured on the yaml corpus: `hostports0.yaml` occurs **156 times** in a single repository
 * (Kubernetes' pod-security-admission testdata, once per API version) and `Chart.yaml` **243
 * times** across the helm charts. On the json corpus every `package.json` publishes a module
 * symbol named `package`, and `package.dependencies` alone carries **3 declarations**.
 *
 * Every qualified path under the document inherits the collision — `hostports0.spec.containers[0]`
 * had 156 declarations — so the `contains` edge asserting that containment cannot be walked in
 * EITHER direction: the shared resolver binds a bare name only under `HAVING COUNT(*) = 1`, and an
 * exact-key match has to be unique too. This is cause A of the fleet's incoming problem in its
 * purest form, and it is not reducible by emitting fewer edges, because an ambiguous edge is ONE
 * edge attributed to N declarations.
 *
 * ## The rule
 *
 * A file-scoped symbol's identity must CONTAIN the file. The basename is not unique; the
 * project-relative directory chain is, and it is stable across machines in a way the absolute
 * path is not. Three properties make it the only sound spelling:
 *
 *  - **Dot-joined, not slash-joined.** Everything downstream already treats a dotted string as a
 *    path (`spec.containers[0]`, `Schema.X.properties`). A slash here would introduce a SECOND,
 *    undeclared path convention into one key space, and the resolver matches on the dotted form.
 *  - **Basename LAST.** The leaf of every member path is computed by slicing a fixed number of
 *    characters off the module prefix (`afterModuleImpl`, `pathDepth`), so the basename must stay
 *    the final segment for that arithmetic to keep working unchanged. Moving it would break every
 *    one of those call sites.
 *  - **Dots inside the scope are safe.** `pathDepth` splits on `.` only AFTER slicing the module
 *    prefix off by LENGTH, and every `lastIndexOf(".")` that reads a path reads a KEY that sits
 *    past the module prefix. A scope segment that itself contains a dot therefore cannot inflate a
 *    depth or be mistaken for a key. This is checked against every `lastIndexOf(".")` in the
 *    consuming analyzer rather than assumed.
 *
 * ## Why this is a shared module and not a per-lane copy
 *
 * Two analyzers needing the same rule and each keeping a private copy is how a key space grows two
 * conventions, and the second one is invisible until a resolver disagrees with both. It is a
 * separate module for that reason alone — not for reuse.
 *
 * `RealYamlAnalyzer` currently holds its own private copy of these three functions and is NOT yet
 * migrated here. That duplication is deliberate and visible rather than hidden: the yaml lane's
 * change is uncommitted work owned by another lane, so editing that file from here would take a
 * second owner's work. Migrating it is a one-line import change for whoever owns yaml, and this
 * file is the single place the rule will change if it ever needs to.
 */

/**
 * The file's own path relative to its project root, POSIX-normalised, or `null` when that cannot
 * be known.
 *
 * `null` is returned — never `""` and never a guess — in every ambiguous case, because a WRONG
 * scope is worse than no scope: the scope's entire job is to be the part of the identity that
 * cannot collide, so a plausible-but-wrong one would manufacture the exact collisions this exists
 * to remove, while looking like a fix. The cases that return `null`:
 *
 *  - no root was supplied, i.e. the caller did not say which project the file is in;
 *  - the root is empty;
 *  - the file IS the root;
 *  - the file does not sit under the root (a relative `filePath` against an absolute root, which is
 *    how several callers run).
 *
 * Backslashes and trailing separators are folded with `split`/`join` and an index walk rather than
 * a replace, so this module holds no regular expression at all — the fleet's rule is no regex, and
 * a rule this module violates in its own first function would be worth nothing.
 */
export function projectRelativePath(filePath: string, projectRoot?: string): string | null {
  if (!projectRoot) return null
  const root = stripTrailingSlashes(projectRoot.split("\\").join("/"))
  const file = stripTrailingSlashes(filePath.split("\\").join("/"))
  if (root.length === 0 || file === root || !file.startsWith(root + "/")) return null
  return file.slice(root.length + 1)
}

/** Drop trailing `/` separators. A root of `"/"` must fold to `""`, not survive as `"/"`. */
function stripTrailingSlashes(p: string): string {
  let end = p.length
  while (end > 0 && p.charAt(end - 1) === "/") end--
  return p.slice(0, end)
}

/**
 * The file's PROJECT-RELATIVE DIRECTORY CHAIN, dot-joined, or `""` when it cannot be known.
 *
 * `""` is the honest answer for a file sitting at the project root: it has no directory, so there
 * is nothing to scope by, and the caller keeps its bare basename. That is also the cheapest case —
 * a root-level file's basename is already unique within its own repository, which is the scope
 * this rule operates at.
 */
export function documentDirScope(filePath: string, projectRoot?: string): string {
  const rel = projectRelativePath(filePath, projectRoot)
  if (rel === null) return ""
  const cut = rel.lastIndexOf("/")
  if (cut < 0) return ""
  return rel.slice(0, cut).split("/").filter((s) => s.length > 0).join(".")
}

/**
 * Fold a scope onto an already-computed basename: `<scope>.<basename>` when the scope is known,
 * and the bare basename otherwise.
 *
 * The basename is left EXACTLY as the caller computed it, including any dots it legitimately
 * contains (`.markdownlint-cli2.jsonc` → `.markdownlint-cli2`, and `foo.bar.json` → `foo.bar`).
 * Stripping or re-encoding it would change what every existing fixture asserts, for no gain in
 * uniqueness — the scoped path is already unique.
 */
export function applyDocumentScope(basename: string, scope: string): string {
  return scope.length > 0 ? `${scope}.${basename}` : basename
}