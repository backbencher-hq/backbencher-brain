// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

uint256 constant FILE_SCOPE_MAX = 2 ** 64;
type Price is uint128;

struct FileScopeStruct { uint256 a; }

enum FileScopeEnum { ALPHA, BETA }

error FileScopeError(uint256 code);

event FileScopeEvent(uint256 value);

function fileScopeFunction(uint256 x) pure returns (uint256) { return x + 1; }

contract Owned {
    uint256 internal held;
    function read() public view returns (uint256) { return held; }
}
