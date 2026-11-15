// validation/m12/fixtures/cpp/Shape.cpp
// M12.17 C++ positive fixture: qualified definitions, method calls, field
// access, smart-pointer usage, template definitions.
#include "Shape.h"
#include <cmath>

namespace geometry {

Circle::Circle(double radius) : radius_(radius) {}

double Circle::area() const {
  return 3.14159 * radius_ * radius_;
}

std::string Circle::name() const {
  return "circle";
}

void Circle::scale(double factor) {
  radius_ = radius_ * factor;
}

template <typename T>
void Registry<T>::add(const T &item) {
  items_.push_back(item);
}

template <typename T>
T Registry<T>::find(int id) const {
  return items_.at(id);
}

Drawing::Drawing() {}

void Drawing::addShape(std::shared_ptr<Shape> shape) {
  shapes_.push_back(shape);
}

double Drawing::totalArea() const {
  double total = 0.0;
  for (const auto &shape : shapes_) {
    total += shape->area();
  }
  return total;
}

} // namespace geometry
