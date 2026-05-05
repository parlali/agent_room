FROM oven/bun:1.3.9

ARG TARGETARCH

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl fonts-dejavu git libreoffice poppler-utils tini \
    && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH}" in \
        amd64) dbmate_arch="amd64" ;; \
        arm64) dbmate_arch="arm64" ;; \
        *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/amacneil/dbmate/releases/download/v2.28.0/dbmate-linux-${dbmate_arch}" -o /usr/local/bin/dbmate \
    && chmod +x /usr/local/bin/dbmate

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

ENV NODE_ENV=production
ENV PORT=3000
ENV AGENT_ROOM_DATA_DIR=/app/.agent-room

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "cd /app && bun run db:migrate && bun run bootstrap:root && bun run start"]
