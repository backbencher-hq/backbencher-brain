// c960-sharpness-selftest-falsify — does the instrument's scope check actually die when the
// property it names is broken?
//
// The check it replaces was UNSATISFIABLE (it asked one file to be both an owned input and
// environment, which the partition forbids), so it had been red for a round without anything
// noticing. A replacement that cannot fail would repeat the mistake, so this breaks the exact
// mechanism the check names — the closure walker's DYNAMIC-import branch — and requires the
// check to fail while the file is broken. Bytes are restored in a `finally`.
//
// Run: bun script/m14/tmp/c960-sharpness-selftest-falsify.ts
import * as fs from "node:fs"
import * as path from "node:path"

// this file lives at <root>/script/m14/tmp, so the root is three levels up (two levels up is
// `script/`, which silently produced <root>/script/script/... and an ENOENT — the probe failed
// before it could falsify anything, which is the honest way for a broken instrument to behave).
const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..")
const FILE = path.join(ROOT, "script", "m60", "verify-oracle-sharpness.ts")
const orig = fs.readFileSync(FILE, "utf8")

// The walker's spec pattern: `/(?:from|import|import\(|require\()\s*["']([^"']+)["']/g`.
// Dropping the `import\(|` branch is what a regression to static-import-only would look like.
const DEAD = "import\\(|require\\("
const REPLACED = "require\\("
if (!orig.includes(DEAD)) {
  console.error(`falsification: anchor ${JSON.stringify(DEAD)} not found in ${FILE}`)
  process.exit(2)
}

const run = () => {
  const r = Bun.spawnSync(["bun", FILE, "--selftest"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
  return r.stdout.toString() + r.stderr.toString()
}

let brokenOut = ""
try {
  fs.writeFileSync(FILE, orig.split(DEAD).join(REPLACED))
  brokenOut = run()
} finally {
  fs.writeFileSync(FILE, orig)
}
const restoredOut = run()

const line = (out: string, re: RegExp) => out.split("\n").filter((l) => re.test(l)).join("\n") || "(no matching line)"
const died = /FAIL\s+scope: a core-reached module/.test(brokenOut)
const alive = /selftest: the instrument separates/.test(restoredOut)
console.log("--- broken (dynamic-import reach removed) ---")
console.log(line(brokenOut, /core-reached|selftest:/))
console.log("--- restored ---")
console.log(line(restoredOut, /core-reached|selftest:/))
console.log(`falsified=${died} restored-green=${alive}`)
process.exit(died && alive ? 0 : 1)
