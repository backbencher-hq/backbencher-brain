import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** One `paths` entry, resolved against `baseUrl` into root-relative prefixes. */
export interface PathAliasRule {
  /** The pattern as written, e.g. `@/*`. */
  pattern: string
  /**
   * Root-relative replacement templates, e.g. `["src/*"]`, parallel to TypeScript's
   * fallback order (the FIRST target that exists on disk wins).
   */
  targets: string[]
}

/** Normalise a join of `baseUrl` and a tsconfig target to a root-relative prefix. */
function normaliseTarget(baseUrl: string, target: string): string {
  const joined = target.startsWith("/")
    ? target.slice(1)
    : [baseUrl, target].filter((p) => p && p !== ".").join("/")
  // Collapse `./`, `a//b`, and a leading `./`.
  const parts: string[] = []
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") { parts.pop(); continue }
    parts.push(seg)
  }
  return parts.join("/")
}

/**
 * Parse `compilerOptions.paths` out of a parsed tsconfig/jsconfig object.
 *
 * Returns [] for a config without paths, a malformed config, or anything else —
 * absence of aliases must be silent, because most projects have none.
 */
export function parseTsconfigPathAliases(config: unknown): PathAliasRule[] {
  if (!config || typeof config !== "object") return []
  const compilerOptions = (config as any).compilerOptions
  if (!compilerOptions || typeof compilerOptions !== "object") return []
  const rawBaseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : "."
  const paths = compilerOptions.paths
  if (!paths || typeof paths !== "object") return []

  const rules: PathAliasRule[] = []
  for (const [pattern, value] of Object.entries(paths)) {
    if (typeof pattern !== "string" || !pattern) continue
    const targets = (Array.isArray(value) ? value : [value])
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .map((t) => normaliseTarget(rawBaseUrl, t))
      .filter((t) => t.length > 0)
    if (targets.length === 0) continue
    rules.push({ pattern, targets })
  }
  // TypeScript prefers the LONGEST matching prefix, so match in that order.
  rules.sort((a, b) => b.pattern.length - a.pattern.length)
  return rules
}

/**
 * Map a bare specifier through the alias rules to a root-relative path, or null.
 *
 * TypeScript semantics, as far as they matter here:
 *  · a pattern with exactly one `*` matches that prefix and captures the middle;
 *  · a pattern with no `*` is an exact match (and captures nothing);
 *  · the longest matching pattern wins;
 *  · the first target wins; the caller may fall back if that file does not exist.
 *
 * A capture never escapes the project: the caller applies this to specifiers that are
 * already known to be internal, and a `..` in a target is collapsed by normaliseTarget.
 */
export function applyPathAlias(
  specifier: string,
  rules: readonly PathAliasRule[],
): { resolved: string; rule: PathAliasRule } | null {
  if (!specifier || rules.length === 0) return null
  for (const rule of rules) {
    const star = rule.pattern.indexOf("*")
    if (star < 0) {
      if (specifier !== rule.pattern) continue
      const resolved = rule.targets[0]
      return resolved ? { resolved, rule } : null
    }
    // Exactly one `*`, which is what TypeScript accepts.
    if (rule.pattern.indexOf("*", star + 1) >= 0) continue
    const prefix = rule.pattern.slice(0, star)
    const suffix = rule.pattern.slice(star + 1)
    if (specifier.length < prefix.length + suffix.length) continue
    if (!specifier.startsWith(prefix)) continue
    if (suffix && !specifier.endsWith(suffix)) continue
    const captured = specifier.slice(prefix.length, suffix ? specifier.length - suffix.length : undefined)
    const template = rule.targets[0]
    if (!template) continue
    const resolved = template.replace("*", captured)
    if (!resolved) continue
    return { resolved, rule }
  }
  return null
}

/** Every candidate replacement for a specifier, in target order (fallbacks included). */
export function applyPathAliasCandidates(
  specifier: string,
  rules: readonly PathAliasRule[],
): string[] {
  const first = applyPathAlias(specifier, rules)
  if (!first) return []
  const star = first.rule.pattern.indexOf("*")
  if (star < 0) return [...first.rule.targets]
  const prefix = first.rule.pattern.slice(0, star)
  const suffix = first.rule.pattern.slice(star + 1)
  const captured = specifier.slice(prefix.length, suffix ? specifier.length - suffix.length : undefined)
  return first.rule.targets.map((t) => t.replace("*", captured)).filter(Boolean)
}

/**
 * Read `compilerOptions.paths` from a project's tsconfig.json / jsconfig.json.
 *
 * TypeScript resolves `tsconfig.json` by walking UP from the importing file, and the
 * common shapes in the wild are: a root `tsconfig.json`, a root `tsconfig.json` with
 * `extends`, and `jsconfig.json` for plain-JavaScript projects. This reads the root
 * file of each (in that order) and ignores `extends` — a project that inherits its
 * `paths` from a shared config still has most of them at the root, and inventing an
 * extends-chain resolver would claim coverage this does not have.
 *
 * Disk I/O, bounded: at most two small files, once per index run. A malformed or
 * absent config returns [] — most projects have no aliases, and that is not an error.
 */
export function loadProjectPathAliases(
  projectPath: string,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
  exists: (p: string) => boolean = (p) => existsSync(p),
): PathAliasRule[] {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const file = join(projectPath, name)
    try {
      if (!exists(file)) continue
      const parsed = JSON.parse(readFile(file))
      const rules = parseTsconfigPathAliases(parsed)
      if (rules.length > 0) return rules
    } catch {
      // A tsconfig with comments (TypeScript allows them) is not valid JSON, and an
      // index run must not fail on it. Returning [] means aliases are not resolved —
      // the pre-existing behaviour, which the unresolved-specifier count still declares.
    }
  }
  return []
}
