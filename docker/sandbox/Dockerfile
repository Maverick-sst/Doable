# Disposable verification sandbox. Non-root, no service account, no host
# mounts. The runtime restricts network egress with a Calico NetworkPolicy.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git tar \
  && rm -rf /var/lib/apt/lists/*

# Reuse the pinned Bun binary instead of downloading it at build time.
COPY --from=oven/bun:1.3.11-slim /usr/local/bin/bun /usr/local/bin/bun

RUN corepack enable \
  && mkdir -p /workspace /home/sandbox /opt/doable \
  && chown -R node:node /workspace /home/sandbox /opt/doable

COPY docker/sandbox/serve.mjs /opt/doable/serve.mjs
RUN chmod 0555 /opt/doable/serve.mjs

ENV HOME=/home/sandbox
USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
