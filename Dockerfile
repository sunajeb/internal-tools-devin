FROM node:26.10.0-trixie-slim
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
  && npm install -g npm@11.20.0
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
