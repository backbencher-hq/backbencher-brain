/**
 * script/m14/tmp/wasm-provenance-census.ts
 *
 * Where did every wasm in `wasm/` come from? For each file, compare its sha256
 * against every other copy on this machine that is plausibly an upstream
 * distribution point:
 *
 *   - `~/.bb/wasm` (the data-dir mirror),
 *   - `node_modules` (repo-installed packages),
 *   - every `tree-sitter-*` package in the bun install cache (npm tarballs),
 *   - the `tree-sitter-wasms` prebuilt collection (`out/*.wasm`),
 *   - `~/.bun/install/cache/**` wasm files generally (bounded to 3 levels).
 *
 * Byte identity is the only verdict it asserts. Everything else is "no local
 * copy" — which is the honest answer when the network is unavailable: for those
 * the pin has to be a sha256 + surface fingerprint + a disclosed note.
 *
 * Writes: validation/m14/results/archive/wasm-provenance-census.json
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const HOME = process.env.HOME ?? ""
const OUT = path.join(ROOT, "validation/m14/results/archive/wasm-provenance-census.json")
const sha = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex")

function walk(dir: string, depth: number, out: string[]): string[] {
  if (depth < 0 || !fs.existsSync(dir)) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" && !abs.startsWith(path.join(ROOT, "node_modules"))) continue
      walk(abs, depth - 1, out)
    } else if (e.isFile() && e.name.endsWith(".wasm")) out.push(abs)
  }
  return out
}

async function main() {
  const roots: Array<{ label: string; dir: string; depth: number }> = [
    { label: "mirror", dir: path.join(HOME, ".bb/wasm"), depth: 1 },
    { label: "repo-node_modules", dir: path.join(ROOT, "node_modules"), depth: 4 },
    { label: "bun-cache-cli", dir: path.join(HOME, ".bun/install/cache"), depth: 3 },
  ]
  const index = new Map<string, Array<{ label: string; path: string }>>()
  let scanned = 0
  for (const r of roots) {
    for (const abs of walk(r.dir, r.depth, [])) {
      let buf: Buffer
      try {
        buf = fs.readFileSync(abs)
      } catch {
        continue
      }
      scanned++
      const h = sha(buf)
      const arr = index.get(h) ?? []
      arr.push({ label: r.label, path: abs })
      index.set(h, arr)
    }
  }

  const repoWasmDir = path.join(ROOT, "wasm")
  const files: any[] = []
  for (const name of fs.readdirSync(repoWasmDir).sort()) {
    if (!name.endsWith(".wasm")) continue
    const abs = path.join(repoWasmDir, name)
    const buf = fs.readFileSync(abs)
    const h = sha(buf)
    const matches = index.get(h) ?? []
    files.push({
      wasm: name,
      sha256: h,
      bytes: buf.length,
      byteIdenticalCopies: matches.map((m) => ({ source: m.label, path: m.path.replace(HOME, "~") })),
      verdict:
        matches.length === 0
          ? "no local copy of these bytes — provenance cannot be re-derived offline"
          : `byte-identical to ${matches.length} local copy/copies (${[...new Set(matches.map((m) => m.label))].join(", ")})`,
    })
  }

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    method:
      "sha256 of every wasm/ file compared against every .wasm found under the roots below (bounded depth). Byte identity is the only claim; absence means the bytes exist in no local distribution copy, not that they are unprovenanced.",
    rootsScanned: roots.map((r) => ({ source: r.label, dir: r.dir.replace(HOME, "~"), maxDepth: r.depth })),
    wasmFilesScannedInRoots: scanned,
    files,
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  for (const f of files) console.log(`${f.wasm.padEnd(34)} ${f.verdict}`)
  console.log(`\nwrote ${path.relative(ROOT, OUT)} (${files.length} repo wasms, ${scanned} candidate copies scanned)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
