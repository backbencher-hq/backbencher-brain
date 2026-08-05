import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

/**
 * Get the directory containing the running binary.
 * On Windows with Bun, process.execPath returns Bun's own path (B:\~BUN\root\...)
 * so we check argv[0] and import.meta.dir first.
 */
export function getExecDir(): string {
  if (process.env.OPENCODE_EXEC_PATH) {
    return path.dirname(process.env.OPENCODE_EXEC_PATH)
  }
  // Use process.argv[0] first — this is the actual binary path
  const argv0 = process.argv?.[0]
  if (argv0 && fs.existsSync(argv0)) {
    return path.dirname(argv0)
  }
  // Fall back to import.meta.dir for ES modules
  try {
    const metaDir = path.dirname(fileURLToPath(import.meta.url))
    if (fs.existsSync(path.join(metaDir, "tree-sitter.wasm"))) {
      return metaDir
    }
  } catch {}
  // Last resort
  return path.dirname(process.execPath)
}
