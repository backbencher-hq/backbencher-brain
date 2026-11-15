// HOST-GLOBAL EXTERNAL CLAIMS — the claim pass's two proofs and its two negative controls.
//
// THE PASS IS ADDITIVE: it rewrites no target and adds no edge. A `uses`/`calls`/`extends`/
// `references` row whose target is a DOTLESS identifier that the file does not declare may be
// marked `isExternalTarget` ONLY when the closed, cited vocabulary in
// `src/ast/js-builtin-prototypes.ts` proves it: the bare name is a cited host global, or the
// receiver CHAIN'S ROOT is one. Everything else keeps no claim — a marker set is not a guess.
//
// NEGATIVE CONTROL 1 — a LOCAL binding's member call (`local.getElementById`): the receiver is
// a parameter, so the member could be a project object's method. NO claim.
// NEGATIVE CONTROL 2 — a name the FILE declares (`function setTimeout` inside `shadowed`): the
// bound-name set the claim pass builds is FILE-WIDE and deliberately over-collecting, so the
// file's own declaration outranks the platform table and NO claim is made. (The conservatism
// is the safe direction: it can only refuse a claim, never make one.)

function probe(mixed) {
  document.getElementById('x')
  window.addEventListener('resize', handler)
  const theme = document.body.dataset.theme
  JSON.stringify({ theme })
  parseInt('10', 10)
  if (mixed instanceof Date) return theme
  return theme
}

function negative(local) {
  local.getElementById('x')
  return local
}

function shadowed() {
  function setTimeout(fn) { return fn }
  return setTimeout(noop)
}

class ProbeError extends Error {
  constructor(message) { super(message) }
}
