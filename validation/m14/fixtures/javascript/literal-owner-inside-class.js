// JD3-CLOSURE regression fixture — an OBJECT LITERAL's member belongs to the
// literal, not to the class that lexically encloses it.
//
// The analyzer's `method_definition` case read
// `scopeOwnerName(scopeStack) ?? containerOwnerName(node)`, and `scopeOwnerName`
// is a CLASS-SCOPE lookup, so inside a class body it answered for every object
// literal nested there. The same construct therefore gave two answers depending
// on where it was written:
//
//   class C { m() { const api = { run() {}, stop() {} }; return api } }
//     -> contains C -> run, contains C -> stop     (WRONG: `api` is right there)
//   const api = { run() {} };
//     -> contains api -> run                        (right)
//
// The differential's oracle already declined the wrong rows: its `contains` rule
// asks whether the container is NAMEABLE, so the 2 rows published for
// `svelte/src/legacy/legacy-client.js` (`new Proxy({}, { get(){}, has(){} })`)
// registered as UNEXPLAINED fabrications at confidence 1.0 rather than as the
// mis-attribution they are. The lane doc's claim that `containerOwnerName`
// "superseded" `scopeOwnerName` was true only where no class scope existed.
//
// Three shapes are pinned, because the fix must not over-reach: a NAMED literal
// inside a class takes the literal's binding; an UNNAMED literal inside a class
// takes NO owner at all (the module-scope path already took that silence, and a
// class is not a better answer); and a real class member still belongs to its
// class.

class Service {
  configure() {
    const handlers = {
      onStart() {
        return 1;
      },
      onStop() {
        return 2;
      },
    };
    return handlers;
  }

  // A literal with NO binding — a call argument, so nothing in the language
  // names it. Silence, not the enclosing class.
  makeProxy() {
    return new Proxy({}, {
      get(target, prop) {
        return 1;
      },
    });
  }

  // A real class member: the class still owns it.
  reset() {
    return 0;
  }
}

const registry = { register() {} };

export { Service, registry };