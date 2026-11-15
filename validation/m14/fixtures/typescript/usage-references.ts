// ─────────────────────────────────────────────────────────────────────────────
// PIN CORRECTED 2026-10-17 (Lead-authorised pin-change set, iteration 2d).
// Contract: a type MENTION emits a `uses` row and drops the DUPLICATE `references`
// row (one-label ruling, direction corrected). This fixture pinned the old
// `references` behaviour, so its pin moved with the contract:
//   expected `references X -> T`  ->  expected `uses X -> T`, and
//   forbid the duplicate `references X -> T`.
// Stated only where this fixture's own rows changed (see each row's note).
// ─────────────────────────────────────────────────────────────────────────────
// did for CONTROL 7:
//   OLD PIN (wrong): `references greet -> User` expected, `uses greet -> User` FORBIDDEN.
//   NEW PIN:         `uses greet -> User` expected, `references greet -> User` FORBIDDEN.
// The one-label ruling exists to stop ONE mention being emitted TWICE; it does not say
// the mention emits nothing. A parameter annotation IS a use of the type, so the mention
// must carry the `uses` row and must NOT additionally carry the duplicate `references`
// row. `main -> raw` stays a `references` row: `raw` is a value read, not a type mention.
// ─────────────────────────────────────────────────────────────────────────────
interface User {
    name: string;
}

function greet(u: User): string {
    return u.name;
}

const raw: User = { name: "x" };

function main(u: User): string {
    return greet(raw);
}
