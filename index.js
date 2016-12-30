const fs      = require('fs')
const resolve = require('path').resolve

const evaluate_spec = require('libblkid').evaluate_spec
const prompt        = require('prompt')
const utils         = require('nodeos-mount-utils')

const flags     = utils.flags
const MS_NODEV  = flags.MS_NODEV
const MS_NOSUID = flags.MS_NOSUID


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
function askLocation(mountpoint, cmdline, error, callback)
{
  console.warn('Could not find userfs:', error)

  prompt.start()
  prompt.get('path to userfs', function(error, result)
  {
    if(error) console.warn(error)

    cmdline.root = result['path to userfs']
    return mountUsersFS(mountpoint, cmdline, callback)
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
function mountUsersFS(mountpoint, cmdline, callback)
{
  // Get filesystem location & type and clean their environment variables
  var env = process.env

  var usersDev = env['root']
  var type     = env['rootfstype'] || cmdline.rootfstype || 'auto'

  delete env['root']
  delete env['rootfstype']

  // Allow to override or disable `usersDev`
  if(usersDev === undefined) usersDev = cmdline.root

  // Running on a container (Docker, vagga), don't mount the users filesystem
  if(usersDev === 'container') return callback()

  // Get device from label
  usersDev = evaluate_spec(usersDev)

  // Running on real hardware or virtual machine, mount the users filesystem
  if(usersDev)
    return waitUntilExists(usersDev, 5, function(error)
    {
      if(error) return askLocation(mountpoint, cmdline, error, callback)

      // Mount users filesystem
      var extras = {errors: 'remount-ro', devFile: resolve(usersDev)}

      utils.mkdirMount(mountpoint, type, MS_NODEV | MS_NOSUID, extras, callback)
    })

  // Users filesystem is not defined, launch a Node.js REPL
  fs.readFile(`${__dirname}/readonly_warning.txt`, 'utf8',
  function(error, data)
  {
    if(error) return callback(error)

    console.warn(data)
    utils.startRepl('NodeOS-boot-singleUserMount')
  })
}


module.exports = mountUsersFS
