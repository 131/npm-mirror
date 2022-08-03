"use strict";

const path = require('path');
const fs   = require('fs');
const {spawn}    = require('child_process');

const express  = require('express');
const mkdirpSync = require('nyks/fs/mkdirpSync');

const passthru = require('nyks/child_process/passthru');
const rmrf     = require('nyks/fs/rmrf');

const drain    = require('nyks/stream/drain');

const expect = require('expect.js');
const Mirror = require('../mirror');

/**
* In this test suite, we create a mirror
* then we ignite the mirror cache with a dummy package
* Then we compare npm install / npm ls of this dummy package between the default registry and the mirror registry
*/


const mock_manifest =  {
  name : "test",
  dependencies : {"nyks" : "~6.1.7"}
};


describe("Full test suite", function() {
  this.timeout(60 * 1000);

  const mirror_dir = path.join(__dirname, "mirror");

  const manifest_dir  = path.join(mirror_dir, "manifests");
  const pool_dir      = path.join(mirror_dir, "pool");
  const packages_dir  = path.join(mirror_dir, "packages");

  let mirror, registry_url;

  before("should prepare folder structure", async () => {
    await rmrf(mirror_dir);
    mkdirpSync(manifest_dir);
    mkdirpSync(pool_dir);
    mkdirpSync(packages_dir);
  });

  after("it should cleanup all", async () => {
    console.log("Cleaning all");
    await rmrf(mirror_dir);
  });

  it("SHould create a mock server", async () => {

    var app = express();
    app.use(function(req, res, next) {
      console.log(req.url);
      next();
    });
    app.use("/", express.static(mirror_dir));

    let port = await new Promise(resolve => {
      app.listen(0, '127.0.0.1', function() {
        resolve(this.address().port);
      });
    });

    let local_server = `http://127.0.0.1:${port}`;
    let public_pool_url = `${local_server}/pool/`;
    registry_url    = `${local_server}/packages/`;

    console.log("Local test mirror is ready", registry_url);

    mirror = new Mirror({ manifest_dir, pool_dir, packages_dir, public_pool_url});
  });

  it("Should ignite cache mirror with nyks & dependencies", async () => {
    let manifest_path = path.join(manifest_dir, 'package.json');

    fs.writeFileSync(manifest_path, JSON.stringify(mock_manifest, null, 2));
    await mirror.process();
  });


  it("Should compare check behavior using npm ls", async () => {
    //compare only versions
    var cleanup = function({version, name, dependencies}) {
      for(let dep in dependencies || {})
        dependencies[dep] = cleanup(dependencies[dep]);
      return {version, name, dependencies};
    };

    console.log("Running npm install with default registry");
    await passthru("npm", ["install", "--force"], {cwd : manifest_dir, shell : true});

    console.log("Recording status as reference");
    let child = spawn("npm", ["ls", "--json"], {cwd : manifest_dir, shell : true});
    let official = cleanup(JSON.parse(await drain(child.stdout)));
    console.log("Cleaning up");
    await rmrf(path.join(manifest_dir, "node_modules"));

    console.log("Running npm install with mirror registry");
    await passthru("npm", ["install", "--force", `--registry=${registry_url}`], {cwd : manifest_dir, shell : true});

    console.log("Recording status as challenge");
    child = spawn("npm", ["ls", "--json"], {cwd : manifest_dir, shell : true});
    let mirror = cleanup(JSON.parse(await drain(child.stdout)));

    expect(mirror).to.eql(official);
  });


});
