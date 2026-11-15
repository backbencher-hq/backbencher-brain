// owner-class-generic — C4 GENERIC TYPE-ARGUMENT PROPAGATION.
// `class Box<T> { value: T }` + `const b = new Box<Widget>()` makes `b.value` a Widget.
export class Widget { run(): void {} }
export class Box<T> { value: T }
export function useGeneric(): void {
  const b = new Box<Widget>()
  b.value.run()
}
export function negativeGeneric(): void {
  const plain = { value: { run(): void {} } }
  plain.value.run()
}
