// Second copy of `duplicate` so a symbol-name filter must answer for every
// file that declares the name, and a `path` filter must be able to separate
// the two copies.
export function duplicate(): number {
  return 2
}

export class Gadget {
  render(): string {
    return "gadget"
  }
}
