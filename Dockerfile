FROM oven/bun:1.3.9

ARG TARGETARCH
ARG OPENCLAW_VERSION=2026.4.22

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl expect git gnupg tini \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH}" in \
        amd64) dbmate_arch="amd64" ;; \
        arm64) dbmate_arch="arm64" ;; \
        *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/amacneil/dbmate/releases/download/v2.28.0/dbmate-linux-${dbmate_arch}" -o /usr/local/bin/dbmate \
    && chmod +x /usr/local/bin/dbmate

RUN npm install --global "openclaw@${OPENCLAW_VERSION}"

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=postgres://agent_room:agent_room@postgres:5432/agent_room?sslmode=disable
ENV AGENT_ROOM_DATA_DIR=/app/.agent-room

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "cd /app && dbmate --url \"$DATABASE_URL\" --migrations-dir /app/db/migrations up && bun run bootstrap:root && bun run start"]
