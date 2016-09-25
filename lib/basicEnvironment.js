const symlink = require('fs').symlink

const eachOf = require('async/eachOf')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf').sync


function basicEnvironment(callback)
{
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
    if(error && error.code !== 'EEXIST') return callback(error)

    const symlinks =
    {
      '/proc/mounts': '/etc/mtab',
      '/proc/net/pnp': '/etc/resolv.conf'
    }

    eachOf(symlinks, function(dest, src, callback)
    {
      symlink(src, dest, function(error)
      {
        if(error && error.code !== 'EEXIST') return callback(error)

        callback()
      })
    },
    function(error)
    {
      if(error) return callback(error)

      // Update environment variables
      var env = process.env
      delete env['vga']
      env['NODE_PATH'] = '/lib/node_modules'

      callback()
    })
  })
}


module.exports = basicEnvironment
