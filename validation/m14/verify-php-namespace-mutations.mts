import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const test = fileURLToPath(new URL("./verify-php-stored-namespaces.mts", import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [test, ...args], { encoding: "utf8", timeout: 60_000 })
const control = run([])
assert.equal(control.status, 0, control.stdout + control.stderr)
for (const mutation of ["owner-identity", "parent-identity", "method-case", "relative-receiver", "member-kind", "bound-target-reconciliation"]) {
  const result = run([`--mutate=${mutation}`])
  assert.equal(result.error, undefined, mutation)
  assert.equal(result.signal, null, mutation)
  assert.equal(result.status, 1, `${mutation} must be rejected: ${result.stdout}${result.stderr}`)
  assert.ok(result.stdout.includes(`APPLIED namespace mutation: ${mutation}`), mutation)
  assert.ok(result.stderr.includes("AssertionError"), `${mutation} must fail a graph assertion, rather than crash`)
  console.log(`KILLED ${mutation}`)
}
console.log("PHP namespace control passed; all six production algorithm mutations rejected")
