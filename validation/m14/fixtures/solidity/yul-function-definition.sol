contract T {
  function t() public pure {
    assembly {
      function add2(a, b) -> r { r := add(a, b) }
      let z := add2(1, 2)
      pop(z)
    }
  }
}
