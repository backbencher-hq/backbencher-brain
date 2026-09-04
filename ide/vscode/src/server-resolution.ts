// ide/vscode/src/server-resolution.ts — M25.E1 core (pure, headless-testable).
//
// The single owner of two E1 decisions:
//   1. Server launch resolution order — how the extension finds and launches
//      bb_lsp. Declared order (contract honesty: the order is documented, not
//      discovered at runtime):
//        a. explicit `bbLsp.serverPath` setting (owner override)
//        b. the workspace's own backbencher-brain checkout:
//           <workspace>/dist/lsp/server.js (compiled dist preferred)
//        c. the bundled copy shipped inside the VSIX:
//           <extension>/dist/server/lsp/server.js
//        d. source fallback via bun: <workspace>/src/lsp/server.ts, launched
//           with `bun run` — declared fallback only; recorded as such in the
//           status surface (never silently presented as the dist path).
//   2. Version-compatibility matrix — server version (from the LSP
//      `initialize` response serverInfo.version) must satisfy the declared
//      minimum. A mismatch is a visible error with the fix in the message,
//      never silent feature absence (issue #499).
//
// No `vscode` imports here: everything is pure and unit-testable headless.
// The extension layer (extension.ts) adapts this to the VS Code API.

import { existsSync } from "node:fs"
import path from "node:path"

export type SourceMode = "dist" | "source-bun" | "auto"

export type ServerLaunch = {
  /** How the server was resolved. Reported honestly to the user. */
  kind: "dist-workspace" | "dist-bundled" | "explicit" | "source-bun"
  /** Filesystem path to the server entry (js for dist, ts for source). */
  entryPath: string
  /** Launcher: node for compiled dist, bun for the declared source fallback. */
  runtime: "node" | "bun"
  /** argv prefix before the entry path. */
  runtimeArgs: string[]
  /** True when the resolved path is NOT the preferred compiled dist. */
  isFallback: boolean
}

export type ResolutionInput = {
  workspaceRoot: string
  extensionRoot: string
  mode: SourceMode
  explicitServerPath?: string
  fileExists?: (p: string) => boolean
}

const DEFAULT_FILE_EXISTS = (p: string): boolean => existsSync(p)

/** Resolve the server launch per the declared order. Never throws: an empty
 *  candidates list means "nothing resolvable" and the caller surfaces a
 *  visible error with remediation text. */
export function resolveServerLaunch(input: ResolutionInput): ServerLaunch | { error: string } {
  const fileExists = input.fileExists ?? DEFAULT_FILE_EXISTS

  // a. explicit owner override — validated, never invented.
  if (input.explicitServerPath !== undefined && input.explicitServerPath !== "") {
    const abs = path.isAbsolute(input.explicitServerPath)
      ? input.explicitServerPath
      : path.join(input.workspaceRoot, input.explicitServerPath)
    if (!fileExists(abs)) {
      return { error: `bbLsp.serverPath is set but the file does not exist: ${abs}` }
    }
    const isTs = abs.endsWith(".ts")
    return {
      kind: "explicit",
      entryPath: abs,
      runtime: isTs ? "bun" : "node",
      runtimeArgs: isTs ? ["run"] : [],
      isFallback: isTs,
    }
  }

  // b. workspace's own backbencher-brain checkout (dist preferred).
  const workspaceDist = path.join(input.workspaceRoot, "dist", "lsp", "server.js")
  if (input.mode !== "source-bun" && fileExists(workspaceDist)) {
    return { kind: "dist-workspace", entryPath: workspaceDist, runtime: "node", runtimeArgs: [], isFallback: false }
  }

  // c. bundled copy inside the VSIX.
  const bundled = path.join(input.extensionRoot, "dist", "server", "lsp", "server.js")
  if (input.mode !== "source-bun" && fileExists(bundled)) {
    return { kind: "dist-bundled", entryPath: bundled, runtime: "node", runtimeArgs: [], isFallback: false }
  }

  // d. source fallback via bun (declared fallback, never presented as dist).
  const workspaceSource = path.join(input.workspaceRoot, "src", "lsp", "server.ts")
  if (fileExists(workspaceSource)) {
    return { kind: "source-bun", entryPath: workspaceSource, runtime: "bun", runtimeArgs: ["run"], isFallback: true }
  }

  return {
    error:
      "bb_lsp server not found. Looked for: <workspace>/dist/lsp/server.js, the bundled copy, and <workspace>/src/lsp/server.ts (bun). Install backbencher-brain in the workspace or set bbLsp.serverPath.",
  }
}

// --- Version-compatibility matrix ----------------------------------------

/** Compare two semver-ish version strings ("0.3.0"). Returns true when
 *  `actual` satisfies `minimum`. Pre-release/extra segments are ignored for
 *  the comparison; unparsable versions never satisfy the minimum (fail
 *  closed) — a server that does not declare its version is not trusted. */
export function serverVersionSatisfiesMinimum(actual: string | undefined, minimum: string): boolean {
  if (actual === undefined || actual === "") return false
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = parse(actual)
  const min = parse(minimum)
  if (a === null || min === null) return false
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0
    const mv = min[i] ?? 0
    if (av !== mv) return av > mv
  }
  return true
}

/** The version decision the extension acts on, with the honest user-facing
 *  message baked here (single owner of the wording). */
export function versionDecision(
  actual: string | undefined,
  minimum: string,
): { ok: true } | { ok: false; message: string } {
  if (serverVersionSatisfiesMinimum(actual, minimum)) return { ok: true }
  const seen = actual === undefined || actual === "" ? "(server did not report a version)" : actual
  return {
    ok: false,
    message: `bb_lsp server version ${seen} does not satisfy the minimum ${minimum}. Update the backbencher-brain checkout (or lower bbLsp.minServerVersion if you know what you are doing). Features stay off rather than mislead you.`,
  }
}
