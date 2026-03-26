FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 3001

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Migrate, conditionally seed, then start
CMD ["/app/start.sh"]
