/**
 * script/m14/grammar-remedy.ts
 *
 * THE GRAMMAR REMEDY LADDER — the shared instrument for the owner's ruling-last-resort doctrine
 * (L-2026-10-21-14, and the shared brief's §1a).
 *
 * WHY THIS EXISTS. The owner's rule: the grammars can be CLONED, FIXED, worked on and tested, so we
 * achieve ALL the relationship types; a lane owns the grammar for its language the way it owns the
 * analyzer; where a type is not achievable as things stand, GET THE GRAMMAR, FIX IT, and get
 * all-out-of-all INSTEAD OF RULING — ruling only when there is actually no other way whatsoever. AND
 * VERIFICATION IS THE KEY. So `grammar-absence` is no longer a terminal class: it is a REMEDY
 * DISPOSITION, and the ladder is:
 *
 *   R1  bump the npm grammar package to a build whose inventory HAS the construct
 *   R2  clone + PATCH the grammar source, `tree-sitter generate`, `tree-sitter build --wasm`
 *   R3  implement the construct with an EXISTING node type (no grammar change at all)
 *
 * A remedy is proven by MEASUREMENT, never by a node list: the new build against the old one, and a
 * behavioural fixture whose edge exists only when the construct reaches the analyzer as a real node.
 *
 * WHAT THIS INSTRUMENT IS, AND IS NOT. It is the LEAD's shared instrument — the lane owns the
 * GRAMMAR SOURCE and the PATCH; this owns the LADDER, so that eight lanes do not each invent a
 * different way to get a grammar and a different way to prove what it changed. It MEASURES; it never
 * edits a lane's analyzer and never decides a ruling.
 *
 * THE IDENTITY THAT SURVIVES A REBUILD is the id-ORDER digest (`measureSurface`'s `idOrderDigest`):
 * two builds of the SAME SOURCE agree on it even when their BYTES differ, because it is a
 * `tree-sitter generate` fingerprint. That is the difference between "the wired bytes are a build of
 * this source" (provable) and "the wired bytes look like it" (not a claim at all). The perl lane's
 * pin record is the worked example of that proof, and the cpp lane's vendored fork — three added
 * named node types, and two fixtures that do not parse without them — is the worked example of a
 * LOAD-BEARING patch.
 *
 * THE SURFACE IS NOT REIMPLEMENTED HERE. `measureSurface` is imported from
 * `script/m14/verify-grammar-pins.ts` — the pin instrument that already made "which build is it?" a
 * measured record. This file adds the REMEDY verbs, and the DELTA between two builds.
 *
 * Usage:
 *   npx tsx script/m14/grammar-remedy.ts surface --wasm <path>
 *   npx tsx script/m14/grammar-remedy.ts delta   --from <a.wasm> --to <b.wasm>
 *   npx tsx script/m14/grammar-remedy.ts fetch   --lang <x> [--pkg <npm-name>] [--out <dir>]
 *   npx tsx script/m14/grammar-remedy.ts generate --dir <dir> [--wired <wasm>]
 *   npx tsx script/m14/grammar-remedy.ts build   --dir <dir> --out <path.wasm>
 *   npx tsx script/m14/grammar-remedy.ts prove   --dir <dir> --wired <wasm> [--out <path.wasm>]
 *
 * NO REGEX. Everything is a JSON read, a Set operation and a substring test.
 */
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, dirname, basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { measureSurface } from "./verify-grammar-pins"

const HERE: string = (import.meta as any).dir ?? dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
function flag(flagName: string): boolean {
  return process.argv.indexOf(flagName) >= 0
}
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
const sha256Text = (s: string) => createHash("sha256").update(s).digest("hex")

/** The grammar package name for a language, when it is not the obvious one. */
const PKG_ALIAS: Record<string, string> = {
  csharp: "tree-sitter-c-sharp",
  objc: "tree-sitter-objc",
  proto: "tree-sitter-proto",
  vbnet: "tree-sitter-vbnet",
  vb: "tree-sitter-vbnet",
  scss: "tree-sitter-scss",
  make: "tree-sitter-make",
  "objective-c": "tree-sitter-objc",
}

/** R1's step: the npm package that carries the grammar SOURCE (grammar.js). */
function packageNameFor(lang: string): string {
  return PKG_ALIAS[lang] ?? `tree-sitter-${lang}`
}

async function surfaceOf(wasmPath: string) {
  const abs = resolve(ROOT, wasmPath)
  if (!existsSync(abs)) {
    console.error(`NO SUCH WASM: ${wasmPath}`)
    process.exit(2)
  }
  return await measureSurface(abs)
}

function printSurface(label: string, s: Awaited<ReturnType<typeof measureSurface>>, wasmPath?: string) {
  const { surface, namedUnique } = s
  if (wasmPath) {
    const abs = resolve(ROOT, wasmPath)
    console.log(`   bytes            ${statSync(abs).size}`)
    console.log(`   wasm sha256      ${sha256(readFileSync(abs))}`)
  }
  console.log(`\n== ${label} ==`)
  console.log(`   named types      ${namedUnique.length}`)
  console.log(`   ids              ${surface.ids}`)
  console.log(`   namedIds         ${surface.namedIds}`)
  console.log(`   namedUnique      ${surface.namedUnique}`)
  console.log(`   anonIds          ${surface.anonIds}`)
  console.log(`   anonUnique       ${surface.anonUnique}`)
  console.log(`   fieldCount       ${surface.fieldCount}`)
  console.log(`   idOrderDigest    ${surface.idOrderDigest}`)
  console.log(`   typeSetDigest    ${surface.typeSetDigest}`)
  console.log(`   fieldSetDigest   ${surface.fieldSetDigest}`)
  console.log(`   named types      ${namedUnique.length}`)
}

/** The DELTA between two builds' named vocabularies: what the change ADDED and what it REMOVED. */
function namedDelta(fromNamed: string[], toNamed: string[]) {
  const from = new Set(fromNamed)
  const to = new Set(toNamed)
  const added = toNamed.filter((n) => !from.has(n))
  const removed = fromNamed.filter((n) => !to.has(n))
  return { added, removed }
}

async function cmdSurface() {
  const wasm = argOf("--wasm")
  if (!wasm) {
    console.error("surface needs --wasm <path>")
    process.exit(2)
  }
  const s = await surfaceOf(wasm)
  printSurface(wasm, s, wasm)
  if (flag("--names")) console.log(s.namedUnique.join("\n"))
}

async function cmdDelta() {
  const a = argOf("--from")
  const b = argOf("--to")
  if (!a || !b) {
    console.error("delta needs --from <a.wasm> --to <b.wasm>")
    process.exit(2)
  }
  const sa = await surfaceOf(a)
  const sb = await surfaceOf(b)
  printSurface(`FROM  ${a}`, sa, a)
  printSurface(`TO    ${b}`, sb, b)
  const d = namedDelta(sa.namedUnique, sb.namedUnique)
  console.log(`\n== THE NAMED-TYPE DELTA (the vocabulary the change actually moved) ==`)
  console.log(`   added   (${d.added.length}): ${d.added.join(", ") || "(none)"}`)
  console.log(`   removed (${d.removed.length}): ${d.removed.join(", ") || "(none)"}`)
  console.log(
    `   IDENTITY: ${sa.surface.idOrderDigest === sb.surface.idOrderDigest ? "SAME SOURCE (the id-order digest matches)" : "DIFFERENT SOURCE (the id-order digests differ)"}`,
  )
  console.log(
    `   TYPE SET: ${sa.surface.typeSetDigest === sb.surface.typeSetDigest ? "identical vocabulary" : "vocabulary changed"}`,
  )
}

/**
 * R2's first step: obtain the grammar SOURCE. The npm registry is the route that is available
 * offline of github — the published package carries `grammar.js` and `src/grammar.json` — and the
 * tarball is recorded with its sha256 and the upstream repository it names.
 */
function cmdFetch() {
  const lang = argOf("--lang")
  if (!lang) {
    console.error("fetch needs --lang <x>")
    process.exit(2)
  }
  const pkg = argOf("--pkg") ?? packageNameFor(lang)
  const out = resolve(ROOT, argOf("--out") ?? join("grammars", `tree-sitter-${lang}`))
  const tmp = resolve(ROOT, ".tmp-census", `fetch-${lang}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  console.log(`fetch: npm pack ${pkg}`)
  const outp = execFileSync("npm", ["pack", pkg, "--pack-destination", tmp], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const tgz = outp.split("\n").filter((l) => l.trim().endsWith(".tgz")).pop()
  if (!tgz) {
    console.error(`fetch: npm pack produced no tarball for ${pkg}`)
    process.exit(3)
  }
  const tgzPath = join(tmp, basename(tgz))
  const tarballSha = sha256(readFileSync(tgzPath))
  execFileSync("tar", ["xzf", tgzPath, "-C", tmp])
  const pkgDir = join(tmp, "package")
  const want = ["grammar.js", "src/grammar.json", "src/node-types.json", "tree-sitter.json", "package.json", "LICENSE", "src/parser.c", "src/scanner.c"]
  mkdirSync(out, { recursive: true })
  const copied: string[] = []
  for (const rel of want) {
    const src = join(pkgDir, rel)
    if (!existsSync(src)) continue
    const dst = join(out, rel)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    copied.push(rel)
  }
  let upstream = "unknown"
  let version = "unknown"
  try {
    const pj = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
    version = pj.version ?? "unknown"
    const repo = pj.repository
    upstream = typeof repo === "string" ? repo : (repo?.url ?? pj.homepage ?? "unknown")
  } catch {
    /* the tarball's package.json is the only source of the version; a missing one is reported below */
  }
  const prov = [
    `# GRAMMAR PROVENANCE — ${lang}`,
    "",
    `package        ${pkg}`,
    `version        ${version}`,
    `tarball sha256 ${tarballSha}`,
    `upstream       ${upstream}`,
    `route          npm pack (the published package carries grammar.js and src/grammar.json)`,
    `files copied   ${copied.join(", ") || "(none)"}`,
    "",
    "**The tarball's sha256 and the upstream it names are the record: a patch made to this tree is a patch",
    "to a NAMED source, and the id-order digest of the build that source produces is what proves it.**",
    "",
  ].join("\n")
  writeFileSync(join(out, "PROVENANCE.md"), prov)
  console.log(`fetch: ${pkg}@${version} -> ${out}`)
  console.log(`        tarball sha256 ${tarballSha}`)
  console.log(`        upstream       ${upstream}`)
  console.log(`        files          ${copied.join(", ")}`)
  console.log(`        provenance     ${join(out, "PROVENANCE.md")}`)
}

/** R2's second step: `tree-sitter generate` — the source becomes a parser, and the parser's vocabulary is measured. */
async function cmdGenerate() {
  const dir = resolve(ROOT, argOf("--dir") ?? "")
  if (!argOf("--dir") || !existsSync(dir)) {
    console.error("generate needs --dir <grammar source dir>")
    process.exit(2)
  }
  console.log(`generate: tree-sitter generate in ${dir}`)
  execFileSync("tree-sitter", ["generate"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
  const nt = join(dir, "src", "node-types.json")
  if (!existsSync(nt)) {
    console.error("generate: src/node-types.json was not produced")
    process.exit(3)
  }
  const parsed = JSON.parse(readFileSync(nt, "utf8"))
  const named = (parsed as any[]).filter((t) => t.named === true)
  console.log(`generate: src/node-types.json — ${named.length} named types declared`)
  const wired = argOf("--wired")
  if (wired && existsSync(resolve(ROOT, wired))) {
    const s = await surfaceOf(wired)
    const wireNamed = new Set(s.namedUnique)
    const added = named.map((t: any) => t.type).filter((t: string) => !wireNamed.has(t))
    console.log(`generate: against the wired build ${wired} — ${added.length} named types the WIRED build does not have:`)
    console.log(`          ${added.join(", ") || "(none)"}`)
    console.log(`          (the wired build's namedUnique is ${s.surface.namedUnique}; the generated source declares ${named.length})`)
  }
}

/** R2's third step: the wasm. `tree-sitter build --wasm` is the toolchain, and it works here. */
function cmdBuild() {
  const dir = resolve(ROOT, argOf("--dir") ?? "")
  const out = resolve(ROOT, argOf("--out") ?? "")
  if (!argOf("--dir") || !argOf("--out") || !existsSync(dir)) {
    console.error("build needs --dir <grammar source dir> --out <path.wasm>")
    process.exit(2)
  }
  mkdirSync(dirname(out), { recursive: true })
  console.log(`build: tree-sitter build --wasm in ${dir} -> ${out}`)
  execFileSync("tree-sitter", ["build", "--wasm", "-o", out], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
  const bytes = statSync(out).size
  console.log(`build: ${out} — ${bytes} bytes, sha256 ${sha256(readFileSync(out))}`)
}

/**
 * THE PROOF — the perl lane's shape, and it is the whole point of the doctrine.
 *
 * Build from the source, then compare the three digests with the WIRED build. If the id-order digest
 * matches, the wired bytes ARE a build of this source (the registry's own rule: two builds of one
 * source agree even when their bytes differ), and the patch is PROVEN to be in it. If the digests
 * differ, the wired build is not this source, and the difference is reported with the vocabulary it
 * moved — which is the measurement a ruling needs.
 */
async function cmdProve() {
  const dir = resolve(ROOT, argOf("--dir") ?? "")
  const wired = argOf("--wired")
  if (!argOf("--dir") || !wired) {
    console.error("prove needs --dir <grammar source dir> --wired <wired.wasm>")
    process.exit(2)
  }
  const tmpOut = resolve(ROOT, ".tmp-census", `prove-${basename(dir)}.wasm`)
  mkdirSync(dirname(tmpOut), { recursive: true })
  console.log(`prove: build from source in ${dir}`)
  execFileSync("tree-sitter", ["generate"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
  execFileSync("tree-sitter", ["build", "--wasm", "-o", tmpOut], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
  const built = await measureSurface(tmpOut)
  const wiredS = await surfaceOf(wired)
  const d = namedDelta(wiredS.namedUnique, built.namedUnique)
  console.log(`\n== THE PROOF ==`)
  console.log(`   wired   ${wired}`)
  console.log(`     idOrderDigest  ${wiredS.surface.idOrderDigest}`)
  console.log(`     typeSetDigest  ${wiredS.surface.typeSetDigest}`)
  console.log(`     fieldSetDigest ${wiredS.surface.fieldSetDigest}`)
  console.log(`   built   from ${dir}`)
  console.log(`     idOrderDigest  ${built.surface.idOrderDigest}`)
  console.log(`     typeSetDigest  ${built.surface.typeSetDigest}`)
  console.log(`     fieldSetDigest ${built.surface.fieldSetDigest}`)
  const sameSource = built.surface.idOrderDigest === wiredS.surface.idOrderDigest
  console.log(`\n   IDENTITY: ${sameSource ? "SAME SOURCE — the wired bytes ARE a build of this source" : "DIFFERENT SOURCE — the wired build is NOT this source"}`)
  console.log(`   VOCABULARY THE CHANGE MOVES: added ${d.added.length}, removed ${d.removed.length}`)
  if (d.added.length) console.log(`     added:   ${d.added.join(", ")}`)
  if (d.removed.length) console.log(`     removed: ${d.removed.join(", ")}`)
  const verdict = sameSource
    ? "PROVEN: the wired build and this source are the same grammar."
    : "NOT PROVEN: the wired build is a different grammar — the vocabulary delta above is what differs."
  console.log(`\n   VERDICT: ${verdict}`)
  console.log(`   NOTE: the id-order digest is the identity that SURVIVES a rebuild; the bytes do not have to match.`)
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === "surface") return await cmdSurface()
  if (cmd === "delta") return await cmdDelta()
  if (cmd === "fetch") return cmdFetch()
  if (cmd === "generate") return await cmdGenerate()
  if (cmd === "build") return cmdBuild()
  if (cmd === "prove") return await cmdProve()
  console.error("usage: grammar-remedy.ts <surface|delta|fetch|generate|build|prove> [...]")
  process.exit(2)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
