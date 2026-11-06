# Throwaway image for the browser test only (test/browser/scanner-e2e.mjs):
# the app's pinned Node image, Alpine's own Chromium package, one font (for
# readable screenshots) and bwip-js (draws real barcodes for the simulated
# camera), installed from the repository's package-lock.json.
# The running app does not use this image. Build it from the repository root:
#   docker build -f test/browser/Dockerfile -t inventory-scanner-e2e .
FROM node:24.22.2-alpine3.24
RUN apk add --no-cache chromium font-dejavu
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
USER node
WORKDIR /app
