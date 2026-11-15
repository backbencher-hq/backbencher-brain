// An ARROW FUNCTION's parameters shadow a same-named file-level symbol, and
// nothing covered them.
//
// This is the third form of the same defect. R12 covered a named function's
// parameters, via the symbol's own parameter list. R13 covered a loop variable
// and a catch binding. An arrow fell through both for a structural reason: an
// arrow is not a named declaration, so the reference pass never rebinds its
// "current symbol" on it, and the enclosing function stays current — whose
// parameter list is a DIFFERENT one.
//
// The consequence is that a function's own arrow can publish a reference to a
// module-level declaration the arrow has just shadowed:
//
//   function realRunner(bbEntry: string): IndexRunner {
//     return (root, env) => { ... root ... }     // <- `root` binds HERE
//   }
//
// `root` is not `realRunner`'s parameter (`bbEntry` is), so the shadow set built
// from `realRunner` never contained it, and a read of `root` inside the arrow
// resolved by NAME to a module-level `function root()`. The graph recorded the
// function as referencing a declaration it never mentions.
//
// Measured before the fix: 227 false `references` over 1000 tracked files, in 66
// of them — the largest of the three shadowing defects, and led by the names that
// collide most: `root`, `env`, `c`, `e`, `name`, `file`, `kind`.
//
// The shadowing is scoped to the arrow's OWN extent. That is the point of the
// last case below: an arrow that binds `file` does not make a later `file()` in
// the enclosing function a local read, so the genuine edge there must survive.
// Getting that wrong in the other direction — seeding the enclosing scope and
// over-suppressing — is the mistake R12 already made once with `locals`.
//
// Authored BEFORE the analyzer run.
function root(): string {
  return "module-level root";
}

function env(): string {
  return "module-level env";
}

function file(): string {
  return "module-level file";
}

function helper(): string {
  return "module-level helper";
}

type Pair = (a: string, b: string) => string;

// FALSE POSITIVE 1: the arrow's parameter shadows the module function.
export function arrowShadowsFn(): string {
  return (root: string) => root;
}

// FALSE POSITIVE 2: a function EXPRESSION's parameter, which is the same shape
// and a separate node type from the arrow.
export function fnExprShadowsFn(): string {
  return function (env: string) {
    return env;
  };
}

// FALSE POSITIVE 3: the enclosing function HAS parameters, and they are the
// wrong ones. This is the shape that made the defect structural: the shadow set
// was built from the enclosing function's parameter list, which here is
// `bbEntry`, and `root` is nowhere in it.
export function enclosingHasOtherParams(bbEntry: string): string {
  return (root: string) => root;
}

// FALSE POSITIVE 4: an arrow whose parameters are type-annotated.
export function arrowTypedParam(): string {
  return (root: string, env: string): string => root + env;
}

// TRUE POSITIVE 1: an arrow with NO parameter of that name really does reach the
// module function. The fix must not suppress an arrow wholesale — it shadows the
// names it BINDS, and no others.
export function arrowNoShadow(): string {
  return () => root();
}

// TRUE POSITIVE 2: the shadow is scoped to the arrow's extent, so a read of
// `file()` in the ENCLOSING function after the arrow still resolves to the
// module declaration. A fix that added the arrow's bindings to the enclosing
// scope would delete this edge, and `locals` cannot be used for the bindings
// because `locals` also gates `uses` (see R13).
export function shadowDoesNotLeak(): string {
  const fn = (file: string) => file;
  void fn;
  return file();
}

// TRUE POSITIVE 3: a call to the module function, untouched.
export function callsHelper(): string {
  return helper();
}

// TRUE POSITIVE 4: a nested NAMED function's parameters already shadowed, since
// it rebinds the current symbol. Pinned so the arrow fix does not regress it, and
// so the two paths stay distinguishable: `nestedNamed -> root` must NOT appear.
export function nestedNamedParam(): string {
  function nestedNamed(root: string): string {
    return root;
  }
  return nestedNamed(root());
}

// A function type's SIGNATURE parameters are the clearest case of a binding that
// is not a mention: the type `Pair` writes `a` and `b` in its parameter list and
// neither is a reference to anything.
export const pair: Pair = (a, b) => a + b;
