trait Logging { self: Service =>
  def log(): Unit = ()
}

class Service
