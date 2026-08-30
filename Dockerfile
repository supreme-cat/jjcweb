# Use the official Node.js LTS lightweight Alpine image
FROM node:20-alpine

# Create and set the working directory
WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy the rest of the application files
COPY . .

# Expose the default application port
EXPOSE 2211

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=2211

# Start the Node.js server
CMD ["npm", "start"]