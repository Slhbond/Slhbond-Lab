FROM node:24-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy app files
COPY server.js ./
COPY config.js ./
COPY lib/ ./lib/
COPY views/ ./views/
COPY public/ ./public/

# Posts directory will be mounted as a volume
RUN mkdir -p /app/posts

EXPOSE 3000

CMD ["node", "server.js"]
