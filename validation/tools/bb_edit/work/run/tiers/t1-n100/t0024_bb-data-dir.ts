// Resolvable data-directory for bb. Indexes live at
// <dir>/projects/<sha1-of-project>/brain.db and the WASM cache at <dir>/wasm.
//
// Default: ~/.bb. Override with BB_DATA_DIR — use a workspace-local or
// otherwise reliably-persisted path when the home dir isn't writable/shared
// (sandboxes, CI, VS Code extension hosts that hide ~/.bb across processes).
import { homedir } from "os"
import path from "path"

export function bbDataDir(): string {
  return process.env.BB_DATA_DIR ? path.resolve(process.env.BB_DATA_DIR) : path.join(homedir(), ".bb")
}

export function bbProjectsDir(): string {
  return path.join(bbDataDir(), "projects")
}

export function bbWasmDir(): string {
  return path.join(bbDataDir(), "wasm")
}

/**
 * Candidate locations for a WASM asset, most-specific first. The repo ships
 * grammars in <root>/wasm/; the module can sit at src/ast (source, two levels
 * down) or dist/chunk-*.js (compiled, one level down), and the data-dir cache
 * is the canonical fallback for installed binaries.
 */
export function bbWasmCandidates(moduleDir: string, name: string): string[] {
  const n = name.split("/").pop() || name
  return [
    path.join(moduleDir, "..", "..", "wasm", n), // source layout (src/ast, src/util)
    path.join(moduleDir, "..", "wasm", n), // compiled flat layout (dist/)
    path.join(bbWasmDir(), n), // data-dir cache (~/.bb/wasm or BB_DATA_DIR/wasm)
    path.join(process.cwd(), "wasm", n), // repo root when running from the repo
  ]
}

/** Candidate WASM directories to scan for assets, most-specific first. */
export function bbWasmDirs(moduleDir: string): string[] {
  return [
    path.join(moduleDir, "..", "..", "wasm"),
    path.join(moduleDir, "..", "wasm"),
    bbWasmDir(),
    path.join(process.cwd(), "wasm"),
  ]
}
