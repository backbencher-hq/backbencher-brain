class Service {
public:
    void handle(int x) {
        if (x > 0) {
            log(x);
            db.save(x);
        }
    }
};

// F6 coverage (2026-09-02): for/while/do/case control flow, catch_clause,
// conditional_expression, delete_expression, alias_declaration (using),
// type_definition, auto, lambda_expression, namespace_definition,
// struct/union/enum specifiers, declaration, enumerator,
// template_declaration, field_initializer, operator_cast, operator_name —
// declared handled_verified, now exercised.
namespace f6detail
{
    template <typename T>
    struct Holder
    {
        T value;
        Holder(T v) : value(v) {}
        ~Holder() { delete &value; }
    };

    union Blob
    {
        int asInt;
        double asDouble;
    };

    enum class Mode
    {
        Idle,
        Busy
    };
}

using f6HolderInt = f6detail::Holder<int>;
typedef unsigned long f6Word;

class f6Gadget
{
public:
    f6Gadget() : counter_(0) {}
    explicit f6Gadget(int start) : counter_(start) {}

    f6Gadget &operator++()
    {
        ++counter_;
        return *this;
    }

    operator int() const { return counter_; }

    void spin()
    {
        using f6detail::Blob; // F6: using_declaration (using-declarator)
    label_spin: // F6: statement_identifier (labeled statement)
        for (int i = 0; i < 3; ++i)
        {
            counter_ += i;
            if (counter_ > 100)
            {
                goto label_spin;
            }
        }
        while (counter_ > 10)
        {
            counter_ /= 2;
        }
        do
        {
            counter_ -= 1;
        } while (counter_ > 5);
        switch (counter_)
        {
        case 0:
            counter_ = 1;
            break;
        default:
            break;
        }
        auto probe = counter_ > 2 ? 10 : 20;
        auto lam = [this](int delta)
        { counter_ += delta; };
        lam(probe);
        try
        {
            throw std::runtime_error("x");
        }
        catch (const std::exception &e)
        {
            counter_ += 1;
        }
        int *raw = new int(3);
        delete raw;
    }

private:
    int counter_;
};
