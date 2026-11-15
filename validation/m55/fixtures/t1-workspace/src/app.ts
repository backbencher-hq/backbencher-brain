// The call sites: Store is instantiated here, so the owner-rooted impact of
// its constructor must come back as this function.
import { Store } from "./store"

export function main(): number {
  const s = new Store([["a", 1]])
  s.add("b", 2)
  return s.count
}
