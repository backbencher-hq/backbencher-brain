// D2 (#958): a base whose cleaned leaf equals the derived class's own name has
// LOST the evidence that told them apart, and an edge built on lost evidence is
// not a weaker edge — it is no edge.
//
// Two real shapes, both measured on the corpora, both of which cleaned to
// themselves and were published as `X extends X`:
//
//   template <unsigned N> struct priority_tag : priority_tag<N - 1> {};
//   //  a different INSTANTIATION of the same template
//
//   namespace nlohmann { namespace detail {
//     template <typename T> struct char_traits : std::char_traits<T> {};
//   }}
//   //  a DIFFERENT CLASS, in std — the qualifier is the whole information
//   //  content of a C++ inheritance edge, and the leaf clean discarded it
//
// The second is the worse one: the inheritance is real and the edge said the
// class inherits from itself.
//
// 49 such edges over 1,722 real C++ files. The override resolver already refused
// these bases with exactly this reasoning (`if (base === startCls) continue`);
// the EDGE they were derived from did not. One rule, two sites, one of them had it.

#include <type_traits>

// D2a: the recursive-instantiation idiom. A different instantiation, cleaned to
// the same name.
template <unsigned N>
struct priority_tag : priority_tag<N - 1> {};

template <>
struct priority_tag<0> {};

// D2b: a real inheritance from another namespace, destroyed by the leaf clean.
namespace vendor {
template <typename T>
struct char_traits : std::char_traits<T> {
    static const char* name() { return "vendor::char_traits"; }
};
}

// D2c: a QUALIFIED templated base (CPPD4) whose leaf is the class's own name —
// `typeid` is in the standard library, not in this file, so there is nothing to
// inherit from here.
class proxy : public ::vendor::char_traits<char> {
public:
    const char* label() const { return char_traits<char>::name(); }
};

// D2d: the CONTROL. Distinct names must keep a real extends edge, including a
// qualified one and a templated one. A gate that swallowed every base would pass
// the forbids above and lose all of these.
namespace lib {
class Shape { public: virtual ~Shape() = default; virtual double area() const = 0; };
template <typename T> class Vec2 { public: double x{}, y{}; };
}

class Circle : public lib::Shape {
public:
    double area() const override { return 3.14; }
};

class Box : public lib::Shape {
public:
    double area() const override { return 1.0; }
};

class Poly : public lib::Vec2<double> {
public:
    double area() const { return x * y; }
};

// D2e: a multi-base clause, where one base is REAL (a different class that
// happens to share the `priority_tag` name) and the point of the case is that the
// gate compares against the DERIVED name only. `Mixed -> priority_tag` is correct
// and pinned; what is refused is `priority_tag -> priority_tag` above.
class Mixed : public lib::Shape, public priority_tag<2> {
public:
    double area() const override { return 2.0; }
};

double use_all(Circle c, Box b, Poly p, Mixed m) {
    return c.area() + b.area() + p.area() + m.area();
}
