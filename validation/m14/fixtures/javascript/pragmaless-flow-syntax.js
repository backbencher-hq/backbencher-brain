// TYPED ANNOTATIONS WITH NO PRAGMA MUST STILL BE READ.
// This is not ECMAScript: `value: number` is a typed annotation, and the file carries no pragma
// anywhere. The pragma-gated fallback used to give up here and the analyzer read only whatever error
// recovery left behind. The TypeScript grammar parses this clean, and the fallback wins ONLY on a
// clean parse, so a genuinely broken .js still keeps its error-recovery tree.

export function scale(value: number, factor: number) {
  return value * factor
}

export class Counter {
  count: number = 0

  bump(by: number) {
    this.count = this.count + by
  }
}
