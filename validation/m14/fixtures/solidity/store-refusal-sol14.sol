// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Both names below are REAL Solidity identifiers that pool-worker.ts's UNIVERSAL
// denylist refuses. Both shapes are copied from the pinned corpus at this rev, so
// the fixture is a reproduction and not an invention:
//
//   `root`  — contracts/mocks/MerkleTreeMock.sol:15  `bytes32 public root;`
//   `self`  — contracts/crosschain/CrosschainLinked.sol:59
//              `Link storage self = _links[chain];`  (a LOCAL, so it goes
//              through declareSymbol rather than the state-variable path)

contract StoreRefused {
    struct Link { address gateway; bytes32 counterpart; }

    bytes32 public root;
    Link[] internal _links;

    function bind(uint256 chain, address gateway) public returns (bytes32 seen) {
        Link storage self = _links[chain];
        self.gateway = gateway;
        return root;
    }

    function keeper() public pure returns (uint256) { return 1; }
}