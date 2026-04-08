# Stage 1: Build
FROM rust:1.94-slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache dependencies — only re-downloaded when Cargo.toml/Cargo.lock change
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

# Build actual source
COPY src/ src/
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home cryptext

COPY --from=builder /build/target/release/cryptext-server /usr/local/bin/cryptext-server

USER cryptext

EXPOSE 8080

ENV HOST=0.0.0.0
ENV PORT=8080
ENV AWS_REGION=us-east-2
ENV SECRET_NAME=cryptext/server-config
ENV REDIS_URL=redis://redis:6379

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:8080/health || exit 1

CMD ["cryptext-server"]
