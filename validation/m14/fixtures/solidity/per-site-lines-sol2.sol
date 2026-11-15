// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Sites {
    uint256 public counter;

    function one() public returns (uint256) {
        counter = helper();
        return counter;
    }

    function helper() internal returns (uint256) { return 1; }

    function two() public returns (uint256) {
        counter = helper();
        return counter;
    }
}
