#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const XIVA = path.join(ROOT, 'vendor', 'xivanalysis')
const ENGINE_REVISION = process.env.XIVA_ENGINE_REVISION || 'f532855e635bdfb4211cec8128d582dadfdc6a75'

function fail(message, details) {
  process.stderr.write(JSON.stringify({ error: message, details: details || null }) + '\n')
  process.exit(1)
}

if (!fs.existsSync(path.join(XIVA, 'src', 'parser', 'core', 'Parser.tsx'))) {
  fail('xivanalysis submodule is not initialized', 'Run npm run analysis:setup.')
}
if (!fs.existsSync(path.join(XIVA, 'node_modules', '@babel', 'register'))) {
  fail('xivanalysis dependencies are not installed', 'Run npm run analysis:setup.')
}

process.env.NODE_ENV = 'production'
process.chdir(XIVA)
process.env.NODE_PATH = [path.join(XIVA, 'src'), path.join(XIVA, 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter)
Module._initPaths()

global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@sentry/browser') {
    return {
      captureException: () => {},
      withScope: (callback) =>
        callback({
          setTags: () => {},
          setExtras: () => {},
        }),
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

require.extensions['.css'] = (mod) => {
  mod.exports = new Proxy(
    {},
    {
      get: () => '#000',
    },
  )
}

const assetExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2']
for (const extension of assetExtensions) {
  require.extensions[extension] = (mod, filename) => {
    mod.exports = filename
  }
}

const resolveFromVendor = (id) => require.resolve(id, { paths: [XIVA] })
const presetEnvPackage = require.resolve('@babel/preset-env/package.json', { paths: [XIVA] })
const resolveFromPresetEnv = (id) =>
  require.resolve(id, { paths: [path.dirname(presetEnvPackage)] })
const loadModule = (modulePath) => {
  const loaded = require(modulePath)
  return loaded.default || loaded
}

const dependencyPlugin = loadModule(path.join(XIVA, 'config', 'babel-plugin-xiva-dependency.js'))
const typescriptPlugin = loadModule(resolveFromVendor('@babel/plugin-transform-typescript'))
const decoratorsPlugin = loadModule(resolveFromVendor('@babel/plugin-proposal-decorators'))
const classPropertiesPlugin = loadModule(
  resolveFromPresetEnv('@babel/plugin-transform-class-properties'),
)
const macrosPlugin = loadModule(resolveFromVendor('babel-plugin-macros'))
const lodashPlugin = loadModule(resolveFromVendor('babel-plugin-lodash'))
const transformRuntimePlugin = loadModule(resolveFromVendor('@babel/plugin-transform-runtime'))

const getPlugins = ({ isTypescript = false, isTSX = false } = {}) =>
  [
    dependencyPlugin,
    isTypescript && [typescriptPlugin, { isTSX, allowDeclareFields: true }],
    [decoratorsPlugin, { version: '2023-11' }],
    classPropertiesPlugin,
    macrosPlugin,
    lodashPlugin,
    [
      transformRuntimePlugin,
      {
        corejs: { version: 3 },
        useESModules: true,
        version: '^7.12.5',
      },
    ],
  ].filter(Boolean)

require(resolveFromVendor('@babel/register'))({
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
  cwd: XIVA,
  root: XIVA,
  babelrc: false,
  configFile: false,
  cache: false,
  presets: [
    [
      loadModule(resolveFromVendor('@babel/preset-env')),
      {
        bugfixes: true,
        targets: { node: true },
        include: ['proposal-class-static-block'],
      },
    ],
    [
      loadModule(resolveFromVendor('@babel/preset-react')),
      {
        development: false,
        runtime: 'automatic',
      },
    ],
  ],
  overrides: [
    { test: /[.]jsx?$/, plugins: getPlugins() },
    { test: /[.]ts$/, plugins: getPlugins({ isTypescript: true }) },
    { test: /[.]tsx$/, plugins: getPlugins({ isTypescript: true, isTSX: true }) },
  ]
})

const { GameEdition } = require(path.join(XIVA, 'src', 'data', 'EDITIONS.ts'))
const { getEncounterKey } = require(path.join(XIVA, 'src', 'data', 'ENCOUNTERS.ts'))
const { Team } = require(path.join(XIVA, 'src', 'report.ts'))
const { adaptEvents } = require(
  path.join(XIVA, 'src', 'reportSources', 'legacyFflogs', 'eventAdapter', 'adapter.ts'),
)
const { AVAILABLE_MODULES } = require(path.join(XIVA, 'src', 'parser', 'AVAILABLE_MODULES.ts'))
const { Parser } = require(path.join(XIVA, 'src', 'parser', 'core', 'Parser.tsx'))

// Keep browser detection in React/Scheduler on Node's server path during module loading.
// Parser only uses window.location.reload on its production error-recovery path.
global.window = { location: { reload: () => {} } }

const JOB_KEYS = {
  Paladin: 'PALADIN',
  Warrior: 'WARRIOR',
  DarkKnight: 'DARK_KNIGHT',
  Gunbreaker: 'GUNBREAKER',
  WhiteMage: 'WHITE_MAGE',
  Scholar: 'SCHOLAR',
  Astrologian: 'ASTROLOGIAN',
  Sage: 'SAGE',
  Monk: 'MONK',
  Dragoon: 'DRAGOON',
  Ninja: 'NINJA',
  Samurai: 'SAMURAI',
  Reaper: 'REAPER',
  Viper: 'VIPER',
  Beastmaster: 'BEASTMASTER',
  Bard: 'BARD',
  Machinist: 'MACHINIST',
  Dancer: 'DANCER',
  BlackMage: 'BLACK_MAGE',
  Summoner: 'SUMMONER',
  RedMage: 'RED_MAGE',
  Pictomancer: 'PICTOMANCER',
  BlueMage: 'BLUE_MAGE',
}

const compact = (value) => String(value || '').replace(/[\s_-]/g, '')

function editionFor(language) {
  switch (language) {
    case 'kr':
      return GameEdition.KOREAN
    case 'cn':
      return GameEdition.CHINESE
    case 'ja':
    case 'en':
    case 'de':
    case 'fr':
    case null:
    case undefined:
      return GameEdition.GLOBAL
    default:
      return GameEdition.GLOBAL
  }
}

function actorKind(actor) {
  const guid = actor.gameID == null ? Number(actor.id) : Number(actor.gameID)
  const id = Number(String(actor.id).split(':', 1)[0])
  if (Number.isFinite(guid) && guid >= 1000000 && id === guid % 1000000) {
    return 'unknown'
  }
  return Number.isFinite(guid) ? String(guid) : String(actor.id)
}

function jobFor(subType) {
  return JOB_KEYS[compact(subType)] || 'UNKNOWN'
}

function buildEngineObjects(input) {
  const baseActors = new Map()
  for (const source of input.actors) {
    baseActors.set(source.id, {
      id: source.id,
      kind: actorKind(source),
      name: source.name,
      team: source.team === 'FRIEND' ? Team.FRIEND : Team.FOE,
      playerControlled: source.playerControlled,
      job: source.playerControlled ? jobFor(source.subType) : 'UNKNOWN',
    })
  }

  for (const source of input.actors) {
    const actor = baseActors.get(source.id)
    if (actor && source.ownerId) actor.owner = baseActors.get(source.ownerId)
  }

  const actors = []
  for (const source of input.actors) {
    const actor = baseActors.get(source.id)
    if (!actor) continue
    actors.push(actor)
    const count = Math.max(1, Number(source.instanceCount) || 1)
    for (let instance = 2; instance <= count; instance++) {
      actors.push({ ...actor, id: `${actor.id}:${instance}` })
    }
  }

  actors.push({
    id: 'unknown',
    kind: 'unknown',
    name: 'Unknown',
    team: Team.UNKNOWN,
    playerControlled: false,
    job: 'UNKNOWN',
  })

  const encounterKey = getEncounterKey('legacyFflogs', String(input.pull.encounterID))
  const pull = {
    id: input.pull.id,
    timestamp: input.pull.timestamp,
    duration: input.pull.duration,
    ...(input.pull.progress == null ? {} : { progress: input.pull.progress }),
    encounter: {
      ...(encounterKey ? { key: encounterKey } : {}),
      name: input.pull.name || `Encounter ${input.pull.encounterID}`,
      duty: {
        id: input.pull.gameZone?.id ?? -1,
        name: input.pull.gameZone?.name ?? 'Unknown duty',
      },
    },
    actors,
  }
  const report = {
    timestamp: input.reportTimestamp,
    edition: editionFor(input.reportLanguage),
    name: input.reportTitle || input.reportCode,
    pulls: [pull],
    meta: {
      source: 'legacyFflogs',
      code: input.reportCode,
    },
  }

  return { report, pull }
}

function severityName(value) {
  switch (value) {
    case 0:
      return 'morbid'
    case 1:
      return 'major'
    case 2:
      return 'medium'
    case 3:
      return 'minor'
    case 100:
      return 'memes'
    case Infinity:
      return 'ignore'
    default:
      return 'unknown'
  }
}

async function analyse(input, actorId) {
  const { report, pull } = buildEngineObjects(input)
  const actor = pull.actors.find((candidate) => candidate.id === actorId && candidate.playerControlled)
  if (!actor) throw new Error(`Player actor ${actorId} is not available in pull ${pull.id}.`)

  const adaptedEvents = adaptEvents(report, pull, input.events, input.pull.firstEventTimestamp)

  let meta = AVAILABLE_MODULES.CORE
  if (pull.encounter.key && AVAILABLE_MODULES.BOSSES[pull.encounter.key]) {
    meta = meta.merge(AVAILABLE_MODULES.BOSSES[pull.encounter.key])
  }
  if (AVAILABLE_MODULES.JOBS[actor.job]) {
    meta = meta.merge(AVAILABLE_MODULES.JOBS[actor.job])
  }

  const parser = new Parser({ meta, report, pull, actor })
  await parser.configure()
  parser.parseEvents({ events: adaptedEvents })

  const moduleErrors = Object.fromEntries(
    Object.entries(parser._moduleErrors || {}).map(([handle, error]) => [
      handle,
      error instanceof Error ? error.message : String(error),
    ]),
  )
  const modules = Object.entries(parser.container).map(([handle, module]) => ({
    handle,
    type: module?.constructor?.name || 'Unknown',
    error: moduleErrors[handle] || null,
  }))

  const suggestionsModule = parser.container.suggestions
  const suggestions = Array.isArray(suggestionsModule?._suggestions)
    ? suggestionsModule._suggestions.map((suggestion) => ({
        severity: suggestion.severity,
        severityName: severityName(suggestion.severity),
        value: typeof suggestion.value === 'number' ? suggestion.value : null,
        kind: suggestion.constructor?.name || 'Suggestion',
      }))
    : []

  const eventTypes = {}
  for (const event of adaptedEvents) {
    eventTypes[event.type] = (eventTypes[event.type] || 0) + 1
  }

  return {
    engineRevision: ENGINE_REVISION,
    adapterVersion: input.adapterVersion,
    reportCode: input.reportCode,
    fightId: input.pull.fightId,
    actorId,
    job: actor.job,
    encounterKey: pull.encounter.key || null,
    adaptedEventCount: adaptedEvents.length,
    eventTypes,
    moduleCount: modules.length,
    modules,
    suggestions,
  }
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  if (!raw.trim()) fail('runner input is empty')

  const request = JSON.parse(raw)
  if (!request || typeof request !== 'object' || !request.input || !request.actorId) {
    fail('runner input must contain input and actorId')
  }

  const result = await analyse(request.input, String(request.actorId))
  process.stdout.write(JSON.stringify(result))
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error), error?.stack)
})
