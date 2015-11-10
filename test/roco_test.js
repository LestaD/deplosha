if (!process.env.TRAVIS) {
    var semicov = require('semicov');
    semicov.init('lib'); process.on('exit', semicov.report);
}
var rockout = require('../lib/rockout');
var deplosha;

exports['init'] = function (test) {
    deplosha = rockout.init();
    test.equal(deplosha.constructor.name, 'Deplosha');
    test.done();
};

exports['perform non-existant task'] = function (test) {
    var abort = deplosha.abort;
    deplosha.abort = function (msg) {
        test.ok(msg.match('Unknown command test'));
        deplosha.abort = abort;
        test.done();
    };
    rockout.perform('test');
};

exports['define and perform task'] = function (test) {
    deplosha.ns = 'ns';
    deplosha.task('test', function () {
        test.done();
    });
    deplosha.env = 'staging';
    rockout.perform('ns:test');
};

exports['run command on remote server and locally'] = function (test) {
    test.expect(3);
    var cp = require('child_process');
    var spawn = cp.spawn;
    deplosha.ns = 'test';
    deplosha.set('hosts', ['some.host', 'another.host']);
    deplosha.task('default', function () {
        deplosha.run('cmd remote', function () {
            deplosha.localRun('cmd local', function () {
                cp.spawn = spawn;
                process.nextTick(test.done);
            });
        });
    });
    var cmdStack = ['sh', 'ssh', 'ssh'];
    cp.spawn = function (cmd, opts) {
        test.equal(cmd, cmdStack.pop());
        var proc = new process.EventEmitter;
        proc.stderr = proc.stdout = proc;
        process.nextTick(function () {
            proc.emit('exit', 0);
        });
        return proc;
    };
    rockout.perform('test');
};

exports['print list of commands'] = function (test) {
    rockout.list();
    test.done();
};

