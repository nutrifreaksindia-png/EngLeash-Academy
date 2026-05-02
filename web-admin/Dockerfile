FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY brand ./brand
COPY web-admin/package.json web-admin/package-lock.json ./web-admin/
WORKDIR /app/web-admin
RUN npm ci
COPY web-admin/ .

ARG VITE_API_BASE=https://api.engleashacademy.com
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

FROM nginx:1.27-alpine

COPY web-admin/deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/web-admin/dist /usr/share/nginx/html

EXPOSE 80
