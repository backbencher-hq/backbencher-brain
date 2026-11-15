// imported-binding-claim — the D7 imported-binding CLAIM, both directions.
//
// An edge whose target is a local name bound by an import from an EXTERNAL module carries
// `metadata.importedBinding = { specifier, binding }`; the arbiter verifies it against the file's own
// import evidence (the imports edges publish `metadata.importedBindings` + `metadata.module`), never
// against the claim's word. Outcomes ride the BINDING family (bindOK), never `resolved`.
//
// THE REFUSALS ARE THE OTHER HALF: a binding imported from a PROJECT-LOCAL specifier is not claimable
// (it names a project module; the claim would launder a resolvable edge), and a receiver the file
// itself declares is not an imported binding at all.
import { helper as externalHelper } from 'some-external-pkg'
import * as ns from 'node:fs'
import { localThing } from './local-module'

export class Declared {
  run(): void {}
}

export function useExternal(): void {
  externalHelper.run()
  ns.readFileSync('x')
}

export function useLocalImport(): void {
  localThing.run()
}

export function useDeclaredReceiver(d: Declared): void {
  d.run()
}

// A RE-EXPORT DEPENDENCY binds NO local name: it must not publish importedBindings and must never
// create an imported-binding claim (its item is the name ASKED FOR, not a binding in this file).
export { reExported } from 'some-external-pkg'
