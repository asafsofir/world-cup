FROM node:22-alpine
WORKDIR /app
COPY public ./public
COPY server ./server
COPY README.md ./README.md
COPY SPEC.md ./SPEC.md
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/server.mjs"]
