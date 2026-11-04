'use strict'

/**
 * cloudfunctions/adminLogin —— 管理密码修改（changePwd）
 * 契约：
 *  - 需已登录（adminToken 有效），否则 NEED_ADMIN_LOGIN；
 *  - 校验原口令：数据库 admin_config/admin_pwd 优先，环境变量 ADMIN_PWD 仅初始化兜底；
 *  - 新口令 6-32 位、不能含空格、不能与原口令相同；
 *  - 成功后写 scrypt 加盐哈希，不保存明文；所有管理会话失效，需用新密码重新登录。
 * 运行：node --test tests/cloud/adminLogin.password.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const SESSION_TOKEN = 'tok_admin_valid'
const ENV_PWD = 'EnvPass123'

function hash(pwd, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16)
  const buf = crypto.scryptSync(String(pwd), salt, 64)
  return { salt: salt.toString('hex'), hash: buf.toString('hex'), algo: 'scrypt' }
}

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  if (!seed.admin_sessions) {
    seed.admin_sessions = [makeSession({ token: SESSION_TOKEN, openid: 'openid_admin_user', expireAt: Date.now() + 3600 * 1000 })]
  }
  return createScenario({
    fn: 'adminLogin',
    openid: options.openid === undefined ? 'openid_admin_user' : options.openid,
    env: options.env === undefined ? { ADMIN_PWD: ENV_PWD } : options.env,
    seed: seed
  })
}

function change(s, oldPwd, newPwd) {
  return s.call({ action: 'changePwd', oldPwd: oldPwd, newPwd: newPwd, adminToken: SESSION_TOKEN })
}

// ---------------- 鉴权 ----------------
test('changePwd: 未登录（无 token / 无效 token / 过期 token）返回 NEED_ADMIN_LOGIN', async () => {
  let s = scenario()
  let res = await s.call({ action: 'changePwd', oldPwd: ENV_PWD, newPwd: 'NewPass123' })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')

  s = scenario()
  res = await s.call({ action: 'changePwd', oldPwd: ENV_PWD, newPwd: 'NewPass123', adminToken: 'tok_bad' })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')

  s = scenario({ seed: { admin_sessions: [makeSession({ token: SESSION_TOKEN, openid: 'openid_admin_user', expireAt: Date.now() - 1 })] } })
  res = await change(s, ENV_PWD, 'NewPass123')
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.equal(s.count('admin_config'), 0)
})

// ---------------- 参数校验 ----------------
test('changePwd: 原密码为空 / 新密码为空 / 长度非法 / 含空格 / 与原密码相同均被拒绝', async () => {
  const cases = [
    ['', 'NewPass123', 'PWD_EMPTY'],
    ['   ', 'NewPass123', 'PWD_EMPTY'],
    [ENV_PWD, '', 'NEW_PWD_EMPTY'],
    [ENV_PWD, '12345', 'NEW_PWD_INVALID'],
    [ENV_PWD, 'a'.repeat(33), 'NEW_PWD_INVALID'],
    [ENV_PWD, 'New Pass 123', 'NEW_PWD_INVALID'],
    [ENV_PWD, ENV_PWD, 'NEW_PWD_SAME']
  ]
  for (const [oldPwd, newPwd, code] of cases) {
    const s = scenario()
    const res = await change(s, oldPwd, newPwd)
    assert.equal(res.ok, false, 'case=' + JSON.stringify([oldPwd, newPwd]))
    assert.equal(res.code, code)
    assert.equal(s.count('admin_config'), 0, '校验失败不应写库')
  }
})

// ---------------- 初始化口令不存在 ----------------
test('changePwd/login: 数据库与环境变量都未配置口令时返回 ADMIN_PWD_NOT_CONFIGURED', async () => {
  let s = scenario({ env: {} })
  let res = await s.call({ action: 'login', pwd: 'whatever' })
  assert.equal(res.code, 'ADMIN_PWD_NOT_CONFIGURED')

  s = scenario({ env: {} })
  res = await change(s, 'whatever', 'NewPass123')
  assert.equal(res.code, 'ADMIN_PWD_NOT_CONFIGURED')
  assert.equal(s.count('admin_config'), 0)
})

// ---------------- 成功修改 ----------------
test('changePwd: 环境变量初始化口令可修改；写入加盐哈希、清空所有会话、旧密码失效、新密码可登录', async () => {
  const s = scenario()
  const res = await change(s, ENV_PWD, 'NewPass123')
  assert.equal(res.ok, true)
  assert.equal(res.data && res.data.changed, true)

  // 哈希存储，不存明文
  const rec = s.doc('admin_config', 'admin_pwd')
  assert.ok(rec, '应写入 admin_config/admin_pwd')
  assert.equal(rec.algo, 'scrypt')
  assert.match(rec.salt, /^[0-9a-f]{32}$/)
  assert.match(rec.hash, /^[0-9a-f]{128}$/)
  assert.ok(!JSON.stringify(rec).includes('NewPass123'), '不得明文保存密码')
  // 返回值不泄露哈希
  assert.ok(!JSON.stringify(res).includes(rec.hash), '响应不得返回哈希')

  // 所有管理会话失效
  assert.equal(s.count('admin_sessions'), 0)

  // 旧密码失效，新密码可登录
  let login = await s.call({ action: 'login', pwd: ENV_PWD })
  assert.equal(login.code, 'PWD_WRONG')
  login = await s.call({ action: 'login', pwd: 'NewPass123' })
  assert.equal(login.ok, true)
  assert.ok(login.data.token)
  // 新会话 token 可以 verify
  const v = await s.call({ action: 'verify', token: login.data.token })
  assert.deepEqual(v, { ok: true, data: { valid: true, expireAt: login.data.expireAt } })
})

test('changePwd: 数据库口令优先于环境变量（环境变量只作初始化兜底）', async () => {
  const stored = hash('DbPass123')
  const s = scenario({ seed: { admin_config: [Object.assign({ _id: 'admin_pwd' }, stored)] } })
  let res = await s.call({ action: 'login', pwd: 'DbPass123' })
  assert.equal(res.ok, true, '数据库密码应可登录')
  res = await s.call({ action: 'login', pwd: ENV_PWD })
  assert.equal(res.code, 'PWD_WRONG', '数据库存在记录时环境变量不应再被接受')

  // 用数据库当前密码继续修改
  const s2 = scenario({ seed: { admin_config: [Object.assign({ _id: 'admin_pwd' }, stored)] } })
  res = await change(s2, 'DbPass123', 'NextPass456')
  assert.equal(res.ok, true)
  const login = await s2.call({ action: 'login', pwd: 'NextPass456' })
  assert.equal(login.ok, true)
})

test('changePwd: 原密码错误返回 PWD_WRONG 且不覆盖数据库记录', async () => {
  const stored = hash('DbPass123')
  const s = scenario({ seed: { admin_config: [Object.assign({ _id: 'admin_pwd' }, stored)] } })
  const res = await change(s, 'WrongOld123', 'NewPass123')
  assert.equal(res.code, 'PWD_WRONG')
  const rec = s.doc('admin_config', 'admin_pwd')
  assert.equal(rec.hash, stored.hash, '原记录不应被修改')
})

test('changePwd: 保存数据库失败返回 PWD_SAVE_FAILED，会话不被清空', async () => {
  const s = scenario()
  s.mock.failNext('admin_config', 'docSet', new Error('db write failed'))
  const res = await change(s, ENV_PWD, 'NewPass123')
  assert.equal(res.ok, false)
  assert.equal(res.code, 'PWD_SAVE_FAILED')
  assert.match(res.message, /保存新密码失败/)
  assert.equal(s.count('admin_sessions'), 1, '保存失败不应让会话失效')
})

test('changePwd: 登录后改密再登录的完整闭环（旧 token 失效）', async () => {
  const s = scenario()
  const first = await s.call({ action: 'login', pwd: ENV_PWD })
  assert.equal(first.ok, true)
  const oldToken = first.data.token

  let res = await s.call({ action: 'changePwd', oldPwd: ENV_PWD, newPwd: 'FinalPass789', adminToken: oldToken })
  assert.equal(res.ok, true)

  const v = await s.call({ action: 'verify', token: oldToken })
  assert.deepEqual(v, { ok: true, data: { valid: false } }, '改密后旧 token 应失效')

  const second = await s.call({ action: 'login', pwd: 'FinalPass789' })
  assert.equal(second.ok, true)
  assert.notEqual(second.data.token, oldToken)
})
