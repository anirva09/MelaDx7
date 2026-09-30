# syntax=docker/dockerfile:1.7
# MelaDx7 web app: static build served by nginx, which also proxies /api to the backend.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
# nginx.conf is a template: the image's entrypoint substitutes BACKEND_ADDR at start-up.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV BACKEND_ADDR=backend:8000 NGINX_ENVSUBST_FILTER=BACKEND_
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
