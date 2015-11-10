path = require('path')

ensure 'application', ->
    abort 'Please specify application name, set "application", "foo"'
ensure 'repository', ->
    abort 'Please specify repository url, set "repository", "/home/git/myrepo.git"'
ensure 'hosts', ->
    abort 'Specify ssh hosts to run commands on, set "hosts", ["example.com", "git@example.com"]'

ensure 'keepReleases', -> 5
ensure 'env',          'production'
ensure 'scm',          'git'
ensure 'branch',       'master'
ensure 'deployTo', ->  "/var/www/apps/#{deplosha.application}/#{deplosha.env}"
ensure 'releaseName',  Date.now()
ensure 'releasesDir',  'releases'
ensure 'sharedDir',    'shared'
ensure 'currentDir',   'current'
ensure 'releasesPath', -> path.resolve(deplosha.deployTo, deplosha.releasesDir)
ensure 'sharedPath',   -> path.resolve(deplosha.deployTo, deplosha.sharedDir)
ensure 'currentPath',  -> path.resolve(deplosha.deployTo, deplosha.currentDir)
ensure 'releasePath',  -> path.resolve(deplosha.releasesPath, ''+deplosha.releaseName)
ensure 'previousReleasePath', -> path.resolve(deplosha.releasesPath, ''+deplosha.previousRelease)
ensure 'latestReleasePath', -> path.resolve(deplosha.releasesPath, ''+deplosha.latestRelease)
ensure 'env', 'production'
ensure 'nodeEntry', 'index.js'
ensure 'appPort', process.env.APP_PORT || process.env.PORT || 3003
ensure 'job', ->
    if deplosha.env == 'production'
        deplosha.application
    else
        deplosha.application + '-' + deplosha.env

namespace 'deploy', ->

    task "test", ->
        run 'ps aux | grep node', (data) ->
            console.log data

    desc """
        Update code and restart server
    """
    task 'default', (done) -> sequence 'update', 'restart', done

    desc """
        Pull latest changes from SCM and symlink latest release
        as current release
    """
    task 'update', (done) -> sequence 'prepare', 'updateCode', 'symlink', done

    task 'prepare', (done) ->
        run "ls -x #{deplosha.releasesPath}", (res) ->
            rs = res[0].out.replace(/^\s+|\s+$/g, '').split(/\s+/).sort()
            set 'releases', rs
            set 'latestRelease', rs[rs.length - 1]
            set 'previousRelease', rs[rs.length - 2]
            done()

    task 'updateCode', (done) ->
        localRun "git ls-remote #{deplosha.repository} #{deplosha.branch}", (x) ->
            head = x.split(/\s+/).shift()
            run """
                if [ -d #{deplosha.sharedPath}/cached-copy ];
                  then cd #{deplosha.sharedPath}/cached-copy &&
                  git fetch -q origin && git fetch --tags -q origin &&
                  git reset -q --hard #{head} && git clean -q -d -f;
                  git submodule update --init
                else
                  git clone -q #{deplosha.repository} #{deplosha.sharedPath}/cached-copy &&
                  cd #{deplosha.sharedPath}/cached-copy &&
                  git checkout -q -b deploy #{head};
                  git submodule update --init
                fi
                """, ->
                    run """
                        cd #{deplosha.sharedPath}/cached-copy;
                        npm install -l;
                        cp -RPp #{deplosha.sharedPath}/cached-copy #{deplosha.releasePath}
                        """, done

      task 'cleanup', (done) -> sequence 'prepare', 'removeOldReleases', done

      task 'removeOldReleases', (done) ->
        return console.log('Nothing to cleanup', done()) if deplosha.releases.length <= deplosha.keepReleases
        console.log "Deleting #{deplosha.releases.length - deplosha.keepReleases} releases, keep latest #{deplosha.keepReleases} releases"
        run "cd #{deplosha.releasesPath} && rm -rf #{deplosha.releases.slice(0, -deplosha.keepReleases).join(' ')}", done

    desc """
        Remove current symlink, symlink current release and log file
    """
    task 'symlink', (done) ->
        run """
          rm -f #{deplosha.currentPath};
          ln -s #{deplosha.releasePath} #{deplosha.currentPath};
          ln -s #{deplosha.sharedPath}/log #{deplosha.currentPath}/log;
          true
          """, done

    desc """
        Restart upstart job, or start if job is not running
    """
    task 'restart', (done) ->
        run "sudo restart #{deplosha.job} || sudo start #{deplosha.job}", done

    desc "Start upstart job"
    task 'start', (done) ->
        run "sudo start #{deplosha.job}", done

    desc "Stop upstart job"
    task 'stop', (done) ->
        run "sudo stop #{deplosha.job}", done

    desc """
        Rollback current release. Removes current symlink, symlink previous,
        restart process and remove code.
    """
    task 'rollback', (done) ->
        sequence 'prepare', 'rollback:code', 'restart', 'rollback:cleanup', done

    task 'rollback:code', (done) ->
        if deplosha.previousRelease
            run "rm #{deplosha.currentPath}; ln -s #{deplosha.previousReleasePath} #{deplosha.currentPath}", done

    task 'rollback:cleanup', (done) ->
        run "if [ `readlink #{deplosha.currentPath}` != #{deplosha.latestReleasePath} ]; then rm -rf #{deplosha.latestReleasePath}; fi", done

    task 'setup', (done) ->
        dirs = [deplosha.deployTo, deplosha.releasesPath, deplosha.sharedPath, deplosha.sharedPath + '/log'].join(' ')
        run """
            NAME=`whoami`;
            sudo mkdir -p #{dirs} &&
            sudo chown -R $NAME:$NAME #{dirs}
            """, done

    task 'setup:upstart', (done) ->
        sequence 'setup', 'writeUpstartScript', done

    task 'writeUpstartScript', (done) ->
        maybeEnv = ''
        maybeEnv = "env NODE_ENV=\"#{deplosha.env}\"" if deplosha.env

        maybePort = ''
        maybePort = "env PORT=#{deplosha.appPort}" if deplosha.appPort

        ups = """
          description "#{deplosha.application}"

          start on startup
          stop on shutdown

          #{maybePort}
          #{maybeEnv}

          script
              export PORT
              export NODE_ENV

              cd #{deplosha.currentPath}
              /usr/local/bin/node #{deplosha.currentPath}/#{deplosha.nodeEntry} >> #{deplosha.currentPath}/log/#{deplosha.env}.log
          end script
          respawn
          """

        if deplosha.env == 'production'
            file = deplosha.application
        else
            file = "#{deplosha.application}-#{deplosha.env}"

        run "sudo echo '#{ups}' > /tmp/upstart.tmp && sudo mv /tmp/upstart.tmp /etc/init/#{file}.conf", done

