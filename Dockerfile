# Voice worker image for LiveKit Cloud Agents (`lk agent deploy`). The web app deploys on Vercel.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV HUSKY=0

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Bakes the VAD and turn-detector models into the image so calls don't wait on a download.
RUN npx tsx src/voice/worker.ts download-files

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/voice/worker.ts", "start"]
