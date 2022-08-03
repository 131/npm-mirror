"use strict";

const http = require("http");
const path = require("path");
const fs   = require('fs');

const Mirror = require('./mirror');
const {format} = require('util');

const drain = require('nyks/stream/drain');



class server {
  constructor(config_path = null) {

    this.config = {};
    if(typeof config_path == "string" && fs.existsSync(config_path))
      this.config = require(path.resolve(config_path));


    this.port = this.config.port || 8080;
    this.server = http.createServer(this.dispatch.bind(this));
  }

  async dispatch(req, res) {
    try {
      console.log("Incoming query %s:%s", req.method, req.url);

      if(req.url == "/process" && req.method == "POST")
        return await this.process(req, res);

      if(req.url == "/feed" && req.method == "PUT")
        return await this.feed(req, res);

      res.statusCode = 400;
      res.end("Unkown request");

    } catch(err) {
      console.error("Cannot dispatch", err);
      res.statusCode = 500;
      res.end(String(err));
    }
  }

  async feed(req, res) {
    let manifest = JSON.parse(await drain(req));

    let processor     = new Mirror(this.config);
    let manifest_path = processor.feed(manifest);

    res.end(`Write manifest in ${manifest_path}`);
  }

  async process(req, res) {
    let processor = new Mirror(this.config);
    processor.trace  = function(...line) {
      line = format(...line);
      return new Promise(resolve =>  res.write(line + "\n", resolve));
    };

    await processor.process();
    await res.end();
  }

  async start() {
    await new Promise(resolve => this.server.listen(this.port, resolve));
    console.log("Server is now ready on port", this.port);
  }


}

module.exports = server;
