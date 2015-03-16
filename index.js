#!/usr/bin/env node

var fs = require('fs')

var chroot = require('posix').chroot;
var rimraf = require('rimraf').sync;

var mount = require('nodeos-mount');
var utils = require('nodeos-mount-utils');


const pathRootfs  = '/tmp/.rootfs';
const pathOverlay = '/tmp/.overlay';


function onerror(error)
{
  if(error)
  {
    // Error mounting the root filesystem or executing init, enable REPL
    console.trace(error)
    utils.startRepl('NodeOS-mount-filesystems')
  }
}

function linuxCmdline(cmdline)
{
  var result = {}

  cmdline.split(' ').forEach(function(arg)
  {
    arg = arg.split('=');

    var val = true
    if(arg.length > 1)
    {
      val = arg.slice(1).join("=").split(',')
      if(val.length === 1) val = val[0]
    }

    result[arg[0]] = val;
  })

  return result
}


function overlay_tmpfs()
{
  const pathTmpfs = '/.tmpfs';

  const flags = mount.MS_NODEV | mount.MS_NOSUID;

  utils.mkdirMount('tmpfs', pathTmpfs, 'tmpfs', flags, function(error)
  {
    if(error) return onerror(error)

    fs.mkdirSync(pathTmpfs+'/root'    , '0100')
    fs.mkdirSync(pathTmpfs+'/.workdir', '0100')

    // Craft overlayed filesystem
    var type   = 'overlay';
    var extras =
    {
      lowerdir: ['/', pathRootfs].join(':'),
      upperdir: pathTmpfs+'/root',
      workdir : pathTmpfs+'/.workdir'
    };

    utils.mkdirMount('', pathOverlay, type, extras, function(error)
    {
      if(error) return onerror(error)

      // Move kernel filesystems to overlayed filesystem
      utils.moveSync('/dev' , pathOverlay+'/dev');
      utils.moveSync('/proc', pathOverlay+'/proc');
//      utils.moveSync('/sys' , pathOverlay+'/sys');

      // Move overlayed filesytem
      process.chdir(pathOverlay)
      utils.move('.', '/', function(error)
      {
        if(error)
        {
          console.error('Error moving overlayed filesystem to /')
          return onerror(error)
        }

        chroot('.')

        // Execute init
        utils.execInit('/.', process.argv.slice(2), onerror)
      });
    });
  })
}

function overlay_users(usersDev, type)
{
  // Mount users filesystem
  var flags  = mount.MS_NODEV | mount.MS_NOSUID;
  var extras = {errors: 'remount-ro'};

  utils.mkdirMount(usersDev, '/home', type, flags, extras, function(error)
  {
    if(error) return onerror(error)

    // Craft overlayed filesystem
    var type   = 'overlay';
    var extras =
    {
      lowerdir: ['/', pathRootfs].join(':')
    };

    utils.mkdirMount('', pathOverlay, type, extras, function(error)
    {
      if(error) return onerror(error)

      // Move kernel filesystems to overlayed filesystem
      utils.moveSync('/dev' , pathOverlay+'/dev');
      utils.moveSync('/home', pathOverlay+'/home');
      utils.moveSync('/proc', pathOverlay+'/proc');
//      utils.moveSync('/sys' , pathOverlay+'/sys');

      // Move overlayed filesytem
      process.chdir(pathOverlay)
      utils.move('.', '/', function(error)
      {
        if(error)
        {
          console.error('Error moving overlayed filesystem to /')
          return onerror(error)
        }

        chroot('.')

        // Mount users directories and exec their init files
        fs.readdir('/home', function(error, users)
        {
          if(error) return onerror(error)

          users.forEach(function(user)
          {
            if(user[0] === '.') return;

            overlay_user(user)
          })
        })
      });
    });
  })
}

function overlay_user(user)
{
  try
  {
    fs.mkdirSync('/home/.workdirs/'+user, '0100')
  }
  catch(error)
  {
    if(error.code != 'EEXIST') throw error
  }

  // Craft overlayed filesystem
  var type   = 'overlay';
  var extras =
  {
    lowerdir: '/',
    upperdir: '/home/'+user,
    workdir : '/home/.workdirs/'+user
  };

  mount.mount('', '/home/'+user, type, extras, function(error)
  {
    if(error) console.warn(error)

    const flags = mount.MS_NODEV | mount.MS_NOSUID;

    utils.mkdirMount('tmpfs', '/home/'+user+'/tmp', 'tmpfs', flags, function(error)
    {
      if(error) return onerror(error)

      // Execute init
      utils.execInit('/home/'+user, [], function(error)
      {
        if(error) console.warn(error)
      })
    })
  });
}


function overlayfsroot(cmdline)
{
  const type  = cmdline.rootfstype || 'auto';
  const flags = mount.MS_NODEV | mount.MS_NOSUID | mount.MS_RDONLY;

  utils.mountfs_path(cmdline.root, pathRootfs, type, flags, function(error)
  {
    if(error) return onerror(error)

    var usersDev = cmdline.users
    if(usersDev)
      overlay_users(usersDev, cmdline.usersfstype || 'auto')
    else
    {
      console.warn('*** Users filesytem is not defined, will use a tmpfs instead  ***')
      console.warn('*** ALL YOUR CHANGES WILL BE LOST IF NOT SAVED IN OTHER PLACE ***')
      overlay_tmpfs()
    }
  });
}


// Change umask system wide so new files are accesible ONLY by its owner
process.umask(0066);

// Remove from rootfs the files only needed on boot to free memory
rimraf('/bin/century')
rimraf('/bin/nodeos-mount-filesystems')
rimraf('/init')
rimraf('/lib/node_modules')
rimraf('/sbin')

// Mount kernel filesystems
var flags = mount.MS_NODEV | mount.MS_NOEXEC | mount.MS_NOSUID

utils.mkdirMount('udev', '/dev', 'devtmpfs', {mode: 0755}, function onerror_nodev(error)
{
  if(error) console.warn(error);

  utils.mkdirMount('proc', '/proc', 'proc', flags, function onerror_nodev(error)
  {
    if(error) console.warn(error);

    var cmdline = linuxCmdline(fs.readFileSync('/proc/cmdline', {encoding: 'utf8'}));

    // Mount root filesystem
    overlayfsroot(cmdline)
  })
})
