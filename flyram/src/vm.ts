// THE LAPTOP. It has a CACHE and nothing else — `cacheBytes` is the entire local
// budget, and when it fills the oldest page is evicted, not the data. The heap
// remains the truth, so eviction is free.
//
// This is what "no RAM" means concretely: the local array is a CACHE with a hard
// byte ceiling, and every miss is a network round trip. Nothing is stored locally
// that isn't also on the heap.
export interface Fault { page: string; ms: number }
export interface VMStats { faults: number; hits: number; evictions: number; bytesHeld: number }

export class NoRamMachine {
  private cache = new Map<string, Buffer>()
  private lru: string[] = []
  private s: VMStats = { faults: 0, hits: 0, evictions: 0, bytesHeld: 0 }
  readonly faultLog: Fault[] = []

  constructor(private heapUrl: string, readonly cacheBytes: number) {}

  get stats(): VMStats { return { ...this.s, bytesHeld: [...this.cache.values()].reduce((a, b) => a + b.length, 0) } }

  private touch(id: string) {
    const i = this.lru.indexOf(id)
    if (i >= 0) this.lru.splice(i, 1)
    this.lru.push(id)
  }

  private evictToFit(incoming: number) {
    while ([...this.cache.values()].reduce((a, b) => a + b.length, 0) + incoming > this.cacheBytes && this.lru.length) {
      const victim = this.lru.shift()!
      const b = this.cache.get(victim)
      if (b) this.cache.delete(victim)
      this.s.evictions++
    }
  }

  /** Every access is a potential page fault. There is no local "load". */
  async read(page: string): Promise<Buffer> {
    const hit = this.cache.get(page)
    if (hit) { this.s.hits++; this.touch(page); return hit }
    const t0 = Date.now()
    const res = await fetch(`${this.heapUrl}/page?id=${encodeURIComponent(page)}`)
    const ms = Date.now() - t0
    if (!res.ok) throw new Error(`page fault failed: ${page} (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    this.s.faults++
    this.faultLog.push({ page, ms })
    this.evictToFit(buf.length)
    this.cache.set(page, buf)
    this.touch(page)
    return buf
  }
}
