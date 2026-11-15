// owner-class-cast — C6 `as`-CAST / TYPE-ASSERTION CLASS.
// `const w = value as Widget` states the type even when the declared value is untyped.
export class Widget { run(): void {} }
declare const value: unknown
export function useCast(): void {
  const w = value as Widget
  w.run()
}
export function negativeCast(): void {
  const n = value
  n.never()
}
