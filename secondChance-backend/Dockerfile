FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node . .

USER node
EXPOSE 3060
CMD ["node", "app.js"]
