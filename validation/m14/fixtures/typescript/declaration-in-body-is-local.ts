// A declaration inside a function body is a LOCAL of that function, not a member
// of whatever class or namespace encloses the function. Two independent bugs
// produced false `contains` edges here, and both were invisible to every gate
// until an independent containment oracle was built for the lane.
//
// 1. SCOPE BALANCE. `extractClass` popped its Class scope eagerly, at the end of
//    its own body walk, while its member extractors had pushed scopes of their
//    own and queued those members' BODIES for later walking. The eager pop
//    therefore removed the innermost scope (the method's), and the method's own
//    deferred pop then removed the class scope underneath it. Net effect: the
//    class scope was on the stack while a method body was walked, so anything
//    declared in that body resolved its owner to the class. `extractInterface`
//    and `extractEnum` had the same shape; the five extractors that already
//    deferred their pop (function, method, constructor, static block, namespace)
//    were the pattern applied to them.
//
// 2. THE QUESTION WAS ASKED OF THE WRONG THING. `getOwnerInfo()` walks the scope
//    stack to the nearest class/namespace/interface/enum and skips function
//    scopes, so it cannot see that a declaration is nested in a body. It cannot
//    be fixed there either, because that stack ACCUMULATES: the member loop
//    extracts members synchronously, so member 2 is resolved while member 1's
//    Method scope is still on top. A guard in the stack was tried and measured,
//    and it stripped REAL members. The question is now asked of the TREE.
//
// The positives are pinned just as hard as the negatives: a member is still a
// member, including the second and third member of a class, which is exactly
// what the stack-based attempt broke.
//
// Authored BEFORE the analyzer run.
export class Report {
  // Members, in order. The second and third are the regression guard for the
  // stack-based attempt, which resolved them through the previous member's
  // leftover scope and dropped them.
  first(): string {
    return "a";
  }
  second(): string {
    return "b";
  }
  third(): string {
    return "c";
  }
  private count = 0;

  // A function declared in a METHOD body is a local. Pre-fix this emitted
  // `contains Report->helper`, claiming the class has a member it does not have.
  build(): () => number {
    function helper(): number {
      return 1;
    }
    return helper;
  }

  // A type alias and an interface declared in a method body: same false edge.
  // The alias and the interface still CONTAIN their own members — that part was
  // always right and must survive the fix.
  describe(): unknown {
    type Detail = { id: string; label: string };
    interface Audit {
      at: number;
    }
    const detail: Detail = { id: "1", label: "x" };
    const audit: Audit = { at: 0 };
    return { detail, audit };
  }

  // An UNBOUND object literal in a method body owns nothing. Its member is not a
  // member of the class, so no edge may be emitted — and the member itself stays,
  // ownerless, exactly as an unbound literal at module level already did.
  scratch(): unknown {
    return {
      temp(): number {
        return 2;
      },
    };
  }
}

export namespace Registry {
  export function outer(): () => number {
    function inner(): number {
      return 3;
    }
    return inner;
  }
}
