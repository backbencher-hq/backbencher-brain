// Third file: gives `buildThing` a second declaring file and the project a
// non-symbol declaration so a project-wide read and a path-only read differ.
export const READY = true

export function buildThing(): number {
  return 3
}
