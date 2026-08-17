FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY server/package.json server/pnpm-lock.yaml ./server/
RUN pnpm install --frozen-lockfile && pnpm --dir server install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    PRESET_STUDIO_WORKSPACE=/app/workspace-data \
    PRESET_STUDIO_STATIC_ROOT=/app/dist

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/node_modules ./server/node_modules
RUN mkdir -p /app/workspace-data && chown node:node /app/workspace-data

USER node

EXPOSE 3001
VOLUME ["/app/workspace-data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
