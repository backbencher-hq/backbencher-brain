#include <cstdio>
#include <cstring>

class Greeter {
public:
    Greeter(const char* prefix) {
        std::strncpy(prefix_, prefix, sizeof(prefix_) - 1);
    }

    void greet(const char* name, char* out, std::size_t out_size) const {
        std::snprintf(out, out_size, "%s, %s!", prefix_, name);
    }

private:
    char prefix_[32];
};

int main() {
    Greeter greeter("hello");
    char buffer[64];
    greeter.greet("world", buffer, sizeof(buffer));
    std::printf("%s\n", buffer);
    return 0;
}
