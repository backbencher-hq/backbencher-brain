// A project this lane never indexes. The read door must not create a store or
// an index for it merely by being asked for annotations.
export function lonely(): string {
  return "lonely"
}
