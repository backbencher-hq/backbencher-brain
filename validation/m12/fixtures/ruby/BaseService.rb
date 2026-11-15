class BaseService
  def initialize(store)
    @store = store
  end

  def save(record)
    persist(record)
  end
end
