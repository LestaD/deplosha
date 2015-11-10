var deplosha;
var cp = require('child_process');
var coffee = require('coffee-script');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var util = require('util');
var about = {};
var beforeTask = {};
var afterTask = {};
var existsSync = fs.existsSync || path.existsSync;

/**
 * Print arguments to stdout using util.puts
 */
function log() {
  deplosha.log.apply(this, [].slice.call(arguments));
};

function print() {
  deplosha.print.apply(this, [].slice.call(arguments));
};

/**
 * Initialize module. Creates module-wide global variable called `deplosha`
 */
exports.init = function (env) {
  return deplosha = new Deplosha(env);
};

/**
 * Perform some command.
 *
 * @param {Array} what
 * [0] {String} env - environment (optional)
 * [1] {String} command
 */
exports.perform = function (cmd) {
  var env = deplosha.env;

  log('Running in', $(env).bold, 'mode');

  if (deplosha[cmd]) {
    deplosha[cmd]();
  }
  else if (deplosha[cmd + ':default']) {
    deplosha[cmd + ':default']();
  }
  else {
    deplosha.abort('Unknown command ' + cmd);
  }
};

exports.list = function listTasks(how, noDescriptions) {
  Object.keys(about).forEach(function (ns) {
    console.log('\n' + ns + '\n');
    about[ns].forEach(function (cmd) {
      if (noDescriptions || !cmd.description) {
        console.log(' deplosha', ns + ':' + cmd.name);
      } else {
        console.log(' deplosha', ns + ':' + cmd.name, '-', cmd.description);
      }
    });
  });
};

/**
 * Deplosha API object, this is context-object for running deploshafiles
 *
 * Every deploshafile changes context of this object.
 */
function Deplosha(env) {
  deplosha = this;
  deplosha.env = env;
  deplosha.deplosha = this;
  this.init();
}

/**
 * Initialize deplosha object with some settings:
 *
 *  - ./package.json
 *  - /etc/deplosha.coffee
 *  - ~/.deplosha.coffee
 *  - ./Deplosha.coffee
 *  - ./config/Deplosha.coffee
 *
 * Package descriptor `./package.json` can provide information about:
 *
 *  - application name (`application` var set up from package.name)
 *  - git url (`repository` set from package.repository.url)
 */
Deplosha.prototype.init = function () {
  var cwd = process.cwd();

  var packageFile = path.resolve(cwd, 'package.json');
  var configFiles = [
    '/etc/deplosha.coffee',
    path.resolve(process.env.HOME, '.deplosha.coffee'),
    path.resolve(cwd, 'Deplosha.coffee'),
    path.resolve(cwd, 'config/Deplosha.coffee')
  ];

  var cockOutDir = path.resolve(__dirname, '../cockout');

  this.require = require;
  this.console = console;
  this.process = process;

  if (process.env.HOSTS) {
    deplosha.hosts = process.env.HOSTS.split(',');
  }

  if (existsSync(packageFile)) {
    var package = require(packageFile);

    this.application = package.name;

    if (package.repository) {
      deplosha.scm = package.repository.type;
      deplosha.repository = package.repository.url;
    }
  }

  if (process.env.APP) {
    deplosha.application = process.env.APP;
  }

  fs.readdirSync(cockOutDir).forEach(function (file) {
    if (file.match(/\.coffee$/)) {
      deplosha.load(path.resolve(cockOutDir, file));
    }
  });

  configFiles.forEach(function (configFile) {
    if (existsSync(path.resolve(configFile))) {
      deplosha.load(configFile);
    }
  });
};

Deplosha.prototype.log = function () {
  console.log([].join.call(arguments, ' '));
};

Deplosha.prototype.print = function () {
  util.print([].join.call(arguments, ' '));
};

/**
 * Run command on all remote hosts listed in `hosts` var.
 *
 * Each host can be 'hostname' or 'hostname:portnumber'. Example:
 *
 *     HOSTS jsdoc.info:222,node-js.ru:2222 deplosha i:free
 */
Deplosha.prototype.run = function (cmd, callback) {
  if (typeof deplosha.hosts === 'string') {
    deplosha.hosts = [deplosha.hosts];
  }

  log('Executing ' + $(cmd).yellow + ' on ' + $(deplosha.hosts.join(', ')).blue);
  var wait = 0;
  data = [];

  if (deplosha.hosts.length > 1) {
    deplosha.parallelRunning = true;
  }

  deplosha.hosts.forEach(function (host) {
    wait += 1;

    var options = [];
    if (host.match(/:\d+$/)) {
      var h = host.split(':');
      options.push(h[0]);
      options.push('-p' + h[1]);
    }
    else {
      options.push(host);
    }

    if (cmd[0] === '@') {
      options.ignoreError = true;
      cmd = cmd.substr(1);
    }

    options.push(cmd);

    spawnProcess('ssh', options, function (err, out) {
      if (!err) {
        data.push({
          host: host,
          out: out
        });
      }
      done(err);
    });
  });

  var error;
  function done(err) {
    error = error || err;
    if (--wait === 0) {
      deplosha.parallelRunning = false;
      if (error) {
        deplosha.abort('FAILED TO RUN, return code: ' + error);
      }
      else if (callback) {
        callback(data);
      }
    }
  }

};

/**
 * Run command locally
 */
Deplosha.prototype.localRun = function (cmd, callback) {
  log('Executing ' + $(cmd).green + ' locally');
  spawnProcess('sh', [ '-c', cmd ], function (err, data) {
    if (err) {
      deplosha.abort('FAILED TO RUN, return code: ' + err);
    } else {
      if (callback) callback(data);
    }
  });
};

/**
 * Spawn process with `command` and `options`, call `callback` when process
 * finishes. Callback called with (code, output). Code 0 means ok, output contain
 * both `stderr` and `stdout`.
 */
function spawnProcess(command, options, callback) {
  var child = cp.spawn(command, options), waiting = true;
  var prefix = deplosha.parallelRunning && command === 'ssh' ? '[' + options[0] + '] ' : '';
  prefix = $(prefix).grey;

  child.stderr.on('data', function (chunk) {
    print(addBeauty(chunk));
  });
  var res = [];
  child.stdout.on('data', function (chunk) {
    res.push(chunk.toString());
    print(addBeauty(chunk));
  });

  function addBeauty(buf) {
    return prefix + buf
      .toString()
      //.replace(/\s+$/, ' ')
      .replace(/\n/g, '\n' + prefix);
  }

  if (options.ignoreError) {
    child.stdout.on('end', function() {
      if (waiting) {
        callback(null, res.join('\n'));
        waiting = false;
      }
    });
    setTimeout(function() {
      if (waiting) {
        waiting = false;
        callback(null, res.join('\n'));
      }
    }, 5000);
  } else {
    child.on('exit', function (code) {
      if (callback) {
        callback(code === 0 ? null : code, res && res.join('\n'));
      }
    });
  }
}

/**
 * Define `key` only if it is not defined yet
 *
 * @param {String} key
 * @param {Mixed} def
 */
Deplosha.prototype.ensure = function (key, def) {
  if (deplosha.hasOwnProperty(key)) return;
  deplosha.set(key, def);
};

/**
 * Define `key` on current deplosha object. When def is function, it called each time
 * when deplosha[key] getter called. This is odd befavior. It should be called only
 * once and then return cached value.
 *
 * TODO: only call `def` once
 *
 * @param {String} key
 * @param {Mixed} def
 */
Deplosha.prototype.set = function (key, def) {
  if (typeof def === 'function') {
    deplosha.__defineGetter__(key, def);
  }
  else {
    deplosha.__defineGetter__(key, function () {
      return def;
    });
  }
};

/**
 * Load deploshafile `file`
 *
 * @param {String} file - path to deploshafile
 */
Deplosha.prototype.load = function (file) {
  if (!file) throw new Error('File not specified');
  if (!existsSync(file)) return;

  // console.log('loading', file);
  var code = coffee.compile(fs.readFileSync(file).toString());
  var dir = path.dirname(file);
  var fn = new Function('deplosha', '__dirname', 'with(deplosha){(function(){ ' + code + ' })();}');
  fn(this, dir);
};

/**
 * Exit with status 1 and error message `msg`
 *
 * @param {String} msg
 */
Deplosha.prototype.abort = function (msg) {
  log($(msg).red);
  process.exit(1);
};

/**
 * Define namespace. No namespace nesting!
 */
Deplosha.prototype.namespace = function (name, callback) {
  if (deplosha.ns) {
    throw new Error('Nested namespaces is not supported at the mo');
  }
  deplosha.ns = name;
  callback();
  deplosha.ns = '';
};

/**
 * Run tasks listed as arguments sequentially
 */
Deplosha.prototype.sequence = function () {
  var args = arguments;
  var ns = args.callee.caller.ns;
  deplosha.asyncLoop([].slice.call(args), function (arg, next) {
    if (typeof arg === 'function') {
      arg.call(deplosha, next);
    } else {
      deplosha[ns ? ns + ':' + arg : arg].call(deplosha, next);
    }
  });
};

/**
 * Loop asyncronouslythrough `collection` calling `iteration` for each item
 * and then call `complete` (when done)
 */
Deplosha.prototype.asyncLoop = function asyncLoop(collection, iteration, complete) {
  var self = this;
  var item = collection.shift();
  if (item) {
    iteration.call(self, item, function next() {
      asyncLoop.call(self, collection, iteration, complete);
    });
  } else if (typeof complete === 'function') {
    complete.call(self);
  }
};

var description = '';
Deplosha.prototype.desc = function (text) {
  description = text;
};

/**
 * Describe task
 *
 * @param {String} name
 * @param {Function} action
 */
Deplosha.prototype.task = function (name, action) {
  var ns = deplosha.ns;
  var fullname = ns + ':' + name;
  deplosha[fullname] = function task(done) {
    var displayName = name === 'default' ? ns : fullname;
    log('Executing', displayName);
    var queue = [];
    if (beforeTask[fullname]) {
      queue = queue.concat(beforeTask[fullname]);
    }
    queue.push(function (next) {
      var time = Date.now();
      action(function () {
        if (next) next();
      });
    });
    if (afterTask[fullname]) {
      queue = queue.concat(afterTask[fullname]);
    }
    if (done) queue.push(done);
    deplosha.sequence.apply(deplosha, queue);
  };
  action.ns = ns;
  action.task = name;

  about[ns] = about[ns] || [];
  about[ns].push({
    name: name,
    description: description
  });
  description = '';
};

Deplosha.prototype.before = function (name, action) {
  beforeTask[name] = beforeTask[name] || [];
  beforeTask[name].push(action);
};

Deplosha.prototype.after = function (name, action) {
  afterTask[name] = afterTask[name] || [];
  afterTask[name].push(action);
};

/**
 * Stylize a string
 */
function stylize(str, style) {
  var styles = {
    'bold'      : [1,  22],
    'italic'    : [3,  23],
    'underline' : [4,  24],
    'cyan'      : [96, 39],
    'blue'      : [34, 39],
    'yellow'    : [33, 39],
    'green'     : [32, 39],
    'red'       : [31, 39],
    'grey'      : [90, 39],
    'green-hi'  : [92, 32],
  };
  return '\033[' + styles[style][0] + 'm' + str +
       '\033[' + styles[style][1] + 'm';
};

/**
 * Stylize string chainable helper, allows to call stylize like that:
 *
 *    $('some string').bold.yellow
 *
 */
function $(str) {
  str = new(String)(str);

  ['bold', 'grey', 'yellow', 'red', 'green', 'cyan', 'blue', 'italic', 'underline'].forEach(function (style) {
    Object.defineProperty(str, style, {
      get: function () {
        return $(stylize(this, style));
      }
    });
  });
  return str;
};
stylize.$ = $;
