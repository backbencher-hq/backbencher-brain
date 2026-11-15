import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('./verify-typescript-conditional-aliases.mts', import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [file, ...args], {encoding: 'utf8', timeout: 60_000})
const control = run([])
assert.equal(control.status, 0, control.stdout + control.stderr)
for (const mutation of ['ternary','condition','logical','assignment','sequence']) {
  const result = run([`--mutate=${mutation}`])
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.stdout.includes(`APPLIED conditional mutation: ${mutation}`))
  assert.ok(result.stderr.includes('AssertionError'))
  console.log(`Rejected conditional alias ${mutation} source mutation`)
}
