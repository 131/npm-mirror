"use strict";

const path = require('path');
const fs   = require('fs');
const {spawn}    = require('child_process');

const mkdirpSync = require('nyks/fs/mkdirpSync');

const passthru = require('nyks/child_process/passthru');
const rmrf     = require('nyks/fs/rmrf');

const drain    = require('nyks/stream/drain');

const expect = require('expect.js');
const Mirror = require('../mirror');
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


describe("Tarball rewrite behavior", function() {
  const fixture_root = path.join(__dirname, "rewrite-fixture");
  const manifest_dir = path.join(fixture_root, "manifests");
  const pool_dir = path.join(fixture_root, "pool");
  const packages_dir = path.join(fixture_root, "packages");
  const public_pool_url = "http://mirror.local/pool/";

  const createMirror = async function() {
    await rmrf(fixture_root);
    mkdirpSync(manifest_dir);
    mkdirpSync(pool_dir);
    mkdirpSync(packages_dir);

    let mirror = new Mirror({manifest_dir, pool_dir, packages_dir, public_pool_url});
    mirror.trace = async function() {};
    return mirror;
  };

  after(async () => {
    await rmrf(fixture_root);
  });

  it("should rewrite an upstream tarball to the pool url without re-downloading when the file already exists", async () => {
    let mirror = await createMirror();

    let shasum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let remote = "https://registry.example/pkg/-/pkg-1.0.0.tgz";
    let package_path = path.join(packages_dir, "pkg");

    let pool_path = path.join(pool_dir, shasum.substr(0, 2), shasum.substr(2, 1), shasum);
    mkdirpSync(path.dirname(pool_path));
    fs.writeFileSync(pool_path, "pkg-1");

    fs.writeFileSync(package_path, JSON.stringify({
      name : "pkg",
      versions : {
        "1.0.0" : {
          name : "pkg",
          version : "1.0.0",
          dist : {shasum, tarball : remote, _tarball : remote},
        },
      },
    }));

    mirror.fetch_package = async function() {
      throw new Error("fetch_package should not be called");
    };

    await mirror.process_package("pkg", "1.x");

    let package_manifest = JSON.parse(fs.readFileSync(package_path));
    expect(package_manifest.versions["1.0.0"].dist.tarball).to.be(mirror.pool_url(shasum));
    expect(package_manifest.versions["1.0.0"].dist._tarball).to.be(remote);
    expect(fs.readFileSync(pool_path).toString()).to.be("pkg-1");
  });
});



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
