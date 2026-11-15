import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const test = fileURLToPath(new URL("./verify-ruby-project-index-evidence.mts", import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [test, ...args], { encoding: "utf8", timeout: 60_000 })
const control = run([])
assert.equal(control.status, 0, control.stdout + control.stderr)
for (const mutation of ["dispatch", "index-proof", "hierarchy"]) {
  const result = run([`--mutate-${mutation}`])
  assert.equal(result.error, undefined, mutation)
  assert.equal(result.signal, null, mutation)
  assert.equal(result.status, 1, `${mutation} must be rejected: ${result.stdout}${result.stderr}`)
  assert.ok(result.stderr.includes("AssertionError"), `${mutation} must fail an evidence assertion, rather than crash`)
  console.log(`KILLED ${mutation}`)
}
console.log("Ruby override control passed; all three production algorithm mutations rejected")
