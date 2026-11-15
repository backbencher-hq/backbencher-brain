// owner-class-element — C3 ARRAY/COLLECTION ELEMENT TYPE.
// The element is typed by the collection's declaration: `items: Item[]`, `new Array<Item>()`,
// a for-of binding over either, and a subscript receiver (`items[0].m()`).
export class Item { run(): void {} }
export function useElement(items: Item[]): void {
  items[0].run()
  for (const item of items) {
    item.run()
  }
}
export function useElementNew(): void {
  const made = new Array<Item>()
  made[0].run()
}
