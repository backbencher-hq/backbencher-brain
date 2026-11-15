// validation/m12/fixtures/go/service.go
// M12.22 Go positive fixture: package clause, imports, interface with methods,
// structs with fields (incl. struct tags), embedding (method promotion),
// methods with value and pointer receivers, constructor function, calls with
// leaf targets (incl. stdlib), field access, goroutine + defer spawns.
package service

import (
	"fmt"
	"strings"
)

// Repository is a data-access contract.
type Repository interface {
	Find(id string) (*User, error)
	Save(user *User) error
}

// BaseService holds shared state for services.
type BaseService struct {
	name  string
	count int
}

// Describe returns the receiver's name.
func (b *BaseService) Describe() string {
	return "BaseService:" + b.name
}

// User is a domain entity.
type User struct {
	ID   string
	Name string
}

// NewUser constructs a User (Go constructor convention).
func NewUser(id string, name string) *User {
	return &User{ID: id, Name: name}
}

// UserService embeds BaseService and implements Repository.
type UserService struct {
	BaseService
	users []*User
	repo  Repository
}

// Describe promotes the embedded BaseService name via embedding.
func (s *UserService) Describe() string {
	return "UserService:" + s.name
}

// Find returns a user by id.
func (s *UserService) Find(id string) (*User, error) {
	user := NewUser(id, "anon")
	s.users = append(s.users, user)
	return user, nil
}

// Save delegates to the injected repository.
func (s *UserService) Save(user *User) error {
	s.repo.Save(user)
	return nil
}

// transform uppercases each value using the stdlib strings package.
func transform(values []string) []string {
	var result []string
	for _, v := range values {
		result = append(result, strings.ToUpper(v))
	}
	return result
}

// launch spawns a goroutine and schedules deferred cleanup.
func launch() {
	go process()
	defer cleanup()
}

func process() {}
func cleanup() {}
