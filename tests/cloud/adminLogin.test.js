'use strict'

/**
 * cloudfunctions/adminLogin —— 管理口令登录 / 会话校验 / 注销
 * 契约：login 返回 {ok:true, data:{token, expireAt(毫秒), sessionId, openid(掩码), profile}}；
 *       token 写入 admin_sessions，有效期 12h；verify 返回 {ok:true, data:{valid, expireAt}}。
 * 运行：node --test tests/cloud/adminLogin.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TTL = 12 * 60 * 60 * 1000
const ADMIN_PWD = 'super-secret-pwd'

function loginScenario(opts) {
  const options = opts || {}
  return createScenario({
    fn: 'adminLogin',
    openid: options.openid === undefined ? 'openid_admin_user' : options.openid,
    env: options.env === undefined ? { ADMIN_PWD: ADMIN_PWD } : options.env,
    seed: options.seed
  })
}

test('adminLogin/login: 未配置 ADMIN_PWD 时返回 ADMIN_PWD_NOT_CONFIGURED', async () => {
  const s = loginScenario({ env: {} })
  const res = await s.call({ action: 'login', pwd: 'whatever' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'ADMIN_PWD_NOT_CONFIGURED')
  assert.match(res.message, /管理口令未配置|ADMIN_PWD/)
})

test('adminLogin/login: 空口令（含纯空白/null/undefined）返回 PWD_EMPTY 且不写会话', async () => {
  const s = loginScenario()
  for (const pwd of ['', '   ', null, undefined]) {
    const res = await s.call({ action: 'login', pwd })
    assert.equal(res.ok, false, 'pwd=' + String(pwd))
    assert.equal(res.code, 'PWD_EMPTY')
    assert.match(res.message, /请输入管理口令/)
  }
  assert.equal(s.count('admin_sessions'), 0)
})

test('adminLogin/login: 口令错误返回 PWD_WRONG 且不写会话', async () => {
  const s = loginScenario()
  const res = await s.call({ action: 'login', pwd: 'wrong-pwd' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'PWD_WRONG')
  assert.match(res.message, /管理口令错误/)
  assert.equal(s.count('admin_sessions'), 0)
})

test('adminLogin/login: 口令正确时签发 token 并写入 admin_sessions（12h 有效）', async () => {
  const s = loginScenario({ openid: 'oABCDEFGHIJKLMNOP' })
  const before = Date.now()
  const res = await s.call({ action: 'login', pwd: ADMIN_PWD })
  const after = Date.now()

  assert.equal(res.ok, true)
  assert.match(res.data.token, /^[0-9a-f]{48}$/)
  assert.ok(res.data.sessionId, '应返回 sessionId')
  // expireAt 为毫秒数字，约等于 now + 12h
  assert.equal(typeof res.data.expireAt, 'number')
  assert.ok(res.data.expireAt >= before + TTL && res.data.expireAt <= after + TTL, 'expireAt 应为 now+12h')
  // openid 掩码：前 6 + **** + 后 4
  assert.equal(res.data.openid, 'oABCDE****MNOP')
  // 未绑定员工时 profile 为 null
  assert.equal(res.data.profile, null)

  const sessions = s.docs('admin_sessions')
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0]._id, res.data.sessionId)
  assert.equal(sessions[0].token, res.data.token)
  assert.equal(sessions[0].openid, 'oABCDEFGHIJKLMNOP')
  assert.equal(sessions[0].expireAt, res.data.expireAt)
  assert.ok(sessions[0].createdAt instanceof Date, 'createdAt 由 serverDate 落成 Date')
})

test('adminLogin/login: 口令首尾空白会被 trim（输入 "  pwd  " 可登录）', async () => {
  const s = loginScenario()
  const res = await s.call({ action: 'login', pwd: '  ' + ADMIN_PWD + '  ' })
  assert.equal(res.ok, true)
  assert.ok(res.data.token)
})

test('adminLogin/login: 已绑定员工时附带 profile（不用于鉴权）', async () => {
  const profile = { _id: 'emp_admin', openid: 'openid_admin_user', empNo: 'A001', name: '管理员', admin: true }
  const s = loginScenario({ seed: { employees: [profile] } })
  const res = await s.call({ action: 'login', pwd: ADMIN_PWD })
  assert.equal(res.ok, true)
  assert.deepEqual(res.data.profile, profile)
  assert.equal(res.data.openid, 'openid****user') // 前6 'openid' + **** + 后4 'user'
})

test('adminLogin/login: openid 长度 <= 10 时掩码保持原样', async () => {
  const s = loginScenario({ openid: 'shortid' })
  const res = await s.call({ action: 'login', pwd: ADMIN_PWD })
  assert.equal(res.data.openid, 'shortid')
})

test('adminLogin/login: 登录时清理当前 openid 的过期会话，保留有效会话与其他人的会话', async () => {
  const now = Date.now()
  const s = loginScenario({
    openid: 'openid_admin_user',
    seed: {
      admin_sessions: [
        makeSession({ _id: 'sess_expired_mine', token: 'tok_expired_mine', openid: 'openid_admin_user', expireAt: now - 1000 }),
        makeSession({ _id: 'sess_valid_mine', token: 'tok_valid_mine', openid: 'openid_admin_user', expireAt: now + 60000 }),
        makeSession({ _id: 'sess_expired_other', token: 'tok_expired_other', openid: 'openid_other', expireAt: now - 1000 })
      ]
    }
  })
  const res = await s.call({ action: 'login', pwd: ADMIN_PWD })
  assert.equal(res.ok, true)
  const tokens = s.docs('admin_sessions').map(function (d) { return d.token })
  assert.equal(tokens.indexOf('tok_expired_mine'), -1, '当前 openid 的过期会话应被清理')
  assert.notEqual(tokens.indexOf('tok_valid_mine'), -1, '当前 openid 的有效会话应保留')
  assert.notEqual(tokens.indexOf('tok_expired_other'), -1, '其他人的过期会话不清理')
  assert.notEqual(tokens.indexOf(res.data.token), -1, '新 token 已写入')
  assert.equal(tokens.length, 3)
})

test('adminLogin/login: 两次登录签发不同 token（可并存）', async () => {
  const s = loginScenario()
  const first = await s.call({ action: 'login', pwd: ADMIN_PWD })
  const second = await s.call({ action: 'login', pwd: ADMIN_PWD })
  assert.notEqual(first.data.token, second.data.token)
  assert.equal(s.count('admin_sessions'), 2)
})

test('adminLogin/login: 写会话失败时返回 SESSION_STORE_FAILED 并保留提示', async () => {
  const s = loginScenario()
  s.mock.failNext('admin_sessions', 'add', new Error('collection not ready'))
  const res = await s.call({ action: 'login', pwd: ADMIN_PWD })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'SESSION_STORE_FAILED')
  assert.match(res.message, /创建管理会话失败/)
  assert.match(res.message, /collection not ready/)
})

test('adminLogin: 不带 action 时默认按 login 处理', async () => {
  const s = loginScenario()
  const res = await s.call({})
  assert.equal(res.ok, false)
  assert.equal(res.code, 'PWD_EMPTY')
})

test('adminLogin/verify: 无 token / 空 token 返回 valid:false', async () => {
  const s = loginScenario()
  for (const event of [{ action: 'verify' }, { action: 'verify', token: '' }, { action: 'verify', token: null }]) {
    const res = await s.call(event)
    assert.deepEqual(res, { ok: true, data: { valid: false } })
  }
})

test('adminLogin/verify: 有效 token 返回 valid:true 与 expireAt', async () => {
  const expireAt = Date.now() + 60 * 1000
  const s = loginScenario({ seed: { admin_sessions: [makeSession({ token: 'tok_valid', expireAt })] } })
  const res = await s.call({ action: 'verify', token: 'tok_valid' })
  assert.deepEqual(res, { ok: true, data: { valid: true, expireAt } })
})

test('adminLogin/verify: 已过期 token 返回 valid:false', async () => {
  const s = loginScenario({ seed: { admin_sessions: [makeSession({ token: 'tok_expired', expireAt: Date.now() - 1 })] } })
  const res = await s.call({ action: 'verify', token: 'tok_expired' })
  assert.deepEqual(res, { ok: true, data: { valid: false } })
})

test('adminLogin/verify: 未知 token 返回 valid:false', async () => {
  const s = loginScenario({ seed: { admin_sessions: [makeSession({ token: 'tok_known' })] } })
  const res = await s.call({ action: 'verify', token: 'tok_unknown' })
  assert.deepEqual(res, { ok: true, data: { valid: false } })
})

test('adminLogin/verify: 数据库查询异常时按未登录处理（valid:false，不抛错）', async () => {
  const s = loginScenario()
  s.mock.failNext('admin_sessions', 'get', new Error('db down'))
  const res = await s.call({ action: 'verify', token: 'tok_whatever' })
  assert.deepEqual(res, { ok: true, data: { valid: false } })
})

test('adminLogin/logout: 删除指定 token 的会话；无 token 时幂等返回 done', async () => {
  const s = loginScenario({
    seed: {
      admin_sessions: [
        makeSession({ token: 'tok_a' }),
        makeSession({ token: 'tok_b' })
      ]
    }
  })
  const res = await s.call({ action: 'logout', token: 'tok_a' })
  assert.deepEqual(res, { ok: true, data: { done: true } })
  const tokens = s.docs('admin_sessions').map(function (d) { return d.token })
  assert.deepEqual(tokens, ['tok_b'])

  const res2 = await s.call({ action: 'logout' })
  assert.deepEqual(res2, { ok: true, data: { done: true } })
  assert.equal(s.count('admin_sessions'), 1)
})

test('adminLogin/logout: 数据库删除异常被吞掉，仍返回 done:true', async () => {
  const s = loginScenario({ seed: { admin_sessions: [makeSession({ token: 'tok_a' })] } })
  s.mock.failNext('admin_sessions', 'remove', new Error('remove failed'))
  const res = await s.call({ action: 'logout', token: 'tok_a' })
  assert.deepEqual(res, { ok: true, data: { done: true } })
})

test('adminLogin: 未知 action 返回 ok:false 且提示 action 名', async () => {
  const s = loginScenario()
  const res = await s.call({ action: 'hack' })
  assert.equal(res.ok, false)
  assert.match(res.message, /未知 action: hack/)
})
