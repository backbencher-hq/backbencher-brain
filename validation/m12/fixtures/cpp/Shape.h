// validation/m12/fixtures/cpp/Shape.h
// M12.17 C++ positive fixture: namespace, abstract base class, derived
// class with virtual overrides, enum class, template class, smart-pointer
// members, using declaration, include guard.
#ifndef SHAPE_H
#define SHAPE_H

#include <string>
#include <memory>
#include "shape_config.h"

namespace geometry {

using Point = std::pair<double, double>;

enum class ShapeKind {
  CIRCLE = 0,
  RECTANGLE = 1,
  TRIANGLE = 2
};

class Shape {
public:
  virtual ~Shape() = default;
  virtual double area() const = 0;
  virtual std::string name() const = 0;
  virtual void scale(double factor) = 0;
};

class Circle : public Shape {
public:
  Circle(double radius);
  double area() const override;
  std::string name() const override;
  void scale(double factor) override;
private:
  double radius_;
};

template <typename T>
class Registry {
public:
  void add(const T &item);
  T find(int id) const;
private:
  std::vector<T> items_;
};

class Drawing {
public:
  Drawing();
  void addShape(std::shared_ptr<Shape> shape);
  double totalArea() const;
private:
  std::vector<std::shared_ptr<Shape>> shapes_;
};

} // namespace geometry

#endif // SHAPE_H
