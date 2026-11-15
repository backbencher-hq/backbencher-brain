//
// D13/D1 — a friend body's OWNER must be a scope the walk published, never
// recovery text.
//
// CONTROL 1 comes FIRST on purpose: the recovery shape below swallows whatever
// `namespace …` follows it, so a control written after the bare macro would be
// damaged too and would pin the wrong thing.
//
// CONTROL 1 — a namespace the grammar parses NORMALLY. The friend body's owner
// must be the namespace that was published, NOT `global`: a rule that answered
// `global` everywhere would fail this half.
//
namespace clean_ns {
class widget
{
    int size_ = 0;

    friend bool operator!=(widget lhs, widget rhs)
    {
        return lhs.size_ != rhs.size_;
    }
};
} // namespace clean_ns

//
// The measured shape, taken from
// `include/nlohmann/detail/iterators/primitive_iterator.hpp`: the bare
// `NLOHMANN_JSON_NAMESPACE_BEGIN` before a namespace head makes the grammar
// swallow the macro AND the head into a single `function_definition` whose
// declarator TEXT is the two words `namespace detail`. A walk that re-derives a
// scope name from node fields then publishes `uses namespace detail -> m_it` — a
// source that is a symbol in no translation unit, which no store can resolve and
// no consumer can tell from a real one. There is deliberately no `#define` here:
// the recovery is the trigger, and truthfulness must not depend on the macro
// being defined.
//
NLOHMANN_JSON_NAMESPACE_BEGIN
namespace detail {
class primitive_iterator_t
{
    int m_it = 0;

    friend bool operator==(primitive_iterator_t lhs, primitive_iterator_t rhs)
    {
        return lhs.m_it == rhs.m_it;
    }
};
} // namespace detail
NLOHMANN_JSON_NAMESPACE_END

//
// CONTROL 2 — template parameters. `new T()` inside `template <typename T>`
// constructs a TYPE PARAMETER, so it is not an instantiation of any class, while
// `new gadget()` in the same file IS one. A guard that dropped every `new` inside
// a template would fail the positive half; one that never looked would fail the
// negative half.
//
struct gadget
{
    gadget();
};

template <typename T>
T* manufactured()
{
    return new T();
}

gadget* make_gadget()
{
    return new gadget();
}
