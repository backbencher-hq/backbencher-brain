// THE USES HALF OF THE OWNER CHANNEL (JS-twin parity, 2026-11-17).
//
// A member READ carries the same receiver evidence a member CALL does, from the SAME per-file
// collection: `metadata.owner` + `metadata.ownerEvidence`. The store's owner pass
// (`src/ast/member-owner-resolution.ts`) withdraws the name binding for an owner-carrying
// calls/uses row and re-resolves inside the owner; without the keys, a read was bound by the name
// model's arbitrary winner. The honest other half is the UNRESOLVED marker: a read through a local
// whose type this file does not state cannot identify a declaration, so the row keeps its spelling
// and the store withdraws the name binding.
class Widget {
  value: number = 1
  on: boolean = true
}

class Holder {
  private inner: Widget = new Widget()

  readThis(): number {
    return this.inner.value
  }
}

function viaNew(): number {
  const w = new Widget()
  return w.value
}

function viaParam(w: Widget): number {
  return w.value
}

function viaElement(): number {
  const items: Widget[] = []
  return items[0].value
}

// THE CONTROL: an untyped local's member read must state NO owner and must carry the unresolved
// marker, because a member name on an untyped receiver cannot identify a declaration.
function viaUntyped(u: any): number {
  const v = u
  return v.value
}

export { Holder, viaNew, viaParam, viaElement, viaUntyped }
