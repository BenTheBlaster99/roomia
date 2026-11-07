'use strict'
/**
 * "Créer un rapport de problème" (menu Aide): one zip on the Desktop with what we need to understand a problem — the
 * app and server logs of the last days, the graphics card test, the versions, and for each project its state and the
 * end of its render log. Never the account file (it holds the sign-in token) nor the models or the renders.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')

const MAX_LOG = 2 * 1024 * 1024
const MAX_BUILD_LOG = 300 * 1024

function tail(file, max) {
  try {
    const { size } = fs.statSync(file)
    const fd = fs.openSync(file, 'r')
    const length = Math.min(size, max)
    const buf = Buffer.alloc(length)
    fs.readSync(fd, buf, 0, length, size - length)
    fs.closeSync(fd)
    return buf
  } catch {
    return null
  }
}

function makeReport({ data, dirs, appVersion, engineInfo }) {
  const files = {}
  const add = (name, content) => {
    if (content) files[name] = typeof content === 'string' ? strToU8(content) : new Uint8Array(content)
  }
  add(
    'versions.json',
    JSON.stringify(
      {
        app: appVersion,
        electron: process.versions.electron,
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model,
        cores: os.cpus().length,
        ramMb: Math.round(os.totalmem() / 1048576),
        freeRamMb: Math.round(os.freemem() / 1048576),
        at: new Date().toISOString(),
        engine: engineInfo.engine ? { version: engineInfo.engine.version, source: engineInfo.engine.source } : null,
        engineError: engineInfo.error,
      },
      null,
      2,
    ),
  )
  add('engine.json', tail(path.join(data, 'engine.json'), MAX_LOG))
  const weekAgo = Date.now() - 7 * 86400000
  for (const name of fs.existsSync(dirs.logs) ? fs.readdirSync(dirs.logs) : []) {
    const file = path.join(dirs.logs, name)
    if (fs.statSync(file).mtimeMs >= weekAgo) add(`logs/${name}`, tail(file, MAX_LOG))
  }
  const projects = fs.existsSync(dirs.projects) ? fs.readdirSync(dirs.projects).filter(n => /^[A-Za-z0-9_-]{21}$/.test(n)) : []
  for (const id of projects) {
    const dir = path.join(dirs.projects, id)
    add(`projects/${id}/meta.json`, tail(path.join(dir, 'meta.json'), MAX_LOG))
    add(`projects/${id}/report.json`, tail(path.join(dir, 'report.json'), MAX_LOG))
    add(`projects/${id}/runs.jsonl`, tail(path.join(dir, 'runs.jsonl'), MAX_BUILD_LOG))
    add(`projects/${id}/tour-status.json`, tail(path.join(dir, 'tour', 'status.json'), MAX_LOG))
    add(`projects/${id}/build-log.txt`, tail(path.join(dir, 'tour', 'build-log.txt'), MAX_BUILD_LOG))
    add(`projects/${id}/bake-log.txt`, tail(path.join(dir, 'tour', 'bake-log.txt'), MAX_BUILD_LOG))
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return { name: `Roomia-rapport-${stamp}.zip`, bytes: zipSync(files, { level: 6 }) }
}

module.exports = { makeReport }
