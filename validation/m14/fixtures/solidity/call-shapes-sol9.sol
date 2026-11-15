// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Shapes {
    struct S { uint256 a; uint256 b; }
    uint256 public value;

    function everyShape(address t) public payable returns (uint256) {
        S memory legacy = S { a: 1, b: 2 };
        S memory modern = S({a: 3, b: 4});
        (bool ok, ) = t.call{value: 1, gas: 100}("");
        require(ok, "no");
        payable(t).transfer(1);
        uint256 z = type(uint256).max;
        value = legacy.a + modern.b + z;
        return value;
    }
}
