#include <string>

struct Point
{
    Point(int x, int y)
        : x_(x)
        , y_(y)
    {
    }
    virtual ~Point() {}

    int sum() const { return x_ + y_; }

    // M60.P1: a field carries modifiers too, not only a method.
    static constexpr int kAxes = 2;

private:
    int x_;
    int y_;
};

class Shape : public Point
{
public:
    explicit Shape(double scale)
        : scale_(scale)
    {
    }

    // Trailing return type: the declaration's `type` field is `auto`, and `auto`
    // is a name that resolves to nothing. The declared return type is after `->`.
    auto label() const -> std::string;

    virtual double area() const = 0;

    // A defaulted parameter is an `optional_parameter_declaration`, a DIFFERENT
    // node type from a required one. The middle parameter's `&` and the third
    // parameter's default are both part of the payload.
    void configure(int mode, const std::string& name, double scale = 1.0);

    // A variadic `...` is a parameter with no name and no type. The family
    // parameter shape has no slot for it.
    void variadic(const char* format, ...);

    // `override` is a `virtual_specifier` in this grammar, a level below the
    // declaration — so it is not found by a scan of the declaration's own tokens.
    void onResize(int width, int height) override;

    void reset();

private:
    double scale_;
};
