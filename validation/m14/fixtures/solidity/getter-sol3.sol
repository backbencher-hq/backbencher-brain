// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Vault {
    uint256 public balance;
    uint256 internal hidden;
    uint256 private secret;
    address public owner;

    function total() public view returns (uint256) { return balance; }
}
