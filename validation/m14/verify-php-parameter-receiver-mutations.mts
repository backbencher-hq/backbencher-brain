import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const file = fileURLToPath(new URL("./verify-php-parameter-receivers.mts", import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [file, ...args], { encoding: "utf8", timeout: 60_000 })
const control = run([])
assert.equal(control.status, 0, control.stdout + control.stderr)
for (const mutation of ["assignments", "escape", "dynamic", "unions"]) {
  const result = run([`--mutate=${mutation}`])
  assert.equal(result.error, undefined, mutation)
  assert.equal(result.signal, null, mutation)
  assert.equal(result.status, 1, `${mutation} survived: ${result.stdout}${result.stderr}`)
  assert.ok(result.stdout.includes(`APPLIED parameter mutation: ${mutation}`), mutation)
  assert.ok(result.stderr.includes("AssertionError"), mutation)
  console.log(`KILLED ${mutation}`)
}
console.log("PHP parameter receiver control passed; all four executable-decision mutations rejected")
