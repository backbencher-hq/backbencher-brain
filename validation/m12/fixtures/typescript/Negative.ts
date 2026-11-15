export namespace Example.Negative {
  export class Counter {
    private value = 0

    increment(): void {
      this.value++
    }

    get current(): number {
      return this.value
    }
  }

  export function LocalsAreNotSymbols(): void {
    const localA = 1
    const localB = "text"
    const localC = localA + 2
    console.log(localB + localC)
  }

  export function ParamsAreNotSymbols(input: string, count: number): number {
    const total = input.length + count
    return total
  }

  export function BuiltinsAreFiltered(): void {
    console.log("noise")
    console.warn("warn")
    const s = "x"
    const t = s.toString()
    const v = t.valueOf()
    const h = t.hasOwnProperty("x")
    const i = t.isPrototypeOf(Object)
  }

  export function LambdaParamsAreNotSymbols(): void {
    const list = [1, 2, 3]
    const doubled = list.map((x) => x * 2)
    const joined = doubled.map((n) => n.toFixed(2)).join(",")
    console.log(joined)
  }

  export function DestructuredParamsAreNotSymbols({ a, b }: { a: number; b: number }): number {
    return a + b
  }

  export function TemplateStringsAreNotCallTargets(): void {
    const s = `hello ${LocalsAreNotSymbols()}`
    console.log(s)
  }
}
