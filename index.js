#!/usr/bin/env node

var rimraf = require('rimraf').sync;

var mount = require('src-mount');

var utils = require('nodeos-mount-utils');


function aufsroot(dev)
{
  var path   = '/rootfs';
  var type   = 'ext2' //process.env.ROOTFSTYPE || 'auto';
  var extras = 'errors=remount-ro';

  var res = utils.mkdirMount(dev, path, type, extras);
  if(res == 0)
  {
    var path   = '/aufs';
    var type   = 'aufs';
    var extras = 'errors=remount-ro';

    var res = utils.mkdirMount('', path, type, extras);
    if(res == 0)
    {
      var error = utils.execInit('/root/init')
      if(!error) return;

      return error
    }
  }
}


// Remove from rootfs the files only needed on boot to free memory

rimraf('/init')
rimraf('/bin')
rimraf('/lib/node_modules')


// Mount kernel filesystems

utils.mkdirMount('udev', '/dev', 'devtmpfs', 'mode=0755')
utils.mkdirMount('proc', '/proc', 'proc', mount.flags.MS_NODEV
                                        | mount.flags.MS_NOEXEC
                                        | mount.flags.MS_NOSUID)
utils.mkdirMount('sysfs', '/sys', 'sysfs', mount.flags.MS_NODEV
                                         | mount.flags.MS_NOEXEC
                                         | mount.flags.MS_NOSUID)
utils.mkdirMount('tmpfs', '/tmp', 'tmpfs', mount.flags.MS_NODEV
                                         | mount.flags.MS_NOEXEC
                                         | mount.flags.MS_NOSUID, 'mode=1777')


// Mount root filesystem

var envDev = 'ROOT';
var path   = '/root';
var type   = 'ext4' //process.env.ROOTFSTYPE || 'auto';
var extras = 'errors=remount-ro';

utils.mountfs(envDev, path, type, extras, function(error)
{
  if(!error)
  {
    error = utils.execInit(path)
    if(!error) return;
  }

  // Error mounting the root filesystem, enable REPL

  console.warn(error)

  utils.startRepl('NodeOS-rootfs')
})
