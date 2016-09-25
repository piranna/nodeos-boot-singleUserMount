const fs      = require('fs')
const spawn   = require('child_process').spawn

const async  = require('async')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf').sync
const utils  = require('nodeos-mount-utils')

const flags     = utils.flags
const MS_BIND   = flags.MS_BIND
const MS_NODEV  = flags.MS_NODEV
const MS_NOSUID = flags.MS_NOSUID


const EXCLFS_BIN = '/bin/exclfs'
const HOME       = '/tmp'


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
 * Waits until `/dev` is mounted and then mount `root`'s `${upperdir}/proc` and
 * `${upperdir}/tmp`
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
      flags: MS_NODEV | MS_NOSUID
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

      return async.each(arr, mkdirMountInfo, callback)
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

        async.each(arr, mkdirMountInfo, callback)
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


//
// Public API
//

/**
 * Creates the workdir (with `0100` permission) which is a string out of the
 * folder where all users are located, a constant `.workdirs` and the username
 * e.g. `${upperdir}/.workdirs/${user}`
 *
 * @access private
 *
 * @param  {String}   upperdir The folder where all user folders are
 * @param  {Function} callback    The callback function
 */
function create(upperdir, callback)
{
  var workdir = upperdir.split('/')
  var user    = workdir.pop()
  var workdir = workdir.join('/')+'/.workdirs/'+user

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


exports.create = create
