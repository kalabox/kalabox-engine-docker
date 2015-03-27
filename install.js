'use strict';

var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var meta = require('./meta.js');

var BOOT2DOCKER = 'Boot2Docker';

module.exports = function(kbox) {

  var sysProfiler = kbox.install.sysProfiler;
  var provider = kbox.engine.provider;
  var shell = kbox.util.shell;

  // Boot2docker installed?
  kbox.install.registerStep(function(step) {
    step.name = 'is-boot2docker-installed';
    step.description = 'Check if boot2docker is installed.';
    step.deps = [];
    // @todo: switch this to provider.isInstalled and remove
    // sysprofile stuff
    step.all.darwin = function(state, done) {
      sysProfiler.isAppInstalled(BOOT2DOCKER, function(err, isInstalled) {
        if (err) {
          done(err);
        } else {
          state.isBoot2DockerInstalled = isInstalled;
          state.log(BOOT2DOCKER + ' is installed?: ' + isInstalled);
          done();
        }
      });
    };
    step.all.linux = function(state, done) {
      provider.isInstalled(function(err, isInstalled) {
        if (err) {
          done(err);
        } else {
          state.isBoot2DockerInstalled = isInstalled;
          state.log(BOOT2DOCKER + ' is installed?: ' + isInstalled);
          done();
        }
      });
    };
  });

  // Boot2docker profile set?
  kbox.install.registerStep(function(step) {
    step.name = 'is-boot2docker-profile-set';
    step.description = 'Check if boot2docker profile is set.';
    step.deps = [];
    step.all = function(state, done) {
      state.boot2dockerProfileFilepath = path.join(
        state.config.sysProviderRoot,
        'profile'
      );
      fs.exists(state.boot2dockerProfileFilepath, function(exists) {
        state.isBoot2dockerProfileSet = exists;
        state.log('Boot2docker profile set?: ' + exists);
        done();
      });
    };
  });

    // Boot2docker profile set?
  kbox.install.registerStep(function(step) {
    step.name = 'is-virtualbox-installed';
    step.description = 'Check if Virtualbox is installed.';
    step.deps = [];
    step.all.linux = function(state, done) {
      var cmd = 'which VBoxManage';
      shell.exec(cmd, function(err, data) {
        state.log(data);
        state.vbIsInstalled = (err) ? false : true;
        state.log('VBoxManage installed?' + state.vbIsInstalled);
        done(null);
      });
    };
  });

  // Download docker dependencies
  kbox.install.registerStep(function(step) {
    step.name = 'gather-boot2docker-dependencies';
    step.description = 'Gathering docker dependencies';
    step.deps = [
      'is-boot2docker-installed',
      'is-boot2docker-profile-set',
      'is-virtualbox-installed'
    ];
    step.subscribes = ['downloads'];
    step.all = function(state) {

      // Boot2docker profile.
      if (!state.isBoot2dockerProfileSet) {
        state.downloads.push(meta.PROVIDER_PROFILE_URL);
      }

      // Boot2docker package.
      if (!state.isBoot2DockerInstalled) {
        state.downloads.push(meta.PROVIDER_DOWNLOAD_URL[process.platform]['b2d']);
      }

      if (process.platform === 'linux' && !state.vbIsInstalled) {
        var nix = kbox.install.linuxOsInfo.get();
        state.downloads.push(
          meta.PROVIDER_DOWNLOAD_URL.linux.vb[nix.ID][nix.VERSION_ID]
        );
      }

    };
  });

  // Setup Boot2docker profile.
  kbox.install.registerStep(function(step) {
    step.name = 'boot2docker-profile';
    step.description = 'Setup the boot2docker profile.';
    step.deps = ['gather-boot2docker-dependencies'];
    step.all = function(state, done) {
      if (!state.isBoot2dockerProfileSet) {
        mkdirp.sync(state.config.sysProviderRoot);
        var src = path.join(
          state.downloadDir,
          path.basename(meta.PROVIDER_PROFILE_URL)
        );
        var dst = state.boot2dockerProfileFilepath;
        fs.rename(src, dst, function(err) {
          if (err) {
            state.log(state.status.notOk);
            done(err);
          } else {
            state.log(state.status.ok);
            done();
          }
        });
      } else {
        state.log(state.status.ok);
        done();
      }
    };
  });

  // Install Boot2docker.
  kbox.install.registerStep(function(step) {
    step.name = 'install-engine';
    step.description  = 'Install boot2docker package.';
    step.deps = [
      'boot2docker-profile',
      'gather-boot2docker-dependencies'
    ];
    step.subscribes = [];
    step.all.darwin = function(state, done) {
      if (!state.isBoot2DockerInstalled) {
        kbox.util.disk.getMacVolume(function(err, volume) {
          if (err) {
            state.log(state.status.notOk);
            done(err);
          } else {
            var pkg = path.join(
              state.downloadDir,
              path.basename(PROVIDER_URL_PACKAGE)
            );
            var cmd = kbox.install.cmd.buildInstallCmd(pkg, volume);
            var cmds = [cmd];
            var child = kbox.install.cmd.runCmdsAsync(cmds);
            child.stdout.on('data', function(data) {
              state.log(data);
            });
            child.stdout.on('end', function() {
              state.log(state.status.ok);
              done();
            });
            child.stderr.on('data', function(data) {
              state.log(state.status.notOk);
              done(new Error(data));
            });
          }
        });
      } else {
        state.log(state.status.ok);
        done();
      }
    };
    step.all.linux = function(state, done) {
      console.log("engine install");
      done();
    };
  });

  // Init and start Boot2docker.
  kbox.install.registerStep(function(step) {
    step.name = 'init-engine';
    step.description = 'Init and start boot2docker';
    step.deps = ['install-engine'];
    step.all = function(state, done) {
      var iso = path.join(state.config.sysProviderRoot, 'boot2docker.iso');
      console.log('iso -> ' + iso);
      var exists = fs.existsSync(iso);
      console.log('exists -> ' + exists);
      if (exists) {
        fs.unlinkSync(iso);
      }
      kbox.engine.provider.up(function(err, data) {
        if (data) {
          state.log(data);
        }

        if (err) {
          state.log(state.status.notOk);
          done(err);
        } else {
          state.log(state.status.ok);
          done();
        }
      });
    };
  });

};
