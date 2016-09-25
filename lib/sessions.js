const fs = require('fs')

const each      = require('async/each')
const jocker    = require('jocker')
const rimraf    = require('rimraf').sync
const startRepl = require('nodeos-mount-utils').startRepl

const jocker_root = require('./jocker_root')


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
 * Overlays the users filesystem
 *
 * @param {String} usersFolder The path to folder of the users
 * @param {Function} callback
 */
function usersSessions(usersFolder, callback)
{
  function done(error)
  {
    // Remove the modules from initramfs to free memory
    // rimraf('/lib/node_modules')
    rimraf('/lib/node_modules/jocker')

    // Make '/usr' a opaque folder (OverlayFS feature)
    rimraf('/usr')

    callback(error)
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


//
// Public API
//

/**
 * Prepares the session and checks if the users filesystem has a root account,
 * if not check if `/proc/cmdline` has the single key
 * It deletes the `root`, `rootfstype` and `vga` environment variables
 * and adds `NODE_PATH` to it.
 * @access private
 * @return {Repl} Returns either a repl or a error if the error contains
 *                a `ENOENT` code
 */
function prepareSessions(home, single, callback)
{
  const upperdir = home+'/root'

  // Check if users filesystem has an administrator account
  fs.readdir(upperdir, function(error)
  {
    if(error)
    {
      if(error.code !== 'ENOENT') return callback(error)

      return usersSessions(home, callback)
    }

    // There's an administrator account, prepare it first
    jocker_root.create(upperdir, function(error, newHome)
    {
      if(error) return callback(error)

      // Enter administrator mode
      if(single) return startRepl('Administrator mode')

      // Execute `root` user init in un-priviledged environment
      jocker.exec(home, '/init', {PATH: '/bin'}, function(error)
      {
        if(error) console.warn(error)

        usersSessions(newHome, callback)
      })
    })
  })
}


module.exports = prepareSessions
