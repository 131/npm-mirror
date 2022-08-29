"use strict";

const http = require("http");
const path = require("path");
const fs   = require('fs');

const Mirror = require('./mirror');
const {format} = require('util');

const drain = require('nyks/stream/drain');

const express = require('express');

class server {

  constructor(config_path = (process.env["MIRROR_CONFIG_PATH"] || './example/config.json')) {

    this.config = null;

    if(typeof config_path == "string" && fs.existsSync(config_path)) {
      console.log("Loading configuration from", config_path);
      this.config = require(path.resolve(config_path));
    }
    if(typeof config_path == "object")
      this.config = config_path;

    if(!this.config)
      throw `Invalid service configuration (check process.env.MIRROR_CONFIG_PATH)`;

    this.port = this.config.port || 0;
    this.mirror = new Mirror(this.config);
    this.http_packages_root = this.config.http_packages_root || '/';
    this.http_pool_root     = this.config.http_pool_root     || '/-/pool/';

    this.app = express();
    this.app.use(function(req, res, next) {
      console.log("Incoming query %s:%s", req.method, req.url);
      next();
    });

    //preserve %2f style in express/static/send
    this.app.use("/", function(req, res, next) {
      req.url = req.url.replace("%2F", "%2f");
      if(/%2f/.test(req.url)) {
        req.url = req.url.replace("%", "%25");
        req.originalUrl = req.url;
      }
      next();
    });

    this.app.use(this.http_packages_root, express.static(this.mirror.packages_dir, {fallthrough : false}));
    this.app.use(this.http_pool_root, express.static(this.mirror.pool_dir));

    this.app.post("/process", async (req, res)  => {
      try {
        return await this.process(req, res);
      } catch(err) {
        res.status(500).send(String(err));
      }
    });
    this.app.put("/feed", async (req, res) => {
      try {
        return await this.feed(req, res);
      } catch(err) {
        res.status(500).send(String(err));
      }
    });

    this.app.use((err, req, res, next) => { // eslint-disable-line
      console.error("Cannot dispatch", err);
      res.status(500).send(String(err));
    });


    this.server = http.createServer(this.app);
  }

  async feed(req, res) {
    let manifest = JSON.parse(await drain(req));
    let manifest_path = this.mirror.feed(manifest);
    res.end(`Write manifest in ${manifest_path}`);
  }

  async process(req, res) {
    //todo  : lock processor
    this.mirror.trace  = function(...line) {
      line = format(...line);
      return new Promise(resolve =>  res.write(line + "\n", resolve));
    };

    await this.mirror.process();
    await res.end();
  }

  async start() {
    this.port = await new Promise(resolve => this.server.listen(this.port, () => {
      resolve(this.server.address().port);
    }));
    console.log("Server is now ready on port", this.port);
  }


}

module.exports = server;
