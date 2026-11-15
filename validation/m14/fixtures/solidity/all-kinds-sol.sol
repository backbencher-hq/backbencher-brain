// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./IERC20.sol";
import * as Utils from "./Utils.sol";
import "./Bare.sol";

interface IFeed {
    function latest() external view returns (uint256);
}

library Math {
    using SafeMath for uint256;
    function add(uint256 a, uint256 b) internal pure returns (uint256) { return a + b; }
}

contract Feed is IFeed {
    error Stale(uint256 at);
    event Updated(uint256 value);

    uint256 private current;
    address public oracle;
    Feeder impl;

    constructor(address o) payable { oracle = o; }

    modifier onlyOracle() {
        require(msg.sender == oracle, "no");
        _;
    }

    function latest() external view override returns (uint256) {
        return current;
    }

    function push(uint256 v) public onlyOracle {
        Feeder next = new Feeder(v);
        impl = next;
        Feeder(v).report();
        emit Updated(v);
        this.latest();
        current = Math.add(current, v);
    }

    receive() external payable {}
    fallback() external payable {}
}

contract Feeder {
    constructor(uint256 v) payable {}
    function report() public pure { }
    function useThis(S memory s) public pure returns (S memory) {
        return S({a: 1, b: 2});
    }
    struct S { uint256 a; uint256 b; }
}
