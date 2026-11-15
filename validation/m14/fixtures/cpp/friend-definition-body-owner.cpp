// D13: a friend function DEFINED inside a class body is not a member of that class,
// so its body's reads must not be attributed to the class.
//
// Both shapes below are taken from the measured abseil site, not invented:
// `absl/random/uniform_int_distribution.h:81-87`, where `param_type` has member
// functions named `a()` and `b()` AND an in-class friend `operator==` whose
// parameters are also named `a` and `b`. The analyzer published
// `uses param_type -> b` — the enclosing CLASS as the owner of a read of a
// PARAMETER — which is wrong twice over: the read belongs to the friend, not the
// class, and the class has members of the same name, so the edge is
// indistinguishable from reading them.
//
// The `OutOfLine` block is the CONTROL and the reason this pin is not one-sided:
// an out-of-line member definition's body is already owned correctly, so a fix that
// simply pushed every function body to `global` would fail here.
//
// `friend void helper();` is the CP2 control: a friend DECLARATION mints no symbol
// and must keep minting none.

class param_type {
 public:
  result_type a() const { return lo_; }
  result_type b() const { return lo_; }

  friend bool operator==(const param_type& a, const param_type& b) {
    return a.lo_ == b.lo_;
  }

  friend void helper();

 private:
  int lo_;
};

bool OutOfLine::compare(const param_type& a, const param_type& b) {
  return a.lo_ == b.lo_;
}