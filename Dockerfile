# syntax=docker/dockerfile:1
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Install dependencies (only production)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Set proper non-root ownership
RUN chown -R node:node /usr/src/app

# Run as non-root user
USER node

# Expose API port
EXPOSE 5000

# Set production environment variable
ENV NODE_ENV=production
ENV PORT=5000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health/live || exit 1

# Start production server
CMD ["node", "server.js"]
