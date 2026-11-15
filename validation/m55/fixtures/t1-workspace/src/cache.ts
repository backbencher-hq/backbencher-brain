// A SECOND `constructor` in the same project: a name-only lookup cannot
// choose between it and Store's, so it must stay a declared error.
export class Cache {
  private entries: string[]

  constructor(entries: string[]) {
    this.entries = entries
  }

  size(): number {
    return this.entries.length
  }
}
