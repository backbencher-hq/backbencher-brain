class Calculator
  def initialize
    @total = 0
  end

  def add(value)
    @total += value
  end

  def total
    @total
  end
end

def square(x)
  x * x
end
