'use strict'

/**
 * cloudfunctions/adminLogin —— 第一层安全
 * 覆盖：whoami、首次管理员自动绑定、非白名单拒绝、停用拒绝、登录限流锁定、会话 openid 绑定。
 * 运行：node --test tests/cloud/adminLogin.security.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const PWD = 'AdminPass123'
function scenario(opts) {
  const options = opts || {}
  return createScenario({
    fn: 'adminLogin',
    openid: options.openid || 'openid_owner',
    env: options.env === undefined ? { ADMIN_PWD: PWD } : options.env,
    seed: options.seed || {}
  })
}

test('whoami: 没有任何管理员时 bootstrap=true，普通微信可看到入口完成初始化', async () => {
  const s = scenario()
  const res = await s.call({ action: 'whoami' })
  assert.equal(res.ok, true)
  assert.equal(res.data.isAdmin, false)
  assert.equal(res.data.bootstrap, true)
})

test('首次登录自动绑定为管理员；之后 whoami 返回 isAdmin=true，其他微信 bootstrap=false', async () => {
  const s = scenario({ openid: 'openid_first_admin' })
  const login = await s.call({ action: 'login', pwd: PWD })
  assert.equal(login.ok, true)
  assert.ok(s.doc('admin_users', 'openid_first_admin'), '应写入 admin_users')
  let who = await s.call({ action: 'whoami' })
  assert.equal(who.data.isAdmin, true)
  assert.equal(who.data.bootstrap, false)

  s.mock.setOpenid('openid_other')
  who = await s.call({ action: 'whoami' })
  assert.equal(who.data.isAdmin, false)
  assert.equal(who.data.bootstrap, false)
})

test('非管理员微信登录返回 NOT_ADMIN，且不校验口令/不创建会话', async () => {
  const s = scenario({
    openid: 'openid_other',
    seed: { admin_users: [{ _id: 'openid_owner', openid: 'openid_owner', name: '店主', enabled: true, role: 'owner' }] }
  })
  const res = await s.call({ action: 'login', pwd: PWD })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NOT_ADMIN')
  assert.equal(s.count('admin_sessions'), 0)
})

test('被停用的管理员微信登录返回 ADMIN_DISABLED', async () => {
  const s = scenario({
    openid: 'openid_disabled',
    seed: { admin_users: [{ _id: 'openid_disabled', openid: 'openid_disabled', name: '店员', enabled: false }] }
  })
  const res = await s.call({ action: 'login', pwd: PWD })
  assert.equal(res.code, 'ADMIN_DISABLED')
})

test('口令连续失败 5 次后锁定 10 分钟，即使输入正确口令也拒绝', async () => {
  const s = scenario({
    openid: 'openid_owner',
    seed: { admin_users: [{ _id: 'openid_owner', openid: 'openid_owner', name: '店主', enabled: true }] }
  })
  for (let i = 0; i < 5; i++) {
    const r = await s.call({ action: 'login', pwd: 'wrong-' + i })
    assert.equal(r.code, 'PWD_WRONG')
  }
  const locked = await s.call({ action: 'login', pwd: PWD })
  assert.equal(locked.code, 'LOGIN_LOCKED')
  assert.match(locked.message, /分钟/)
  assert.equal(s.count('admin_sessions'), 0)
})

test('管理员登录成功后清空失败计数，可正常再次登录', async () => {
  const s = scenario({
    openid: 'openid_owner',
    seed: { admin_users: [{ _id: 'openid_owner', openid: 'openid_owner', name: '店主', enabled: true }] }
  })
  await s.call({ action: 'login', pwd: 'wrong' })
  await s.call({ action: 'login', pwd: 'wrong' })
  const ok = await s.call({ action: 'login', pwd: PWD })
  assert.equal(ok.ok, true)
  const second = await s.call({ action: 'login', pwd: PWD })
  assert.equal(second.ok, true)
})

test('会话绑定调用者 openid：换微信后 verify 无效、logout 不影响原会话', async () => {
  const s = scenario({ openid: 'openid_owner' })
  const login = await s.call({ action: 'login', pwd: PWD })
  const token = login.data.token

  s.mock.setOpenid('openid_attacker')
  let v = await s.call({ action: 'verify', token: token })
  assert.deepEqual(v, { ok: true, data: { valid: false } })
  await s.call({ action: 'logout', token: token })
  assert.equal(s.count('admin_sessions'), 1, '他人无法注销该 token')

  s.mock.setOpenid('openid_owner')
  v = await s.call({ action: 'verify', token: token })
  assert.equal(v.data.valid, true)
})

test('token 有效但 session 的 openid 与调用者不符时，管理函数拒绝访问', async () => {
  const s = createScenario({
    fn: 'orderAdmin',
    openid: 'openid_attacker',
    seed: {
      admin_sessions: [makeSession({ token: 'tok_owner', openid: 'openid_owner', expireAt: Date.now() + 60000 })],
      orders: []
    },
    templates: []
  })
  const res = await s.call({ action: 'list', adminToken: 'tok_owner' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})
