"use strict";

const path = require('path');
const fs   = require('fs');
const {spawn}    = require('child_process');

const mkdirpSync = require('nyks/fs/mkdirpSync');

const passthru = require('nyks/child_process/passthru');
const rmrf     = require('nyks/fs/rmrf');

const drain    = require('nyks/stream/drain');

const expect = require('expect.js');
const Server = require('../server');

/**
* In this test suite, we create a mirror
* then we ignite the mirror cache with a dummy package
* Then we compare npm install / npm ls of this dummy package between the default registry and the mirror registry
*/


const mock_manifest =  {
  name : "test",
  dependencies : {
    "nyks"          : "~6.1.7",
    "@slack/types" : "1.1.0"
  }
};


describe("Full test suite", function() {
  this.timeout(60 * 1000);

  const mirror_dir = path.join(__dirname, "mirror");

  const manifest_dir  = path.join(mirror_dir, "manifests");
  const pool_dir      = path.join(mirror_dir, "pool");
  const packages_dir  = path.join(mirror_dir, "packages");
  const test_dir  = path.join(mirror_dir, "test");

  let server, registry_url;

  before("should prepare folder structure", async () => {
    await rmrf(mirror_dir);
    await rmrf(test_dir);
    mkdirpSync(test_dir);
    mkdirpSync(manifest_dir);
    mkdirpSync(pool_dir);
    mkdirpSync(packages_dir);
    fs.writeFileSync(path.join(test_dir, "package.json"), JSON.stringify(mock_manifest));
  });

  after("it should cleanup all", async () => {
    console.log("Cleaning all");
    await rmrf(mirror_dir);
  });

  it("SHould create a mock server", async () => {
    let port = 8080;

    let local_server = `http://127.0.0.1:${port}`;
    let public_pool_url = `${local_server}/-/pool/`;
    registry_url    = `${local_server}/`;

    let config = { port, manifest_dir, pool_dir, packages_dir, public_pool_url};
    server =  new Server(config);
    await server.start();

    console.log("Local test mirror is ready", registry_url);
  });

  it("Should ignite cache mirror with nyks & dependencies", async () => {
    await server.mirror.feed(mock_manifest);
    await server.mirror.process();
  });


  it("Should compare check behavior using npm ls", async () => {
    //compare only versions
    var cleanup = function({version, name, dependencies}) {
      for(let dep in dependencies || {})
        dependencies[dep] = cleanup(dependencies[dep]);
      return {version, name, dependencies};
    };

    console.log("Running npm install with default registry");

    let ctx = {cwd : test_dir, env : {
      ...process.env,
      NPM_CONFIG_CACHE : path.join(test_dir, ".cache"),
      NPM_CONFIG_PACKAGE_LOCK : false,
    }, shell : true};

    await passthru("npm", ["install", "--force"], {...ctx});

    console.log("Recording status as reference");
    let child = spawn("npm", ["ls", "--json"], {...ctx});
    let official = cleanup(JSON.parse(await drain(child.stdout)));
    console.log("Cleaning up");
    await rmrf(path.join(test_dir, "node_modules"));
    await rmrf(path.join(test_dir, ".cache"));

    console.log("Running npm install with mirror registry");
    await passthru("npm", ["install", "--force", `--registry=${registry_url}`], {...ctx});

    console.log("Recording status as challenge");
    child = spawn("npm", ["ls", "--json"], {...ctx});
    let mirror = cleanup(JSON.parse(await drain(child.stdout)));


    console.log("Comparing challenges");
    expect(mirror).to.eql(official);
  });


});
