// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// DECORATES — the applied modifier, pinned with its impostor.
//
// Solidity has ONE node type for two constructs: `modifier_invocation` covers both
// `function f() onlyGuard` (an applied MODIFIER) and `constructor() Base(1)` (a
// BASE-CONSTRUCTOR CALL). The tree is identical — a field-less identifier child —
// so the discriminator is RESOLUTION against the declaration name space:
//
//   target resolves to a `modifier_definition`      → `decorates`
//   target resolves to a contract/interface/library → `calls` (base constructor)
//   neither                                          → `calls`, unresolved
//
// This fixture fires the decorator rows and FORBIDS the impostor explicitly, both
// directions: `Derived`'s constructor names a declared CONTRACT, so it must stay
// `calls` and must not become `decorates`; `guard`'s application names a declared
// MODIFIER, so it must be `decorates` and must not stay `calls`. A cross-file
// modifier (`fromIndex`) is applied without an in-file declaration, so with NO
// project index it must stay `calls` unresolved — and never a fabricated
// `decorates`.

contract Base {
    uint256 public v;
    constructor(uint256 _v) { v = _v; }
}

contract Other {
    constructor() { }
}

library Ops {
    function inc(uint256 x) internal pure returns (uint256) { return x + 1; }
}

contract Guarded {
    modifier onlyGuard() { _; }
    modifier neverApplied() { _; }
}

contract Main is Base, Other {
    using Ops for uint256;

    // fires: an applied modifier resolving to the in-file `modifier_definition`
    function guarded(uint256 x) public onlyGuard returns (uint256) {
        return x;
    }

    // fires twice, in source order
    function twice(uint256 x) public onlyGuard onlyGuard returns (uint256) {
        return x + 1;
    }

    // the IMPOSTOR, pinned: `Base(x)` resolves to a declared contract, stays `calls`
    constructor() Base(42) Other() { }

    // a cross-file-shaped application: `fromIndex` is declared NOWHERE in this file,
    // so with no project index it stays `calls` unresolved — never a decorates guess
    function unresolvedName(uint256 x) public fromIndex returns (uint256) {
        return x;
    }
}
