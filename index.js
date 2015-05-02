#!/usr/bin/env node
var fs = require('fs')

var each   = require('async').each;
var mkdirp = require('mkdirp').sync;
var rimraf = require('rimraf').sync;

var mount = require('nodeos-mount');
var utils = require('nodeos-mount-utils');


const flags = mount.MS_NODEV | mount.MS_NOSUID
const HOME = '/tmp/users'


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


function mountDevProcTmp_ExecInit(upperdir, callback)
{
  mount.mount('/dev', upperdir+'/dev', mount.MS_BIND, function(error)
  {
    if(error) return callback(error)

    mount.mount('/proc', upperdir+'/proc', mount.MS_BIND, function(error)
    {
      if(error) return callback(error)

      mount.mount('tmpfs', upperdir+'/tmp', 'tmpfs', flags, function(error)
      {
        if(error) return callback(error)

        // Execute init
        utils.execInit(upperdir, [], function(error)
        {
          if(error) console.warn(error)

          callback(null, upperdir)
        })
      })
    })
  })
}

function overlay_user(usersFolder, user, callback)
{
  var upperdir = usersFolder+'/'+user
  var workdir  = usersFolder+'/.workdirs/'+user

  try
  {
    mkdirp(workdir, '0100')
  }
  catch(error)
  {
    if(error.code != 'EEXIST') return callback(error)
  }

  // Craft overlayed filesystem
  var type   = 'overlay';
  var extras =
  {
    lowerdir: '/',
    upperdir: upperdir,
    workdir : workdir
  };

  if(user === 'root') upperdir = '/tmp/root'

  utils.mkdirMount('', upperdir, type, mount.MS_NOSUID, extras, function(error)
  {
    if(error) return callback(error)

    if(user === 'root')
      // Allow to root to access to users filesystem
      utils.mkdirMove(HOME, upperdir+'/home', function(error)
      {
        if(error) return callback(error)

        mountDevProcTmp_ExecInit(upperdir, callback)
      })
    else
      mountDevProcTmp_ExecInit(upperdir, callback)
  });
}

function filterUser(user)
{
  return user[0] !== '.' && user !== 'root'
}

function overlay_users(usersFolder, callback)
{
  function onerror(error)
  {
    // Remove modules from initramfs
    rimraf('/lib/node_modules')

    callback(error)
  }

  // Mount users directories and exec their init files
  fs.readdir(usersFolder, function(error, users)
  {
    if(error) return onerror(error)

    each(users.filter(filterUser),
         overlay_user.bind(undefined, usersFolder),
         onerror)
  })
}

function waitUntilExists(path, tries, callback)
{
  fs.exists(path, function(exists)
  {
    if(exists) return callback()

    if(tries-- <= 0) return callback(new Error(path+' not exists'))

    setTimeout(waitUntilExists, 1000, path, tries, callback)
  })
}

function askLocation (error)
{
  console.log('Could not find userfs');
  // only load prompt when it is needed
  var prompt = require('prompt');
  prompt.start();
  prompt.get('path to userfs', function (err, result) {
    cmdline.root = result['path to userfs'];
    return  overlayfsroot(cmdline);
  });
}

function overlayfsroot(cmdline)
{
  var usersDev = cmdline.root
  if(usersDev)
    waitUntilExists(usersDev, 5, function(error)
    {
      if(error) return askLocation(error);

      // Mount users filesystem
      var type   = cmdline.rootfstype || 'auto'
      var extras = {errors: 'remount-ro'};

      utils.mkdirMount(usersDev, HOME, type, flags, extras, function(error)
      {
        if(error) return onerror(error)

        fs.readdir(HOME+'/root', function(error, users)
        {
          if(error)
          {
            if(error.code != 'ENOENT') return onerror(error)

            // Users filesystem don't have a root user, just overlay users folders
            overlay_users(HOME, onerror)
          }
          else
          {
            overlay_user(HOME, 'root', function(error, upperdir)
            {
              if(error) return onerror(error)

              overlay_users(upperdir+'/home', onerror)
            })
          }
        })
      })
    })
  else
  {
    console.warn('*************************************************************')
    console.warn('* Users filesytem is not defined, will use a tmpfs instead. *')
    console.warn('*                                                           *')
    console.warn('* ALL YOUR CHANGES WILL BE LOST IF NOT SAVED IN OTHER PLACE *')
    console.warn('*                                                           *')
    console.warn('* You can find info about how to use an users filesystem at *')
    console.warn('*                                                           *')
    console.warn('*             https://github.com/NodeOS/NodeOS              *')
    console.warn('*************************************************************')

    utils.startRepl('NodeOS-mount-filesystems')
  }
}


// Change umask system wide so new files are accesible ONLY by its owner
process.umask(0066);

// Remove from rootfs the files only needed on boot to free memory
rimraf('/bin/century')
rimraf('/bin/nodeos-mount-filesystems')
rimraf('/init')
rimraf('/sbin')

// Mount kernel filesystems
var cmdline;

utils.mkdirMount('udev', '/dev', 'devtmpfs', {mode: 0755}, function(error)
{
  if(error) console.warn(error);

  utils.mkdirMount('proc', '/proc', 'proc', flags, {hidepid: 2}, function(error)
  {
    if(error) console.warn(error);

    cmdline = linuxCmdline(fs.readFileSync('/proc/cmdline', {encoding: 'utf8'}));

    // Mount root filesystem
    overlayfsroot(cmdline)
  });
});
