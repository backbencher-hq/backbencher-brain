// A store with a constructor (the member target), a getter (the accessor)
// and one plain method.
export class Store {
  private items: Map<string, number>

  constructor(initial: Array<[string, number]>) {
    this.items = new Map(initial)
  }

  get count(): number {
    return this.items.size
  }

  add(key: string, value: number): void {
    this.items.set(key, value)
  }
}
