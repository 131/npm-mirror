FROM node:20
WORKDIR /usr/app

COPY . .
RUN npm install --production


LABEL "org.opencontainers.image.version"="2.2.4"
LABEL "org.opencontainers.image.source"="git@github.com:131/npm-mirror.git"
