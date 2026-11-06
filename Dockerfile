# Inventory Scanner. Runs on Node's own HTTP server and built-in SQLite
# (node:sqlite), so there is no "npm install" step and no node_modules folder.
#
# Pinned to an exact Node release and Alpine version, so a rebuild never picks
# up a new Node unannounced. To update, change this tag, rebuild and run the
# tests (README.md, "Updating Node").
FROM node:24.22.2-alpine3.24

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# Copied as root and only readable by the app, so the app cannot change its
# own code. The only place it writes is /data (bind-mounted, see compose).
COPY package.json ./
COPY src ./src
COPY public ./public

# "node" (uid/gid 1000) ships with the image. The data folder mounted at /data
# must be writable by uid 1000 (README.md, "Running it").
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "src/main.js"]
