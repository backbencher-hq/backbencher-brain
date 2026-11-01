/**
 * Project identity: a stable id for a project directory.
 *
 * This lives here, apart from `src/cli/index.ts`, because of a real circular
 * import that only showed up on the SOURCE entry:
 *
 *   src/cli/index.ts  --(dynamic import, to start the server)-->  src/mcp/server.ts
 *   src/mcp/server.ts --(static import, for getProjectId)------->  src/cli/index.ts
 *
 * Under the built binary (`bin/bb` -> `dist/`) esbuild inlines the graph, the
 * cycle never materialises, and `bb mcp` answers an `initialize` handshake
 * correctly. Under `node node_modules/tsx/dist/cli.mjs src/cli/index.ts mcp` the
 * cycle is real: the dynamic import waits on a module graph that includes the
 * module currently holding a pending top-level `await runCli(...)`, and the
 * handshake never gets a response. Measured — the built entry answers with one
 * JSON-RPC frame even when stdin closes immediately; the source entry answers
 * with nothing even when stdin is held open.
 *
 * Moving the function to a leaf module removes the back-edge entirely. It has no
 * dependency on the CLI: path, realpath, hash, and the data dir are all it uses.
 *
 * `src/cli/index.ts` re-exports it, so every existing import site keeps working.
 */
import { createHash } from "crypto"
import { existsSync, mkdirSync, realpathSync, renameSync } from "fs"
import path from "path"
import { bbProjectsDir } from "./bb-data-dir"

export function getProjectId(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  let canonical = resolved
  try {
    canonical = realpathSync.native(resolved)
  } catch {
    // Nonexistent paths retain deterministic lexical identity for validation.
  }
  const canonicalId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  if (canonical !== resolved) {
    const legacyId = createHash("sha1").update(resolved).digest("hex").substring(0, 40)
    const legacyDir = path.join(bbProjectsDir(), legacyId)
    const canonicalDir = path.join(bbProjectsDir(), canonicalId)
    if (existsSync(legacyDir) && !existsSync(canonicalDir)) {
      mkdirSync(bbProjectsDir(), { recursive: true })
      try { renameSync(legacyDir, canonicalDir) } catch {}
    }
  }
  return canonicalId
}
