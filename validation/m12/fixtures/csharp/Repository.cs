using System.Collections.Generic;
using System.Threading.Tasks;

namespace Example.Base;

public interface IRepository<T> where T : BaseService.Entity
{
    Task<T> Save(T value);
    List<T> FindAll();
}
