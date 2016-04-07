"use strict";
var glob    = require('glob');
var util    = require('util');
var crypto  = require('crypto');
var fs      = require('fs');
var path    = require('path');
var semver  = require('semver');
var async   = require('async');


var unique       = require('mout/array/unique');
var map          = require('mout/object/map');
var filter       = require('mout/array/filter');
var forIn        = require('mout/object/forIn');

var request      = require('nyks/http/request');
var md5          = require('nyks/crypto/md5');
var detach       = require('nyks/function/detach');
var sprintf      = require('nyks/string/sprintf');
var mkdirpSync   = require('nyks/fs/mkdirpSync');
var sort         = require('nyks/object/sort');
var sha1sum      = require('nyks/fs/sha1File');


var options = require('nyks/process/parseArgs')();
var registry_url = options.registry_url || console.error("Missing registry url"),
    remote_registry_url = options.remote_registry_url || "http://registry.npmjs.org/",
    manifest_directory  = options.manifest_directory || console.error("Missing manifest_directory"),
    package_directory  = options.package_directory || console.error("Missing package_directory");


var manifests_list = glob.sync(util.format("%s/*.json", manifest_directory));

manifests_list = manifests_list.map(function(v){ return path.resolve(v) });
manifests_list = manifests_list.map(require);

var dependencies = {};


var fetch_package_json_cache = {};


var fetch_package_json = async.queue(function(package_name, chain){
  chain = detach(chain);

  var cache_file = path.join('cache', md5(package_name));
  if(fetch_package_json_cache[package_name])
    return chain(null, fetch_package_json_cache[package_name]);

  if(fs.existsSync(cache_file)) {
    var body = JSON.parse(fs.readFileSync(cache_file, "utf-8"));
    fetch_package_json_cache[package_name] = body;
    return chain(null, body);
  }

  var remote_url = util.format("%s/%s", remote_registry_url, package_name);
  console.log("Reaching %s", remote_url);
  request(remote_url, function(err, body){

    fs.writeFileSync(cache_file, JSON.stringify(body));

    fetch_package_json_cache[package_name] = body;
    chain(null, body);
  });

}, 5).push;





function stack_dependency(package_name, requested_version, chain){

  if(!dependencies[package_name])
      dependencies[package_name] = []

  fetch_package_json(package_name, function(err, body){
    if(false && err)
      return chain(null, false);

    var full_versions_list = Object.keys(body.versions || {});

    var target_version = semver.maxSatisfying(full_versions_list, requested_version);
    if(target_version && dependencies[package_name].indexOf(target_version) == -1) {
      dependencies[package_name].push(target_version);
      return chain(null, true); //new dependecy to scan
    }

    chain(null, false);
  });
}

function stack_dependencies(newlist, chain){
  var new_packages = [];
  async.each(newlist, function(entry, chain){
    stack_dependency(entry.package_name, entry.version, function(err, changed){
      if(changed)
        new_packages.push(entry.package_name);
      chain();
    });
  }, function(err){
    chain(null, unique(new_packages));
  });
}


function inline_dependencies(){
  var out = [];
  [].slice.apply(arguments).forEach(function(d){
    if(!d) return;
    for(var package_name in d)
      out.push({package_name:package_name, version:d[package_name]});
  });
  return out;
}




var full_list = [];
manifests_list.map(function(v){
  var foo = inline_dependencies(v.dependencies, v.devDependencies, v.peerDependencies);
  full_list = full_list.concat(foo);
});




var dead_ends = {};


var download = async.queue(function(remote, chain){

  var file_path   = remote.file_path,
       remote_url = remote.url,
       challenge_sha1 = remote.sha1;


  if(fs.existsSync(file_path)) {
    sha1sum(file_path, function(err, sha1){
      if(sha1 != challenge_sha1) {
        fs.unlinkSync(file_path);
        return download(remote, chain);
      }
      chain();
    });
    return ;
  }

  console.log("Downloading '%s' to '%s'", remote_url, file_path); 

  var hash = crypto.createHash('sha1'); hash.setEncoding('hex');
  var dest =  fs.createWriteStream(file_path);
  request(remote_url, function(err, res){
    res.pipe(hash);

    res.pipe(dest).on("finish", function(){
      hash.end();
      var dl_sha1 = hash.read();
      console.log(dl_sha1, "vs", challenge_sha1);
      chain();
    });
  });
}).push;



var downloadPackages = function(){
  forIn(dependencies, function(versions, package_name) {
    var package_dir = util.format("tmp/%s", package_name);
    mkdirpSync(package_dir);

    fetch_package_json(package_name, function(err, _package){
      if(err)
        return chain(err);

      versions.forEach(function(version_key) {
        var version = _package.versions[version_key];

        var archive_dir = util.format("%s/%s", package_dir, version_key);

        mkdirpSync(archive_dir);
        var file_name =   sprintf("%1$s-%2$s.tgz", package_name, version_key);

        var file_url = util.format("%s/%s%s", registry_url, archive_dir, file_name);

        var file_path = util.format("%s/%s", archive_dir, file_name);
        var json_path = util.format("%s/%s", archive_dir, "index.json");

        var remote_url = version.dist.tarball;

        version.dist.tarball = file_url;

        fs.writeFileSync(json_path, JSON.stringify(version));

        download({url : remote_url, file_path : file_path, sha1:version.dist.shasum}, Function.prototype);
      });

      var json_path = util.format("%s/%s", package_dir, "index.json");
      _package.versions = sort(_package.versions, versions);
      fs.writeFileSync(json_path, JSON.stringify(_package));

    });



  });


}

stack_dependencies(full_list, function(){

  var q = async.queue(function(package_name, chain){

    fetch_package_json(package_name, function(err, body){

      var full_list = [];

      async.each(dependencies[package_name], function(version_key, chain){
        if(dead_ends[package_name + version_key])
          return chain();

        var version = body.versions[version_key];
        var foo = inline_dependencies(version.dependencies,  version.peerDependencies);
          
        stack_dependencies(foo, function(err, new_packages){
          if(!new_packages.length)
            dead_ends[package_name + version_key] = true;

          new_packages.forEach(function(package_name){ q.push(package_name); });

          chain();
        });

      }, chain);



    });

  }, 5);

  var start = Date.now();
  q.drain = function(){
    downloadPackages();
  }

  Object.keys(dependencies).forEach(function(package_name){
    q.push(package_name);
  });


});