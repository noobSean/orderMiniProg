'use strict'

/**
 * cloudfunctions/settingsAdmin —— 门店配置读取 / 更新（单文档 upsert）
 * 运行：node --test tests/cloud/settingsAdmin.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_settings_admin'

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  seed.admin_sessions = [makeSession({ token: TOKEN, expireAt: Date.now() + 60 * 60 * 1000 })]
  return createScenario({ fn: 'settingsAdmin', openid: 'openid_admin', seed: seed })
}

test('settingsAdmin: 无 token 返回 NEED_ADMIN_LOGIN；过期 token 同样被拒', async () => {
  let s = scenario()
  let res = await s.call({ action: 'get' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /请先登录管理后台/)

  s = createScenario({
    fn: 'settingsAdmin',
    openid: 'openid_admin',
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] }
  })
  res = await s.call({ action: 'get', adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期/)
})

test('settingsAdmin/get: 无配置返回 data:null；有配置返回第一条', async () => {
  let s = scenario()
  let res = await s.call({ action: 'get', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: null })

  const doc = { _id: 'settings_main', storeName: '星辰餐厅', openTime: '08:30', closeTime: '13:30' }
  s = scenario({ seed: { settings: [doc] } })
  res = await s.call({ action: 'get', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: doc })
})

test('settingsAdmin/update: 已有配置时局部更新，未传字段保留', async () => {
  const original = { _id: 'settings_main', storeName: '旧店名', openTime: '08:00', closeTime: '13:00', phone: '123' }
  const s = scenario({ seed: { settings: [original] } })
  const res = await s.call({ action: 'update', storeName: '新店名', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data._id, 'settings_main')
  assert.equal(res.data.storeName, '新店名')
  assert.equal(res.data.openTime, '08:00', '返回值为旧记录合并 patch')
  const saved = s.doc('settings', 'settings_main')
  assert.equal(saved.storeName, '新店名')
  assert.equal(saved.openTime, '08:00')
  assert.equal(saved.phone, '123')
  assert.equal(s.count('settings'), 1, '不应新增第二条配置')
})

test('settingsAdmin/update: 数组字段会归一为字符串数组，非数组归零为 []', async () => {
  const s = scenario({ seed: { settings: [{ _id: 'settings_main', storeName: 'x' }] } })
  await s.call({ action: 'update', locations: ['A座', 1, null], departments: '不是数组', adminToken: TOKEN })
  const saved = s.doc('settings', 'settings_main')
  assert.deepEqual(saved.locations, ['A座', '1', 'null'])
  assert.deepEqual(saved.departments, [])
})

test('settingsAdmin/update: 布尔字段仅当显式 false 时才关闭', async () => {
  const s = scenario({ seed: { settings: [{ _id: 'settings_main', storeName: 'x', allowSelfPickup: false, allowDelivery: true }] } })
  // 传 0 / null 均不是 === false，因此源码的 !== false 语义会视为开启
  let res = await s.call({ action: 'update', allowSelfPickup: 0, allowDelivery: null, adminToken: TOKEN })
  assert.equal(res.data.allowSelfPickup, true)
  assert.equal(res.data.allowDelivery, true)
  // 显式 false 才关闭
  res = await s.call({ action: 'update', allowSelfPickup: false, adminToken: TOKEN })
  assert.equal(res.ok, true)
  const saved = s.doc('settings', 'settings_main')
  assert.equal(saved.allowSelfPickup, false)
  assert.equal(saved.allowDelivery, true)
})

test('settingsAdmin/update: 无配置时创建单文档并写入 serverDate createdAt', async () => {
  const s = scenario()
  const res = await s.call({
    action: 'update',
    storeName: '星辰科技 · 员工餐厅',
    openTime: '08:30',
    closeTime: '13:30',
    phone: '021-8888-6666',
    adminToken: TOKEN
  })
  assert.equal(res.ok, true)
  assert.ok(res.data._id, '应返回新文档 _id')
  assert.equal(res.data.storeName, '星辰科技 · 员工餐厅')
  assert.equal(s.count('settings'), 1)
  const saved = s.doc('settings', res.data._id)
  assert.ok(saved.createdAt instanceof Date, 'db 中 createdAt 为 Date')
  assert.equal(saved.phone, '021-8888-6666')
})

test('settingsAdmin: 未知 action 返回 ok:false；数据库异常返回 ok:false', async () => {
  let s = scenario()
  let res = await s.call({ action: 'replace-all', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知 action: replace-all/)

  s = scenario()
  s.mock.failNext('settings', 'get', new Error('settings db down'))
  res = await s.call({ action: 'get', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /settings db down/)
})
