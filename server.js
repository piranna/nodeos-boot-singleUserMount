#!/usr/bin/env node

const fs      = require('fs')
const resolve = require('path').resolve
const spawn   = require('child_process').spawn

const async  = require('async')
const jocker = require('jocker')
const mkdirp = require('mkdirp')
const prompt = require('prompt')
const rimraf = require('rimraf').sync
const utils  = require('nodeos-mount-utils')

const flgs      = utils.flags
const MS_BIND   = flgs.MS_BIND
const MS_NODEV  = flgs.MS_NODEV
const MS_NOSUID = flgs.MS_NOSUID

const flags = MS_NODEV | MS_NOSUID
const EXCLFS_BIN = '/bin/exclfs'
const HOME = '/tmp'


var single


/**
 * This error handler traces the error and starts a node.js repl
 * @access private
 * @param  {Error} error The error that gets traced
 */
function onerror(error)
{
  console.trace(error)
  utils.startRepl('NodeOS-mount-filesystems')
}

/**
 * This functions takes the `cmdline` from `/proc/cmdline` **showed below in
 * the example** and splits it into key/value pairs
 * @access private
 * @param  {String} cmdline This string contains information about the
 *                          initrd and the root partition
 * @return {Object}         It returns a object containing key/value pairs
 *                          if there is no value for the key then its just true.
 *                          **For more Information, look at the example**
 * @example
 *   var cmdline1 = 'initrd=\\initramfs-linux.img root=PARTUUID=someuuidhere\n'
 *   var cmdline2 = 'somevar root=PARTUUID=someuuidhere\n'
 *
 * 	 var res1 = linuxCmdline(cmdline1)
 * 	 var res2 = linuxCmdline(cmdline2)
 * 	 console.log(res1)
 * 	 //-> { initrd: '\\initramfs-linux.img',root: 'PARTUUID=someuuidhere' }
 * 	 console.log(res2)
 * 	 //-> { somevar: true, root: 'PARTUUID=someuuidhere' }
 */
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

/**
 * This functions mounts the provided path to the device.
 * **If no device is available then it uses the type**
 * @access   private
 * @param    {Object}       info          This object holds information
 *                                        about the folder to create
 * @property {String}       info.dev      Device-File being mounted
 *                                        (located in `/dev`) a.k.a. devFile.
 * @property {String}       info.path     Directory to mount the device to.
 * @property {String}       info.type     Filesystem identificator
 *                                        (one of `/proc/filesystems`).
 * @property {Array|Number} info.[flags]  Flags for mounting
 * @property {String}       info.[extras] The data argument is
 *                                        interpreted by the different
 *                                        file systems. Typically it is a
 *                                        string of comma-separated options
 *                                        understood by this file system.
 * @param {Function}     callback         Function called after the
 *                                        mount operation finishes.
 *                                        Receives only one argument err.
 */
function mkdirMountInfo(info, callback)
{
  utils.mkdirMount(info.path, info.type, info.flags, info.extras, callback)
}

/**
* Asynchronously create a target directory mount the source with `MS_MOVE` to it
* and move all files to the newly created directory
 * @access   private
 * @param    {Object}   info
 * @property {String}   info.source The source subtree to move
 * @property {String}   info.target The path to move the subtree into
 * @param    {Function} callback    The callback gets called if the move
 *                                  operations is done
 */
function mkdirMoveInfo(info, callback)
{
  utils.mkdirMove(info.source, info.target, callback)
}

/**
 * Mounts the root filesystems and exec its `/init`
 *
 * @access private
 *
 * @param {Array} arr An array containing objects with the mounting information
 *                    **For more Information see mkdirMountInfo**
 * @param {String} home Path to the `root` home. It must contain an `/init` file
 *
 * @example
 *   let infos = [ mountInfo1, mountInfo2 ] // see under mkdirMountInfo
 *                                          // for more Info
 *
 * 	 // Its necessary to exclude the init file from the path because
 * 	 // `mountRootFilesystems()` does that for you
 *   mountRootFilesystems(infos, 'path/to/initfile', callback)
 */
function mountRootFilesystems(arr, home, callback)
{
  async.each(arr, mkdirMountInfo, function(error)
  {
    if(error) return callback(error)

    // System started in `single` mode, launch REPL
    if(single) return callback()

    // Execute `root` user init in un-priviledged environment
    jocker.exec(home, '/init', {PATH: '/bin'}, function(error)
    {
      if(error) console.warn(error)

      callback()
    })
  })
}

/**
 * Waits until `/dev` is mounted and then executes `mountRootFilesystems()` to
 * mount `root`'s `${upperdir}/proc` and `${upperdir}/tmp`
 *
 * @access private
 *
 * @param {String} upperdir The upperdir
 * @param {mountDevProcCallback} callback The callback function
 */
function prepareRootFilesystems(upperdir, callback)
{
  var arr =
  [
    {
      path: upperdir+'/proc',
      flags: MS_BIND,
      extras: {devFile: '/proc'}
    },
    {
      path: upperdir+'/tmp',
      type: 'tmpfs',
      flags: flags
    }
  ]

  // Using ExclFS filesystem
  fs.access(EXCLFS_BIN, fs.constants.X_OK, function(error)
  {
    var path = upperdir+'/dev'

    if(error)
    {
      arr.unshift({
        path: path,
        flags: MS_BIND,
        extras: {devFile: '/dev'}
      })

      return mountRootFilesystems(arr, upperdir, callback)
    }

    mkdirp(path, '0000', function(error)
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

        mountRootFilesystems(arr, upperdir, callback)
      })
    })
  })
}
/**
 * @callback mountDevProcCallback
 *
 * @param {Error} error The callback is called with an error if the devices
 *                      couldn't be mounted
 */

/**
 * Creates the workdir (with `0100` permission) which is a string out of the
 * folder where all users are located, a constant `.workdirs` and the username
 * e.g. `${usersFolder}/.workdirs/${user}`
 *
 * @access private
 *
 * @param  {String}   usersFolder The folder where all user folders are
 * @param  {Function} callback    The callback function
 */
function overlay_root(usersFolder, callback)
{
  var upperdir = usersFolder+'/root'
  var workdir  = usersFolder+'/.workdirs/root'

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
    }

    upperdir = '/root'

    utils.mkdirMount(upperdir, type, MS_NOSUID, extras, function(error)
    {
      if(error) return callback(error)

      // Allow root to access to the content of the users filesystem
      async.eachSeries(
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

        prepareRootFilesystems(HOME, function(error)
        {
          if(error) return callback(error)

          callback(null, HOME+'/home')
        })
      })
    })
  })
}

/**
 * Filter folders that are valid user `$HOME`
 * @access private
 * @param  {String}  user The name of the user
 * @return {Boolean}      Returns true If the first char is not a dot
 *                        and not `root` and not ´lost+found´
 */
function filterUser(user)
{
  return user[0] !== '.' && user !== 'root' && user !== 'lost+found'
}

/**
 * This helper waits with a limit of tries until the path exists
 * @access private
 * @param  {String}   path     The path to check for
 * @param  {Number}   tries    A limit of tries
 * @param  {Function} callback The callback function
 * @return {Function}          Returns the callback with either nothing
 *                             or with a error
 */
function waitUntilExists(path, tries, callback)
{
  fs.exists(path, function(exists)
  {
    if(exists) return callback()

    if(tries-- <= 0) return callback(new Error(path+' not exists'))

    setTimeout(waitUntilExists, 1000, path, tries, callback)
  })
}

/**
 * This helper waits with a limit of tries until the device is mounted
 * @access private
 * @param  {String}   path     The path to read the files from
 * @param  {Number}   tries    A limit of tries
 * @param  {Function} callback The callback function
 * @return {Function}          Returns the callback with either a error
 *                             or nothing (if the amount of files is bigger 1)
 */
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

/**
 * A callback function for the askLocation function
 * @access private
 * @param  {Error}    error  If the error is null it not gets printed
 * @param  {Object}   result A object containing a key for the path to the userfs
 * @return {Function}        Returns either a prompt or a error if the mount
 *                           process fails
 */
function pathToUserfs(error, result)
{
  if(error) console.warn(error)

  this.root = result['path to userfs']
  return mountUsersFS(this)
}

/**
 * Starts a prompt and asks for the location of the userfs
 * @access private
 * @param  {Error} error The error will be printed in the console
 */
function askLocation(error)
{
  console.warn('Could not find userfs:', error)

  prompt.start()
  prompt.get('path to userfs', pathToUserfs.bind(this))
}

/**
 * If the `single` key is set in the cmdline it starts a admin repl
 * If not it just overlays the users filesystem
 * @access private
 * @param  {String} usersFolder The path to folder of the users
 */
function adminOrUsers(usersFolder)
{
  // Enter administrator mode
  if(single) return utils.startRepl('Administrator mode')

  // Users filesystem don't have a root user, just overlay users folders

  function done(error)
  {
    // Remove the modules from initramfs to free memory
    // rimraf('/lib/node_modules')
    rimraf('/lib/node_modules/jocker')

    // Make '/usr' a opaque folder (OverlayFS feature)
    rimraf('/usr')

    if(error) onerror(error)
  }

  // Mount users directories and exec their init files
  fs.readdir(usersFolder, function(error, users)
  {
    if(error) return done(error)

    async.each(users.filter(filterUser), function(username, callback)
    {
      jocker.run(usersFolder+'/'+username, '/init', {PATH: '/bin'}, callback)
    },
    done)
  })
}

/**
 * Prepares the session and checks if the users filesystem has a root account,
 * if not check if `/proc/cmdline` has the single key
 * It deletes the `root`, `rootfstype` and `vga` environment variables
 * and adds `NODE_PATH` to it.
 * @access private
 * @return {Repl} Returns either a repl or a error if the error contains
 *                a `ENOENT` code
 */
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
      if(error.code !== 'ENOENT') return onerror(error)

      return adminOrUsers(HOME)
    }

    // There's an administrator account, prepare it first
    overlay_root(HOME, function(error, newHome)
    {
      if(error) return onerror(error)

      adminOrUsers(newHome)
    })
  })
}

/**
 * This function mounts the userfs
 * if the root env variable contains `container` it prepares the session
 * and if there is no root env var then it awaits the user device and
 * then mounts the user device and then prepares the session
 * @access private
 * @param  {Object}       cmdline This objects holds key/value pairs from the
 *                                `/proc/cmdline` file
 * @return {Prompt|Error}         It returns either a prompt if the
 *                                tries has reached its limit or a error
 *                                if the `mkdirMount` fails to create the user
 *                                device
 */
function mountUsersFS(cmdline)
{
  // Allow to override or disable `usersDev`
  var usersDev = process.env.root
  if(usersDev === undefined) usersDev = cmdline.root

  // Running on a container (Docker, vagga), don't mount the users filesystem
  if(usersDev === 'container') return prepareSessions()

  // Running on real hardware or virtual machine, mount the users filesystem
  if(usersDev)
    waitUntilExists(usersDev, 5, function(error)
    {
      if(error) return askLocation.call(cmdline, error)

      // Mount users filesystem
      var type   = process.env.rootfstype || cmdline.rootfstype || 'auto'
      var extras = {errors: 'remount-ro', devFile: resolve(usersDev)}

      utils.mkdirMount(HOME, type, flags, extras, function(error)
      {
        if(error) return onerror(error)

        prepareSessions()
      })
    })

  // Users filesystem is not defined, launch a Node.js REPL
  else
    fs.readFile('resources/readonly_warning.txt', 'utf8', function(error, data)
    {
      if(error) return onerror(error)

      console.warn(data)
      utils.startRepl('NodeOS-mount-filesystems')
    })
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
  if(error && error.code != 'EEXIST') throw error

  const symlinks =
  {
    '/proc/mounts': '/etc/mtab',
    '/proc/net/pnp': '/etc/resolv.conf'
  }

  async.eachOf(symlinks, function(dest, src, callback)
  {
    fs.symlink(src, dest, function(error)
    {
      if(error && error.code !== 'EEXIST') return callback(error)

      callback()
    })
  },
  function(error)
  {
    if(error) throw error

    fs.readFile('/proc/cmdline', 'utf8', function(error, data)
    {
      if(error) throw error

      var cmdline = linuxCmdline(data)

      single = cmdline.single

      // Mount root filesystem
      mountUsersFS(cmdline)
    })
  })
})
