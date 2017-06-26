#!/usr/bin/env node

const readFile = require('fs').readFile

const basicEnvironment = require('nodeos-boot-singleUser')
const linuxCmdline     = require('linux-cmdline')
const rimraf           = require('rimraf').sync
const run              = require('jocker').run
const startRepl        = require('nodeos-mount-utils').startRepl

const mountUsersFS = require('.')


const MOUNTPOINT = '/tmp'


/**
 * This error handler traces the error and starts a Node.js REPL
 *
 * @param  {Error} error The error that gets traced
 */
function onerror(error)
{
  console.trace(error)
  startRepl('NodeOS-boot-singleUserMount')
}


basicEnvironment(function(error)
{
  if(error) return onerror(error)

  // Get Linux kernel command line arguments
  readFile('/proc/cmdline', 'utf8', function(error, data)
  {
    if(error) return onerror(error)

    var cmdline = linuxCmdline(data)

    // Mount users filesystem
    mountUsersFS(MOUNTPOINT, cmdline, function(error)
    {
      if(error) return onerror(error)

      run(MOUNTPOINT, '/init', {PATH: '/bin'}, function(error)
      {
        if(error) return onerror(error)

        // Remove from initramfs the files only needed on boot to free memory
        try
        {
          rimraf('/bin/nodeos-boot-singleUserMount')
          rimraf('/init')
          rimraf('/lib/node_modules/nodeos-boot-singleUserMount')
          rimraf('/sbin')
        }
        catch(error)
        {
          // If `rootfs` is read-only (like in `vagga`), ignore the error
          if(error.code !== 'EROFS') return callback(error)
        }

        // KTHXBYE >^.^<
      })
    })
  })
})
