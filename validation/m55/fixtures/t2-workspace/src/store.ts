export class Store<T> {
  private items: Map<string, T>;

  constructor(initial: Array<[string, T]>) {
    this.items = new Map(initial);
  }

  get(key: string): T | undefined {
    return this.items.get(key);
  }

  set(key: string, value: T): void {
    this.items.set(key, value);
  }
}
