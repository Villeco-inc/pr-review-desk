FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y curl ca-certificates gnupg dirmngr build-essential python3 git \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install gh -y \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/shared ./shared
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG DESK_COMMIT=inconnue
ENV DESK_COMMIT=$DESK_COMMIT

EXPOSE 3100
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/dist/server/src/index.js"]
