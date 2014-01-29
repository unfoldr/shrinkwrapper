#!/usr/bin/env node

// TODO: Add some more comments and tidy the code a bit.
// TODO: Show a warning if no '_resolved' is present.

var fs = require('fs'),
    path = require('path'),
    async = require('async'),
    argv = require('optimist').argv,
    http = require('http'),
    ecstatic = require('ecstatic'),
    httpRequest = require('http-request'),
    traverse = require('traverse'),
    mkdirp = require('mkdirp'),
    portfinder = require('portfinder'),
    glob = require('glob'),
    spawn = require('child_process').spawn,
    chalk = require('chalk');

var findRootPath = function() {
  var cwd = path.resolve('.'),
      parts = cwd.split(/\//);

  for (var end = parts.length; end > 0; end -= 1) {
    var packageFile = parts.slice(0, end).concat('package.json').join(path.sep);
    if (fs.existsSync(packageFile)) {
        return path.dirname(packageFile);
    }
  }
};

var rootPath = findRootPath(),
    packageJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'))),
    vaultPath = path.join(rootPath, packageJson.shrinkwrapVault || './packages');

var urlBasename = function(url) {
  return path.basename(require('url').parse(url).path);
};

var download = function(url, next) {
  next = next || function() {};
  var filename = urlBasename(url);
  if (filename == '') return;
  filename = path.join(vaultPath, filename);
  fs.exists(filename, function(exists) {
    if (exists) {
      next(null);
      return;
    } else {
      console.log(chalk.green('http'), chalk.magenta('GET'), url);
      httpRequest.get(url, filename, function(err, res) {
        if (err) {
          console.error(err);
          next(err);
          return;
        }
        console.log(chalk.green('http'), chalk.magenta(res.code), url);
        next(null);
      });
    }
  });
};

if (argv.save) {
  spawn('npm', ['shrinkwrap'], { stdio: 'inherit' }).
    on('close', function(code) {
      if (code != 0)
        return;

      var tasks = {};
      traverse(JSON.parse(fs.readFileSync(path.join(rootPath, 'npm-shrinkwrap.json')))).
        forEach(function() {
          if (this.node['resolved']) {
            var url = this.node['resolved'];
            tasks[url] = tasks[url] || function(next) { download(url, next); };
          }
        });

      mkdirp.sync(vaultPath);

      async.parallelLimit(tasks, 10, function(err) {
        if (err) { console.error(err); return; }
      });
    });

  return;
}

var getBackupFilename = function(filename) {
  return path.join(path.dirname(filename), '.' + path.basename(filename) + '.bak');
};

// Asynchronously applies a mapping function to values of the given field in
// the identified JSON file.  Makes a backup copy of the file first.
var mapFile = function(filename, field, fn, next) {
  var backupFilename = getBackupFilename(filename);
  fs.rename(filename, backupFilename, function(err) {
    if (err) return next(err);

    fs.readFile(backupFilename, function(err, data) {
      if (err) return next(err);

      var data = JSON.parse(data);
      traverse(data).forEach(function() {
        if (this.key == field) {
          this.update(fn(this.node));
        }
      });
      fs.writeFile(filename, JSON.stringify(data, null, 2), next);
    });
  });
};

// Asynchronously restores the mapped file from the backup copy.
var unmapFile = function(filename, next) {
  var backupFilename = getBackupFilename(filename);
  fs.rename(backupFilename, filename, next);
};

if (argv.install) {
  
  // TODO: Report an error if there is no npm-shrinkwrap.json file!

  var basePort = argv.p || argv.port    || '8080',
      host     = argv.a || argv.address || 'localhost';

  portfinder.basePort = parseInt(basePort, 10);
  portfinder.getPort(function (err, port) {
    if (err) throw err;

    var server = http.createServer(ecstatic(vaultPath));
    server.listen(port, host, function() {

      // Redirect resolved references from the default npm registry to
      // localhost in npm-shrinkwrap.json and all top-level package.json files

      var mapUrl = function(url) {
        return url.indexOf('https://registry.npmjs.org/') == 0 ?
          'http://' + host + ':' + port + '/' + urlBasename(url) :
          url;
      };

      var files = glob.sync('node_modules/*/package.json', { cwd: rootPath });
      files.unshift('npm-shrinkwrap.json');

      async.each(files, function(file, next) {
          mapFile(file,
            path.basename(file) == 'package.json' ? '_resolved' : 'resolved',
            mapUrl, next
          );
        }, function(err) {

          var restore = function() {
            // Restore the mapped files
            async.each(files, unmapFile, function() {
              process.exit();
            });
          };

          if (err) restore();

          process.on('SIGINT', restore);

          // Install package files from the vault
          spawn('npm', ['install'], { stdio: 'inherit' }).
            on('close', function(code) {
              server.close();
              restore();
            });
        }
      );
    });
  });

  return;
}

console.error('Usage: ...');
