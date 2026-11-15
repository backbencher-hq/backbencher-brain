module Loggable
  def log(message)
    puts "[#{self.class}] #{message}"
  end
end

class BaseService
  attr_reader :store

  def initialize(store)
    @store = store
  end

  def format(value)
    value.strip
  end
end

class User
  attr_accessor :id, :name

  def initialize(id:, name:)
    @id = id
    @name = name
  end
end
