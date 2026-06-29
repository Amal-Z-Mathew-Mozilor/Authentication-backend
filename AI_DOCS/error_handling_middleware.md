# Global Error Handling Middleware

## 1. Plan

### Objective

Implement a centralized global error-handling middleware for the Express application to provide consistent JSON error responses for all application errors.

### Goals

- Capture errors thrown from controllers and middleware.
- Handle errors forwarded through `next(err)`.
- Return standardized JSON responses.
- Use custom status codes provided by the `ApiError` class.
- Return a default `500 Internal Server Error` for unexpected errors.
- Prevent Express's default HTML error response.

---

## 2. Specification

### Feature

Global Express Error-Handling Middleware

### Middleware Signature

```javascript
(err, req, res, next)
```

### Input

The middleware receives an error object forwarded using:

```javascript
throw new ApiError(...);
```

or

```javascript
next(error);
```

through the application's `asyncHandler`.

### Status Code Logic

- Use `err.statuscode` when available.
- Otherwise return `500 Internal Server Error`.

### Response Format

```json
{
    "success": false,
    "message": "Error message",
    "errors": []
}
```

### Error Sources

The middleware should handle errors originating from:

- Authentication middleware
- Authorization middleware
- Validation middleware
- Controllers
- Database operations
- JWT verification
- Password reset
- Password change
- Refresh token rotation
- Login and logout operations
- Any unexpected server-side exception

---

## 3. Design Notes

### Error Flow

```
Controller / Middleware
        │
        ▼
throw new ApiError(...)
        │
        ▼
asyncHandler
        │
        ▼
next(error)
        │
        ▼
Express
        │
        ▼
Global Error Middleware
        │
        ▼
Read err.statuscode
        │
        ▼
res.status(status).json(...)
```

### Responsibilities

The middleware is responsible for:

- Receiving the error object from Express.
- Reading `err.statuscode`.
- Returning a standardized JSON response.
- Falling back to HTTP 500 when a custom status code is unavailable.
- Preventing Express's default HTML error page.

### Responsibilities Outside This Middleware

The middleware should **not** perform:

- Authentication
- Authorization
- Validation
- Business logic
- Database operations
- Password hashing
- JWT generation or verification

These components should simply throw an `ApiError` or forward an error using `next(err)`.

---

## 4. AI Prompts

### Prompt 1

Design a centralized Express error-handling middleware that catches all errors thrown from asynchronous controllers wrapped with an `asyncHandler` and returns standardized JSON responses.

### Prompt 2

Explain how Express propagates errors from `throw new ApiError(...)` through `asyncHandler`, `next(err)`, and finally into the global error-handling middleware.

### Prompt 3

Design an error middleware that reads the custom `statuscode` property from the `ApiError` class and falls back to HTTP 500 for unexpected errors.

### Prompt 4

Provide a standardized JSON error response format suitable for authentication, validation, authorization, and unexpected server errors.

---

## 5. Supporting Documentation

### Error Response Structure

```json
{
    "success": false,
    "message": "Invalid credentials",
    "errors": []
}
```

### Example Flow

```
Client Request
      │
      ▼
Controller
      │
      ▼
throw new ApiError(...)
      │
      ▼
asyncHandler
      │
      ▼
next(error)
      │
      ▼
Express Error Pipeline
      │
      ▼
Global Error Middleware
      │
      ▼
Read err.statuscode
      │
      ▼
res.status(status).json(...)
      │
      ▼
Client receives JSON error response
```

### HTTP Status Codes

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Resource Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

### Integration

The middleware should be registered **after all application routes**.

Example:

```javascript
app.use(errorHandler);
```

### Dependencies

- Express
- Custom `ApiError` class
- `asyncHandler`

### Benefits

- Centralized error handling.
- Consistent JSON responses across the application.
- Simplified controller logic through `throw new ApiError(...)`.
- Automatic handling of asynchronous errors forwarded through `next(err)`.
- Improved maintainability and debugging.
- Prevention of Express's default HTML error responses.