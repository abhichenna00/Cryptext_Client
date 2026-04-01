# Stage 1: Build
FROM rust:1.86-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY src/ src/

RUN cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home cryptext

COPY --from=builder /build/target/release/cryptext-server /usr/local/bin/cryptext-server

USER cryptext

EXPOSE 8080

ENV HOST=0.0.0.0
ENV PORT=8080
ENV AWS_REGION=us-east-2
ENV SECRET_NAME=cryptext/server-config

CMD ["cryptext-server"]
