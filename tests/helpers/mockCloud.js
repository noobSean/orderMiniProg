'use strict'

/**
 * tests/helpers/mockCloud.js
 * ---------------------------------------------------------------------------
 * 零依赖的 wx-server-sdk 内存 Mock + 云函数加载器，供 tests/cloud/*.test.js 使用。
 *
 * 能力：
 *   - 拦截 require('wx-server-sdk')，返回内存版 cloud 对象；
 *   - 内存云数据库：collection/where/orderBy/skip/limit/get/count/add/doc get|set|update|remove、
 *     db.command（eq/neq/gt/gte/lt/lte/in/nin/exists/and/or）、db.RegExp、db.serverDate、
 *     db.startTransaction()（doc get/update/set/remove + add，commit 生效 / rollback 丢弃）；
 *   - cloud.getWXContext() 可配置 OPENID；
 *   - cloud.openapi.subscribeMessage.getTemplateList / send 可配置模板列表、发送结果与抛错，
 *     并记录调用参数（用于断言「发送次数 / 发送内容」）；
 *   - createScenario()：重置 mock、写种子数据、设置 process.env、清 require 缓存后加载云函数；
 *   - failNext() 注入数据库错误；after() 注入写操作后的回调（用于模拟并发竞态）；
 *   - console.log / console.error 默认被静默捕获到内存，可通过 scenario.logs() 断言诊断日志。
 *
 * 注意：每个测试文件是独立进程（node --test 语义），本模块的全局状态只在单文件内复用；
 * 每个 test() 里应调用 createScenario() 新建场景，避免用例间互相污染。
 */

const Module = require('module')
const path = require('path')
const fs = require('fs')
const { isDeepStrictEqual } = require('node:util')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const CLOUD_DIR = path.join(PROJECT_ROOT, 'cloudfunctions')

// 云函数会读取的环境变量（每个 scenario 之间需要清干净，避免串味）
const KNOWN_ENV_KEYS = [
  'ADMIN_PWD',
  'ORDER_PLACED_TEMPLATE_ID',
  'PICKUP_READY_TEMPLATE_ID',
  'DELIVERY_DONE_TEMPLATE_ID',
  'SUBSCRIBE_MINIPROGRAM_STATE'
]

// ===========================================================================
// console 捕获（默认静默；设置 CLOUD_TEST_VERBOSE=1 可查看云函数日志）
// ===========================================================================
const capturedLogs = []
const VERBOSE = process.env.CLOUD_TEST_VERBOSE === '1'

function stringifyLogArg(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message
  try {
    return JSON.stringify(value)
  } catch (e) {
    return String(value)
  }
}

if (!VERBOSE) {
  console.log = function () {
    capturedLogs.push(Array.prototype.map.call(arguments, stringifyLogArg).join(' '))
  }
  console.error = function () {
    capturedLogs.push('[console.error] ' + Array.prototype.map.call(arguments, stringifyLogArg).join(' '))
  }
}

// ===========================================================================
// 基础工具
// ===========================================================================
function clone(value) {
  if (value === undefined || value === null) return value
  try {
    return structuredClone(value)
  } catch (e) {
    return JSON.parse(JSON.stringify(value))
  }
}

class ServerDate {}
class RegExpSpec {
  constructor(options) {
    const opts = options || {}
    this.regexp = opts.regexp === undefined ? '' : String(opts.regexp)
    this.options = opts.options === undefined ? '' : String(opts.options)
  }
}

function resolveWrites(value) {
  if (value instanceof ServerDate) return new Date()
  if (Array.isArray(value)) return value.map(resolveWrites)
  if (value instanceof Date) return value
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = resolveWrites(value[key])
    return out
  }
  return value
}

function toComparable(value) {
  if (value instanceof Date) return value.getTime()
  return value
}

function compareValues(a, b) {
  const ca = toComparable(a)
  const cb = toComparable(b)
  if (ca === cb) return 0
  if (typeof ca !== typeof cb) return String(ca) < String(cb) ? -1 : 1
  return ca < cb ? -1 : 1
}

// ===========================================================================
// db.command
// ===========================================================================
class QueryCommand {
  constructor(type, value) {
    this.__isCommand = true
    this.type = type
    this.value = value
  }
  and(other) {
    return new QueryCommand('fieldAnd', [this, other])
  }
  or(other) {
    return new QueryCommand('fieldOr', [this, other])
  }
}

function fieldCommand(type) {
  return function (value) {
    return new QueryCommand(type, value)
  }
}

const command = {
  eq: fieldCommand('eq'),
  neq: fieldCommand('neq'),
  gt: fieldCommand('gt'),
  gte: fieldCommand('gte'),
  lt: fieldCommand('lt'),
  lte: fieldCommand('lte'),
  in: fieldCommand('in'),
  nin: fieldCommand('nin'),
  exists: fieldCommand('exists'),
  and: function (subs) {
    return new QueryCommand('logicAnd', Array.isArray(subs) ? subs : [subs])
  },
  or: function (subs) {
    return new QueryCommand('logicOr', Array.isArray(subs) ? subs : [subs])
  }
}

function matchFieldValue(actual, expected) {
  if (expected instanceof QueryCommand) return matchCommand(actual, expected)
  if (expected instanceof RegExpSpec) {
    if (typeof actual !== 'string') return false
    try {
      return new RegExp(expected.regexp, expected.options).test(actual)
    } catch (e) {
      return false
    }
  }
  if (expected instanceof Date) {
    if (actual instanceof Date) return actual.getTime() === expected.getTime()
    return false
  }
  if (Array.isArray(expected)) return Array.isArray(actual) && isDeepStrictEqual(actual, expected)
  if (expected && typeof expected === 'object') return isDeepStrictEqual(actual, expected)
  return actual === expected
}

function matchCommand(actual, cmd) {
  switch (cmd.type) {
    case 'fieldAnd':
      return (cmd.value || []).every(function (sub) { return matchFieldValue(actual, sub) })
    case 'fieldOr':
      return (cmd.value || []).some(function (sub) { return matchFieldValue(actual, sub) })
    case 'logicAnd':
    case 'logicOr':
      // 字段级不应出现顶层逻辑命令，保守返回 false
      return false
    case 'eq':
      return matchFieldValue(actual, cmd.value)
    case 'neq':
      return !matchFieldValue(actual, cmd.value)
    case 'exists':
      return (actual !== undefined) === !!cmd.value
    case 'in':
      return (Array.isArray(cmd.value) ? cmd.value : []).some(function (v) { return matchFieldValue(actual, v) })
    case 'nin':
      return !(Array.isArray(cmd.value) ? cmd.value : []).some(function (v) { return matchFieldValue(actual, v) })
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (actual === undefined || actual === null) return false
      const ca = toComparable(actual)
      const cb = toComparable(cmd.value)
      if (typeof ca !== typeof cb) return false
      if (cmd.type === 'gt') return ca > cb
      if (cmd.type === 'gte') return ca >= cb
      if (cmd.type === 'lt') return ca < cb
      return ca <= cb
    }
    default:
      throw new Error('mockCloud: 不支持的查询命令 ' + cmd.type)
  }
}

function matchCondition(doc, condition) {
  if (condition === undefined || condition === null) return true
  if (condition instanceof QueryCommand) {
    const subs = Array.isArray(condition.value) ? condition.value : [condition.value]
    if (condition.type === 'logicOr') return subs.some(function (sub) { return matchCondition(doc, sub) })
    if (condition.type === 'logicAnd') return subs.every(function (sub) { return matchCondition(doc, sub) })
    throw new Error('mockCloud: 不支持的顶层查询命令 ' + condition.type)
  }
  if (typeof condition !== 'object') return false
  return Object.keys(condition).every(function (field) {
    return matchFieldValue(doc[field], condition[field])
  })
}

// ===========================================================================
// 内存云数据库
// ===========================================================================
class MockDatabase {
  constructor(options) {
    const opts = options || {}
    this.options = {
      // doc(id).get() 找不到文档时：'throw'（贴近真实云 SDK 行为，默认）/ 'null'（返回 {data:null}）
      missingDoc: opts.missingDoc === 'null' ? 'null' : 'throw',
      // orderBy 字段缺失的文档：'exclude'（贴近真实云数据库，默认）/ 'last'（排最后）
      orderByMissing: opts.orderByMissing === 'last' ? 'last' : 'exclude'
    }
    this._store = new Map()
    this._idSeq = 0
    this._failures = []
    this._hooks = []
    this.command = command
  }

  serverDate() {
    return new ServerDate()
  }

  RegExp(options) {
    return new RegExpSpec(options)
  }

  collection(name) {
    const collName = String(name)
    if (!this._store.has(collName)) this._store.set(collName, new Map())
    return new Query(this, collName)
  }

  async createCollection(name) {
    this._fail('*', 'createCollection')
    const collName = String(name)
    if (this._store.has(collName)) {
      const err = new Error('collection already exists')
      err.errCode = -501001
      throw err
    }
    this._store.set(collName, new Map())
    return { ok: true }
  }

  startTransaction() {
    return new MockTransaction(this)
  }

  // ---------------- 内部方法 ----------------
  _coll(name) {
    const collName = String(name)
    if (!this._store.has(collName)) this._store.set(collName, new Map())
    return this._store.get(collName)
  }

  _nextId() {
    this._idSeq += 1
    return 'id_' + this._idSeq
  }

  _fail(collection, op) {
    const idx = this._failures.findIndex(function (f) {
      const collOk = f.collection === collection || f.collection === '*'
      const opOk = f.op === op || f.op === '*'
      return collOk && opOk
    })
    if (idx < 0) return
    const failure = this._failures.splice(idx, 1)[0]
    const err = failure.error instanceof Error
      ? failure.error
      : Object.assign(new Error(String(failure.error || 'mock database failure')), {
        errCode: failure.errCode === undefined ? -1 : failure.errCode
      })
    throw err
  }

  _runHooks(collection, op, payload) {
    for (const hook of this._hooks) {
      if ((hook.collection === collection || hook.collection === '*') && (hook.op === op || hook.op === '*')) {
        hook.fn(payload, this)
      }
    }
  }

  // 种子/直插：不触发 hooks、不消耗 failNext
  insertSeed(name, data) {
    const store = this._coll(name)
    const doc = clone(resolveWrites(data))
    if (!doc._id) doc._id = this._nextId()
    store.set(String(doc._id), doc)
    return doc._id
  }
}

// ---------------------------------------------------------------------------
// Query（collection 本身即查询链起点）
// ---------------------------------------------------------------------------
class Query {
  constructor(db, collectionName) {
    this.db = db
    this.collectionName = collectionName
    this._where = null
    this._orders = []
    this._skip = 0
    this._limit = 100
  }

  _copy() {
    const q = new Query(this.db, this.collectionName)
    q._where = this._where
    q._orders = this._orders.slice()
    q._skip = this._skip
    q._limit = this._limit
    return q
  }

  where(condition) {
    const q = this._copy()
    q._where = condition
    return q
  }

  orderBy(field, direction) {
    const q = this._copy()
    q._orders.push({ field: String(field), direction: direction === 'desc' ? 'desc' : 'asc' })
    return q
  }

  skip(count) {
    const q = this._copy()
    q._skip = Math.max(0, Number(count) || 0)
    return q
  }

  limit(count) {
    const q = this._copy()
    q._limit = Math.max(0, Number(count) || 0)
    return q
  }

  _matched() {
    const self = this
    const rows = []
    for (const doc of this.db._coll(this.collectionName).values()) {
      if (matchCondition(doc, self._where)) rows.push(doc)
    }
    return rows
  }

  _rows() {
    let rows = this._matched()
    if (this._orders.length) {
      const self = this
      if (this.db.options.orderByMissing === 'exclude') {
        rows = rows.filter(function (doc) {
          return self._orders.every(function (o) { return doc[o.field] !== undefined })
        })
      }
      const indexed = rows.map(function (doc, index) { return { doc: doc, index: index } })
      indexed.sort(function (a, b) {
        for (const order of self._orders) {
          const c = compareValues(a.doc[order.field], b.doc[order.field])
          if (c !== 0) return order.direction === 'desc' ? -c : c
        }
        return a.index - b.index
      })
      rows = indexed.map(function (row) { return row.doc })
    }
    return rows
  }

  async get() {
    this.db._fail(this.collectionName, 'get')
    const rows = this._rows()
    const data = rows.slice(this._skip, this._skip + this._limit).map(clone)
    return { data: data, errMsg: 'collection.get:ok' }
  }

  async count() {
    this.db._fail(this.collectionName, 'count')
    return { total: this._matched().length }
  }

  async add(options) {
    this.db._fail(this.collectionName, 'add')
    const data = (options && options.data) || {}
    const store = this.db._coll(this.collectionName)
    const doc = clone(resolveWrites(data))
    if (!doc._id) doc._id = this.db._nextId()
    store.set(String(doc._id), doc)
    this.db._runHooks(this.collectionName, 'add', clone(doc))
    return { _id: doc._id }
  }

  async remove() {
    this.db._fail(this.collectionName, 'remove')
    const matched = this._matched()
    const store = this.db._coll(this.collectionName)
    for (const doc of matched) store.delete(String(doc._id))
    return { stats: { removed: matched.length } }
  }

  async update(options) {
    this.db._fail(this.collectionName, 'update')
    const patch = clone(resolveWrites((options && options.data) || {}))
    const matched = this._matched()
    const store = this.db._coll(this.collectionName)
    for (const doc of matched) {
      const current = store.get(String(doc._id))
      if (current) Object.assign(current, patch)
    }
    this.db._runHooks(this.collectionName, 'update', { stats: { updated: matched.length } })
    return { stats: { updated: matched.length } }
  }

  doc(id) {
    return new DocumentReference(this.db, this.collectionName, id)
  }
}

class DocumentReference {
  constructor(db, collectionName, id) {
    this.db = db
    this.collectionName = collectionName
    this.id = String(id)
  }

  async get() {
    this.db._fail(this.collectionName, 'docGet')
    const store = this.db._coll(this.collectionName)
    const doc = store.get(this.id)
    if (!doc) {
      if (this.db.options.missingDoc === 'null') return { data: null }
      const err = new Error('document.get:fail document with _id ' + this.id + ' does not exist')
      err.errCode = -1
      err.errMsg = err.message
      throw err
    }
    this.db._runHooks(this.collectionName, 'docGet', clone(doc))
    return { data: clone(doc) }
  }

  async set(options) {
    this.db._fail(this.collectionName, 'docSet')
    const data = clone(resolveWrites((options && options.data) || {}))
    const store = this.db._coll(this.collectionName)
    data._id = this.id
    store.set(this.id, data)
    this.db._runHooks(this.collectionName, 'docSet', clone(data))
    return { stats: { updated: 1 }, _id: this.id }
  }

  async update(options) {
    this.db._fail(this.collectionName, 'docUpdate')
    const store = this.db._coll(this.collectionName)
    const current = store.get(this.id)
    if (!current) return { stats: { updated: 0 } }
    const patch = clone(resolveWrites((options && options.data) || {}))
    Object.assign(current, patch)
    this.db._runHooks(this.collectionName, 'docUpdate', clone(current))
    return { stats: { updated: 1 } }
  }

  async remove() {
    this.db._fail(this.collectionName, 'docRemove')
    const store = this.db._coll(this.collectionName)
    const existed = store.delete(this.id)
    this.db._runHooks(this.collectionName, 'docRemove', { _id: this.id })
    return { stats: { removed: existed ? 1 : 0 } }
  }
}

// ---------------------------------------------------------------------------
// 事务（读直接读主库；写先暂存，commit 时生效，rollback 丢弃）
// ---------------------------------------------------------------------------
class MockTransaction {
  constructor(db) {
    this.db = db
    this.ops = []
    this.finished = false
  }

  collection(name) {
    return new TransactionCollection(this, String(name))
  }

  async commit() {
    this._ensureOpen()
    this.db._fail('*', 'commit')
    for (const op of this.ops) {
      const store = this.db._coll(op.collectionName)
      if (op.type === 'set') store.set(op.id, op.doc)
      else if (op.type === 'update') {
        const current = store.get(op.id)
        if (current) Object.assign(current, op.patch)
      } else if (op.type === 'remove') {
        store.delete(op.id)
      }
    }
    this.ops = []
    this.finished = true
    return { errMsg: 'transaction.commit:ok' }
  }

  async rollback() {
    this._ensureOpen()
    this.ops = []
    this.finished = true
    return { errMsg: 'transaction.rollback:ok' }
  }

  _ensureOpen() {
    if (this.finished) throw new Error('transaction already finished')
  }
}

class TransactionCollection {
  constructor(transaction, collectionName) {
    this.transaction = transaction
    this.collectionName = collectionName
  }

  doc(id) {
    return new TransactionDocument(this.transaction, this.collectionName, id)
  }

  async add(options) {
    this.transaction._ensureOpen()
    const data = (options && options.data) || {}
    const doc = clone(resolveWrites(data))
    if (!doc._id) doc._id = this.transaction.db._nextId()
    this.transaction.ops.push({ type: 'set', collectionName: this.collectionName, id: String(doc._id), doc: doc })
    return { _id: doc._id }
  }

  async count() {
    return { total: 0 }
  }
}

class TransactionDocument {
  constructor(transaction, collectionName, id) {
    this.transaction = transaction
    this.collectionName = collectionName
    this.id = String(id)
  }

  async get() {
    this.transaction._ensureOpen()
    this.transaction.db._fail(this.collectionName, 'txGet')
    const doc = this.transaction.db._coll(this.collectionName).get(this.id)
    return { data: doc ? clone(doc) : null }
  }

  async update(options) {
    this.transaction._ensureOpen()
    this.transaction.db._fail(this.collectionName, 'txUpdate')
    const patch = clone(resolveWrites((options && options.data) || {}))
    this.transaction.ops.push({ type: 'update', collectionName: this.collectionName, id: this.id, patch: patch })
    return { stats: { updated: 1 } }
  }

  async set(options) {
    this.transaction._ensureOpen()
    this.transaction.db._fail(this.collectionName, 'txSet')
    const data = clone(resolveWrites((options && options.data) || {}))
    data._id = this.id
    this.transaction.ops.push({ type: 'set', collectionName: this.collectionName, id: this.id, doc: data })
    return { stats: { updated: 1 } }
  }

  async remove() {
    this.transaction._ensureOpen()
    this.transaction.db._fail(this.collectionName, 'txRemove')
    this.transaction.ops.push({ type: 'remove', collectionName: this.collectionName, id: this.id })
    return { stats: { removed: 1 } }
  }
}

// ===========================================================================
// wx-server-sdk Mock（cloud 对象）
// ===========================================================================
function buildCloud(st) {
  return {
    DYNAMIC_CURRENT_ENV: 'mock-env',
    init: function () { return {} },
    database: function () { return st.db },
    getWXContext: function () {
      return { OPENID: st.openid, APPID: 'wx_mock_appid', UNIONID: '' }
    },
    openapi: {
      subscribeMessage: {
        getTemplateList: async function (args) {
          st.openapi.calls.getTemplateList.push(clone(args === undefined ? {} : args))
          if (st.openapi.getTemplateListError) throw st.openapi.getTemplateListError
          return { data: clone(st.openapi.templates) }
        },
        send: async function (args) {
          st.openapi.calls.send.push(clone(args))
          if (st.openapi.sendError) throw st.openapi.sendError
          return clone(st.openapi.sendResult)
        }
      }
    }
  }
}

function createState(opts) {
  const st = {
    openid: opts.openid === undefined ? 'openid_test_user' : opts.openid,
    openapi: {
      templates: clone(opts.templates || []),
      getTemplateListError: opts.templateListError || null,
      sendError: opts.sendError || null,
      sendResult: opts.sendResult === undefined ? { errCode: 0, errMsg: 'ok' } : clone(opts.sendResult),
      calls: { getTemplateList: [], send: [] }
    },
    logsFrom: capturedLogs.length
  }
  st.db = new MockDatabase(opts.options)
  st.cloud = buildCloud(st)

  st.setOpenid = function (openid) { st.openid = openid }
  st.docs = function (collectionName) {
    const store = st.db._store.get(String(collectionName))
    if (!store) return []
    return Array.from(store.values()).map(clone)
  }
  st.doc = function (collectionName, id) {
    const store = st.db._store.get(String(collectionName))
    if (!store) return null
    const doc = store.get(String(id))
    return doc ? clone(doc) : null
  }
  st.count = function (collectionName) {
    const store = st.db._store.get(String(collectionName))
    return store ? store.size : 0
  }
  st.insert = function (collectionName, docs) {
    const list = Array.isArray(docs) ? docs : [docs]
    const ids = []
    for (const doc of list) ids.push(st.db.insertSeed(collectionName, doc))
    return ids.length === 1 ? ids[0] : ids
  }
  st.seed = function (collectionName, docs) { return st.insert(collectionName, docs) }
  st.failNext = function (collection, op, error) {
    st.db._failures.push({ collection: collection, op: op, error: error })
  }
  st.after = function (collection, op, fn) {
    st.db._hooks.push({ collection: collection, op: op, fn: fn })
  }
  st.logs = function () { return capturedLogs.slice(st.logsFrom) }
  return st
}

// ===========================================================================
// 环境变量管理
// ===========================================================================
let activeEnvKeys = []

function applyEnv(env) {
  const toClear = new Set(KNOWN_ENV_KEYS.concat(activeEnvKeys))
  for (const key of toClear) delete process.env[key]
  activeEnvKeys = []
  const entries = Object.entries(env || {})
  for (const entry of entries) {
    const key = entry[0]
    const value = entry[1]
    if (value === undefined) continue
    process.env[key] = String(value)
    activeEnvKeys.push(key)
  }
}

// ===========================================================================
// 云函数加载
// ===========================================================================
function loadCloudFunction(functionName) {
  const file = path.join(CLOUD_DIR, functionName, 'index.js')
  if (!fs.existsSync(file)) throw new Error('mockCloud: 云函数不存在 -> ' + file)
  delete require.cache[require.resolve(file)]
  return require(file)
}

// 拦截 require('wx-server-sdk')
let currentState = null
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    if (!currentState) throw new Error('mockCloud: 请先调用 createScenario() 再加载云函数')
    return currentState.cloud
  }
  return originalLoad.apply(this, arguments)
}

// ===========================================================================
// 场景辅助
// ===========================================================================
function flushAsync(rounds) {
  const total = rounds === undefined ? 6 : rounds
  let chain = Promise.resolve()
  for (let i = 0; i < total; i += 1) {
    chain = chain.then(function () {
      return new Promise(function (resolve) { setImmediate(resolve) })
    })
  }
  return chain
}

function makeSession(opts) {
  const options = opts || {}
  const token = options.token === undefined ? 'token_mock_valid' : String(options.token)
  const ttlMs = options.ttlMs === undefined ? 60 * 60 * 1000 : options.ttlMs
  const session = {
    token: token,
    openid: options.openid === undefined ? 'openid_admin' : options.openid,
    expireAt: options.expireAt === undefined ? Date.now() + ttlMs : options.expireAt,
    createdAt: options.createdAt === undefined ? new Date() : options.createdAt
  }
  if (options._id !== undefined) session._id = options._id
  return session
}

/**
 * 创建并加载一个云函数测试场景。
 *
 * @param {object} opts
 * @param {string} opts.fn                云函数目录名（cloudfunctions/<fn>/index.js）
 * @param {string} [opts.openid]          getWXContext().OPENID，默认 'openid_test_user'
 * @param {object} [opts.env]             加载前设置的 process.env（键值会 String 化）
 * @param {object} [opts.seed]            { collectionName: [docs...] } 种子数据
 * @param {object} [opts.options]         mock db 行为：{ missingDoc:'throw'|'null', orderByMissing:'exclude'|'last' }
 * @param {Array}  [opts.templates]       openapi 模板列表 [{priTmplId,title,content,type}]
 * @param {*}      [opts.templateListError] getTemplateList 抛出的错误（Error 实例）
 * @param {*}      [opts.sendError]       send 抛出的错误
 * @param {*}      [opts.sendResult]      send 成功返回值，默认 {errCode:0,errMsg:'ok'}
 * @returns {object} scenario
 */
function createScenario(opts) {
  const options = opts || {}
  if (!options.fn) throw new Error('createScenario: 缺少 fn（云函数目录名）')
  const st = createState(options)
  currentState = st
  if (options.seed) {
    for (const collectionName of Object.keys(options.seed)) {
      const docs = options.seed[collectionName]
      const list = Array.isArray(docs) ? docs : [docs]
      for (const doc of list) st.db.insertSeed(collectionName, doc)
    }
  }
  applyEnv(options.env)
  const mod = loadCloudFunction(options.fn)

  return {
    name: options.fn,
    fn: mod,
    mock: st,
    db: st.db,
    cloud: st.cloud,
    call: function (event) {
      return mod.main(event === undefined ? {} : event, {})
    },
    logs: st.logs,
    flush: flushAsync,
    docs: st.docs,
    doc: st.doc,
    count: st.count
  }
}

module.exports = {
  PROJECT_ROOT: PROJECT_ROOT,
  CLOUD_DIR: CLOUD_DIR,
  createScenario: createScenario,
  loadCloudFunction: loadCloudFunction,
  flushAsync: flushAsync,
  makeSession: makeSession,
  capturedLogs: capturedLogs,
  // 便于断言错误对象
  MockDatabase: MockDatabase,
  ServerDate: ServerDate
}
