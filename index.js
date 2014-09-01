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

    fs.readdirSync(path).forEach(function(file)
    {
      const HOME = path+'/'+file

      var homeStat = fs.statSync(HOME)
      if(!homeStat.isDirectory()) return;

      const initPath = HOME+'/init'

      try
      {
        var initStat = fs.statSync(initPath)
      }
      catch(exception){return}
      if(!initStat.isFile()) return;

      if(homeStat.uid != initStat.uid || homeStat.gid != initStat.gid)
        return console.warning(HOME+" uid & gid don't match with its init")

      // Update env with user variables
      var env = {}
      for(var key in process.env)
        env[key] = process.env[key];

      env.HOME = HOME
      env.PATH = HOME+'/bin:/usr/bin'

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
    })

    return
  }

  console.error(res,'Error '+errno.getErrorString()+' while mounting',path)


  // Error booting, enable REPL

  console.log('Starting REPL session')

  require("repl").start("NodeOS> ")
}
else
  console.warning('Users filesystem not defined')
