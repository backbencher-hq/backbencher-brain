// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-17 — applied modifiers as `decorators`. Authored 2026-09-30 from the
// analyzer's measured output. 188 of 5,976 corpus symbols carry applied
// modifiers, over 40 distinct names (`onlyOwner`, `initializer`, `whenNotPaused`).
//
// Published on the `decorators` FIELD, not as a relationship — the family
// contract. C#, Java and F# all treat decorators as metadata on the thing they
// decorate, and the `modifier_invocation` case already emits the one edge that
// does carry meaning: a `calls` edge, because invoking a modifier IS calling it.

abstract contract Guarded {
    modifier onlyOwner() {
        _;
    }

    modifier nonReentrant() {
        _;
    }

    /// @dev Not applied to anything — declared modifiers are functions too.
    modifier declaredOnly() {
        _;
    }
}

contract Vault is Guarded {
    uint256 private _v;

    /// @notice One modifier.
    /// @dev Pinned singly so a rule that dropped all but the first would pass.
    function single() public onlyOwner {}

    /// @notice Two modifiers, in source order.
    function paired() public onlyOwner nonReentrant {}

    /// @notice Applied modifiers AND an override, which must not be confused.
    function withOverride() public virtual override onlyOwner {}

    function untouched() public {}
}