
## Deplosha

> Deplosha is a fork of [Roco](http://npmjs.com/roco)

Command line tool allows you to execute commands on remote server(s) or locally.
Useful for deployment, monitoring and other tasks.

## Installation

    npm install deplosha -g

## Usage

    deplosha deploy:setup   # prepare deploy (create directories)
    deplosha deploy         # update code and restart server

## Configuring

Use one of three ways for configuring your app: package.json, deplosha.coffee or ENV vars

### package.json

deplosha looking for package.json in working directory and set these variables:

- `pkg.name` as `application`
- `pkg.repository.name` as `repository`
- `pkg.repository.type` as `scm`

### Roco.coffee

deplosha looking for Roco.coffee file in `/etc/deplosha.coffee`, `~/.deplosha.coffee`, `./Deplosha.coffee`, `./config/Deplosha.coffee` paths

This files can extend behavior of deplosha and configure variables. Checkout examples to learn how to use it

## Examples

### my ~/.deplosha.coffee file

```coffee-script
namespace 'deploy', ->
    # show status of running application
    task 'status', ->
        run "sudo status #{deplosha.application}"

namespace 'git', ->
    # setup remote private repo
    task 'remote', ->
        app = deplosha.application
        run """
        mkdir #{app}.git;
        cd #{app}.git;
        git --bare init;
        true
        """, (res) ->
            localRun """
            git remote add origin #{res[0].host}:#{app}.git;
            git push -u origin master
            """

# some tasks for monitoring server state
namespace 'i', ->
    task 'disk', (done) -> run 'df -h', done
    task 'top',  (done) -> run 'top -b -n 1 | head -n 12', done
    task 'who',  (done) -> run 'who', done
    task 'node', (done) -> run 'ps -eo args | grep node | grep -v grep', done
    task 'free', (done) -> run 'free', done

    task 'all', (done) ->
        sequence 'top', 'free', 'disk', 'node', done

    # display last 100 lines of application log
    task 'log', ->
        run "tail -n 100 #{deplosha.sharedPath}/log/#{deplosha.env}.log"
```

## Deploy

Current deploy script allows you deploy upstart-controlled applications out of box, just run

    deplosha deploy:setup:upstart

to setup upstart script and create dirs, if you use another solution for node daemon management
feel free to rewrite start/stop/restart scripts:

```coffee-script
namespace 'deploy', ->
    task 'start', (done) -> run "cd #{deplosha.currentPath}; forever start server.js"
    task 'stop', (done) -> run "cd #{deplosha.currentPath}; forever stop"
```

## Another snippets

### Update nodejs on server(s)

~/.deplosha.coffee:

```coffee-script
set 'nodever', '0.8.10'
namespace 'node', ->
  task 'update', (done) -> sequence 'download', 'unpack', 'compile', 'install', done
  task 'rebuild', (done) -> sequence 'unpack', 'compile', 'install', done
  task 'download', (done) ->
    run "cd /tmp && wget http://nodejs.org/dist/v#{deplosha.nodever}/node-v#{deplosha.nodever}.tar.gz", done
  task 'unpack', (done) ->
    run "cd /tmp && tar xfv node-v#{deplosha.nodever}.tar.gz", done
  task 'compile', (done) ->
    run "cd /tmp/node-v#{deplosha.nodever} && ./configure && make", done
  task 'install', (done) ->
    run "cd /tmp/node-v#{deplosha.nodever} && sudo make install", done
```

Example: update nodejs on `localhost` and `railwayjs.com` hosts

    HOSTS=localhost,railwayjs.com deplosha node:update

## License

MIT
