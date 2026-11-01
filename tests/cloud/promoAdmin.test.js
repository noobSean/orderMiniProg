'use strict'

/**
 * cloudfunctions/promoAdmin —— 促销活动管理（proto）
 * 覆盖：鉴权、列表、创建/更新、参数校验、范围（全部/分类/菜品）、时间、启用停用、删除。
 * 运行：node --test tests/cloud/promoAdmin.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_promo_admin'

function scenario() {
  return createScenario({
    fn: 'promoAdmin',
    openid: 'openid_admin',
    seed: {
      admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() + 3600 * 1000 })],
      promotions: [
        {
          _id: 'promo_old',
          name: '旧活动',
          scopeType: 'all',
          categoryIds: [],
          dishIds: [],
          discount: 9,
          rate: 0.9,
          startAt: null,
          endAt: null,
          enabled: true,
          createdAt: new Date('2026-10-01T00:00:00+08:00')
        }
      ]
    }
  })
}

function call(s, event) { return s.call(Object.assign({ adminToken: TOKEN }, event || {})) }

test('promoAdmin: 未登录/无效 token 返回 NEED_ADMIN_LOGIN', async () => {
  const s = scenario()
  let res = await s.call({ action: 'list' })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  res = await s.call({ action: 'list', adminToken: 'bad' })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

test('promoAdmin/list: 返回活动列表（按创建时间倒序）', async () => {
  const s = scenario()
  s.mock.insert('promotions', {
    _id: 'promo_new', name: '新活动', scopeType: 'all', categoryIds: [], dishIds: [],
    discount: 8, rate: 0.8, startAt: null, endAt: null, enabled: true, createdAt: new Date('2026-10-20T00:00:00+08:00')
  })
  const res = await call(s, { action: 'list' })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.map(function (p) { return p._id }), ['promo_new', 'promo_old'])
})

test('promoAdmin/save: 创建全部品类折扣活动', async () => {
  const s = scenario()
  const res = await call(s, {
    action: 'save', name: '全场 8 折', discount: 8, scopeType: 'all',
    startAt: new Date('2026-11-01T00:00:00+08:00').getTime(),
    endAt: new Date('2026-11-30T23:59:59+08:00').getTime(),
    enabled: true
  })
  assert.equal(res.ok, true)
  assert.ok(res.data._id)
  const doc = s.doc('promotions', res.data._id)
  assert.equal(doc.name, '全场 8 折')
  assert.equal(doc.rate, 0.8)
  assert.equal(doc.discount, 8)
  assert.equal(doc.scopeType, 'all')
  assert.equal(doc.enabled, true)
  assert.ok(doc.createdAt instanceof Date)
})

test('promoAdmin/save: 指定分类活动（categoryIds 去重/过滤空值）', async () => {
  const s = scenario()
  const res = await call(s, {
    action: 'save', name: '饮品 5 折', discount: 5, scopeType: 'category',
    categoryIds: ['cat_drink', 'cat_drink', '', '  ']
  })
  assert.equal(res.ok, true)
  const doc = s.doc('promotions', res.data._id)
  assert.deepEqual(doc.categoryIds, ['cat_drink'])
  assert.equal(doc.rate, 0.5)
})

test('promoAdmin/save: 参数校验（名称/折扣/范围/分类/时间）', async () => {
  const cases = [
    [{ name: '', discount: 8, scopeType: 'all' }, /活动名称/],
    [{ name: 'x'.repeat(21), discount: 8, scopeType: 'all' }, /最多 20/],
    [{ name: '活动', discount: 0.5, scopeType: 'all' }, /折扣/],
    [{ name: '活动', discount: 10, scopeType: 'all' }, /折扣/],
    [{ name: '活动', discount: 8, scopeType: 'weird' }, /范围/],
    [{ name: '活动', discount: 8, scopeType: 'category', categoryIds: [] }, /分类/],
    [{ name: '活动', discount: 8, scopeType: 'dish', dishIds: [] }, /菜品/],
    [{ name: '活动', discount: 8, scopeType: 'all', startAt: 'bad' }, /开始时间/],
    [{ name: '活动', discount: 8, scopeType: 'all', startAt: 2000, endAt: 1000 }, /结束时间/]
  ]
  for (const [event, re] of cases) {
    const s = scenario()
    const res = await call(s, Object.assign({ action: 'save' }, event))
    assert.equal(res.ok, false, JSON.stringify(event))
    assert.match(res.message, re)
    assert.equal(s.count('promotions'), 1, '校验失败不应新增活动')
  }
})

test('promoAdmin/save: 按 _id 更新已有活动', async () => {
  const s = scenario()
  const res = await call(s, {
    action: 'save', _id: 'promo_old', name: '旧活动改名', discount: 7, scopeType: 'all', enabled: false
  })
  assert.equal(res.ok, true)
  const doc = s.doc('promotions', 'promo_old')
  assert.equal(doc.name, '旧活动改名')
  assert.equal(doc.rate, 0.7)
  assert.equal(doc.enabled, false)
  assert.ok(doc.updatedAt instanceof Date)
})

test('promoAdmin/toggle: 启用/停用活动', async () => {
  const s = scenario()
  let res = await call(s, { action: 'toggle', _id: 'promo_old', enabled: false })
  assert.equal(res.ok, true)
  assert.equal(s.doc('promotions', 'promo_old').enabled, false)
  res = await call(s, { action: 'toggle', _id: 'promo_old', enabled: true })
  assert.equal(res.ok, true)
  assert.equal(s.doc('promotions', 'promo_old').enabled, true)
})

test('promoAdmin/remove: 删除活动；缺少 _id 返回错误', async () => {
  const s = scenario()
  let res = await call(s, { action: 'remove', _id: 'promo_old' })
  assert.equal(res.ok, true)
  assert.equal(s.doc('promotions', 'promo_old'), null)
  res = await call(s, { action: 'remove' })
  assert.equal(res.ok, false)
  assert.match(res.message, /_id/)
})

test('promoAdmin: 未知 action 返回错误提示', async () => {
  const s = scenario()
  const res = await call(s, { action: 'hack' })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知 action: hack/)
})
