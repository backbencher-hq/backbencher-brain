// THE CONSTRUCTOR-RECEIVER OWNER (C9, 2026-11-25).
//
// `new Worker().run()` states the receiver's class OUTRIGHT in the `new_expression`'s
// own `constructor` field. Before this branch the call row carried no
// `metadata.owner`, so the store fell back to the NAME model and bound `run` to
// whichever same-named member won its tie-break — measured on a three-file repro:
// `new Worker().run()` bound to `Other.run` in a DIFFERENT file, because `Worker`
// and `Other` both declare `run` and nothing withdrew the name binding.
//
// THE FIXTURE MUST DECLARE A RIVAL, or it cannot fail. `Other` exists only so the
// name `run` is genuinely ambiguous inside this file's own symbol table; a lone
// `run` would resolve by name anyway and the row would pass with or without the fix.
class Worker {
  run() {
    return "worker";
  }
}
class Other {
  run() {
    return "other";
  }
}

export function viaNewExpression() {
  return new Worker().run();
}

// CONTROL: the same member reached through an annotated local, the evidence class this
// branch must NOT change. If C9 over-claimed, this row's owner would move.
export function viaLocal() {
  const w: Worker = new Worker();
  return w.run();
}

export { Worker, Other };
