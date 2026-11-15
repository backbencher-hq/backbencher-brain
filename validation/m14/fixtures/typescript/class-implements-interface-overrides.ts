// M49 W22 (rotation-found on vue-core `packages/reactivity/src/effect.ts`):
// a CLASS implementing an in-file INTERFACE supplies implementations of that
// interface's members, and the analyzer emitted none of those overrides. The
// F5 oracle derives them generically (`declParents` takes `extends` AND
// `implements` edges whose target resolves in-file) and java's analyzer already
// emits the same contract (clojure `TransformerIterator`: `Empty.add ->
// Buffer.add`, probe-verified), which is why the java lane read 0 missing and
// the typescript lane carried exactly this one gap.
//
// Every shape below is pinned, including the ABSTENTIONS, because an arm that
// only pairs on a name would over-claim here:
//   - a class FIELD implementing an interface property must NOT pair (the
//     oracle deliberately keeps `public_field_definition` out of its member
//     set so truth cannot outrun the analyzer);
//   - an overloaded name on EITHER side cannot be paired name-only;
//   - an EXTERNAL/qualified base resolves to no in-file declaration;
//   - a member the interface never declares pairs with nothing.
//
// Authored BEFORE the analyzer run.
export interface Subscriber {
  notify(): void;
  readonly kind: string;
}

export interface Debuggable {
  debug(): string;
}

// Transitive base: `Subscriber`'s own members must still pair through `Base`.
export interface Base extends Subscriber {}

// 1. the gain: methods pair with the in-file interface's methods.
export class Effect implements Subscriber {
  kind = "effect" // 2. a FIELD must NOT pair with `Subscriber.kind`
  notify(): void {
    this.kind
  }
  // 4. `Subscriber` never declares `dispose`, so nothing pairs.
  dispose(): void {}
}

// 3. an overloaded interface name abstains: two `notify` declarations.
export interface Overloaded {
  notify(): void
  notify(reason: string): void
}
export class Ambiguous implements Overloaded {
  notify(): void {}
}

// 4. an external/qualified base has no in-file declaration: abstain.
export class External implements ImportedThing {
  run(): void {}
}

// 5. transitive: pairs with the ancestor that DECLARES the member.
export class Derived extends Object implements Base {
  kind = "derived"
  notify(): void {}
}
