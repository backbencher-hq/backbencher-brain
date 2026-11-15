// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// SOL-26/27/28 — three dependencies the project does not declare, each with the claim that answers it.
import "forge-std/Test.sol";

contract Probe is Test {
    function check() public {
        assertEq(1, 1);
    }
}
