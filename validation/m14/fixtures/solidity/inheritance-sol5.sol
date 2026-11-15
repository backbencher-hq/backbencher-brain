// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-5: Solidity has ONE heritage construct — `is` — with no `interface`
// keyword in the list, so the tree does NOT say which kind each ancestor is. The
// distinction has to come from the ancestor's own DECLARATION. This fixture pins
// BOTH outcomes in one file, which is what stops a rule that always emits one kind
// from passing: an `extends`-only rule and an `implements`-only rule each fail here.

interface IFeed {
    function latest() external view returns (uint256);
    function feedKind() external pure returns (uint256);
}

abstract contract FeedBase is IFeed {
    uint256 internal current;
    function latest() public view virtual override returns (uint256) { return current; }
    function feedKind() external pure virtual override returns (uint256) { return 1; }
}

contract Feed is FeedBase {
    uint256 public counter;
    constructor() FeedBase() {}

    function latest() public view override(FeedBase) returns (uint256) {
        return super.latest();
    }
}

// SOL-19. `IOther` is NOT declared in this file, so the tree cannot say whether it
// is an interface or a contract — the kind of the heritage edge is undecided, and
// the lane must SAY SO rather than publish the guess as structural evidence.
contract CrossFile is IOther {
    function latest() public view override returns (uint256) {
        return 1;
    }
}
