// script/lib/editor-cli.ts — find an editor CLI, honestly, or say why not.
//
// WHY THIS EXISTS. Four gate scripts reached for `/usr/bin/code` by absolute path:
//
//   script/m25/verify-install-docs.ts   lines 71, 103, 110
//   script/m45/capture-driver.ts        lines 103, 132, 161, 197
//   script/m45/session-driver.ts        lines 223, 243, 271, 326
//
// On this machine that path does not exist, and the CLI does:
//
//   /usr/bin/code                                                  absent
//   /Applications/Visual Studio Code.app/Contents/Resources/app/bin/code   present, 1.140.0
//
// So `verify-install-docs.ts` reported `pre: \`code\` CLI present — FAIL` and
// `spawnSync /usr/bin/code ENOENT` on a machine that HAS VS Code installed. That
// is not an honest block, it is a gate that cannot find a program it needs — and
// the failure reads exactly like "VS Code is not installed", which is the
// opposite of the truth. The same defect makes the m45 drivers unusable here.
//
// The app-bundle location is the RELIABLE one on macOS; /usr/bin only exists when
// someone made a symlink. A gate hardcoding /usr/bin is therefore broken by
// default and correct only by accident on some setups.
//
// WHAT THIS DOES. Resolve in this order, and report every place it looked:
//   1. an explicit override (BB_EDITOR_CLI_<NAME>), so a run can be pinned
//   2. PATH, via `which`/`where`
//   3. the macOS app bundle, for every editor that ships one
//   4. the historical /usr/bin/<name>, last, because it is the least reliable
//
// It returns the resolved absolute path AND the list of candidates tried, so a
// gate that reports "blocked" can say which paths were checked. Silence about
// where it looked is how "not installed" and "I could not find it" got confused.

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

export interface EditorCliResolution {
  /** Absolute path to the executable, or null when it was not found. */
  path: string | null
  /** Every location checked, in order. Reported so a block names its reason. */
  tried: string[]
  /** Which strategy produced the answer, for the evidence record. */
  via: "override" | "path" | "app-bundle" | "usr-bin" | "not-found"
}

/** macOS app bundles that ship a CLI named `name` under Resources/app/bin. */
const APP_BUNDLES: Record<string, string[]> = {
  code: ["Visual Studio Code", "VSCodium", "Code"],
  cursor: ["Cursor"],
  windsurf: ["Windsurf"],
  zed: ["Zed"],
}

/** Where macOS keeps installed apps, plus the usual non-standard locations. */
function appRoots(): string[] {
  const home = process.env.HOME ?? ""
  return [
    "/Applications",
    path.join(home, "Applications"),
    "/Applications/Preview",
  ]
}

function whichAll(name: string): string[] {
  try {
    const probe = process.platform === "win32" ? "where" : "which"
    const out = execFileSync(probe, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Resolve an editor CLI. `name` is the executable name (`code`, `cursor`, …).
 *
 * The env override is `BB_EDITOR_CLI_<NAME>` upper-cased with non-alphanumerics
 * replaced by `_`, so `code` becomes `BB_EDITOR_CLI_CODE`.
 */
export function resolveEditorCli(name: string): EditorCliResolution {
  const tried: string[] = []

  // 1. explicit override — the way to pin a run to a known binary
  const envKey = `BB_EDITOR_CLI_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
  const override = process.env[envKey]
  if (override) {
    tried.push(`$${envKey}=${override}`)
    if (existsSync(override)) return { path: override, tried, via: "override" }
    tried.push(`  ^ that override does not exist`)
  }

  // 2. PATH
  for (const candidate of whichAll(name)) {
    tried.push(`PATH: ${candidate}`)
    if (existsSync(candidate)) return { path: candidate, tried, via: "path" }
  }

  // 3. macOS app bundle — the reliable location on macOS
  const bundles = APP_BUNDLES[name] ?? []
  if (process.platform === "darwin") {
    for (const root of appRoots()) {
      for (const bundle of bundles) {
        const candidate = path.join(root, `${bundle}.app`, "Contents", "Resources", "app", "bin", name)
        tried.push(`bundle: ${candidate}`)
        if (existsSync(candidate)) return { path: candidate, tried, via: "app-bundle" }
      }
    }
  }

  // 4. the historical location — last, because it only exists via a symlink
  const legacy = path.join("/usr/bin", name)
  tried.push(`legacy: ${legacy}`)
  if (existsSync(legacy)) return { path: legacy, tried, via: "usr-bin" }

  return { path: null, tried, via: "not-found" }
}

/** One line naming what was tried, for a blocked-leg's recorded reason. */
export function describeResolution(res: EditorCliResolution, name: string): string {
  if (res.path) return `${name} resolved via ${res.via}: ${res.path}`
  return `${name} not found — looked at: ${res.tried.join("; ")}`
}