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

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build \
    && chmod -R go-rX src \
    && chmod -R a+rX dist/server/assets/skills

ENV NODE_ENV=production
ENV PORT=3000
ENV AGENT_ROOM_DATA_DIR=/app/.agent-room

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "cd /app && bun run db:migrate && bun run bootstrap:root && bun run start"]
