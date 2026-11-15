defmodule FakeOtp do
  use MyApp.SupervisorTree
  use MyApp.GenServerPool
end
