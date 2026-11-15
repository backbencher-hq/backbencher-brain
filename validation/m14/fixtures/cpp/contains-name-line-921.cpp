// #921 (M60-C): a `contains` edge must carry the line that NAMES the child.
// Every child below is written so that its NAME is on a LATER line than its
// declaration starts, which is the only shape that can tell the two readings
// apart:
//   * a wrapped return type (`long long` then the function name) — measured on
//     zig's libtsan, `void NORETURN` then `CheckFailed(const char *file, …)`;
//   * a wrapped member type (`unsigned long long` then the field);
//   * an anonymous aggregate member (`struct { … } options;`) — the name is on
//     the CLOSING line of the declaration;
//   * a wrapped class-scope typedef (`typedef unsigned long` then `Handle;`).
namespace ns {

// the declaration starts here, the name is on the NEXT line
long long
sum(long long a, long long b) {
  return a + b;
}

class Widget {
 public:
  // declaration starts here, the name is below
  unsigned long long
      counter_;

  // the name is on the closing line of this declaration
  struct {
    unsigned bits : 1;
  } options;

  // declaration starts here, the name is below
  typedef unsigned long
      Handle;

  Handle take(Handle h) { return h; }
};

}  // namespace ns
