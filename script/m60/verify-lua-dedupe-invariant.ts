/**
 * M60 LUA-53 — proof that removing the dead `dedupe` flag changed nothing.
 *
 * ## Why a count is not proof here
 *
 * The removed code was
 *
 *     if (opts?.dedupe === false) {
 *       if (ctx.seenRelationships.has(key)) return
 *     } else if (ctx.seenRelationships.has(key)) return
 *     ctx.seenRelationships.add(key)
 *
 * — both arms ran the same test and the key was recorded either way, so the flag could
 * not change an output. That is a reading, and a reading is exactly what this lane has
 * now been wrong about three times (LUA-02's `isCoroutine` counter that could only read
 * 0, LUA-10's dead scoring branch, LUA-46's dead write exclusion). So the claim is
 * MEASURED, and the measurement is an EXACT DIFF of the whole edge set, not a recount.
 *
 * ## WHY THIS RUNS THE ANALYZER TWICE FROM DISK, IN TWO PROCESSES
 *
 * `ASTEngine`'s `getAnalyzer` resolves lua with `await import("./real-lua-analyzer")` —
 * the real module PATH, chosen by a switch statement, with no injection point. So a
 * script cannot hand `parseFile` a different analyzer: importing a second copy of the
 * class and calling it would not be the production path at all, and the diff would be
 * comparing one analyzer with itself. That is the shape of a check that cannot fail.
 *
 * Therefore each version is measured by putting its SOURCE at the real path and running
 * the production `parseFile` over it in a FRESH PROCESS, so `await import`'s module cache
 * cannot serve the other version. The child prints one digest line per edge; this script
 * compares them. The real file is restored in a `finally`, and the restore is verified by
 * hashing it before and after.
 *
 * ## SERIAL, and why that matters
 *
 * `parseFile` returns `extractFallback`'s output for a file whose grammar load lost a
 * race — §5 of the lane document records 12 of 3,252 files varying between two passes of
 * a provably identical draw. One worker, one file order, so that noise cannot masquerade
 * as a difference between the two versions.
 *
 * ## WHAT WOULD OVERTURN IT
 *
 * A single differing edge line. The script fails and prints both sides. It also fails if
 * the pre-fix revision does not mention `dedupe`, if the current source still passes it,
 * if the child prints nothing, or if the restored file's hash differs from the original —
 * an empty result over a non-empty corpus is a failed check, not a pass (honesty
 * contract §5.4).
 *
 * Usage: npx tsx script/m60/verify-lua-dedupe-invariant.ts [--cap N] [--rev <sha>]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const CAP = Number(arg("--cap", "40"))
const REV = arg("--rev", "")!
const ANALYZER = path.join(ROOT, "src", "ast", "real-lua-analyzer.ts")
const CHILD = path.join(ROOT, "script", "m60", "tmp-lua-dedupe-child.ts")

const sha = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16)

// ── 0. the two versions, and the guards that make the diff worth anything
const postSrc = readFileSync(ANALYZER, "utf8")
let preSrc: string
try {
  preSrc = execFileSync("git", ["show", `${REV}:src/ast/real-lua-analyzer.ts`], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  })
} catch (e: any) {
  console.error(`FAIL: could not read the pre-fix analyzer at ${REV}: ${e?.message ?? e}`)
  process.exit(1)
}
if (!preSrc.includes("dedupe")) {
  console.error(`FAIL: ${REV} does not mention \`dedupe\`, so it is not the pre-fix revision. A diff against it`)
  console.error("  would compare two versions of the same code and the zero difference would prove nothing.")
  process.exit(1)
}
if (postSrc.includes("dedupe: false")) {
  console.error("FAIL: the current analyzer still passes `dedupe: false`. The fix is not in place.")
  process.exit(1)
}

// ── the child: drive production parseFile, print one line per edge
writeFileSync(CHILD, `
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CAP = ${CAP}
const files: Array<{ repo: string; rel: string; abs: string; dir: string }> = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked.slice(0, CAP)) files.push({ repo: e, rel, abs: path.join(dir, rel), dir })
}
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { continue }
  for (const s of r.symbols ?? []) {
    const m = s.metadata ?? {}
    process.stdout.write(["SYM", f.repo + "/" + f.rel, String(s.name), String(s.kind), String(s.ownerName ?? ""), String(s.scope ?? ""), String(m.isMethod ?? "")].join("\\u001f") + "\\n")
  }
  for (const e of r.relationships ?? []) {
    const m = e.metadata ?? {}
    process.stdout.write(["REL", f.repo + "/" + f.rel, String(e.type), String(e.source), String(e.target), String(e.line_number ?? ""), String(e.confidence), String(m.evidenceClass ?? ""), String(m.relationshipType ?? ""), String(m.redefinition ?? ""), String(m.member ?? ""), String(m.overridesLine ?? ""), String(m.receiver ?? ""), String(m.memberPath ?? ""), String(m.qualifiedName ?? "")].join("\\u001f") + "\\n")
  }
}
`)

function runChild(label: string): string[] {
  try {
    const out = execFileSync("npx", ["tsx", CHILD], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024,
      env: { ...process.env, BB_CORPUS_ROOT: CR },
      stdio: ["ignore", "pipe", "inherit"],
    })
    return out.split("\n").filter(Boolean)
  } catch (e: any) {
    console.error(`FAIL: the ${label} child process failed (exit ${e?.status}). The analyzer was left as the`)
    console.error("  ${label} version on disk and the restore below will put it back.")
    throw e
  }
}

const US = ""
function count(lines: string[]): { rel: number; sym: number } {
  let rel = 0, sym = 0
  for (const l of lines) { if (l.startsWith(`REL${US}`)) rel++; else if (l.startsWith(`SYM${US}`)) sym++ }
  return { rel, sym }
}

console.log(`dedupe-invariant proof — cap ${CAP}/repo, SERIAL, two fresh processes`)
console.log(`pre-fix revision: ${REV}`)
console.log(`pre-fix source sha ${sha(preSrc)}   post-fix source sha ${sha(postSrc)}\n`)

let preLines: string[] = []
let postLines: string[] = []
try {
  writeFileSync(ANALYZER, preSrc)
  preLines = runChild("pre-fix")
  writeFileSync(ANALYZER, postSrc)
  postLines = runChild("post-fix")
} finally {
  writeFileSync(ANALYZER, postSrc)
  try { if (existsSync(CHILD)) (await import("node:fs")).unlinkSync(CHILD) } catch { /* already gone */ }
  const restored = readFileSync(ANALYZER, "utf8")
  if (restored !== postSrc) {
    console.error("\nFAIL: the analyzer file was not restored byte-for-byte. Treat the working tree as untrusted.")
    process.exit(1)
  }
  console.log(`\nrestored: analyzer sha ${sha(restored)} (expected ${sha(postSrc)})`)
}

const preC = count(preLines)
const postC = count(postLines)
console.log(`pre-fix : ${preC.rel.toLocaleString()} relationships, ${preC.sym.toLocaleString()} symbols`)
console.log(`post-fix: ${postC.rel.toLocaleString()} relationships, ${postC.sym.toLocaleString()} symbols`)

const preSet = new Set(preLines)
const postSet = new Set(postLines)
const onlyPre = [...preSet].filter((l) => !postSet.has(l))
const onlyPost = [...postSet].filter((l) => !preSet.has(l))
// A line repeated in one version but not the other would be masked by the set, so the
// multiset is compared too. This is the check that makes the set comparison honest.
const preMulti = preLines.filter((l, i) => preLines.indexOf(l) !== i)
const postMulti = postLines.filter((l, i) => postLines.indexOf(l) !== i)
const dupDiff = preMulti.length !== postMulti.length || preMulti.some((l, i) => l !== postMulti[i])

console.log(`\nonly in pre-fix : ${onlyPre.length}`)
console.log(`only in post-fix: ${onlyPost.length}`)
for (const l of onlyPre.slice(0, 8)) console.log(`  - ${l.split(US).join(" | ")}`)
for (const l of onlyPost.slice(0, 8)) console.log(`  + ${l.split(US).join(" | ")}`)

const out = {
  schemaVersion: 1,
  kind: "lua_dedupe_invariant_proof",
  at: new Date().toISOString().slice(0, 10),
  claim: "the `dedupe` option read in addRelationship could not change any output: both arms of its test ran the same check and the key was recorded either way. Removing it is therefore behaviour-preserving.",
  method: "each version's SOURCE is placed at src/ast/real-lua-analyzer.ts and driven through the production `parseFile` in a FRESH process, because ASTEngine's getAnalyzer resolves lua with `await import(\"./real-lua-analyzer\")` — the real path, with no injection point — and `await import` caches per process. Every relationship AND symbol is emitted as one line carrying type, source, target, line_number, confidence, evidenceClass, relationshipType, redefinition, member, overridesLine, receiver, memberPath and qualifiedName; the two line multisets are then compared exactly. The real file is restored in a finally and its sha256 verified.",
  whySerial: "parseFile returns extractFallback's output for a file whose grammar load lost a race — 12 of 3,252 files vary between two passes of a provably identical draw (docs/analyzers/real-lua-analyzer.md §5). Under concurrency that noise would make the diff meaningless.",
  preFixRevision: REV,
  capPerRepo: CAP,
  preFixRelationships: preC.rel,
  postFixRelationships: postC.rel,
  preFixSymbols: preC.sym,
  postFixSymbols: postC.sym,
  onlyInPreFix: onlyPre.length,
  onlyInPostFix: onlyPost.length,
  duplicateLineMultisetDiffers: dupDiff,
  samples: { onlyPre: onlyPre.slice(0, 8), onlyPost: onlyPost.slice(0, 8) },
  overturn: "a single differing line refutes the claim that the flag was inert. An empty result over a non-empty corpus refutes it too, and is treated as a failure rather than a pass.",
}
writeFileSync(path.join(ROOT, "validation/m60/lua/dedupe-invariant.json"), JSON.stringify(out, null, 2) + "\n")

if (preC.rel === 0 || postC.rel === 0 || preC.sym === 0) {
  console.error("\nFAIL: a pass produced no edges or no symbols. An empty result over a non-empty corpus is a")
  console.error("failed check, not a pass.")
  process.exit(1)
}
if (onlyPre.length || onlyPost.length || dupDiff) {
  console.error(`\nFAIL: the output CHANGED — ${onlyPre.length} only in pre-fix, ${onlyPost.length} only in post-fix, duplicate-multiset differs: ${dupDiff}.`)
  console.error("The removal was not behaviour-preserving and the claim in the analyzer comment is wrong.")
  process.exit(1)
}
console.log(`\nPASS: ${preC.rel.toLocaleString()} relationships and ${preC.sym.toLocaleString()} symbols are identical`)
console.log("across the two versions, line for line. The flag was inert; removing it changed nothing.")