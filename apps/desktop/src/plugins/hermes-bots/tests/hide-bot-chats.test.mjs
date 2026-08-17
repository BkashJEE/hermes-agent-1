import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// #46: canonical "Bot Chat" sessions can be hidden from the global Sessions
// sidebar via the core generic `hidden` session flag, while staying in the Bots
// roster. The plugin passes hidden:true on session.create when the pref is on,
// and reconciles the durable ids via session.set_stored_hidden.

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function loadCreate(hidePref) {
  const start = source.indexOf('const canonicalCreations = new Map()')
  const end = source.indexOf('function displayName(', start)
  const created = []
  const context = {
    host: {
      openSession: async () => {},
      request: async (method, params) => {
        if (method === 'session.create') {
          created.push(params)
          return { stored_session_id: 'sid-1', session_id: 'rt-1' }
        }
        return {}
      }
    },
    saveBotMeta: () => {},
    $hideBotChats: { get: () => hidePref },
    window: { setTimeout: cb => cb() }
  }
  const section = source.slice(start, end).concat('\nglobalThis.__c = { createCanonicalChat };\n')
  vm.runInNewContext(section, context, { filename: 'c.js' })
  return { create: context.__c.createCanonicalChat, created }
}

test('createCanonicalChat passes hidden:true when the pref is on', async () => {
  const { create, created } = loadCreate(true)
  await create('alpha')
  assert.equal(created.length, 1)
  assert.equal(created[0].hidden, true)
  assert.equal(created[0].title, 'Bot Chat')
})

test('createCanonicalChat omits hidden when the pref is off', async () => {
  const { create, created } = loadCreate(false)
  await create('beta')
  assert.equal(created.length, 1)
  assert.ok(!('hidden' in created[0]), 'hidden should be omitted, not false')
})

function loadToggle({
  failProfile = null,
  previous = false,
  storedUnsupported = false,
  legacyFails = false,
  legacyTransient = false,
  staleProfile = null,
  profileRoutes = null,
  routeOwners = {}
} = {}) {
  const requests = []
  const storage = []
  const notifications = []
  const hiddenFromRecents = []
  const savedMeta = []
  const state = []
  const start = source.indexOf('function isSessionNotFoundError(')
  const end = source.indexOf('const avatarFetchInflight', start)
  const context = {
    pluginCtx: { storage: { set: async (...args) => storage.push(args) } },
    $hideBotChats: { get: () => previous, set: value => state.push(value) },
    $botMeta: {
      get: () => ({
        default: { chat: 'stored-default' },
        jarvis: { chat: 'stored-jarvis' }
      })
    },
    saveBotMeta: (profile, patch) => savedMeta.push({ profile, patch }),
    host: {
      profileRoutes: profileRoutes ? async () => profileRoutes : undefined,
      requestProfile: profileRoutes
        ? async (route, method, params) => {
            requests.push({ via: 'route', route, method, params })
            if (routeOwners[params.session_id] !== route.connectionId) {
              const error = new Error('session not found')
              error.code = 4007
              throw error
            }
            return { hidden: params.hidden, session_id: params.session_id }
          }
        : undefined,
      request: async (method, params) => {
        requests.push({ method, params })
        if (method === 'session.set_stored_hidden' && params.profile === staleProfile) {
          const error = new Error('session not found')
          error.code = 4007
          throw error
        }
        if (method === 'session.set_stored_hidden' && storedUnsupported) {
          const error = new Error('unknown method: session.set_stored_hidden')
          error.code = -32601
          throw error
        }
        if (method === 'session.set_hidden' && legacyTransient) {
          throw new Error('connection closed')
        }
        if (method === 'session.set_hidden' && legacyFails) {
          throw new Error('session not found')
        }
        if (params.profile === failProfile) {
          throw new Error('write failed')
        }
        return { hidden: params.hidden, session_id: params.session_id }
      },
      hideSessionsFromRecents: ids => hiddenFromRecents.push(ids),
      notify: notification => notifications.push(notification)
    }
  }
  const section = source.slice(start, end).concat('\nglobalThis.__toggle = setHideBotChats;\n')
  vm.runInNewContext(section, context, { filename: 'toggle.js' })
  return { toggle: context.__toggle, requests, storage, notifications, hiddenFromRecents, savedMeta, state }
}

test('setHideBotChats persists the pref and updates each durable session in its profile', async () => {
  const fixture = loadToggle()
  await fixture.toggle(true)

  assert.deepEqual(fixture.storage, [['hide-bot-chats', true]])
  assert.deepEqual(fixture.state, [true])
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.requests)), [
    {
      method: 'session.set_stored_hidden',
      params: { profile: 'default', session_id: 'stored-default', hidden: true }
    },
    {
      method: 'session.set_stored_hidden',
      params: { profile: 'jarvis', session_id: 'stored-jarvis', hidden: true }
    }
  ])
  assert.equal(fixture.notifications.length, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.hiddenFromRecents)), [
    [
      { profile: 'default', sessionId: 'stored-default' },
      { profile: 'jarvis', sessionId: 'stored-jarvis' }
    ]
  ])
  assert.equal(fixture.requests.some(request => request.method === 'session.set_hidden'), false)
})

test('setHideBotChats finds the owning connection without foregrounding it', async () => {
  const routes = [
    { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' },
    { connectionId: 'remote-a', mode: 'remote', profile: 'jarvis-a', targetProfile: 'jarvis' },
    { connectionId: 'remote-b', mode: 'remote', profile: 'jarvis-b', targetProfile: 'jarvis' }
  ]
  const fixture = loadToggle({
    profileRoutes: routes,
    routeOwners: { 'stored-default': 'local', 'stored-jarvis': 'remote-b' }
  })
  await fixture.toggle(true)

  assert.equal(fixture.requests.every(request => request.via === 'route'), true)
  assert.equal(fixture.requests.filter(request => request.params.session_id === 'stored-jarvis').length, 2)
  assert.deepEqual(fixture.storage, [['hide-bot-chats', true]])
  assert.deepEqual(fixture.state, [true])
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.hiddenFromRecents)), [
    [
      { profile: 'default', sessionId: 'stored-default' },
      { profile: 'jarvis', sessionId: 'stored-jarvis' }
    ]
  ])
  assert.equal(fixture.notifications.length, 0)
})

test('setHideBotChats keeps an unavailable remote pointer without blocking valid chats', async () => {
  const fixture = loadToggle({ staleProfile: 'jarvis' })
  await fixture.toggle(true)

  assert.deepEqual(fixture.savedMeta, [])
  assert.deepEqual(fixture.storage, [['hide-bot-chats', true]])
  assert.deepEqual(fixture.state, [true])
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.hiddenFromRecents)), [
    [{ profile: 'default', sessionId: 'stored-default' }]
  ])
  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0].kind, 'warning')
  assert.match(fixture.notifications[0].message, /unavailable on this connection.*owning source/)
})

test('setHideBotChats uses the legacy live-session RPC on an older backend', async () => {
  const fixture = loadToggle({ storedUnsupported: true })
  await fixture.toggle(true)

  assert.equal(fixture.requests.filter(request => request.method === 'session.set_stored_hidden').length, 2)
  assert.equal(fixture.requests.filter(request => request.method === 'session.set_hidden').length, 2)
  assert.deepEqual(fixture.storage, [['hide-bot-chats', true]])
  assert.deepEqual(fixture.state, [true])
  assert.equal(fixture.notifications.length, 0)
  assert.equal(fixture.hiddenFromRecents.length, 1)
})

test('setHideBotChats saves the future preference when legacy reconciliation cannot apply', async () => {
  const fixture = loadToggle({ storedUnsupported: true, legacyFails: true })
  await fixture.toggle(true)

  assert.deepEqual(fixture.storage, [['hide-bot-chats', true]])
  assert.deepEqual(fixture.state, [true])
  assert.equal(fixture.hiddenFromRecents.length, 0)
  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0].kind, 'warning')
  assert.match(fixture.notifications[0].message, /Preference saved.*2 existing Bot Chats/)
})

test('setHideBotChats treats a transient legacy failure as a real write failure', async () => {
  const fixture = loadToggle({ storedUnsupported: true, legacyTransient: true })
  await fixture.toggle(true)

  assert.deepEqual(fixture.storage, [['hide-bot-chats', false]])
  assert.deepEqual(fixture.state, [false])
  assert.equal(fixture.hiddenFromRecents.length, 0)
  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0].kind, 'error')
  assert.match(fixture.notifications[0].message, /Could not hide 2 Bot Chats. Preference unchanged/)
})

test('setHideBotChats rolls back successful writes and preserves the preference on failure', async () => {
  const fixture = loadToggle({ failProfile: 'jarvis', previous: true })
  await fixture.toggle(false)

  assert.deepEqual(JSON.parse(JSON.stringify(fixture.requests)), [
    {
      method: 'session.set_stored_hidden',
      params: { profile: 'default', session_id: 'stored-default', hidden: false }
    },
    {
      method: 'session.set_stored_hidden',
      params: { profile: 'jarvis', session_id: 'stored-jarvis', hidden: false }
    },
    {
      method: 'session.set_stored_hidden',
      params: { profile: 'default', session_id: 'stored-default', hidden: true }
    }
  ])
  assert.deepEqual(fixture.storage, [['hide-bot-chats', true]])
  assert.deepEqual(fixture.state, [true])
  assert.equal(fixture.hiddenFromRecents.length, 0)
  assert.equal(fixture.notifications.length, 1)
  assert.equal(fixture.notifications[0].kind, 'error')
  assert.match(fixture.notifications[0].message, /Could not show 1 Bot Chat. Preference unchanged/)
})
