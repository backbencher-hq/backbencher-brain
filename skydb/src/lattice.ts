// The ONLY merge rule in skydb, and everything else is built on it.
//
// A fact is a (key, value, stamp) triple. The stamp is a dot: a Lamport counter
// paired with the node that wrote it. Merge takes, per key, the dot with the
// greater counter; a tie is broken by node id so every replica picks the SAME
// winner without talking to anyone. That tie-break is the whole trick: a merge
// that is commutative, associative and idempotent converges no matter what
// order packets arrive or how often they are replayed.

export interface Dot { counter: number; node: string }
export interface Fact<T = unknown> { key: string; value: T; dot: Dot }

/** Total order on dots. Deterministic, so replicas cannot disagree. */
export function dotGreater(a: Dot, b: Dot): boolean {
  if (a.counter !== b.counter) return a.counter > b.counter
  return a.node > b.node
}

export function mergeFact<T>(a: Fact<T> | undefined, b: Fact<T>): Fact<T> {
  if (!a) return b
  return dotGreater(b.dot, a.dot) ? b : a
}

export class Lattice {
  private facts = new Map<string, Fact>()
  private counter = 0
  constructor(readonly node: string) {}

  /** Local write. Takes the next counter, so it beats anything this node has seen. */
  set<T>(key: string, value: T): Fact<T> {
    const f: Fact<T> = { key, value, dot: { counter: ++this.counter, node: this.node } }
    this.facts.set(key, f as Fact)
    return f
  }

  get<T>(key: string): T | undefined {
    return this.facts.get(key)?.value as T | undefined
  }

  /** Advance the clock past anything we have seen, so our next write wins over it. */
  observe(dot: Dot): void {
    if (dot.counter > this.counter) this.counter = dot.counter
  }

  snapshot(): Fact[] { return [...this.facts.values()] }

  /** The merge. Idempotent: merging the same snapshot twice changes nothing. */
  merge(incoming: Fact[]): number {
    let changed = 0
    for (const f of incoming) {
      this.observe(f.dot)
      const cur = this.facts.get(f.key)
      const next = mergeFact(cur, f)
      if (cur !== next) { this.facts.set(f.key, next); changed++ }
    }
    return changed
  }

  size(): number { return this.facts.size }
}
