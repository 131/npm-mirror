FROM node:20
ENV NODE_PATH=/usr/local/lib/node_modules/

RUN npm install -g cnyks npm-registry-mirror


CMD ["cnyks", "npm-registry-mirror/server", "--ir://start"]
LABEL "org.opencontainers.image.version"="2.2.1"
LABEL "org.opencontainers.image.source"="git@github.com:131/npm-mirror.git"
