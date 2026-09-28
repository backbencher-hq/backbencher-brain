// script/m20/create-corpus-snapshots.ts — M20.C2 setup utility.
//
// Creates immutable archive snapshots for the repositories listed in
// validation/m20/corpus-snapshots.json. It never resets, cleans, checks out, or
// writes to a source repository. Existing destinations are refused. Run this
// only when the source revisions are already available locally or network
// access is explicitly intended.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

type Snapshot = { source: string; revision: string }
type SnapshotManifest = { root: string; repositories: Record<string, Snapshot> }

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const manifestPath = path.join(ROOT, "validation/m20/corpus-snapshots.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest

function run(source: string, args: string[]): string {
  return execFileSync("git", ["-C", source, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim()
}

const root = manifest.root
mkdirSync(root, { recursive: true })
for (const [id, declaration] of Object.entries(manifest.repositories)) {
  const destination = path.join(root, id)
  if (existsSync(destination)) throw new Error(`Refusing to overwrite existing snapshot: ${destination}`)
  run(declaration.source, ["cat-file", "-e", `${declaration.revision}^{commit}`])
  mkdirSync(destination)
  const archive = execFileSync("git", ["-C", declaration.source, "archive", "--format=tar", declaration.revision], { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 })
  execFileSync("tar", ["-xf", "-", "-C", destination], { cwd: ROOT, input: archive, stdio: ["pipe", "ignore", "pipe"] })
  const trackedFiles = Number(run(declaration.source, ["ls-tree", "-r", "--name-only", declaration.revision]).split("\n").filter(Boolean).length)
  const archiveSha256 = createHash("sha256").update(archive).digest("hex")
  const treeHash = run(declaration.source, ["rev-parse", `${declaration.revision}^{tree}`])
  writeFileSync(path.join(destination, ".m20-snapshot.json"), JSON.stringify({ id, source: declaration.source, revision: declaration.revision, archiveFormat: "git-archive", trackedFiles, archiveSha256, treeHash }, null, 2) + "\n")
  console.log(`created ${id}: ${trackedFiles} tracked files (${archiveSha256.slice(0, 12)})`)
}
