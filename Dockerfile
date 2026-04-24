FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /var/lib/niyam && chown -R node:node /app /var/lib/niyam

ENV NODE_ENV=production
ENV NIYAM_PORT=3000
ENV NIYAM_DATA_DIR=/var/lib/niyam

EXPOSE 3000

USER node

CMD ["node", "server.js"]
