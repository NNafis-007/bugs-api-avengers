FROM node:18-alpine
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install || true

# Copy source code
COPY src ./src
COPY .env.example ./

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/index.js"]
