package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	restate "github.com/restatedev/sdk-go"
	"github.com/restatedev/sdk-go/server"
)

type User struct {
	Name     string `json:"name"`
	Surname  string `json:"surname"`
	Password string `json:"password"`
}

type NewUser struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Surname  string `json:"surname"`
	Password string `json:"password"`
}

type SignupAccepted struct {
	Username     string `json:"username"`
	InvocationID string `json:"invocationId"`
	Message      string `json:"message"`
}

type userObject struct{}

func (u *userObject) ServiceName() string { return "User" }

func (u *userObject) Initialize(ctx restate.ObjectContext, user User) error {
	existingUser, err := restate.Get[*User](ctx, "user")
	if err != nil {
		return err
	}
	if existingUser != nil {
		return restate.TerminalError(fmt.Errorf("user is already initialized"))
	}

	restate.Set(ctx, "user", user)
	restate.Set(ctx, "activated", false)

	return nil
}

func (u *userObject) Activate(ctx restate.ObjectContext) error {
	existingUser, err := restate.Get[*User](ctx, "user")
	if err != nil {
		return err
	}
	if existingUser == nil {
		return restate.TerminalError(fmt.Errorf("user does not exist"))
	}

	restate.Set(ctx, "activated", true)

	return nil
}

func (u *userObject) Get(ctx restate.ObjectSharedContext) (User, error) {
	return restate.Get[User](ctx, "user")
}

type signupService struct{}

func (s *signupService) ServiceName() string { return "Signup" }

func (s *signupService) Signup(ctx restate.Context, newUser NewUser) (SignupAccepted, error) {
	invocationID := restate.ServiceSend(ctx, "Signup", "RunSignup").
		Send(newUser, restate.WithIdempotencyKey("signup-"+newUser.Username)).
		GetInvocationId()

	return SignupAccepted{
		Username:     newUser.Username,
		InvocationID: invocationID,
		Message:      "signup accepted; waiting for activation event",
	}, nil
}

func (s *signupService) RunSignup(ctx restate.Context, newUser NewUser) (string, error) {
	user := User{
		Name:     newUser.Name,
		Surname:  newUser.Surname,
		Password: newUser.Password,
	}

	_, err := restate.Object[restate.Void](ctx, "User", newUser.Username, "Initialize").Request(user)
	if err != nil {
		return "", err
	}

	activation := restate.Awakeable[restate.Void](ctx)

	_, err = restate.Run(ctx, func(ctx restate.RunContext) (restate.Void, error) {
		sendActivationEmail(ctx.Log(), newUser.Username, activation.Id())
		return restate.Void{}, nil
	})
	if err != nil {
		return "", err
	}

	_, err = activation.Result()
	if err != nil {
		return "", err
	}

	_, err = restate.Run(ctx, func(ctx restate.RunContext) (restate.Void, error) {
		ctx.Log().Info("activation event received", "username", newUser.Username)
		return restate.Void{}, nil
	})
	if err != nil {
		return "", err
	}

	_, err = restate.Object[restate.Void](ctx, "User", newUser.Username, "Activate").Request(restate.Void{})
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("user %q is signed up and activated", newUser.Username), nil
}

func sendActivationEmail(log *slog.Logger, username string, awakeableID string) {
	log.Info(
		"activation email requested",
		"username", username,
		"resolve_with", fmt.Sprintf("curl -X POST http://localhost:8080/restate/awakeables/%s/resolve", awakeableID),
	)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9080"
	}

	if err := server.NewRestate().
		Bind(restate.Reflect(&userObject{})).
		Bind(restate.Reflect(&signupService{})).
		Start(context.Background(), ":"+port); err != nil {
		slog.Error("application exited unexpectedly", "err", err)
		os.Exit(1)
	}
}
