/**
 * Rebuild the MEASURED read oracle from HEAD + the staged patch, so the round-3
 * proof is reproducible without committing an 840 KB derived copy of a shared
 * file that would silently drift out of date.
 *
 * Round 3 shipped `reviews/ruby/patches/differential-ruby-oracle-mirrors.patch`
 * on the evidence that it "applies cleanly", which is a statement about `patch`
 * and not about behaviour — the patch's own claims were unmeasured. This builds
 * the mirrored oracle and points the census at it via BB_RB_ORACLE, which turns
 * those claims into numbers:
 *
 *   corpus        MISSING          UNEXPLAINED
 *   rails         28  ->  0        103  ->  0
 *   rubocop       13  ->  0          0  ->  0
 *   mastodon       0  ->  0         46  ->  0
 *
 * 1,200 files, every audited label, 0 unmatched on both sides.
 *
 * With BOTH patches and the two new audited labels, on the FULL 8,528-file
 * corpus: outside-audited 34% -> 0%, MISSING 63 (0.025%), UNEXPLAINED 507
 * (0.177%). Run it with:
 *   BB_RB_AUDIT=contains,references BB_RB_ORACLE=script/m14/tmp/oracle-mirror/differential.ts
 *
 * The generated copy lives under script/m14/tmp/ and is NOT committed — run this
 * to recreate it.
 *
 * Usage: npx tsx script/m14/tmp/rb-make-mirrored-oracle.ts
 *   then: BB_RB_ORACLE=script/m14/tmp/oracle-mirror/differential.ts \
 *         npx tsx script/m14/tmp/rb-corpus-census.ts <corpus> --limit 400
 */
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
const OUT_DIR = path.join(ROOT, "script", "m14", "tmp", "oracle-mirror")
const PATCHES = [
  "differential-ruby-oracle-mirrors.patch",
  "differential-ruby-oracle-mirrors-2.patch",
].map((f) => path.join(ROOT, "reviews", "ruby", "patches", f))

const head = execFileSync("git", ["show", "HEAD:script/m14/differential.ts"], {
  cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
})
const tmp = "/tmp/rb-mirror-input.ts"
fs.writeFileSync(tmp, head)
let cur = tmp
PATCHES.forEach((pf, i) => {
  const out = `/tmp/rb-mirror-out-${i}.ts`
  const msg = execFileSync("patch", [cur, pf, "-o", out], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  })
  if (msg) process.stdout.write(msg)
  cur = out
})
// The generated copy sits one directory deeper than the original, so every
// relative import needs one more hop: `../../src` -> `../../../../src`, and a
// sibling import `./nim-truth-oracle` -> `../../nim-truth-oracle`.
let out = fs.readFileSync(cur, "utf8")
out = out.replace(/from "\.\.\/\.\.\/src\//g, 'from "../../../../src/')
out = out.replace(/from "\.\//g, 'from "../../')
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, "differential.ts"), out)
console.log(`wrote ${path.relative(ROOT, path.join(OUT_DIR, "differential.ts"))} (${out.length} bytes)`)
console.log(`point the census at it with: BB_RB_ORACLE=script/m14/tmp/oracle-mirror/differential.ts`)
