"use strict";

const path = require('path');
const fs   = require('fs');
const util = require('util');
const crypto = require('crypto');


const  semver  = require('semver');
const glob     = require('glob');
const sprintf = util.format;

const fetch = require('nyks/http/fetch');
const drain = require('nyks/stream/drain');
const pipe = require('nyks/stream/pipe');
const mkdirpSync = require('nyks/fs/mkdirpSync');

class mirror {

  constructor() {
    this.manifest_dir = "./manifests";
    this.pool_dir     = "./pool";
    this.packages_dir = "./packages";

      //directory urls ends with /
    this.public_pool_url     = "http://packages.ivsweb.com/npm/pool/";
    this.public_registry_url = "http://packages.ivsweb.com/npm/";
    this.remote_registry_url = "https://registry.npmjs.org/";

    this.proceed = {};
    this._pkgCache = {};

    this.ban = new RegExp("uws-trashme-after-121-merge|47admin|simplexml|csbox-.*|ivscs.*|cordova|html2pdf|activisu-.*|activbridge-.*|ivs-.*|activscreen-.*|splocalstorage|spdiscovery|spdownloader");
    this.banversion = new RegExp("^https?://|git://");

  }




  parse() {
    var packages_list = glob.sync(sprintf("%s/*", this.packages_dir));
    packages_list = packages_list.map( v => JSON.parse(fs.readFileSync(path.resolve(v), 'utf-8')));
    console.log("Now ignited with %d packages", packages_list.length);

  }

  async run() {

    var manifests_list = glob.sync(sprintf("%s/*.json", this.manifest_dir));
    manifests_list = manifests_list.map( v => path.resolve(v));
    manifests_list = manifests_list.map(require); //lol
    console.log("Now ignited with %d manifests", manifests_list.length);

    var which_list = [];
    manifests_list.map((v) => {
      var dep = {...v.dependencies, ...v.devDependencies, ...v.peerDependencies};
      for(var package_name in dep)
        which_list.push({package_name, version:dep[package_name]})
    });

    for(var line of which_list)
      await this.process(line.package_name, line.version);
    



  }

  //check localy if we got a semver match
  async process(package_name, requested_version, force) {
    var hk = `${package_name}-${requested_version}`;
    var touch = false;

    if(this.proceed[hk])
      return;

    if(this.ban.test(package_name) || this.banversion.test(requested_version) ) {
      this.proceed[hk] = true;
      return false;
    }

    if(!this.proceed[package_name])
      this.proceed[package_name] = {};

    if(!semver.validRange(requested_version))
      throw `Invalid semver '${requested_version}' of package ${package_name}`;



    console.log("Wanting ", package_name, requested_version);


    var manifest_path = path.join(this.packages_dir, package_name.replace('/', '%2f'));

    var manifest = this._pkgCache[package_name];

    if(!manifest) {
      if(!fs.existsSync(manifest_path) || force) {
        console.log("Downloading remote manifest", package_name);
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
      console.log("Forcing re-analysis");
      return await this.process(package_name, requested_version, true);
    }

    var version = manifest.versions[target_version];

    var dist = version.dist;
    var shasum = dist.shasum;

    if(await this.check_pool(shasum, dist.tarball))
      touch = true;

    //now check all dependencies

    //prevent full recurse
    this.proceed[hk] = true;

    if(touch) {
      var dep = {...version.dependencies, ...version.peerDependencies};
      for(var dep_name in dep)
        await this.process(dep_name, dep[dep_name]);
    }

    if(touch) {
      for(var version in manifest.versions)
          manifest.versions[version].dist.tarball = this.pool_url(manifest.versions[version].dist.shasum);
      console.log("TOUCHED");
      fs.writeFileSync(manifest_path, JSON.stringify(manifest));
    }


  }

  pool_url(shasum) {
    var pool_path = path.join(shasum.substr(0,2), shasum.substr(2,1), shasum);
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
    var pool_path = path.join(this.pool_dir, shasum.substr(0,2), shasum.substr(2,1), shasum);
    if(fs.existsSync(pool_path))
      return;

    mkdirpSync(path.dirname(pool_path));

    console.log("Downloading from", remote_url);
    var res = await fetch(remote_url);
    var tmp_path = pool_path + ".tmp";

    var dst = fs.createWriteStream(tmp_path);
    var hash = crypto.createHash('sha1');

    await Promise.all([pipe(res, dst), pipe(res, hash)]);
    hash = hash.read().toString('hex');
    console.log("Got hash", hash);
    if(shasum.toLowerCase() != hash.toLowerCase())
      throw  `Corrupted download hash ${shasum} vs ${hash}`;

    fs.renameSync(tmp_path, pool_path);
    return true;
  }



  





}


module.exports = mirror;
