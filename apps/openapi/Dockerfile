FROM orbiter/clients:latest AS builder

# ARG NODE_ENV
ARG BUILD_FLAG
WORKDIR /app
COPY . .
RUN npx nx run openapi:build ${BUILD_FLAG}

FROM orbiter/clients:latest

WORKDIR /app
COPY --from=builder app/package.json ./
COPY --from=builder app/dist/apps/openapi ./
# ENV NODE_ENV=$NODE_ENV
CMD [ "node", "main.js" ]
