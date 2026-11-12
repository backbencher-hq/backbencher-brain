// script/verify-dist-integrity.ts — the packaged build's chunk graph.
//
// A tsup build splits dynamic imports into hashed chunk files. A build that
// emits a chunk referencing another chunk it did not write (interrupted build,
// concurrent build, stale dist) produces a package that fails at RUNTIME with
// ERR_MODULE_NOT_FOUND in the middle of a phase — exactly the failure a user hit
// on a repo build that was rebuilt under a running process. The package itself
// must be self-consistent, so `prepack` runs this and refuses to pack otherwise.
//
// Run: npx tsx script/verify-dist-integrity.ts [distDir]

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

export interface DistIntegrityResult {
  distDir: string
  files: number
  references: number
  missing: Array<{ file: string; missing: string }>
}

/** Every relative `./<chunk>.js` reference must resolve inside the same dist dir. */
export function verifyDistDir(distDir: string): DistIntegrityResult {
  const result: DistIntegrityResult = { distDir, files: 0, references: 0, missing: [] }
  if (!existsSync(distDir)) {
    result.missing.push({ file: distDir, missing: "dist directory does not exist" })
    return result
  }
  const files = readdirSync(distDir).filter((name) => name.endsWith(".js"))
  result.files = files.length
  const present = new Set(files)
  const relativeModule = /["']\.\/([A-Za-z0-9_.-]+\.js)["']/g
  for (const file of files) {
    const source = readFileSync(path.join(distDir, file), "utf8")
    for (const match of source.matchAll(relativeModule)) {
      result.references++
      const target = match[1]
      if (!present.has(target)) result.missing.push({ file, missing: target })
    }
  }
  return result
}

function main(): void {
  const distDir = path.resolve(process.argv[2] ?? "dist")
  const result = verifyDistDir(distDir)
  const entry = path.join(distDir, "cli", "index.js")
  console.log(`dist integrity: ${result.files} JS chunk(s), ${result.references} relative reference(s) in ${result.distDir}`)
  if (!existsSync(entry)) {
    console.error(`  ✗ entry missing: ${entry}`)
    process.exit(1)
  }
  if (result.missing.length > 0) {
    console.error(`  ✗ ${result.missing.length} broken reference(s) — the packaged build cannot load every chunk:`)
    for (const row of result.missing.slice(0, 30)) console.error(`      ${row.file} -> ${row.missing}`)
    if (result.missing.length > 30) console.error(`      … ${result.missing.length - 30} more`)
    process.exit(1)
  }
  console.log("  ✓ every relative chunk reference resolves; entry exists")
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false
if (isMain) main()
