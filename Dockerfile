FROM oven/bun:1.3.13

ARG TARGETARCH

WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash \
        bzip2 \
        ca-certificates \
        curl \
        file \
        fonts-dejavu \
        gh \
        ghostscript \
        git \
        jq \
        less \
        libreoffice \
        make \
        openssh-client \
        pandoc \
        passwd \
        patch \
        poppler-utils \
        python3 \
        python3-pip \
        python3-venv \
        qpdf \
        ripgrep \
        rsync \
        sqlite3 \
        tini \
        tree \
        unzip \
        util-linux \
        xz-utils \
        zip \
        zstd \
    && ln -sf /usr/bin/python3 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH}" in \
        amd64) dbmate_arch="amd64" ;; \
        arm64) dbmate_arch="arm64" ;; \
        *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/amacneil/dbmate/releases/download/v2.28.0/dbmate-linux-${dbmate_arch}" -o /usr/local/bin/dbmate \
    && chmod +x /usr/local/bin/dbmate

COPY package.json bun.lock turbo.json ./
COPY apps/self-hosted/package.json apps/self-hosted/package.json
COPY apps/marketing/package.json apps/marketing/package.json
COPY packages/brand/package.json packages/brand/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN bun install --frozen-lockfile

COPY . .
RUN bun run brand:export:marketing \
    && bun run marketing:build \
    && bun run self-hosted:build \
    && chmod -R go-rX apps/self-hosted/src \
    && chmod -R a+rX apps/self-hosted/dist/server/assets/skills

ENV NODE_ENV=production
ENV PORT=3000
ENV AGENT_ROOM_DATA_DIR=/app/.agent-room

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "cd /app && bun run db:migrate && bun run bootstrap:root && bun run start"]
