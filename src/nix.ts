/**
 * Nixster's interface to Nix.
 */

import path from 'path'

import Database from 'better-sqlite3'
import mkdirp from 'mkdirp'
// @ts-ignore
import spawn from 'await-spawn'
import { sprintf } from 'sprintf-js'

/**
 * The Nixster database used to cache data on
 * packages and environments.
 */
const db = new Database('nixster.sqlite3')

/**
 * Create a version string that can be ordered
 * according to semantic versioning conventions for use
 * int database SQL queries.
 *
 * @param version The version string
 */
export function semver (version: string): string {
  let match = version.match(/^(\d+)(\.(\d+))?(\.(\d+))?(.*)?/)
  return match ? sprintf('%05i.%05i.%05i%s', match[1], match[3] || 0, match[5] || 0, match[6] || '') : version
}
// Register function in the database
db.function('semver', semver)

// Currently we're putting generate Nix profiles in the /nix directory.
// This is somewhat arbitrary.
const profiles = path.join('/', 'nix', 'profiles')
mkdirp.sync(profiles)

/**
 * Add a channel
 *
 * See the list of NixOS channels at: https://nixos.org/channels/
 */
export async function channel (url: string = 'https://nixos.org/channels/nixpkgs-unstable', name: string = 'nixpkgs-unstable') {
  // Update the channel
  // nix-channel --add url [name] : Adds a channel named name with URL url to the list of subscribed channels
  spawn('nix-channel', ['--add', url, name])
  // nix-channel --update [names...] : Downloads the Nix expressions of all subscribed channels (or only those included in names if specified) and
  // makes them the default for nix-env operations (by symlinking them from the directory ~/.nix-defexpr).
  spawn('nix-channel', ['--update', name])
  // nix-channel --list : Prints the names and URLs of all subscribed channels on standard output.
  const list = spawn('nix-channel', ['--list'])
  console.log('Updated channel. Current channel list:')
  list.stdout.pipe(process.stdout)
}

/**
 * Rules for packages that should be skipped during `update()`
 */
const SKIP = [
  { attr: /^rWrapper$/ }
]

/**
 * Update the Nixster database
 */
export async function update (channels: string | Array<string> = [], last: boolean = true) {
  if (Array.isArray(channels)) {
    if (channels.length === 0) {
      channels = [
        // TODO this should come from `nix-channel --list`
        'nixpkgs-unstable',
        'nixos-18.09', 'nixos-18.03',
        'nixos-17.09', 'nixos-17.03',
        'nixos-16.09', 'nixos-16.03',
        'nixos-15.09'
      ]
    }
    for (let item of channels) await update(item, channels.indexOf(item) === channels.length - 1)
    return
  }

  let channel = channels

  // Get list of avalaible packages in the nixster channel and put them in the database
  console.log(`Querying channel ${channel} for available packages`)
  let pkgs: any = {}
  const args = ['--query', `--file`, `channel:${channel}`, '--available', '--meta', '--json']
  // For some reason, in order to get R packages it is necessary to explicitly use --attr rPackages
  // so we have a loop for that case and potential others
  for (let extraArgs of [
    [],
    ['--attr', 'rPackages']
  ]) {
    const query = await spawn('nix-env', args.concat(extraArgs))
    let json = query.toString()
    let newPkgs
    try {
      newPkgs = JSON.parse(json)
    } catch (error) {
      console.error(error)
      console.error(json)
    }
    Object.assign(pkgs, newPkgs)
  }
  console.log(`Obtained list of ${Object.keys(pkgs).length} for channel ${channel}`)

  console.log(`Updating database with package data`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type,
      name,
      version,
      runtime,
      channel,
      attr,
      fullname,
      priority INT,
      description TEXT,
      meta TEXT
    )
  `)
  const insert = db.prepare(`
    INSERT INTO packages (type, name, version, runtime, channel, attr, fullname, priority, description, meta)
    VALUES (@type, @name, @version, @runtime, @channel, @attr, @fullname, @priority, @description, @meta)
  `)
  db.transaction(() => {
    for (let attr of Object.keys(pkgs)) {
      const pkg = pkgs[attr]

      // We ignore some packages that
      let skip = false
      for (let spec of SKIP) {
        if (spec.attr && attr.match(spec.attr)) {
          skip = true
          break
        }
      }
      if (skip) continue

      let type: string = ''
      let name: string
      let version: string = ''
      let runtime: string = ''
      const match = pkg.name.match(/(.+?)-(\d.*)$/)
      if (match) {
        name = match[1]
        version = match[2]
      } else {
        name = pkg.name
      }

      // Rename language packages to provide consistency and
      // prevent versioned names.

      const pythonPackage = attr.match(/^python(\d+)Packages\./)
      if (pythonPackage) {
        type = 'python-package'
        runtime = 'python' + pythonPackage[1]
        if (name.startsWith('python')) {
          name = name.replace(/^python[\d\.]+/, 'python')
        } else {
          name = 'python-' + name
        }
      }

      const perlPackage = attr.match(/^perl(\d+|devel)?Packages\./)
      if (perlPackage) {
        type = 'perl-package'
        runtime = 'perl' + (perlPackage[1] ? perlPackage[1] : '')
        if (name.startsWith('perl')) {
          name = name.replace(/^perl[\d\.]+/, 'perl')
        }
      }

      const rPackage = attr.match(/^rPackages\./)
      if (rPackage) {
        type = 'r-package'
      }

      // Normalise name
      name = name.toLowerCase().replace(/[._-]+/gi, '-')

      // Insert row into table
      insert.run({
        type,
        name,
        version,
        runtime,
        channel,
        attr,
        fullname: pkg.name,
        priority: pkg.meta.priority || 0,
        description: pkg.meta.description,
        meta: JSON.stringify(pkg.meta)
      })
    }
  })()

  if (last) {
    // Create full text search virtual table
    db.exec(`
      DROP TABLE IF EXISTS packages_text;
      CREATE VIRTUAL TABLE packages_text USING fts4(
        id INTEGER,
        type TEXT,
        name TEXT,
        description TEXT
      );
      INSERT INTO packages_text SELECT id, type, name, description FROM packages
    `)
  }
}

/**
 * Find matches
 *
 * @param pkg Package name/version e.g. r-ggplot2, r-ggplot==3.1.0
 * @returns An array of matching packages
 */
export async function match (pkg: string): Promise<Array<any>> {
  let [name, version] = pkg.split('==')
  let sql = `
    SELECT name, version, channel, description, attr
    FROM packages
    WHERE name==?
  `
  if (version) sql += 'AND version==? '
  sql += 'ORDER BY semver(version) DESC, priority DESC'
  const stmt = db.prepare(sql)
  return version ? stmt.all(name, version) : stmt.all(name)
}

/**
 * Search for a package in the Nixster database
 *
 * @param term Search term
 * @param type Type of package e.g. `r-package`
 * @param limit Limit on number of packages to return
 */
export async function search (term: string, type: string = '', limit: number = 1000): Promise<Array<any>> {
  term = term.replace("'", "\'")
  // TODO: find a way to show the channel and description for the latest
  // version
  const stmt = db.prepare(`
    SELECT name, type, max(version) AS version, max(channel) AS channel, max(description) AS description
    FROM (
      SELECT name, type, version, channel, description
      FROM packages
      JOIN (
        SELECT id
        FROM packages_text
        WHERE packages_text MATCH 'name:${term} OR description:${term}'
          ${type ? `AND type=='${type}'` : ''}
        ORDER BY SUBSTR(OFFSETS(packages_text), 1, 1)
        LIMIT ?
      ) USING (id)
    )
    GROUP BY name, type
  `)
  return stmt.all(limit)
}

/**
 * Get the location of an environment within the Nix store
 *
 * @param env The environment name
 */
export async function location (env: string): Promise<string> {
  const readlink = await spawn('readlink', ['-f', path.join(profiles, env)])
  return readlink.toString().trim()
}

/**
 * Install packages into an environment
 *
 * @param env The environment name
 * @param pkgs An array of normalized package names
 */
export async function install (env: string, pkgs: Array<string>, clean: boolean = false) {
  let channels: {[key: string]: any} = {}
  for (let pkg of pkgs) {
    let matches = await match(pkg)
    if (matches.length === 0) {
      const err: any = new Error(`No package matches "${pkg}"`)
      err.code = 'ENOMATCH'
      err.pkg = pkg
      throw err
    }
    const best = matches[0]
    if (channels[best.channel]) channels[best.channel].push(best)
    else channels[best.channel] = [best]
  }

  if (Object.keys(channels).length > 1) {
    console.error('Warning: installing packages from more than one channel into the same environment.\n', channels)
  }

  for (let channel in channels) {
    let args = [
      '--install',
      '--file', `channel:${channel}`,
      '--profile', path.join(profiles, env)
    ]
    if (clean) args = args.concat('--remove-all')
    args = args.concat('--attr', channels[channel].map((pkg: any) => pkg.attr))

    await spawn('nix-env', args, {
      stdio: 'inherit'
    })
  }
}

/**
 * Upgrade packages within an environment
 *
 * @param env The environment name
 * @param pkgs A list of packages to upgrade
 */
export async function upgrade (env: string, pkgs: Array<string>) {
  await spawn('nix-env', [
    '--upgrade',
    '--file', `channel:nixpkgs-unstable`,
    '--profile', path.join(profiles, env),
    '--attr'
  ].concat(attrs(pkgs)), {
    stdio: 'inherit'
  })
}

/**
 * Uninstall packages from an environment
 *
 * @param env The environment name
 * @param pkgs A list of packages to uninstall
 */
export async function uninstall (env: string, pkgs: Array<string>) {
  await spawn('nix-env', [
    '--uninstall',
    '--profile', path.join(profiles, env)
  ].concat(names(pkgs)), {
    stdio: 'inherit'
  })
}

/**
 * Get a list of packages installed within an environment
 *
 * @param env The environment name
 */
export async function packages (env: string): Promise<any> {
  const query = await spawn('nix-env', [
    '--query',
    '--installed',
    '--profile', path.join(profiles, env),
    '--out-path'
  ])
  const list = query.toString().trim()
  let pkgs: any = {}
  for (let pkg of (list.length ? list.split('\n') : [])) {
    let [name, path] = pkg.split(/ +/)
    pkgs[name] = path
  }
  return pkgs
}

/**
 * Get a list of packages required by the environment
 *
 * @param env The environment name
 */
export async function requisites (env: string): Promise<Array<any>> {
  const query = await spawn('nix-store', [
    '--query',
    '--requisites',
    await location(env)
  ])
  const list = query.toString().trim()
  return list.length ? list.split('\n') : []
}

/**
 * Get the Nix attribute paths for packages
 *
 * @param pkgs A list of package names
 */
function attrs (pkgs: Array<string>): Array<string> {
  // Installing using Nix attribute paths (i.e. the `--attr` option rather than names)
  // seems to be much faster. Currently we take the package with the highest Nix priority
  // (define in the package meta) but we should also take into account the package version
  // and warn users when more than one? Would also b good to do suggestions is no exact match
  // is found.
  const attrs = []
  for (let pkg of pkgs) {
    const stmt = db.prepare('SELECT attr FROM packages WHERE name == ? ORDER BY priority DESC LIMIT 1')
    const attr = stmt.pluck().get(pkg)
    if (!attr) throw new Error(`No package with name "${pkg}"`)
    attrs.push(attr)
  }
  return attrs
}

/**
 * Get the Nix packages names for packages
 *
 * @param pkgs A list of package names
 */
function names (pkgs: Array<string>): Array<string> {
  const name = []
  for (let pkg of pkgs) {
    const stmt = db.prepare('SELECT fullname FROM packages WHERE name == ? ORDER BY priority DESC LIMIT 1')
    const attr = stmt.pluck().get(pkg)
    if (!attr) throw new Error(`No package with name "${pkg}"`)
    name.push(attr)
  }
  return name
}