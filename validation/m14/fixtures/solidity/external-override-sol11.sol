// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-11 — cross-file override resolution. Authored 2026-09-30.

// `ILater` is deliberately NOT declared here. That absence is the whole point of
// this fixture: it is the trigger condition for the external-base tier, exactly as
// the JavaScript lane's external-override fixture triggers its first-parent guess.

interface ILocal {
    function handle() external;
}

contract LocalBase {
    function handle() public virtual returns (uint256) {
        return 1;
    }
}

contract Derived is LocalBase {
    // Bare `override` over EXACTLY ONE header base. Solidity 0.8.8+ requires an
    // explicit list only when MORE THAN ONE base declares the member, so with a
    // single base the keyword is unambiguous and the edge resolves to it.
    function handle() public override returns (uint256) {
        return 2;
    }
}

contract ExplicitExternal is ILater {
    // `override(ILater)` names its base EXPLICITLY, and `ILater` is declared in
    // another file. The compiler rejects `override(X)` unless `X` declares the
    // member, so this edge is true for any compiling source.
    function handle() external override(ILater) {}
}

contract TwoBases is LocalBase, ILocal {
    // Bare `override` over TWO bases, and BOTH declare a member here. Solidity would
    // not compile this without an explicit list; it is here to pin that the analyzer
    // refuses the shape instead of guessing which base declares it.
    //
    // Named `ambiguous`, NOT `handle`, and that is load-bearing rather than cosmetic.
    // In the first draft of this fixture all three functions were called `handle`, so
    // the analyzer's rows collapsed to one source name and the forbid row could not
    // say WHICH contract must stay silent — it could only forbid `handle -> ILocal`
    // globally. That made the row weaker than it looked and let a mutant that lifts
    // the refusal SURVIVE, because picking "the first base" happened to reproduce a row
    // another contract legitimately emits. Distinct names are what let a gate be
    // precise.
    function ambiguous() public override returns (uint256) {
        return 3;
    }
}