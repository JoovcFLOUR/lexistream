# ADR-0005: Modular Monolithic Rust Backend with Axum, SQLx, and Pure-Rust TLS

**Date**: 2026-11-15
**Status**: accepted
**Deciders**: Core Engineering

## Context

The backend handles user authentication, versioned delta synchronization, GDPR account deletion, and server-side translation API proxying (keeping provider keys off client devices). Host inspection showed an ARM64 Linux environment without `libssl-dev` OpenSSL C headers.

## Decision

We implement `apps/api` as a single **modular monolithic Rust binary** using `axum`, `tokio`, `sqlx` (`runtime-tokio-rustls`), `argon2`, and `PostgreSQL 16`, without Redis, message brokers, or microservices.

## Alternatives Considered

### Alternative 1: Microservices + Redis + Message Queue
- **Pros**: Independent horizontal scaling per service at massive scale.
- **Cons**: Multiplies operational complexity, network serialization hops, and idle container RAM by 4–6×.
- **Why not**: A single Axum + PostgreSQL monolith handles thousands of concurrent delta-sync and translation requests per second inside tens of megabytes of RAM.

### Alternative 2: OpenSSL (`native-tls`) Dependencies
- **Pros**: System TLS linkage on desktops with `libssl-dev`.
- **Cons**: Fails to compile on minimal Linux / ARM64 hosts lacking C OpenSSL development headers and complicates cross-compilation.
- **Why not**: Pure-Rust `rustls` (`runtime-tokio-rustls` and `reqwest` `rustls-tls`) compiles cleanly everywhere with memory-safe TLS.

## Consequences

### Positive
- Zero external infrastructure dependencies beyond PostgreSQL (`postgres:16-alpine` tuned to `32 MB` `shared_buffers`).
- Compile-time memory safety, Argon2id password hashing, parameterized SQL queries, and deterministic sub-millisecond routing.

### Negative
- In-process token-bucket rate limiting (`RateLimiter`) is per-instance; if horizontally scaled behind a load balancer in the future, sticky routing or shared rate-limit state would be introduced then.
