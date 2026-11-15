// M60/#924 — the cpp row's second name-surface class, reconstructed from the
// real sites (fmt/include/fmt/os.h:122, nlohmann-json/include/nlohmann/json.hpp:5263,
// nlohmann-json/include/nlohmann/detail/input/input_adapters.hpp:464,
// fmt/test/gtest/gmock/gmock.h:391, fmt/test/gtest/gtest/gtest.h:498).
//
// When a macro stands where the return type begins, the cpp grammar cannot place
// the type and rejoins it to the declarator as extra qualifier segments separated
// by WHITESPACE ONLY — the `::` separator slot carries empty text. The old name
// read published `system_error vwindows_error` (a name no consumer can resolve)
// and took `system_error` as the OWNER (a class that does not exist).
#define FMT_API
#define MTPL_DECL
#define GTEST_API_

namespace json_literals {

// (1) macro prefix + two-segment return type: the real os.h site.
FMT_API std::system_error vwindows_error(int error_code, const char* fmt);

// (2) the same glue across a line break, as a DEFINITION (json.hpp:5263).
MTPL_DECL
std::string to_string(const json& j)
{
    return j.dump();
}

// (3) the macro stands between a single-segment type and the name
//     (input_adapters.hpp:464, gtest.h:498).
GTEST_API_ std::size_t get_elements(void* dest, std::size_t count);
GTEST_API_ TimeInMillis GetTimeInMillis();

// (4) a genuine qualified declarator: the join IS a `::` token, so the owner is
//     real and must survive the fix with a bare name.
struct SocketWriter
{
    void MakeConnection(int fd);
};

void SocketWriter::MakeConnection(int fd) {}

namespace Sub
{
void method(int a);
}

void Sub::method(int a) {}

// (5) an operator's spelling carries a space by language rule — kept as written.
FMT_API std::ostream& operator<<(std::ostream& os, int v) { return os; }

} // namespace json_literals
