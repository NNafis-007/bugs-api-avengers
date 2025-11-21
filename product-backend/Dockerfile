FROM node:18-alpine
WORKDIR /app

# install deps
COPY package.json package-lock.json* ./
RUN npm install || true

# copy source
COPY src ./src

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "src/index.js"]
