// M49 W13 regression fixture — a TS private member read must emit a Uses edge.
//
// The field-access rule looks the member's name up in the declared-symbol set
// before emitting, and that set stores private members under their CLEAN name
// (`count` for `#count` — the documented spec-table contract). The rule passed
// the node's RAW text (`#count`), so the membership test was always false and
// the analyzer skipped the read itself: `this.#count` emitted nothing while
// `this.count` emitted `uses read->count`, and while the private METHOD call
// `this.#step()` correctly emitted `calls run->#step`. Probe-proven, not
// inferred; no fixture covered a private field read, and the pinned TS corpora
// barely contain one (element-plus: 0, vue-core: 1 — and that one is inside a
// comment in packages/compiler-core/src/babelUtils.ts, vue-element-admin: 0),
// which is exactly why the sampled differential lanes never surfaced it.
//
// Contract: a private read emits the `#`-spelled target — the spelling the
// calls edge already uses (`calls run->#step`) and the one the javascript twin
// emits (`uses Store->#update_version`), so the web family agrees.

const update_version = 5;

class Store {
  #count = 0;
  #version = update_version || -1;

  #step() {
    return 1;
  }

  read() {
    return this.#count;
  }

  bump() {
    return this.#version + this.#step();
  }
}
