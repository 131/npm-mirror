"use strict";

var crypto  = require('crypto');
var fs      = require('fs');
var util    = require('util');


var request      = require('nyks/http/request');
var sha1sum      = require('nyks/fs/sha1File');

/*
* Check the hashsum of a local file and download update if needed
*/

var download = function(remote, chain){

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
  request(remote_url, function(err, res) {
    res.pipe(hash);

    res.pipe(dest).on("finish", function(){
      hash.end();
      var dl_sha1 = hash.read();
      chain(dl_sha1 != challenge_sha1 ? util.format("Corrupted file %s", JSON.stringify(remote), "vs", dl_sha1)  : null);
    });
  });
};

module.exports = download;
