// fixture: typescript/decorator-lines-860
// M59 (#860): decorator `references` edges carried NO line at all — the only
// relationship emitter in the web family with no line field. Every other kind
// names the line it is written on; the svelte lane's pinned 40-file sample
// therefore read 110/111 (one decorator site).
// Each decorator below sits on a DIFFERENT line from the declaration it
// decorates, so "the decorator's own line" and "the declaration's line" are
// different answers — the forbid entries name the wrong one, which is what
// makes the contract falsifiable rather than merely present.
function sealed(target: any): any {
  return target
}

function inject(name: string): any {
  return () => undefined
}

@sealed
export class Service {
  @inject("db")
  private pool: unknown

  @sealed
  method(): void {}
}
