# --- Stage 1: Builder ---
# Full Node.js environment to install dependencies and build the Vite app
# Nothing from this stage goes into the final image except the built dist/ folder
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
# npm ci is cached until package.json or package-lock.json changes
# A change in src/ does not re-trigger npm ci
COPY package.json package-lock.json* ./
RUN npm ci

# Copy remaining source files
COPY . .

# VITE_API_URL is required at build time
# Vite bakes environment variables into the static bundle during build
# This is not a runtime variable - it is embedded in the JS files
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# VITE_COMMIT_HASH is computed on the host where .git actually exists
# (the EC2 deploy script, or your local machine) and passed in here.
# vite.config.js cannot reliably compute this itself inside the build:
# node:24-alpine has no git binary installed, and this build context
# (./frontend) does not include the repo's .git folder one level up.
ARG VITE_COMMIT_HASH
ENV VITE_COMMIT_HASH=$VITE_COMMIT_HASH

# Build the production bundle into dist/
RUN npm run build

# --- Stage 2: Final image ---
# Minimal Nginx to serve the static files
# No Node.js, no source code, no node_modules in final image
FROM nginx:alpine

# Copy built static files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Replace default Nginx config with our custom config
# Enables SPA fallback routing for React Router
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
