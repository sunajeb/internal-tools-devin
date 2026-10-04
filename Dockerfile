FROM node:22.23.3-bookworm-slim
ENV NODE_ENV=development
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY tools ./tools
COPY scripts ./scripts
COPY tsconfig.json tsconfig.base.json ./
RUN npm install --no-audit --no-fund
EXPOSE 3000 4000 5173
