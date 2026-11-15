import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const file = fileURLToPath(new URL("./verify-php-trait-dispatch.mts", import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [file, ...args], { encoding: "utf8", timeout: 60_000 })
const control = run([])
assert.equal(control.status, 0, control.stdout + control.stderr)
for (const mutation of ["traits", "aliases", "precedence", "exclusion", "conflict", "unqualified", "localOverride", "projectOverride"]) {
  const result = run([`--mutate=${mutation}`])
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.stdout.includes(`APPLIED trait mutation: ${mutation}`))
  assert.ok(result.stderr.includes("AssertionError"))
  console.log(`KILLED ${mutation}`)
}
const receivers = fileURLToPath(new URL("./verify-php-trait-receivers.mts", import.meta.url))
const receiverControl = spawnSync(process.execPath, [receivers], {encoding:"utf8",timeout:60_000})
assert.equal(receiverControl.status, 0, receiverControl.stdout + receiverControl.stderr)
const receiverMutant = spawnSync(process.execPath, [receivers, "--mutate"], {encoding:"utf8",timeout:60_000})
assert.equal(receiverMutant.error, undefined)
assert.equal(receiverMutant.signal, null)
assert.equal(receiverMutant.status, 1, receiverMutant.stdout + receiverMutant.stderr)
assert.ok(receiverMutant.stdout.includes("APPLIED trait receiver mutation"))
assert.ok(receiverMutant.stderr.includes("AssertionError"))
console.log("KILLED consumer-bound receiver inference")
