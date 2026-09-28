// PINS the javascript wave fixture pack (M29.R2 wave 1, owner-approved set).
export class Greeter {
  constructor(items) {
    this.items = items;
  }

  greet() {
    return `hello ${this.items.length}`;
  }
}

export function main() {
  const g = new Greeter(["a", "b"]);
  console.log(g.greet());
  return g.items.length;
}

export const CONSTANT = 42;
