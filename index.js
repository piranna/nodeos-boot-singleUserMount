#!/usr/bin/env node

var fs = require('fs')

var spawn = require('child_process').spawn

var errno = require('src-errno');
var mount = require('src-mount');


// dev - needed to mount external filesystems (is there an alternative?)

var path = '/dev';

var res = mount.mount('udev', path, 'devtmpfs', null, 'mode=0755');
if(res == -1) console.error('Error while mounting',path)


/*
// proc

var path = '/proc';
var flags  = mount.flags.MS_NODEV | mount.flags.MS_NOEXEC | mount.flags.MS_NOSUID;

fs.mkdirSync(path)
var res = mount.mount('proc', path, 'proc', flags, '');
if(res == -1) console.error('Error while mounting',path)
*/


// Mount users filesystem

if(process.argv.length > 2)
{
  var dev    = process.argv[2];
  var path   = '/home';
  var type   = 'ext4';
  var flags  = mount.flags.MS_NODEV;
  var extras = 'errors=remount-ro';

  fs.mkdirSync(path)
  var res = mount.mount(dev, path, type, flags, extras);

  if(res == 0)
  {
    // [ToDo] remove from rootfs the files only needed on boot to free memory

    const HOME = '/home/root'

    var env = {}
    for(var key in process.env)
      env[key] = process.env[key];

    env.HOME = HOME
    env.PATH = HOME+'/bin:/usr/bin'

    return spawn(HOME+'/bin/nsh', [], {cwd: HOME, detached: true, env: env, stdio: 'inherit'});
  }

  console.error(res,'Error '+errno.getErrorString()+' while mounting',path)
}


// Error booting, enable REPL

console.log('Starting REPL session')

require("repl").start("NodeOS> ")
