// M49 W13 regression fixture — a CLASS EXPRESSION's members need a container
// identity too.
//
// Only `class_declaration` pushed a Class scope, so `scopeOwnerName` returned
// undefined for every member of every anonymous class expression and they ALL
// shared the dedup key `module:<name>`: the second class expression's
// `constructor` replaced the first's, dead-spanning its body and dropping every
// edge it owned. Measured on the real svelte corpus —
// `packages/svelte/src/internal/client/dom/elements/custom-element.js` defines
// TWO class expressions (the `SvelteElement` custom-element base and the
// per-component `Class` built by `create_custom_element`), each with a
// `constructor`, so `this.attachShadow(shadow_root_init)` in the FIRST one
// vanished (the javascript-lane MISSING edge W12's 400-file measurement
// registered). The 60-file rotation never sampled a file with two anonymous
// class expressions, which is why the deep run found it and no fixture did.
//
// Contract: identity is container-scoped (W2 #769 for object literals) — two
// class expressions never collide, while duplicates INSIDE one class body
// still collapse last-wins (J3 / dup-key Option A).

const alpha = () => 1;
const beta = () => 2;

let First;
First = class extends Base {
  constructor(init) {
    super();
    this.init = init;
    this.shadow = this.attachShadow(init);
  }
  run() {
    return alpha();
  }
};

function make() {
  const Second = class extends First {
    constructor() {
      super();
      this.ready = true;
    }
    run() {
      return beta();
    }
  };
  return Second;
}
