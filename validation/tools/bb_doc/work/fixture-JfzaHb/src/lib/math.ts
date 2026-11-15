/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b }

/** Renders a map for the *page*; returns a [pointer]. */
export function render(values: Map<string, number>): string {
  return JSON.stringify([...values.entries()])
}
