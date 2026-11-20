/**
 * GO MODULE IDENTITY — P1-1 phase 2 helper.
 *
 * WHAT THIS ANSWERS. Whether a Go import specifier names the project's OWN package or a
 * package outside it, and where in the project that package lives. Both questions need
 * the `module` line of the project's go.mod; neither can be answered from the specifier
 * shape alone (a module path looks exactly like a third-party path).
 *
 * WHY IT IS A FILE OF ITS OWN. Three consumers need the same rule and must not grow three
 * copies of it: the analyzer (per-file, receives the module path in its context), the
 * indexer store phase (Go import-classification section), and the file-dependency engine
 * (which reads the persisted project metadata). Only `node:fs`/`node:path` are imported
 * here — no DB, no engine — so the analyzer can import it without dragging the store in.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never guesses a module path. A project without a
 * readable go.mod yields `null`, and every consumer degrades to the previous honest
 * behaviour (an undecidable specifier stays undecided) rather than inventing a boundary.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

export interface GoModuleInfo {
  /** The `module` directive's path, e.g. `github.com/bettercap/bettercap/v2`. */
  modulePath: string
  /** Absolute directory holding the go.mod this was read from. */
  moduleRoot: string
  /** The indexed project root's directory relative to `moduleRoot`, POSIX, "" at the root.
   *  A project indexed at a SUBDIRECTORY of its module (gh-cli/internal) needs this to map
   *  `github.com/cli/cli/v2/internal/x` to `x` under the project root, not `internal/x`. */
  moduleDir: string
}

/** Read the `module` line from `<dir>/go.mod`; null when absent/unreadable. Pure I/O, no
 *  parsing library: the module directive is a single line. */
export function readGoModulePath(dir: string): string | null {
  let text: string
  try {
    text = readFileSync(path.join(dir, "go.mod"), "utf8")
  } catch {
    return null
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line.startsWith("module")) continue
    const rest = line.slice(6)
    // `module` must be followed by whitespace or the line is not the directive
    // (`moduleX` is a different token). No regex: the no-regex policy holds here too.
    if (rest.length > 0 && rest[0] !== " " && rest[0] !== "\t") continue
    let token = ""
    for (const ch of rest.trim()) {
      if (ch === " " || ch === "\t") break
      token += ch
    }
    if (token.length === 0) return null
    // A quoted module path is legal (`module "example.com/m"`).
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("`") && token.endsWith("`"))) {
      token = token.slice(1, -1)
    }
    return token.length > 0 ? token : null
  }
  return null
}

/**
 * Locate the go.mod that governs `projectRoot` (the project's own directory or, for a
 * project indexed at a subdirectory of its module, the nearest ancestor up to 32 levels).
 * The walk is bounded and stops at the filesystem root; no network, no git.
 */
export function readGoModuleInfo(projectRoot: string): GoModuleInfo | null {
  try {
    let dir = path.resolve(projectRoot)
    try {
      if (!statSync(dir).isDirectory()) dir = path.dirname(dir)
    } catch {
      return null
    }
    for (let depth = 0; depth < 32; depth++) {
      if (existsSync(path.join(dir, "go.mod"))) {
        const modulePath = readGoModulePath(dir)
        if (!modulePath) return null
        const rel = path.relative(dir, path.resolve(projectRoot))
        const moduleDir = rel === "" || rel === "." ? "" : rel.split(path.sep).join("/")
        return { modulePath, moduleRoot: dir, moduleDir }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  } catch {
    return null
  }
}

/**
 * Per-process cache. WHY: the indexer store phase and the analyzer context construction
 * both ask the same question per file; reading go.mod once per project is the difference
 * between one bounded read and N small reads on every index run. Keyed by the RESOLVED
 * project root string. Bounded (the cache is cleared when it grows past 64 projects) —
 * a CLI process indexes a handful of projects, never unbounded.
 */
const moduleInfoCache = new Map<string, GoModuleInfo | null>()
const MODULE_INFO_CACHE_MAX = 64

export function moduleInfoForProject(projectRoot: string | null | undefined): GoModuleInfo | null {
  if (!projectRoot) return null
  const key = path.resolve(projectRoot)
  if (moduleInfoCache.has(key)) return moduleInfoCache.get(key)!
  const info = readGoModuleInfo(key)
  if (moduleInfoCache.size >= MODULE_INFO_CACHE_MAX) moduleInfoCache.clear()
  moduleInfoCache.set(key, info)
  return info
}

/**
 * Go import identity — PURE. `modulePath` is the project's go.mod module path, or `null`
 * when it is unknown. Returns `true` = outside this project (stdlib or third-party),
 * `false` = the project's own package, `null` = undecidable at this information level (a
 * domain-shaped specifier when the module path is unknown: it may be this project itself).
 *
 * WHY A PURE FUNCTION. The bettercap dependency-graph defect (ISSUE-03) is that the Go
 * analyzer never DECLARED externality, so a shared JS-shaped fallback ("a bare specifier
 * is external") classified every Go import external — stdlib, third-party AND same-module —
 * and the file-dependency engine then never attempted internal resolution.
 */
export function goImportExternality(importPath: string, modulePath: string | null): boolean | null {
  const specifier = importPath.trim()
  if (specifier.length === 0) return null
  if (modulePath !== null && modulePath.length > 0) {
    if (specifier === modulePath) return false
    if (specifier.startsWith(modulePath + "/")) return false
  }
  const firstSegment = specifier.split("/")[0]
  // No dot in the first segment: Go's own package naming (stdlib has no domain; a
  // GOPATH-era import has no domain either) — outside the project.
  if (firstSegment.indexOf(".") === -1) return true
  // A domain-shaped specifier when the project's own module path is unknown: it may be
  // the project itself. Undecidable rather than guessed.
  return modulePath === null ? null : true
}

/**
 * Map a Go import specifier to the PROJECT-RELATIVE directory of the package it names, or
 * `null` when the specifier is not inside this project's module. `lib` for
 * `example.com/m/lib` in a project indexed at the module root; `x` for
 * `github.com/cli/cli/v2/internal/x` in a project indexed at the module's `internal/`.
 *
 * THE DIRECTORY IS THE PACKAGE. A Go import names a package, not a file, and a package is
 * every `.go` file in one directory — so callers resolve the directory to files themselves
 * (the dependency engine emits one edge per file in it).
 */
export function goPackageDirForSpecifier(
  importPath: string,
  info: { modulePath: string; moduleDir: string },
): string | null {
  const specifier = importPath.trim()
  if (info.modulePath.length === 0) return null
  if (specifier !== info.modulePath && !specifier.startsWith(info.modulePath + "/")) return null
  const rest = specifier === info.modulePath ? "" : specifier.slice(info.modulePath.length + 1)
  // The module-relative path must be mapped INTO the indexed project root: a project
  // indexed at the module's `internal/` directory sees `…/v2/internal/x` as `x`. An import
  // under the module but outside that root is a real package the index does not contain —
  // `null`, never a fabricated directory.
  if (info.moduleDir.length === 0) return rest
  if (rest === info.moduleDir) return ""
  if (rest.startsWith(info.moduleDir + "/")) return rest.slice(info.moduleDir.length + 1)
  return null
}
