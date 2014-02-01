#!/usr/bin/env node

// TODO: Show a warning if no '_resolved' is present.

var fs = require('fs'),
    path = require('path'),
    async = require('async'),
    http = require('http'),
    ecstatic = require('ecstatic'),
    httpRequest = require('http-request'),
    traverse = require('traverse'),
    mkdirp = require('mkdirp'),
    portfinder = require('portfinder'),
    glob = require('glob'),
    spawn = require('child_process').spawn,
    chalk = require('chalk');

var optimist = require('optimist')
      .alias('s', 'store')
      .alias('p', 'port')
      .alias('a', 'address')
      .alias('h', 'help')
    argv = optimist.argv;

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
    storePath = argv.store || path.join(rootPath, (packageJson.shrinkwrapper || {}).store || './packages');

var urlBasename = function(url) {
  return path.basename(require('url').parse(url).path);
};

var download = function(url, next) {
  next = next || function() {};
  var filename = urlBasename(url);
  if (filename == '') return;
  filename = path.join(storePath, filename);
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

//
// Shrinkwrap command
//
var shrinkwrap = function() {
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

      mkdirp.sync(storePath);

      async.parallelLimit(tasks, 10, function(err) {
        if (err) { console.error(err); return; }
      });
    });
};

//
// Install command
//
var install = function() {
  // TODO: Report an error if there is no npm-shrinkwrap.json file!

  var basePort = argv.port    || '8080',
      host     = argv.address || 'localhost';

  portfinder.basePort = parseInt(basePort, 10);
  portfinder.getPort(function (err, port) {
    if (err) throw err;

    var server = http.createServer(ecstatic(storePath));
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
};

//
// Usage (help)
//
var usage = function() {
  console.log([
    'Usage: ' + argv.$0 + ' <command> <options>',
    '',
    '  Save shrinkwrapped packages away and install them later.',
    '',
    'Commands:',
    '',
    '  shrinkwrap (default)   run ' + chalk.yellow('npm shrinkwrap') + ' and download required packages',
    '  install                run ' + chalk.yellow('npm install') + ' using previously saved packages',
    '',
    'Options:',
    '',
    '  -s, --store            set directory for saved packages (overrides setting in package.json)',
    '  -h, --help             show usage information',
    ''
  ].join('\n'));
};

var command = argv._.join();

if      (argv.help)                                usage();
else if (command == '' || command == 'shrinkwrap') shrinkwrap();
else if (command == 'install')                     install();
else                                               usage();
