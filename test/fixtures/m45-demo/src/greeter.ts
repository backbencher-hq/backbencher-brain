// bb-demo — greeter.ts
// The class at the center of the demo: hover its methods to see usages from
// two other files, the connected summary, enrichment, and the action row.

export class Greeter {
  private items: string[] = [];

  constructor(items: string[]) {
    this.items = items;
  }

  greet(): string {
    return `hello ${this.items.length}`;
  }

  add(item: string): void {
    this.items.push(item);
  }

  size(): number {
    return this.items.length;
  }
}

export function buildGreeter(): Greeter {
  return new Greeter(["a", "b", "c"]);
}
