// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Exists so `expectComplexity` has a REAL pin. The lane's first complexity metric
// counted `binary_expression` unconditionally and missed `if` entirely, which the
// F9 payload section could not see because no fixture carried a branch. 7 branches:
// if, for, while, do-while, &&, ||, and the ternary — plus the `catch`, which is
// the eighth. `else` is part of `if_statement` in this grammar, so an `if`/`else`
// pair is ONE decision point.

contract Branches {
    uint256[] internal values;

    function everyBranch(uint256 a, uint256 b, address t) public returns (uint256 r) {
        if (a > b) {
            r = a;
        } else {
            r = b;
        }

        for (uint256 i; i < a; i++) {
            r = r + i;
        }

        while (r > 100) {
            r = r - 1;
        }

        do {
            r = r + 1;
        } while (r < b);

        bool both = a > b && b > 0;
        bool either = a > b || b > 0;
        r = both ? r : either ? a : b;

        try IThing(t).fetch() returns (uint256 v) {
            r = r + v;
        } catch {
            r = 0;
        }

        assembly {
            if gt(a, b) { r := add(r, 1) }
            switch a
            case 0 { r := 0 }
            default { r := 1 }
        }
    }

    function unreachableTail() internal pure returns (uint256) { return 1; }
}

interface IThing { function fetch() external returns (uint256); }
