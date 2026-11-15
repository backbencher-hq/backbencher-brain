using System.Collections.Generic;
using System.Threading.Tasks;
using Example.Base;

namespace Example.Service;

public class UserService : BaseService<UserService.User>, IRepository<UserService.User>
{
    private readonly Dictionary<string, User> store = new();

    public UserService()
    {
    }

    public override string Format(string value)
    {
        return prefix + ":" + value.Trim();
    }

    public override Task<User> Save(User value)
    {
        store[value.GetId()] = value;
        return Task.FromResult(value);
    }

    public User Find(string id)
    {
        return store[id];
    }

    public class User : BaseService.Entity
    {
        private readonly string id;
        private readonly string name;

        public User(string id, string name)
        {
            this.id = id;
            this.name = name;
        }

        public string GetId() { return id; }

        public string GetName() { return name; }
    }
}
