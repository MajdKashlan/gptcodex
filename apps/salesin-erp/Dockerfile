# --- build ---------------------------------------------------------------
# The app is compiled inside the image, so the machine running `docker compose
# build` needs Docker but NOT Node.js or spare RAM for a local build.
FROM node:24-alpine AS build

WORKDIR /app

# Dependency layer first, so it is cached until the package files change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# --- serve ---------------------------------------------------------------
FROM nginx:1.27-alpine

# Defaults; override in docker-compose.yml. The nginx entrypoint renders
# /etc/nginx/templates/*.template with these values at start-up.
ENV ERPNEXT_UPSTREAM=https://erp.hmgtr.com
ENV ERPNEXT_HOST=erp.hmgtr.com

COPY deploy/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/salesin-erp/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
