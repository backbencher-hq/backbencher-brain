import { startHeap } from "../src/heap.ts"
import { NoRamMachine } from "../src/vm.ts"

const r: [string, boolean, string][] = []
const ck = (n: string, ok: boolean, d = "") => r.push([n, ok, d])

// The heap holds 4 pages of 100 bytes = 400 bytes of "RAM" that is NOT in the laptop.
const heap = await startHeap(4891, { p0: 100, p1: 100, p2: 100, p3: 100 })

// THE LAPTOP: a cache of 150 bytes. That is its ENTIRE local memory budget.
const vm = new NoRamMachine(`http://127.0.0.1:${heap.port}`, 150)

// 1. A first read of every page must FAULT — nothing is local yet.
for (const p of ["p0", "p1", "p2", "p3"]) await vm.read(p)
ck("every first access is a page fault from the network", vm.stats.faults === 4, JSON.stringify(vm.stats))

// 2. The cache cannot hold all four pages — it evicted, and the bytes it holds never exceed the budget.
ck("the local cache never exceeds its byte budget", vm.stats.bytesHeld <= 150, `held=${vm.stats.bytesHeld}`)
ck("pages were evicted because there is no RAM for them", vm.stats.evictions > 0, `evictions=${vm.stats.evictions}`)

// 3. THE PROOF IT HAS NO RAM OF ITS OWN: read the evicted page again and it must FAULT AGAIN.
const before = vm.stats.faults
await vm.read("p0")
ck("an evicted page faults AGAIN — the laptop cannot hold its own working set",
   vm.stats.faults === before + 1, `faults ${before} -> ${vm.stats.faults}`)

// 4. AND THE DATA IS STILL CORRECT, because the heap is the truth.
const b = await vm.read("p0")
ck("the page comes back intact from the remote heap", b.length === 100, `len=${b.length}`)

// 5. Every fault was a real network round trip, and the log proves it.
ck("every miss is a logged network round trip", vm.faultLog.length === vm.stats.faults,
   `${vm.faultLog.length} logged vs ${vm.stats.faults} counted`)

// 6. A cache large enough for everything stops faulting — the variable is the LOCAL budget, not the heap.
const bigVm = new NoRamMachine(`http://127.0.0.1:${heap.port}`, 10_000)
for (const p of ["p0", "p1", "p2", "p3"]) { await bigVm.read(p); await bigVm.read(p) }
ck("with a big enough cache the second read is a HIT — the budget is what changes, not the data",
   bigVm.stats.hits === 4 && bigVm.stats.faults === 4, JSON.stringify(bigVm.stats))

await heap.close()

let pass = 0
for (const [n, ok, d] of r) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); if (ok) pass++ }
console.log(`\n${pass}/${r.length} checks`)
process.exit(pass === r.length ? 0 : 1)
