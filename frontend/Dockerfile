# Development Dockerfile for Shizuha Home Frontend
FROM node:20-alpine

WORKDIR /app

# Create packages directory for shared dependencies
RUN mkdir -p /packages

# Install dependencies
COPY package*.json ./
RUN npm install --ignore-scripts || true

# Copy source code
COPY . .

# Expose Vite dev server port
EXPOSE 5180

# Start development server
CMD ["npm", "run", "dev"]
