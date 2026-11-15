// D8: a TRAILING ANNOTATION is not a declaration.
//
// Given the shape below the grammar ends the declaration at the `)` and recovers a
// SECOND function_definition whose declarator is the annotation macro and whose
// BODY is the real method's body. Publishing that invents a member of the class and
// attributes the body's reads to a macro.
class Guarded {
 public:
  virtual int current_value(Widget& w) const GTEST_LOCK_EXCLUDED_(mutex_) {
    ++reads_;
    return w.value();
  }

  // The same annotation on a method whose return type has a trailing `const`, which
  // is the shape that made a "look at the character before the macro" rule read this
  // as opening a statement: the preceding character is `t`, not `)`.
  virtual Widget* suite_for(const TestInfo& t) const GTEST_LOCK_EXCLUDED_(mutex_) {
    return t.suite();
  }
};

// CONTROL 1: a macro at STATEMENT position defines the function it names. `TEST` is
// spelled in all caps, so any rule that only asks "is the name a macro" deletes every
// heading in gtest and catch2 — this is the largest single loss available to the
// fix, and it is what the first version of this rule did.
TEST(Suite, Reads) {
  int x = 1;
  helper(x);
}

// CONTROL 2: an all-caps name that is a REAL function survives, because a C++
// function definition always has a return type.
void MAX_SIZE(int a) { sink(a); }

// CONTROL 3: a declaration, not a definition, immediately before a heading. The
// sibling-based version of this rule read the declaration as proof that the heading
// CONTINUED it, and deleted this.
class WithPrior {
 public:
  void prior();
};

TEST(Other, Suite) { int y = 2; }

int reads_count = 0;
