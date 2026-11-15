contract T {
  function t() public pure {
    assembly {
      loop: { pop(1) leave }
    }
  }
}
