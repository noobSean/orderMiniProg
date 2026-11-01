'use strict'

/**
 * cloudfunctions/categoryAdmin —— 菜品分类管理（list/get/create/update/delete）
 * 运行：node --test tests/cloud/categoryAdmin.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_category_admin'

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  seed.admin_sessions = [makeSession({ token: TOKEN, expireAt: Date.now() + 60 * 60 * 1000 })]
  return createScenario({ fn: 'categoryAdmin', openid: 'openid_admin', seed: seed })
}

function category(id, sort, name) {
  return { _id: id, name: name || ('分类' + id), sort: sort }
}

test('categoryAdmin: 无 token 与过期 token 均返回 NEED_ADMIN_LOGIN', async () => {
  let s = scenario()
  let res = await s.call({ action: 'list' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /请先登录管理后台/)

  s = createScenario({
    fn: 'categoryAdmin',
    openid: 'openid_admin',
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] }
  })
  res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期/)
})

test('categoryAdmin/list: 按 sort 升序返回分类', async () => {
  const s = scenario({ seed: { menu_categories: [category('c2', 2), category('c1', 1), category('c3', 3)] } })
  const res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.map(function (d) { return d._id }), ['c1', 'c2', 'c3'])
})

test('categoryAdmin/get: 兼容 categoryId 与 _id；缺 id 报错', async () => {
  const c = category('c1', 1, '商务套餐')
  const s = scenario({ seed: { menu_categories: [c] } })
  let res = await s.call({ action: 'get', categoryId: 'c1', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: c })
  res = await s.call({ action: 'get', _id: 'c1', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: c })
  res = await s.call({ action: 'get', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少分类 id/)
})

test('categoryAdmin/create: 空名报错；正常创建写库并返回 _id', async () => {
  const s = scenario()
  let res = await s.call({ action: 'create', name: '', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /分类名不能为空/)
  assert.equal(s.count('menu_categories'), 0)

  res = await s.call({ action: 'create', name: '饮品', sort: '4', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.ok(res.data._id)
  assert.equal(res.data.name, '饮品')
  assert.equal(res.data.sort, 4)
  assert.equal(s.doc('menu_categories', res.data._id).name, '饮品')
})

test('categoryAdmin/create: sort 非法时回落 0', async () => {
  const s = scenario()
  const res = await s.call({ action: 'create', name: '甜点', sort: 'not-a-number', adminToken: TOKEN })
  assert.equal(res.ok, true)
  assert.equal(res.data.sort, 0)
})

test('categoryAdmin/update: 局部更新，未传字段不变', async () => {
  const s = scenario({ seed: { menu_categories: [category('c1', 1, '旧名')] } })
  const res = await s.call({ action: 'update', categoryId: 'c1', sort: 9, adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { _id: 'c1' } })
  const saved = s.doc('menu_categories', 'c1')
  assert.equal(saved.sort, 9)
  assert.equal(saved.name, '旧名')
})

test('categoryAdmin/update: 缺少 id 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'update', name: 'x', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少分类 id/)
})

test('categoryAdmin/delete: 物理删除分类', async () => {
  const s = scenario({ seed: { menu_categories: [category('c1', 1)] } })
  const res = await s.call({ action: 'delete', categoryId: 'c1', adminToken: TOKEN })
  assert.deepEqual(res, { ok: true, data: { _id: 'c1' } })
  assert.equal(s.doc('menu_categories', 'c1'), null)
})

test('categoryAdmin/delete: 缺少 id 返回 ok:false', async () => {
  const s = scenario()
  const res = await s.call({ action: 'delete', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /缺少分类 id/)
})

test('categoryAdmin: 数据库异常返回 ok:false；未知 action 有提示', async () => {
  let s = scenario({ seed: { menu_categories: [category('c1', 1)] } })
  s.mock.failNext('menu_categories', 'get', new Error('cat db down'))
  let res = await s.call({ action: 'list', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /cat db down/)

  s = scenario()
  res = await s.call({ action: 'rename-all', adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知 action: rename-all/)
})
