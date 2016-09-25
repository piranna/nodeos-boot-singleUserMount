const fs      = require('fs')
const resolve = require('path').resolve

const each   = require('async/each')
const jocker = require('jocker')
const prompt = require('prompt')
const rimraf = require('rimraf').sync
const utils  = require('nodeos-mount-utils')

const jocker_root = require('./jocker_root')

const flags     = utils.flags
const MS_NODEV  = flags.MS_NODEV
const MS_NOSUID = flags.MS_NOSUID


const HOME = '/tmp'


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

/**
 * If the `single` key is set in the cmdline it starts a admin repl
 * If not it just overlays the users filesystem
 * @access private
 * @param  {String} usersFolder The path to folder of the users
 */
function adminOrUsers(usersFolder)
{
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

    each(users.filter(filterUser), function(username, callback)
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

  const upperdir = HOME+'/root'

  // Check if users filesystem has an administrator account
  fs.readdir(upperdir, function(error)
  {
    if(error)
    {
      if(error.code !== 'ENOENT') return onerror(error)

      return adminOrUsers(HOME)
    }

    // There's an administrator account, prepare it first
    jocker_root.create(upperdir, function(error, newHome)
    {
      if(error) return onerror(error)

      // Enter administrator mode
      if(exports.single) return utils.startRepl('Administrator mode')

      // Execute `root` user init in un-priviledged environment
      jocker.exec(HOME, '/init', {PATH: '/bin'}, function(error)
      {
        if(error) console.warn(error)

        adminOrUsers(newHome)
      })
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

      utils.mkdirMount(HOME, type, MS_NODEV | MS_NOSUID, extras, function(error)
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


exports.mountUsersFS = mountUsersFS
exports.single       = false
