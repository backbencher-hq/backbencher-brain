// local-binding-claim — the D7 local-binding claim: the family binding spelling for names the
// family never publishes.
//
// A parameter, a type parameter and a local declarator bind names that can never name a published
// symbol, so their edges are RE-SPELLED `<callable>\u0000<binding>` and marked `metadata.localBinding`.
// The arbiter verifies the claim from the spelling alone (no declaration can answer it). The claim
// lands in bindOK, never in resolved — nothing was resolved.
//
// REFUSALS: a nested function that the analyzer PUBLISHES as a symbol is not re-spelled (its edge may
// resolve), and a name bound by an import belongs to the imported-binding claim instead.
export function outer(cb: () => void): string {
  let localVal = ''

  function publishedNested(): void {}

  const assign = (x: number) => x
  cb()
  publishedNested()
  localVal = String(assign(1))
  return localVal
}

export function typed<T>(value: T): T {
  return value
}
