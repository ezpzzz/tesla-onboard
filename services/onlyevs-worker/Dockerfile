FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY lib ./lib
COPY packages ./packages
COPY services/onlyevs-worker ./services/onlyevs-worker
USER node
CMD ["./node_modules/.bin/tsx", "services/onlyevs-worker/index.ts"]
