#!/usr/bin/env node

var fs = require('fs')

var spawn = require('child_process').spawn

var rimraf = require('rimraf').sync;

var errno = require('src-errno');
var mount = require('src-mount');


function mkdirMount(dev, path, type, flags, extras)
{
  if(typeof flags == 'string')
  {
    extras = flags
    flags = undefined
  }

  flags = flags || null
  extras = extras || ''

  try
  {
    fs.mkdirSync(path)
//    fs.mkdirSync(path, '0000')
  }
  catch(error)
  {
    if(error.code != 'EEXIST') throw error
  }

  var res = mount.mount(dev, path, type, flags, extras);
  if(res == -1) console.error('Error '+errno.getErrorString()+' while mounting',path)
  return res
}

function execInit(HOME)
{
  var homeStat = fs.statSync(HOME)

  const initPath = HOME+'/init'

  try
  {
    var initStat = fs.statSync(initPath)
  }
  catch(exception)
  {
    return initPath+' not found'
  }

  if(!initStat.isFile())
    return initPath+' is not a file';

  if(homeStat.uid != initStat.uid || homeStat.gid != initStat.gid)
    return HOME+" uid & gid don't match with its init"

  // Update env with user variables
  var env =
  {
    HOME: HOME,
    PATH: HOME+'/bin:/usr/bin',
    __proto__: process.env
  }

  // Start user's init
  spawn(initPath, [],
  {
    cwd: HOME,
    stdio: 'inherit',
    env: env,
    detached: true,
    uid: homeStat.uid,
    gid: homeStat.gid
  });
}

function aufsroot(dev)
{
  var path   = '/rootfs';
  var type   = 'ext2' //process.env.ROOTFSTYPE || 'auto';
  var extras = 'errors=remount-ro';

  var res = mkdirMount(dev, path, type, extras);
  if(res == 0)
  {
    var path   = '/aufs';
    var type   = 'aufs';
    var extras = 'errors=remount-ro';

    var res = mkdirMount('', path, type, extras);
    if(res == 0)
    {
      var error = execInit('/root/init')
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

mkdirMount('udev', '/dev', 'devtmpfs', 'mode=0755')
mkdirMount('proc', '/proc', 'proc', mount.flags.MS_NODEV
                                  | mount.flags.MS_NOEXEC
                                  | mount.flags.MS_NOSUID)
mkdirMount('sysfs', '/sys', 'sysfs', mount.flags.MS_NODEV
                                   | mount.flags.MS_NOEXEC
                                   | mount.flags.MS_NOSUID)
mkdirMount('tmpfs', '/tmp', 'tmpfs', mount.flags.MS_NODEV
                                   | mount.flags.MS_NOEXEC
                                   | mount.flags.MS_NOSUID, 'mode=1777')


// Mount users filesystem

var ROOT = process.env.ROOT
if(ROOT)
{
  var dev    = ROOT;
  var path   = '/root';
  var type   = 'ext2' //process.env.ROOTFSTYPE || 'auto';
  var extras = 'errors=remount-ro';

  res = mkdirMount(dev, path, type, extras);
  if(res == 0)
  {
    delete process.env.ROOT

    var error = execInit(path)
    if(!error) return;

    console.warn(error)
  }
}
else
  console.warn('ROOT filesystem not defined')


// Error booting, enable REPL

console.log('Starting REPL session')

require("repl").start("NodeOS-rootfs> ").on('exit', function()
{
  console.log('Got "exit" event from repl!');
  process.exit(2);
});
