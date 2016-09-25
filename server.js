#!/usr/bin/env node

const fs = require('fs')

const eachOf = require('async/eachOf')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf').sync

const mountUsersFS = require('.')


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
  if(error && error.code !== 'EEXIST') throw error

  const symlinks =
  {
    '/proc/mounts': '/etc/mtab',
    '/proc/net/pnp': '/etc/resolv.conf'
  }

  eachOf(symlinks, function(dest, src, callback)
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

    // Update environment variables
    var env = process.env
    delete env['vga']
    env['NODE_PATH'] = '/lib/node_modules'

    // Get Linux kernel command line arguments
    fs.readFile('/proc/cmdline', 'utf8', function(error, data)
    {
      if(error) throw error

      // Mount users filesystem
      mountUsersFS(linuxCmdline(data))
    })
  })
})
