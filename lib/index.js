const fs      = require('fs')
const resolve = require('path').resolve

const prompt = require('prompt')
const utils  = require('nodeos-mount-utils')

const prepareSessions = require('./sessions')

const flags     = utils.flags
const MS_NODEV  = flags.MS_NODEV
const MS_NOSUID = flags.MS_NOSUID


const MOUNTPOINT = '/tmp'


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
 * Starts a prompt and asks for the location of the userfs
 * @access private
 * @param  {Error} error The error will be printed in the console
 */
function askLocation(error)
{
  console.warn('Could not find userfs:', error)

  var self = this

  prompt.start()
  prompt.get('path to userfs', function(error, result)
  {
    if(error) console.warn(error)

    self.root = result['path to userfs']
    return mountUsersFS(self)
  })
}


//
// Public API
//

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
  function done(error)
  {
    if(error) onerror(error)
  }


  const single = cmdline.single

  var env = process.env

  // Allow to override or disable `usersDev`
  var usersDev = env['root']
  if(usersDev === undefined) usersDev = cmdline.root

  // Running on a container (Docker, vagga), don't mount the users filesystem
  if(usersDev === 'container') return prepareSessions(MOUNTPOINT, single, done)

  // Running on real hardware or virtual machine, mount the users filesystem
  if(usersDev)
    waitUntilExists(usersDev, 5, function(error)
    {
      if(error) return askLocation.call(cmdline, error)

      // Mount users filesystem
      var type   = env['rootfstype'] || cmdline.rootfstype || 'auto'
      var extras = {errors: 'remount-ro', devFile: resolve(usersDev)}

      utils.mkdirMount(MOUNTPOINT, type, MS_NODEV | MS_NOSUID, extras, function(error)
      {
        if(error) return onerror(error)

        delete env['root']
        delete env['rootfstype']

        prepareSessions(MOUNTPOINT, single, done)
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


module.exports = mountUsersFS
