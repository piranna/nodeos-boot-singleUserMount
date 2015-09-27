#!/usr/bin/env node

var fs    = require('fs')
var spawn = require('child_process').spawn

var async  = require('async')
var mkdirp = require('mkdirp').sync
var rimraf = require('rimraf').sync

var each       = async.each
var eachSeries = async.eachSeries

var utils = require('nodeos-mount-utils')
var flgs  = utils.flags

const MS_BIND   = flgs.MS_BIND
const MS_NODEV  = flgs.MS_NODEV
const MS_NOSUID = flgs.MS_NOSUID

const flags = MS_NODEV | MS_NOSUID
const HOME = '/tmp'


var cmdline
var ROOT_HOME = ''


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
    arg = arg.split('=')

    var val = true
    if(arg.length > 1)
    {
      val = arg.slice(1).join("=").split(',')
      if(val.length === 1) val = val[0]
    }

    result[arg[0]] = val
  })

  return result
}


function mkdirMountInfo(info, callback)
{
  utils.mkdirMount(info.dev, info.path, info.type, info.flags, info.extras,
      callback)
}

function mkdirMoveInfo(info, callback)
{
  utils.mkdirMove(info.source, info.target, callback)
}

function mountDevProcTmp_ExecInit(upperdir, isRoot, callback)
{
  var arr =
  [
    {
      dev: '/proc',
      path: upperdir+'/proc',
      flags: MS_BIND
    },
    {
      dev: 'tmpfs',
      path: upperdir+'/tmp',
      type: 'tmpfs',
      flags: flags
    }
  ]

  function mountUserFilesystems()
  {
    each(arr, mkdirMountInfo, function(error)
    {
      if(error) return callback(error)

  console.log('**mkdirMountInfo**')

      // Execute init
      utils.execInit(upperdir, [], function(error)
      {
        if(error) console.warn(error)

        callback()
      })
    })
  }

  var path = upperdir+'/dev'

  if(isRoot)
  {
    try
    {
      mkdirp(path, '0000')
    }
    catch(error)
    {
      if(error.code != 'EEXIST') return callback(error)
    }

    var argv = [null, path, '-o', 'lowerLayer=/dev']
    var options =
    {
      detached: true,
      stdio: 'inherit'
    }

    spawn(__dirname+'/node_modules/.bin/exclfs', argv, options)
    .on('error', console.error.bind(console))
    .unref()

    return waitUntilDevMounted(path, 5, mountUserFilesystems)
  }

  arr.unshift({
    dev: ROOT_HOME+'/dev',
    path: path,
    flags: MS_BIND
  })

  mountUserFilesystems()
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
  var type   = 'overlay'
  var extras =
  {
    lowerdir: '/',
    upperdir: upperdir,
    workdir : workdir
  };

  if(user === 'root') upperdir = '/root'

  utils.mkdirMount('', upperdir, type, MS_NOSUID, extras, function(error)
  {
    if(error) return callback(error)

    if(user === 'root')
      // Allow to root to access to users filesystem
      eachSeries(
      [
        {
          source: HOME,
          target: upperdir+'/home'
        },
        {
          source: upperdir,
          target: HOME
        }
      ],
      mkdirMoveInfo,
      function(error)
      {
        if(error) return callback(error)

        mountDevProcTmp_ExecInit(HOME, true, function(error)
        {
          if(error) return callback(error)

          ROOT_HOME = HOME

          callback(null, HOME+'/home')
        })
      })

    else
      mountDevProcTmp_ExecInit(upperdir, false, callback)
  });
}

function filterUser(user)
{
  return user[0] !== '.' && user !== 'root'
}

function overlay_users(usersFolder, callback)
{
  function done(error)
  {
    // Remove the modules from initramfs to free memory
//    rimraf('/lib/node_modules')
    rimraf('/lib/node_modules/century')
    rimraf('/lib/node_modules/nodeos-mount-filesystems')

    // Hide '/usr' folder (Is it an OverlayFS feature or a bug?)
    rimraf('/usr')

    callback(error)
  }

  // Mount users directories and exec their init files
  fs.readdir(usersFolder, function(error, users)
  {
    if(error) return done(error)

    each(users.filter(filterUser),
         overlay_user.bind(undefined, usersFolder),
         done)
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

function waitUntilDevMounted(path, tries, callback)
{
  fs.readdir(path, function(error, files)
  {
    if(error) return callback(error)

    if(files.length > 1) return callback()

    if(tries-- <= 0) return callback(new Error(path+' not mounted'))

    setTimeout(waitUntilDevMounted, 1000, path, tries, callback)
  })
}

function pathToUserfs(err, result)
{
  if(error) console.warn(error)

  cmdline.root = result['path to userfs']
  return overlayfsroot(cmdline)
}

function askLocation(error)
{
  console.warn('Could not find userfs', error)

  // only load prompt when it is needed
  var prompt = require('prompt')

  prompt.start()
  prompt.get('path to userfs', pathToUserfs)
}

function overlayfsroot(cmdline)
{
  var usersDev = cmdline.root
  if(usersDev)
    waitUntilExists(usersDev, 5, function(error)
    {
      if(error) return askLocation(error)

      // Mount users filesystem
      var type   = cmdline.rootfstype || 'auto'
      var extras = {errors: 'remount-ro'}

      utils.mkdirMount(usersDev, HOME, type, flags, extras, function(error)
      {
        if(error) return onerror(error)

        // Update environment variables
        var env = process.env

        delete env['root']
        delete env['rootfstype']
        delete env['vga']

        env['NODE_PATH'] = '/lib/node_modules'

        // Check if users filesystem has an administrator account
        fs.readdir(HOME+'/root', function(error)
        {
          if(error)
          {
            if(error.code != 'ENOENT') return onerror(error)

            // Users filesystem don't have a root user, just overlay users folders
            overlay_users(HOME, onerror)
          }
          else
          {
            overlay_user(HOME, 'root', function(error, home)
            {
              if(error) return onerror(error)

              overlay_users(home, onerror)
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
process.umask(0066)

// Remove from initramfs the files only needed on boot to free memory
rimraf('/bin/century')
rimraf('/bin/nodeos-mount-filesystems')
rimraf('/init')
rimraf('/sbin')

// Mount kernel filesystems
each(
[
  {
    dev: 'udev',
    path: '/dev',
    type: 'devtmpfs'
  },
  {
    dev: 'proc',
    path: '/proc',
    type: 'proc',
    flags: flags,
    extras: {hidepid: 2}
  }
],
mkdirMountInfo,
function(error)
{
  if(error) console.warn(error);

  cmdline = linuxCmdline(fs.readFileSync('/proc/cmdline', 'utf8'))

  // Mount root filesystem
  overlayfsroot(cmdline)
})
