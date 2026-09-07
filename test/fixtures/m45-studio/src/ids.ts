// Ids — readable, sortable identifiers for domain entities.

let counter = 0

export function generateId(prefix: string): string {
  counter += 1
  const stamp = Date.now().toString(36)
  return prefix + "_" + stamp + "_" + counter.toString(36).padStart(4, "0")
}
