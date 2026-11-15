using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Example.Domain;

public partial class CustomerService : ICustomerService
{
    private readonly List<Customer> customers = new();
    public event EventHandler<Customer>? CustomerCreated;

    public CustomerService() { }
    public CustomerService(IEnumerable<Customer> seed) { customers.AddRange(seed); }

    public Customer Get(int id) => customers.First(c => c.Id == id);
    public Task<Customer> GetAsync(int id) => Task.FromResult(Get(id));
    public void Add(Customer customer) { customers.Add(customer); CustomerCreated?.Invoke(this, customer); }
}

public interface ICustomerService
{
    Customer Get(int id);
    void Add(Customer customer);
}

public record Customer(int Id, string Name)
{
    public string DisplayName => $"{Id}:{Name}";
}

public delegate bool CustomerFilter(Customer customer);

public static class CustomerExtensions
{
    public static IEnumerable<Customer> Filter(this IEnumerable<Customer> source, CustomerFilter filter) => source.Where(customer => filter(customer));
}
