// D4 (#960): a symbol was published under the source's TYPE, because a macro
// access-specifier label is legal C++ with no node type, and the grammar's ERROR
// recovery displaced the declarator onto the type.
//
// nlohmann-json/include/nlohmann/detail/iterators/primitive_iterator.hpp:36
//
//   JSON_PRIVATE_UNLESS_TESTED:            <- a MACRO used as an access label
//     /// iterator as signed integer type
//     difference_type m_it = (…min)();     <- the REAL declaration
//
// which the grammar reads as:
//
//   field_declaration [ERR] [type=type_identifier(LABEL), ERROR(":"), comment,
//                    declarator=field_identifier(difference_type),
//                    ERROR(identifier(m_it)), "=", init, ";"]
//
// The analyzer read the `declarator` field faithfully and published a `property`
// named `difference_type` — a name that is a TYPE, colliding with the real
// `using difference_type = …;` alias in the same class, which is what produced a
// duplicate `contains` edge (D3) — while the declaration that actually exists,
// `m_it`, was ABSENT from the graph entirely. The two defects hid each other: the
// fabricated symbol and the real one were indistinguishable.
//
// 10 sites over 1,722 real C++ files; 5 of them this exact shape.
//
// THE COMMENT IS LOAD-BEARING. Without a comment between the label and the
// declaration the grammar recovers correctly and the analyzer published `m_it` —
// which is why this went unnoticed for as long as it did. The first two classes
// below pin both readings so a future change cannot quietly lose either.

#include <cstddef>
#include <limits>

// D4a: the shape. The recovered name is `count_`, and the alias `distance_type`
// is a real declaration in the same class that must keep its own name.
class Counted {
private:
    using distance_type = std::ptrdiff_t;
    static constexpr distance_type begin_value = 0;

  COUNTED_PRIVATE_LABEL:
    /// the declared name, which the recovery displaced
    distance_type count_ = 0;

public:
    constexpr distance_type value() const noexcept { return count_; }
    void set(distance_type v) noexcept { count_ = v; }
};

// D4b: THE CONTROL. The same class WITHOUT the comment between the label and the
// declaration. The grammar recovers correctly here, so `plain_` must be published
// under its own name — and NOT under the type. This is what the fixture pins that
// a blanket "never trust a declarator after a macro label" rule would lose.
class Plain {
private:
    using distance_type = std::ptrdiff_t;
    static constexpr distance_type begin_value = 0;

  PLAIN_PRIVATE_LABEL:
    distance_type plain_ = 0;

public:
    constexpr distance_type value() const noexcept { return plain_; }
};

// D4c: a macro between the DECLARATION-SPECIFIER and the name, which is the
// shape CPPD17/CPPD18 fixed for the function branch. The name must still be read
// down the declarator chain.
class Wrapped {
private:
    using difference_type = std::ptrdiff_t;
    WRAPPED_ACCESS:
    /// a comment here too
    difference_type wrapped_ = (std::numeric_limits<std::ptrdiff_t>::min)();

public:
    constexpr difference_type value() const noexcept { return wrapped_; }
};

int use_all(Counted c, Plain p, Wrapped w) {
    return (int)(c.value() + p.value() + w.value());
}
