class A {
  save() { return alpha(); }

  save() { return beta(); }
}

class B {
  save() { return gamma(); }
}

function alpha() { return 1; }
function beta() { return 2; }
function gamma() { return 3; }
