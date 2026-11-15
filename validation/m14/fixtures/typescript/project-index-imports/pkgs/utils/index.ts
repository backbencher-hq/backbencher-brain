// The workspace package's own module. Every declaration here is a name the CONSUMER file imports
// through the package specifier `@fixture/utils`, so the analyzer can only resolve it if the
// complete project index says the item is declared (and, for a bare re-spelling, declared ONCE).
export interface WidgetOptions {
  size: number;
}

export function makeWidget(): number {
  return 1;
}

export interface Twice {
  a: number;
}
