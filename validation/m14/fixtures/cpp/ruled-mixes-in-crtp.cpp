// THE CLOSEST C++ CONSTRUCT TO `mixes_in`, MEASURED — AND WHY IT IS NOT THE VALUE.
//
// The canonical contract (src/ast/types.ts, MixesIn): "A class COMPOSES a mixin into its supertype
// chain", measured on Dart's `class C with M`. C++ has exactly ONE construct for supertype
// composition — the base-clause of a class head — and every entry in it declares a BASE CLASS: the
// type relation is inheritance (is-a), including for the CRTP idiom that C++ programmers call a
// mixin (`class Widget : public Mixin<Widget>`). There is no `with`-list construct that composes
// behavior WITHOUT declaring a base, so the honest value for these rows is `extends`. The near-miss
// is real and large (the coverage instrument counts base clauses, multi-base clauses and CRTP bases
// on the whole corpus); its classification is the language's, not the lane's.
template <typename Derived>
class Mixin {
public:
  void tick() { static_cast<Derived*>(this)->onTick(); }
};

struct Widget : public Mixin<Widget> {
  void onTick() {}
};

struct Button { };

struct Fancy : public Mixin<Fancy>, public Button {
  void onTick() {}
};
