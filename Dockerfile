FROM node:22-alpine

WORKDIR /app

# Install deps first (better layer caching — only re-runs when package files change)
COPY package*.json ./
RUN npm install

# Copy the rest of the source
COPY . .

EXPOSE 8000

CMD ["node", "src/app.js"]
