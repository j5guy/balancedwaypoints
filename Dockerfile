# Debian-based (not alpine) so bcrypt's prebuilt native binary works without
# compiling from source, on the platforms it has one for (notably amd64).
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
# build-essential/python3 are a fallback for platforms without a prebuilt
# bcrypt binary so npm can compile it from source instead of failing
# outright. Installed and purged within this one layer so they don't end up
# in the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && npm install --omit=dev \
    && apt-get purge -y --auto-remove build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npx sass public/scss/main.scss public/css/main.css --style=compressed --no-source-map

RUN groupadd -r app && useradd -r -g app app \
    && mkdir -p logs public/uploads \
    && chown -R app:app /app

RUN chmod +x docker-entrypoint.sh

USER app

EXPOSE 5570

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
