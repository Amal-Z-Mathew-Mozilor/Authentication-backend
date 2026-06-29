# Login Middleware Feature Plan

## 1. Plan

### Objective
Implement a login middleware that performs pre-authentication checks before the login controller is executed.

### Scope

The middleware is responsible for:

- Creating an IP-based Redis counter if it does not exist.
- Validating the login email using Express Validator.
- Checking the validation result.
- Checking whether the IP has exceeded the maximum allowed login attempts.
- Passing the request to the login controller if all checks succeed.

The middleware is **not** responsible for:

- Password verification.
- User authentication.
- JWT generation.
- Database account locking.

These responsibilities are handled by the login controller.

---

## 2. Specification

### Purpose

The login middleware performs pre-authentication checks before the login controller executes.

### Functional Requirements

- Obtain the client's IP address from the incoming request.
- Create a Redis counter for the IP if one does not already exist.
- Set the Redis key to expire after 15 minutes.
- Validate the login email using Express Validator.
- Return a validation error if the email is invalid.
- Check the Redis counter.
- Reject the request if the IP has reached the maximum number of failed login attempts.
- Otherwise, pass control to the login controller.

### Redis Configuration

- **Key Format:** `login:ip:<client_ip>`
- **Value:** Number of failed login attempts.
- **Expiration (TTL):** 15 minutes.
- **Maximum Attempts:** 5.

---

## 3. Design Notes

### Middleware Responsibilities

- Create a Redis IP counter if one does not exist.
- Perform login email validation using Express Validator.
- Check validation results.
- Verify whether the Redis IP counter has exceeded the configured limit.
- Forward the request to the login controller when all checks pass.

### Controller Responsibilities

- Retrieve the user from the database.
- Verify the user's password.
- Increment the Redis IP counter on failed authentication.
- Increment the database failed login attempt counter.
- Lock the account when the configured threshold is reached.
- Reset the Redis and database counters after a successful login.
- Generate and return authentication tokens.

### Design Rationale

Password verification requires access to the user's stored password hash in the database. Therefore, password verification and authentication logic belong in the login controller, while the middleware is limited to request validation and IP-based rate limiting.

---

## 4. AI Prompts

### Prompt 1

Design a login middleware for a Node.js and Express application that creates a Redis IP counter if one does not exist, validates the login email using Express Validator, checks the validation result, verifies whether the IP has exceeded the configured login attempt limit, and forwards the request to the login controller if all checks pass.

### Prompt 2

Explain how to manually execute Express Validator validation chains inside a middleware using `validator.run(req)` before calling `validationResult(req)`.

### Prompt 3

Design the middleware so that it is responsible only for Redis IP counter creation, email validation, and IP rate-limit checking, while password verification and authentication remain in the login controller.

---

## 5. Supporting Documentation

### Middleware Flow

```text
Client
   │
   ▼
Login Middleware
   │
   ├── Get client IP
   ├── Create Redis IP counter (if it does not exist)
   ├── Run login email validation
   ├── Check validationResult()
   ├── Read Redis IP counter
   ├── Verify IP attempt limit
   └── next()
          │
          ▼
   Login Controller
```

### Redis Configuration Example

```
Key:
login:ip:192.168.1.20

Value:
3

TTL:
900 seconds (15 minutes)
```

### Expected Behaviour

- Create a Redis IP counter if one does not already exist.
- Set the Redis IP counter to expire after 15 minutes.
- Validate the login email using Express Validator.
- Return a validation error if the email format is invalid.
- Check the current Redis IP counter value.
- Reject the request if the IP has exceeded the configured maximum number of login attempts.
- Pass control to the login controller if all middleware checks succeed.
