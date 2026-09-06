import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** Next 16 lockfiles fail on the NTFS DATA drive. Keep .next on ext4 there only. */
const project = process.cwd()

function isNtfsProject() {
  try {
    const out = execFileSync('df', ['-T', project], { encoding: 'utf8' })
    const line = out.trim().split('\n').at(-1) ?? ''
    return /\s(fuseblk|ntfs|ntfs3)\s/i.test(line)
  } catch {
    return false
  }
}

if (!isNtfsProject()) process.exit(0)

const target = join(homedir(), '.cache', 'roomia-next')
const link = join(project, '.next')
const nodeModules = join(target, 'node_modules')
const projectModules = join(project, 'node_modules')

function ensureSymlink(from, to) {
  if (existsSync(from)) {
    const stat = lstatSync(from)
    if (stat.isSymbolicLink() && readlinkSync(from) === to) return
    rmSync(from, { recursive: true, force: true })
  }
  symlinkSync(to, from)
}

mkdirSync(target, { recursive: true })
ensureSymlink(link, target)
ensureSymlink(nodeModules, projectModules)
