FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node index.js ./
COPY --chown=node:node build ./build

USER node
EXPOSE 9000
CMD ["node", "index.js"]
