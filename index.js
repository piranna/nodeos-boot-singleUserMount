#!/usr/bin/env node

var chroot = require('posix').chroot;
var rimraf = require('rimraf').sync;

var mount = require('nodeos-mount');

var utils = require('nodeos-mount-utils');


const pathRootfs    = '/.rootfs';
const pathOverlayfs = '/.overlayfs';


function onerror(error)
{
  // Error mounting the root filesystem or executing init, enable REPL
  console.warn(error)
  utils.startRepl('NodeOS-mount-rootfs')
}

function overlayfsroot(envDev)
{
  var flags  = mount.flags.MS_NODEV | mount.flags.MS_NOSUID;

  // Mount root filesystem
  var type   = process.env.ROOTFSTYPE || 'auto';
  var extras = {errors: 'remount-ro'};

  utils.mountfs(envDev, pathRootfs, type, flags, extras, function(error)
  {
    if(error) return onerror(error)

    // Craft overlayed filesystem
    var type   = 'overlay';
//      var extras = {lowerdir: pathRootfs};
    var extras =
    {
      lowerdir: '/',
      upperdir: pathRootfs+'/rootfs',
      workdir : pathRootfs+'/workdir'
    };

    utils.mkdirMount('', pathOverlayfs, type, extras, function(error)
//      utils.mkdirMount('', pathOverlayfs, type, mount.flags.MS_RDONLY, extras, function(error)
    {
      if(error) return onerror(error)

      var path  = '/';

      // Re-mount initram as read-only
      var flags = mount.flags.MS_REMOUNT | mount.flags.MS_RDONLY;

      mount.mount('', path, flags, function(error)
      {
        if(error)
        {
          console.error('Error re-mounting '+path+' as read-only')
          return onerror(error)
        }

        // Move kernel filesystems to overlayed filesystem
        mount.mount('/dev' , pathOverlayfs+'/dev' , mount.flags.MS_MOVE);
        mount.mount('/proc', pathOverlayfs+'/proc', mount.flags.MS_MOVE);
//        mount.mount('/sys' , pathOverlayfs+'/sys' , mount.flags.MS_MOVE);
        mount.mount('/tmp' , pathOverlayfs+'/tmp' , mount.flags.MS_MOVE);

        // Move overlayed filesytem to /
        process.chdir(pathOverlayfs)
        mount.mount('.', path, mount.flags.MS_MOVE, function(error)
        {
          if(error)
          {
            console.error('Error moving overlayed filesystem to /')
            return onerror(error)
          }

          chroot('.')

          // Execute init
          var argv = process.argv.slice(2)
          var error = utils.execInit('/root', argv)
//          var error = utils.execInit(path, argv)
          if(error) onerror(error);
        });
      });
    });
  });
}


// Change umask system wide so new files are accesible ONLY by its owner
process.umask(0066);

// Remove from rootfs the files only needed on boot to free memory
//rimraf('/bin')
rimraf('/init')
//rimraf('/lib/node_modules')
rimraf('/sbin')

// Mount kernel filesystems
var flags = mount.flags.MS_NODEV | mount.flags.MS_NOEXEC | mount.flags.MS_NOSUID

utils.mkdirMount('udev' , '/dev' , 'devtmpfs', 'mode=0755')
utils.mkdirMount('proc' , '/proc', 'proc'  , flags)
// utils.mkdirMount('sysfs', '/sys', 'sysfs', flags)
utils.mkdirMount('tmpfs', '/tmp' , 'tmpfs' , flags, 'mode=1777')

// Mount root filesystem
overlayfsroot('ROOT')
