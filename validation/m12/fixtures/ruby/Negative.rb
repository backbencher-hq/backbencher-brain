class Noise
  def run(value)
    local = value
    puts local
    print local
    local.to_s
    super
    nil?
  end

  private :run
end
