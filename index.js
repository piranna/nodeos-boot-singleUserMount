#!/usr/bin/env node

var chroot = require('posix').chroot;
var rimraf = require('rimraf').sync;

var mount = require('nodeos-mount');

var utils = require('nodeos-mount-utils');


const pathRootfs  = '/.rootfs';
const pathOverlay = '/.overlay';


function onerror(error)
{
  // Error mounting the root filesystem or executing init, enable REPL
  console.trace(error)
  utils.startRepl('NodeOS-mount-rootfs')
}

function onerror_nodev(error)
{
  if(error) console.warn(error);
}


function overlayfsroot(envDev)
{
  var flags  = mount.MS_NODEV | mount.MS_NOSUID;

  // Mount root filesystem
  var type   = process.env.ROOTFSTYPE || 'auto';
  var extras = {errors: 'remount-ro'};

  utils.mountfs(envDev, pathRootfs, type, flags, extras, function(error)
  {
    if(error) return onerror(error)

    // Craft overlayed filesystem
    var type   = 'overlay';
//    var extras = {lowerdir: pathRootfs};
    var extras =
    {
      lowerdir: '/',
      upperdir: pathRootfs+'/rootfs',
      workdir : pathRootfs+'/workdir'
    };

    utils.mkdirMount('', pathOverlay, type, extras, function(error)
//    utils.mkdirMount('', pathOverlay, type, mount.MS_RDONLY, extras, function(error)
    {
      if(error) return onerror(error)

      var path  = '/';

      // Re-mount initram as read-only
      var flags = mount.MS_REMOUNT | mount.MS_RDONLY;

      mount.mount('', path, flags, function(error)
      {
        if(error)
        {
          console.error('Error re-mounting '+path+' as read-only')
//          return onerror(error)
        }

        // Move kernel filesystems to overlayed filesystem
        mount.mountSync('/dev' , pathOverlay+'/dev' , mount.MS_MOVE);
        mount.mountSync('/proc', pathOverlay+'/proc', mount.MS_MOVE);
//        mount.mountSync('/sys' , pathOverlay+'/sys' , mount.MS_MOVE);
        mount.mountSync('/tmp' , pathOverlay+'/tmp' , mount.MS_MOVE);

        // Move overlayed filesytem
        process.chdir(pathOverlay)
        mount.mount('.', path, mount.MS_MOVE, function(error)
        {
          if(error)
          {
            console.error('Error moving overlayed filesystem to '+path)
            return onerror(error)
          }

          chroot('.')

          // Execute init
          utils.execInit('/root', process.argv.slice(2), onerror)
//          utils.execInit(path, process.argv.slice(2), onerror)
        });
      });
    });
  });
}


// Change umask system wide so new files are accesible ONLY by its owner
process.umask(0066);

// Remove from rootfs the files only needed on boot to free memory
rimraf('/bin/century')
rimraf('/bin/nodeos-mount-rootfs')
rimraf('/init')
rimraf('/lib/node_modules')
rimraf('/sbin')

// Mount kernel filesystems
var flags = mount.MS_NODEV | mount.MS_NOEXEC | mount.MS_NOSUID

utils.mkdirMount('udev' , '/dev' , 'devtmpfs', {mode: 0755}, onerror_nodev)
utils.mkdirMount('proc' , '/proc', 'proc'  , flags, onerror_nodev)
// utils.mkdirMount('sysfs', '/sys', 'sysfs', flags, onerror_nodev)
utils.mkdirMount('tmpfs', '/tmp' , 'tmpfs' , flags, {mode: 1777}, onerror_nodev)

// Mount root filesystem
overlayfsroot('ROOT')
