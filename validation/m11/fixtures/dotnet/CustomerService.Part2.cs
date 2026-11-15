using System.Collections.Generic;
using System.Linq;

namespace Example.Domain;

public partial class CustomerService
{
    public IEnumerable<Customer> FindAll(CustomerFilter? filter = null)
    {
        return filter is null ? customers : customers.Where(customer => filter(customer));
    }
}
