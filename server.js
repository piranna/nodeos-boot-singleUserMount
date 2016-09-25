#!/usr/bin/env node

const readFile = require('fs').readFile

const startRepl = require('nodeos-mount-utils').startRepl

const boot = require('.')


const MOUNTPOINT = '/tmp'


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
 * This error handler traces the error and starts a Node.js REPL
 *
 * @param  {Error} error The error that gets traced
 */
function onerror(error)
{
  console.trace(error)
  startRepl('NodeOS-mount-filesystems')
}


boot.basicEnvironment(function(error)
{
  if(error) return onerror(error)

  // Get Linux kernel command line arguments
  readFile('/proc/cmdline', 'utf8', function(error, data)
  {
    if(error) return onerror(error)

    var cmdline = linuxCmdline(data)

    // Mount users filesystem
    boot.mountUsersFS(MOUNTPOINT, cmdline, function(error)
    {
      if(error) return onerror(error)

      boot.prepareSessions(MOUNTPOINT, cmdline.single, function(error)
      {
        if(error) return onerror(error)

        // KTHXBYE >^.^<
      })
    })
  })
})
