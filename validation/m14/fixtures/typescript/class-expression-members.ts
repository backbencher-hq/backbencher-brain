// A class EXPRESSION carries members, exactly like an object literal does — and
// the member's owner follows ONE rule, the javascript twin's.
//
// Pre-fix, `const A = class Inner { m() {} }` produced NO member at all: the
// variable path's only descent trigger tested for `object`, so a class value
// never descended and the whole body was lost with it — no member symbol, no
// `contains` edge, and the calls inside `m` attributed to the enclosing
// function. The javascript twin emitted `method:m` all along, and the oracle
// derives nothing for the shape, so no differential could ever have flagged it:
// the twin was the only available reference.
//
// The owner rule, ported from that twin: a class expression's OWN declared name
// wins, else the binding it initialises or assigns to; an object literal is
// owned by its binding; a function boundary ends the search; and a value with
// no binding to name (a call argument, a `return`) stays ownerless, which is
// correct silence rather than a gap.
//
// The same rule now names the relationship SOURCE as well as the symbol, which
// is what fixed the second half: the resolver used to walk up to the nearest
// `variable_declarator` with no function-boundary check, so a method inside a
// RETURNED object literal matched nothing and every call in it was emitted
// against the enclosing method — the same call appearing in two symbols'
// payloads and the edge pointing at the wrong source.
//
// Authored BEFORE the analyzer run: every pre-fix value above was measured by
// probe before these pins were written.
export function helper(): number {
  return 1;
}

// THE GAIN: a class expression's members exist at all, owned by the class's
// own declared name.
export const Named = class Inner {
  usesHelper(): number {
    return helper();
  }
};

// anonymous: owned by the binding it initialises.
export const Anon = class {
  m(): number {
    return helper();
  }
};

// the assignment form — not a corner case: it is how a custom-element base is
// written (`SvelteElement = class extends HTMLElement { … }`).
let Assigned: any;
Assigned = class {
  m(): number {
    return helper();
  }
};

// no binding to name: a call argument. The member exists and is correctly
// OWNERLESS — it must not steal the enclosing owner.
export function register(_c: unknown): void {}
register(class {
  orphan(): number {
    return helper();
  }
});

// no binding to name: a returned class expression.
export function make(): unknown {
  return class {
    returned(): number {
      return helper();
    }
  };
}

// THE SECOND HALF: a method inside a RETURNED object literal owns its own
// calls. Pre-fix these calls were charged to `outerMethod` as well, so the same
// call sat in two payloads and the edge named the wrong source.
export function outerMethod(): unknown {
  return {
    inner(): number {
      return helper();
    },
  };
}

// object-literal forms, unchanged in shape but now on the same rule.
export const obj = {
  deep(): number {
    return helper();
  },
};

let objAssigned: any;
objAssigned = {
  deep(): number {
    return helper();
  },
};

// nested: a class expression inside a class expression.
export const Outer = class {
  m(): number {
    return 1;
  },
  n(): unknown {
    return class {
      q(): number {
        return helper();
      }
    };
  },
};

// CONTROL: a class DECLARATION is untouched by any of this.
export class Decl {
  m(): number {
    return helper();
  }
}
