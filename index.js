#!/usr/bin/env node

var chroot = require('posix').chroot;
var rimraf = require('rimraf').sync;

var mount = require('src-mount');

var utils = require('nodeos-mount-utils');


const pathRootfs    = '/.rootfs';
const pathOverlayfs = '/.overlayfs';


function overlayfsroot(envDev)
{
  var flags  = mount.flags.MS_NODEV | mount.flags.MS_NOSUID;

  // Mount root filesystem
  var type   = 'ext4' //process.env.ROOTFSTYPE || 'auto';
  var extras = 'errors=remount-ro';

  utils.mountfs(envDev, pathRootfs, type, flags, extras, function(error)
  {
    if(!error)
    {
      // Craft overlayed filesystem
      var type   = 'overlay';
//      var extras = 'lowerdir='+pathRootfs+':/';
      var extras = 'lowerdir=/,upperdir='+pathRootfs+'/rootfs,workdir='+pathRootfs+'/workdir';

      var res = utils.mkdirMount('', pathOverlayfs, type, extras);
//      var res = utils.mkdirMount('', pathOverlayfs, type, mount.flags.MS_RDONLY, extras);
      if(res == 0)
      {
        var path  = '/';

        // Re-mount initram as read-only
        var flags = mount.flags.MS_REMOUNT | mount.flags.MS_RDONLY;

        var res = mount.mount('', path, '', flags, '');
        if(res == -1) console.error('Error re-mounting '+path+' as read-only')

        // Move kernel filesystems to overlayed filesystem
        mount.mount('/dev' , pathOverlayfs+'/dev' , '', mount.flags.MS_MOVE);
        mount.mount('/proc', pathOverlayfs+'/proc', '', mount.flags.MS_MOVE);
//        mount.mount('/sys', pathOverlayfs+'/sys' , '', mount.flags.MS_MOVE);
        mount.mount('/tmp' , pathOverlayfs+'/tmp' , '', mount.flags.MS_MOVE);

        // Move overlayed filesytem to /
        process.chdir(pathOverlayfs)
        var res = mount.mount('.', path, '', mount.flags.MS_MOVE);
        if(res == 0)
        {
          chroot('.')

          // Execute init
          var argv = process.argv.slice(2)
          var error = utils.execInit('/root', argv)
//          var error = utils.execInit(path, argv)
          if(!error) return;
        }

        console.error('Error moving overlayed filesystem to /')
      }
    }

    // Error mounting the root filesystem or executing init, enable REPL
    console.warn(error)
    utils.startRepl('NodeOS-mount-rootfs')
  });
}


// Change umask system wide so new files are accesible ONLY by its owner
process.umask(0066);

// Remove from rootfs the files only needed on boot to free memory
rimraf('/bin')
rimraf('/init')
rimraf('/lib/node_modules')
rimraf('/sbin')

// Mount kernel filesystems
var flags = mount.flags.MS_NODEV | mount.flags.MS_NOEXEC | mount.flags.MS_NOSUID

utils.mkdirMount('udev' , '/dev' , 'devtmpfs', 'mode=0755')
utils.mkdirMount('proc' , '/proc', 'proc'  , flags)
// utils.mkdirMount('sysfs', '/sys', 'sysfs', flags)
utils.mkdirMount('tmpfs', '/tmp' , 'tmpfs' , flags, 'mode=1777')

// Mount root filesystem
overlayfsroot('ROOT')
