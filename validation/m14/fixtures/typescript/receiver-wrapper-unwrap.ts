// THE WRAPPED RECEIVER (C10, 2026-11-25).
//
// `receiverOwnerType` branches on the receiver node's own `type`. A parenthesis and a `!`
// are wrappers that do not change what the receiver IS, but each hid the node underneath:
// `(new Worker()).run()` and `w!.run()` matched no branch, emitted no `metadata.owner`, and
// fell to the store's NAME model — which bound `run` to whichever same-named member won its
// tie-break. MEASURED on a three-file repro: `(new Worker()).run()` bound to `other.ts:run`
// while the call names `Worker` in a file that imports only `Worker`.
//
// A CAST IS NOT A WRAPPER and is handled separately: `(x as Worker).run()` STATES the type,
// so the cast is read as the owner (evidence `cast`) rather than stripped.
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

export function viaParenthesizedNew() {
  return (new Worker()).run();
}

export function viaNonNull(w: Worker) {
  return w!.run();
}

export function viaCast(value: unknown) {
  return (value as Worker).run();
}

export { Worker, Other };
