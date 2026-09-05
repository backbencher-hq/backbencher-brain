// PINS the typescript wave fixture pack (M29.R2 wave 1, owner-approved set).
export class Greeter {
  private items: string[] = [];

  constructor(items: string[]) {
    this.items = items;
  }

  greet(): string {
    return `hello ${this.items.length}`;
  }
}

export function main(): number {
  const g = new Greeter(["a", "b"]);
  console.log(g.greet());
  return g.items.length;
}

export const CONSTANT = 42;
