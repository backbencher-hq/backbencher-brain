// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// SOL-18 — per-symbol complexity and `ownerKind`. Authored 2026-09-30 from the
// analyzer's measured output.
//
// Before SOL-18 every Solidity symbol reported complexity 1.
// `pool-worker.ts` defaults to `s.complexity || s.metadata?.complexity || 1`
// and the analyzer set neither, so the field was populated for the whole corpus
// with a constant that looks like a measurement. Over 389 files it now ranges to
// 25, with 690 symbols above 1.

interface IThing {
    function external1() external;
}

library Lib {
    function fromLibrary() internal pure returns (uint256) {
        return 1;
    }
}

contract Base {
    /// @dev Two branches: complexity 3.
    function twoBranches(uint256 x) public pure returns (uint256) {
        if (x > 1) {
            return 2;
        }
        if (x > 2) {
            return 3;
        }
        return 4;
    }
}

contract Derived is Base {
    /// @dev No decision point: complexity 1, and the shape that makes a constant 1
    /// distinguishable from a measured 1.
    function straight() public pure returns (uint256) {
        return 1;
    }

    /// @dev A loop AND a ternary: complexity 3. Pinned because `else` is part of
    /// `if_statement` in this grammar, so an if/else pair is ONE branch, and a rule
    /// that counted the two keywords separately would report 4 here.
    function loopAndTernary(uint256 x) public pure returns (uint256) {
        for (uint256 i = 0; i < x; i++) {
            x += 1;
        }
        return x > 0 ? x : 0;
    }

    /// @dev A modifier body counts its own branches; `gated` below has one.
    modifier oneBranch() {
        if (true) {
            _;
        }
    }

    modifier gated() {
        _;
    }
}