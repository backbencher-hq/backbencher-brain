// A class that EXTENDS an in-file base overrides its base's methods — with or
// without the `override` keyword, which TypeScript makes optional (it is only
// required under `noImplicitOverride`). The analyzer only paired `implements`
// bases structurally, so `class Sub extends Base { run() {} }` emitted nothing
// while the identical member under `implements` paired. The oracle already
// derives these as truth (`declParents` takes extends AND implements,
// script/m14/differential.ts:12469) — proven by running it on the shape:
// truth `Sub.run -> Base.run`, analyzer nothing.
//
// Every abstention is pinned beside the gain, because a name-only pairing arm
// over-claims without them.
//
// Authored BEFORE the analyzer run: the pre-fix override set on this exact file
// was measured first (only the `override`-keyword cases and the `implements`
// cases existed).
export class Base {
  run(): number {
    return 1;
  }
  helper(): number {
    return 1;
  }
  notOverridden(): number {
    return 1;
  }
}

// THE GAIN: no `override` keyword, and the edge is emitted anyway.
export class Sub extends Base {
  run(): number {
    return 2;
  }
}

// with the keyword: exactly ONE edge, not two (the keyword arm and the
// structural arm must not both fire).
export class SubKeyword extends Base {
  override run(): number {
    return 3;
  }
}

// transitive: pairs with the ancestor that DECLARES the member.
export class Base2 extends Base {}
export class SubTransitive extends Base2 {
  run(): number {
    return 4;
  }
}

// ABSTENTION 1: a class FIELD is `public_field_definition`, which the oracle
// excludes from its member set by name so truth cannot outrun the analyzer.
export class WithField extends Base {
  run2 = 1;
  override helper(): number {
    return 5;
  }
}

// An overload group in the SUBCLASS: the class extractor keeps the LAST
// declaration of a repeated name (the body-carrying one, the same rule that
// keeps an overload group's implementation), so exactly one `run` symbol
// exists and the edge still resolves to it. The load-bearing overload
// ABSTENTION is on the BASE side — a doubly-declared INTERFACE member cannot be
// paired name-only — and that one is pinned by
// class-implements-interface-overrides (`Ambiguous.notify`).
export class Overloaded extends Base {
  run(): number {
    return 6;
  }
  run(prefix: string): number {
    return prefix.length;
  }
}

// ABSTENTION 3: a qualified base resolves to no in-file declaration.
export class External extends ImportedBase {
  run(): number {
    return 7;
  }
}

// ABSTENTION 4: the base never declares `extra`, so it pairs with nothing.
export class Unpaired extends Base {
  extra(): number {
    return 8;
  }
}

// CONTROL: the implements path the analyzer already carried.
export interface Contract {
  handle(): void;
}
export class Implements implements Contract {
  handle(): void {}
}
