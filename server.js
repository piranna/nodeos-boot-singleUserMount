#!/usr/bin/env node

var fs      = require('fs')
var resolve = require('path').resolve
var spawn   = require('child_process').spawn

var async  = require('async')
var mkdirp = require('mkdirp')
var prompt = require('prompt')
var rimraf = require('rimraf').sync

var each       = async.each
var eachSeries = async.eachSeries

var utils = require('nodeos-mount-utils')
var flgs  = utils.flags

const MS_BIND   = flgs.MS_BIND
const MS_NODEV  = flgs.MS_NODEV
const MS_NOSUID = flgs.MS_NOSUID

const flags = MS_NODEV | MS_NOSUID
const EXCLFS_BIN = '/bin/exclfs'
const HOME = '/tmp'


var cmdline
var ROOT_HOME = ''
var single


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

  cmdline.trim().split(' ').forEach(function(arg)
  {
    arg = arg.split('=')

    var key = arg.shift()
    var val = true

    if(arg.length)
    {
      val = arg.join('=').split(',')
      if(val.length === 1) val = val[0]
    }

    result[key] = val
  })

  return result
}


function mkdirMountInfo(info, callback)
{
  var dev = info.dev || info.type

  utils.mkdirMount(dev, info.path, info.type, info.flags, info.extras, callback)
}

function mkdirMoveInfo(info, callback)
{
  utils.mkdirMove(info.source, info.target, callback)
}

function mountUserFilesystems(arr, upperdir, callback)
{
  each(arr, mkdirMountInfo, function(error)
  {
    if(error) return callback(error)

    if(single) return callback()

    // Execute init
    utils.execInit(upperdir, [], function(error)
    {
      if(error) console.warn(error)

      callback()
    })
  })
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
      path: upperdir+'/tmp',
      type: 'tmpfs',
      flags: flags
    }
  ]

  var path = upperdir+'/dev'

  // Root user
  if(isRoot && fs.existsSync(EXCLFS_BIN))
    return mkdirp(path, '0000', function(error)
    {
      if(error && error.code !== 'EEXIST') return callback(error)

      var argv = ['/dev', path, '-o', 'ownerPerm=true']
      var options =
      {
        detached: true,
        stdio: 'inherit'
      }

      spawn(EXCLFS_BIN, argv, options)
      .on('error', console.error.bind(console))
      .unref()

      waitUntilDevMounted(path, 5, function(error)
      {
        if(error) return callback(error)

        // Remove ExclFS from initramfs to free memory
        rimraf(EXCLFS_BIN)
        rimraf('/lib/node_modules/exclfs')

        mountUserFilesystems(arr, upperdir, callback)
      })
    })

  // Regular user
  arr.unshift({
    dev: ROOT_HOME+'/dev',
    path: path,
    flags: MS_BIND
  })

  mountUserFilesystems(arr, upperdir, callback)
}

function overlay_user(usersFolder, user, callback)
{
  var upperdir = usersFolder+'/'+user
  var workdir  = usersFolder+'/.workdirs/'+user

  mkdirp(workdir, '0100', function(error)
  {
    if(error && error.code !== 'EEXIST') return callback(error)

    // Craft overlayed filesystem
    var type   = 'overlay'
    var extras =
    {
      lowerdir: '/',
      upperdir: upperdir,
      workdir : workdir
    };

    if(user === 'root') upperdir = '/root'

    utils.mkdirMount(type, upperdir, type, MS_NOSUID, extras, function(error)
    {
      if(error) return callback(error)

      if(user !== 'root')
        return mountDevProcTmp_ExecInit(upperdir, false, callback)

      // Allow root to access to the content of the users filesystem
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
    })
  })
}

function filterUser(user)
{
  return user[0] !== '.' && user !== 'root' && user !== 'lost+found'
}

function overlay_users(usersFolder, callback)
{
  function done(error)
  {
    // Remove the modules from initramfs to free memory
//    rimraf('/lib/node_modules')
    rimraf('/lib/node_modules/nodeos-mount-utils')

    // Make '/usr' a opaque folder (OverlayFS feature)
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

function pathToUserfs(error, result)
{
  if(error) console.warn(error)

  cmdline.root = result['path to userfs']
  return mountUsersFS(cmdline)
}

function askLocation(error)
{
  console.warn('Could not find userfs:', error)

  prompt.start()
  prompt.get('path to userfs', pathToUserfs)
}

function adminOrUsers(home)
{
  // Enter administrator mode
  if(single) return utils.startRepl('Administrator mode')

  // Users filesystem don't have a root user, just overlay users folders
  overlay_users(home, onerror)
}

function prepareSessions()
{
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

      return adminOrUsers(HOME)
    }

    overlay_user(HOME, 'root', function(error, home)
    {
      if(error) return onerror(error)

      adminOrUsers(home)
    })
  })
}

function mountUsersFS(cmdline)
{
  var usersDev = process.env.root
  if(usersDev === undefined) usersDev = cmdline.root

  // Running on a container (Docker, vagga), don't mount the users filesystem
  if(usersDev === 'container')
    prepareSessions()

  // Running on real hardware or virtual machine, mount the users filesystem
  else if(usersDev)
    waitUntilExists(usersDev, 5, function(error)
    {
      if(error) return askLocation(error)

      // Mount users filesystem
      var type   = process.env.rootfstype || cmdline.rootfstype || 'auto'
      var extras = {errors: 'remount-ro'}

      utils.mkdirMount(resolve(usersDev), HOME, type, flags, extras,
        function(error)
      {
        if(error) return onerror(error)

        prepareSessions()
      })
    })

  // Users filesystem is not defined, launch a Node.js REPL
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
rimraf('/bin/nodeos-mount-filesystems')
rimraf('/init')
rimraf('/lib/node_modules/nodeos-mount-filesystems')
rimraf('/sbin')

// Symlinks for config data optained from `procfs`
mkdirp('/etc', '0100', function(error)
{
  if(error && error.code != 'EEXIST') return callback(error)

  fs.symlinkSync('/proc/mounts' , '/etc/mtab')
  fs.symlinkSync('/proc/net/pnp', '/etc/resolv.conf')

  cmdline = linuxCmdline(fs.readFileSync('/proc/cmdline', 'utf8'))

  single = cmdline.single

  // Mount root filesystem
  mountUsersFS(cmdline)
})
