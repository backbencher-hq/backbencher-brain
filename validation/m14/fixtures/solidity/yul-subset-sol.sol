// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Assembler {
    uint256 public slot;

    function compute(uint256 x) public pure returns (uint256 r) {
        assembly {
            let lo := 0
            let p := shl(0x80, 0x44)
            mstore(p, x)
            r := keccak256(p, 0x20)
            for { let i := 0 } lt(i, 2) { i := add(i, 1) } {
                if gt(r, 0) { r := sub(r, 1) }
                if iszero(r) { break }
            }
            function twice(a) -> b { b := add(a, a) }
            r := twice(r)
            sstore(0, r)
        }
    }
}
