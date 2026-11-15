class Application
  def options
    @options
  end

  def configure
    options.backtrace = true
    options.trace = false
  end

  def destructure(pair)
    first, second = pair
    first
    second
  end
end
