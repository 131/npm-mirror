"use strict";

const path = require('path');
const fs   = require('fs');
const util = require('util');
const crypto = require('crypto');


const semver  = require('semver');
const glob     = require('glob');
const sprintf = util.format;

const fetch = require('nyks/http/fetch');
const drain = require('nyks/stream/drain');
const pipe = require('nyks/stream/pipe');
const filter = require('mout/object/filter');
const startsWith = require('mout/string/startsWith');
const mkdirpSync = require('nyks/fs/mkdirpSync');

class mirror {

  constructor(config_path = (process.env["MIRROR_CONFIG_PATH"] || './example/config.json')) {

    let config;
    if(typeof config_path == "string" && fs.existsSync(config_path))
      config = require(path.resolve(config_path));
    if(typeof config_path == "object")
      config = config_path;


    this.manifest_dir = mkdirpSync(config.manifest_dir);
    this.pool_dir     = mkdirpSync(config.pool_dir);
    this.packages_dir = mkdirpSync(config.packages_dir);


    //directory urls ends with /
    this.public_pool_url     = config.public_pool_url;
    this.remote_registry_url = config.remote_registry_url || 'https://registry.npmjs.org';

    this.proceed = {};
    this._pkgCache = {};

    this.ban = new RegExp(config.exclude_mask || '$a');
    this.banversion = new RegExp("^https?://|git://");

    this.trace = console.log.bind(console);
  }


  feed(package_body) {

    let dependencies = filter({...package_body.dependencies, ...package_body.devDependencies}, (v, k) => {
      if(startsWith(v, "git"))
        return false;
      if(!semver.validRange(v))
        throw `Invalid version format ${k}:${v}`;
      return true;
    });

    let data = {
      'name'    : package_body.name || "unknow-package",
      'version' : package_body.version || "1.0.0",
      'dependencies'  : dependencies,
    };

    //throw rbx::error(json_encode($data));
    let time    = Math.floor(Date.now() / 1000);
    let manifest_path = path.join(this.manifest_dir, `${data.name}_${time}.json`);
    fs.writeFileSync(manifest_path, JSON.stringify(data));
    return manifest_path;
  }

  async process() {

    var manifests_list = glob.sync(sprintf("%s/*.json", this.manifest_dir));
    manifests_list = manifests_list.map(v => path.resolve(v));
    manifests_list = manifests_list.map(require); //lol
    this.trace("Now ignited with %d manifests", manifests_list.length);

    var which_list = [];
    manifests_list.map((v) => {
      var dep = {...v.dependencies, ...v.devDependencies, ...v.peerDependencies};
      for(var package_name in dep)
        which_list.push({package_name, version : dep[package_name]});
    });

    for(var line of which_list)
      await this.process_package(line.package_name, line.version);


  }

  //check localy if we got a semver match
  async process_package(package_name, requested_version, force = false) {
    var hk = `${package_name}-${requested_version}`;
    var touch = false;

    if(this.proceed[hk])
      return;

    if(this.ban.test(package_name) || this.banversion.test(requested_version)) {
      this.proceed[hk] = true;
      return false;
    }

    if(!this.proceed[package_name])
      this.proceed[package_name] = {};

    if(!semver.validRange(requested_version))
      throw `Invalid semver '${requested_version}' of package ${package_name}`;



    await this.trace("Wanting ", package_name, requested_version);


    var manifest_path = path.join(this.packages_dir, package_name.replace('/', '%2f'));

    var manifest = this._pkgCache[package_name];

    if(!manifest) {
      if(!fs.existsSync(manifest_path) || force) {
        this.trace("Downloading remote manifest", package_name);
        manifest = await this.fetch_package(package_name);
        touch = true;
      } else {
        manifest = JSON.parse(fs.readFileSync(manifest_path));
      }

      this._pkgCache[package_name] = manifest;
      //throw `what ${manifest_path} ?`;
    }

    var full_versions_list = Object.keys(manifest.versions || {});
    var target_version = semver.maxSatisfying(full_versions_list, requested_version);
    if(!target_version) {
      if(force)
        throw `Cannot find target version ${package_name}@${requested_version}`;
      this._pkgCache[package_name] = null;
      this.trace("Forcing re-analysis");
      return await this.process_package(package_name, requested_version, true);
    }

    var version = manifest.versions[target_version];

    var dist = version.dist;
    var shasum = dist.shasum;


    if(await this.check_pool(shasum, dist._tarball || dist.tarball))
      touch = true;

    //now check all dependencies

    //prevent full recurse
    this.proceed[hk] = true;

    var dep = {...version.dependencies, ...version.peerDependencies};
    for(var dep_name in dep)
      await this.process_package(dep_name, dep[dep_name]);


    if(touch) {
      for(let version in manifest.versions) {
        if(!manifest.versions[version].dist._tarball)
          manifest.versions[version].dist._tarball = manifest.versions[version].dist.tarball;
        manifest.versions[version].dist.tarball = this.pool_url(manifest.versions[version].dist.shasum);
      }
      this.trace("TOUCHED");
      fs.writeFileSync(manifest_path, JSON.stringify(manifest));
    }


  }

  pool_url(shasum) {
    var pool_path = path.posix.join(shasum.substr(0, 2), shasum.substr(2, 1), shasum);
    return this.public_pool_url + pool_path; //no slash inbetween
  }

  async fetch_package(package_name) {
    var remote_url = sprintf("%s/%s", this.remote_registry_url, package_name.replace('/', '%2f'));

    var res = await fetch(remote_url);
    if(res.statusCode != 200)
      throw `Cannot fetch package ${package_name}`;
    var body = JSON.parse(await drain(res));
    return body;
  }


  //check if a file is available in pool, and fetch it remotly if it's not
  async check_pool(shasum, remote_url) {
    var pool_path = path.join(this.pool_dir, shasum.substr(0, 2), shasum.substr(2, 1), shasum);
    if(fs.existsSync(pool_path))
      return;

    mkdirpSync(path.dirname(pool_path));

    this.trace("Downloading from", remote_url);
    var res = await fetch(remote_url);
    var tmp_path = pool_path + ".tmp";

    var dst = fs.createWriteStream(tmp_path);
    var hash = crypto.createHash('sha1');

    await Promise.all([pipe(res, dst), pipe(res, hash)]);
    hash = hash.read().toString('hex');
    this.trace("Got hash", hash);
    if(shasum.toLowerCase() != hash.toLowerCase())
      throw  `Corrupted download hash ${shasum} vs ${hash}`;

    fs.renameSync(tmp_path, pool_path);
    return true;
  }


}


module.exports = mirror;
