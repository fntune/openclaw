FROM node:22-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm install tsx
COPY . .

EXPOSE 3001
CMD ["npx", "tsx", "index.ts"]
