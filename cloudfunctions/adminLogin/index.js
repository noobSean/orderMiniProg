const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ==================== 管理口令与会话配置 ====================
// 管理口令支持两种来源（数据库优先）：
//   1) 数据库 admin_config/admin_pwd：管理后台「修改密码」后写入（scrypt 加盐哈希）；
//   2) 云函数环境变量 ADMIN_PWD：首次部署的初始化口令，仅当数据库没有记录时生效。
// 修改密码后数据库记录生效，环境变量不再参与校验（可作为重置兜底：删掉 admin_config/admin_pwd 后重新用环境变量登录）。
// 环境变量配置：云开发控制台 → 云函数 → adminLogin → 配置 → 环境变量 → ADMIN_PWD=你的强口令
const ADMIN_PWD = process.env.ADMIN_PWD || ''
// 管理会话有效期：12 小时（餐厅一天一个班次，够用；过期重新输入口令即可）
const SESSION_TTL = 12 * 60 * 60 * 1000
const SESSION_COLLECTION = 'admin_sessions'
const ADMIN_CONFIG_COLLECTION = 'admin_config'
const ADMIN_PWD_DOC_ID = 'admin_pwd'
const PWD_MIN_LEN = 6
const PWD_MAX_LEN = 32

function genToken() {
  return crypto.randomBytes(24).toString('hex')
}

// 首次使用时自动创建会话集合；已存在会报错，忽略即可。
// 若云环境禁止云函数建集合，请在云开发控制台手动新建 admin_sessions（权限：仅云函数可读写）。
async function ensureSessionCollection() {
  // 云函数 SDK 支持 createCollection；老版本/无权限时跳过，由 add 报错提示手动建集合
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection(SESSION_COLLECTION)
  } catch (e) {
    // 集合已存在（-501001 等）忽略
  }
}

// ==================== 管理口令哈希（scrypt + 随机盐） ====================

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(String(saltHex), 'hex') : crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, 64)
  return { salt: salt.toString('hex'), hash: hash.toString('hex') }
}

// 首次使用自动创建配置集合；无建集合权限时忽略，由 set 报错提示手动创建
async function ensureConfigCollection() {
  if (typeof db.createCollection !== 'function') return
  try {
    await db.createCollection(ADMIN_CONFIG_COLLECTION)
  } catch (e) {
    // 集合已存在（-501001 等）忽略
  }
}

// 读取数据库中的口令记录；不存在/查询失败返回 null
async function getPwdRecord() {
  try {
    const r = await db.collection(ADMIN_CONFIG_COLLECTION).doc(ADMIN_PWD_DOC_ID).get()
    return (r && r.data) || null
  } catch (e) {
    return null
  }
}

// 校验口令：数据库记录优先；没有数据库记录时回退环境变量；两者都没有返回 null（未配置）
async function verifyPassword(password) {
  const text = String(password === undefined || password === null ? '' : password)
  const rec = await getPwdRecord()
  if (rec && rec.hash && rec.salt) {
    try {
      const expect = Buffer.from(String(rec.hash), 'hex')
      const actual = crypto.scryptSync(text, Buffer.from(String(rec.salt), 'hex'), expect.length)
      return expect.length === actual.length && crypto.timingSafeEqual(expect, actual)
    } catch (e) {
      return false
    }
  }
  if (ADMIN_PWD) return text === ADMIN_PWD
  return null
}

// 管理会话校验（用于「修改密码」等需要登录态的 action）
async function checkSession(event) {
  const token = (event && event.adminToken) ? String(event.adminToken) : ''
  if (!token) return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '请先登录管理后台' }
  try {
    const r = await db.collection(SESSION_COLLECTION)
      .where({ token: token, expireAt: _.gt(Date.now()) })
      .limit(1)
      .get()
    if (r.data && r.data.length) return null
  } catch (e) {}
  return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '管理登录已过期，请重新登录' }
}

function maskOpenid(openid) {
  if (!openid) return ''
  const s = String(openid)
  return s.length <= 10 ? s : (s.slice(0, 6) + '****' + s.slice(-4))
}

// 登录：校验口令 -> 删除该 openid 的过期会话 -> 签发新 token
async function login(event, OPENID) {
  const pwd = (event && event.pwd !== undefined && event.pwd !== null) ? String(event.pwd).trim() : ''
  if (!pwd) return { ok: false, code: 'PWD_EMPTY', message: '请输入管理口令' }
  const matched = await verifyPassword(pwd)
  if (matched === null) {
    return { ok: false, code: 'ADMIN_PWD_NOT_CONFIGURED', message: '管理口令未配置：请先在云函数环境变量设置 ADMIN_PWD，或通过管理后台修改密码' }
  }
  if (!matched) return { ok: false, code: 'PWD_WRONG', message: '管理口令错误' }

  await ensureSessionCollection()

  // 顺手清理该 openid 的过期会话（失败不影响登录）
  try {
    await db.collection(SESSION_COLLECTION)
      .where({ openid: OPENID, expireAt: _.lte(Date.now()) })
      .remove()
  } catch (e) {}

  const now = Date.now()
  const session = {
    token: genToken(),
    openid: OPENID,
    expireAt: now + SESSION_TTL,
    createdAt: db.serverDate()
  }

  let sessionId = ''
  try {
    const addRes = await db.collection(SESSION_COLLECTION).add({ data: session })
    sessionId = addRes._id
  } catch (e) {
    return {
      ok: false,
      code: 'SESSION_STORE_FAILED',
      message: '创建管理会话失败：' + ((e && e.message) || '请先在云开发控制台创建 admin_sessions 集合')
    }
  }

  // 兼容展示：若该微信已绑定员工档案，一并返回档案信息（不用于鉴权）
  let profile = null
  try {
    const r = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
    profile = (r.data && r.data[0]) || null
  } catch (e) {}

  return {
    ok: true,
    data: {
      token: session.token,
      expireAt: session.expireAt,
      sessionId: sessionId,
      openid: maskOpenid(OPENID),
      profile: profile
    }
  }
}

// 校验：token 存在且未过期
async function verify(event) {
  const token = (event && event.token) ? String(event.token) : ''
  if (!token) return { ok: true, data: { valid: false } }
  try {
    const r = await db.collection(SESSION_COLLECTION)
      .where({ token: token, expireAt: _.gt(Date.now()) })
      .limit(1)
      .get()
    const doc = (r.data && r.data[0]) || null
    if (!doc) return { ok: true, data: { valid: false } }
    return { ok: true, data: { valid: true, expireAt: doc.expireAt } }
  } catch (e) {
    // 集合不存在 / 查询失败：按未登录处理，不把内部错误暴露给前端
    return { ok: true, data: { valid: false } }
  }
}

// 注销：删除该 token 的会话
async function logout(event) {
  const token = (event && event.token) ? String(event.token) : ''
  if (!token) return { ok: true, data: { done: true } }
  try {
    await db.collection(SESSION_COLLECTION).where({ token: token }).remove()
  } catch (e) {}
  return { ok: true, data: { done: true } }
}

// 修改管理口令：需已登录；校验原口令 -> 写数据库哈希 -> 所有管理会话失效（强制重新登录）
async function changePwd(event) {
  const deny = await checkSession(event)
  if (deny) return deny
  const oldPwd = (event && event.oldPwd !== undefined && event.oldPwd !== null) ? String(event.oldPwd).trim() : ''
  const newPwd = (event && event.newPwd !== undefined && event.newPwd !== null) ? String(event.newPwd) : ''
  if (!oldPwd) return { ok: false, code: 'PWD_EMPTY', message: '请输入原管理密码' }
  if (!newPwd) return { ok: false, code: 'NEW_PWD_EMPTY', message: '请输入新管理密码' }
  if (newPwd.length < PWD_MIN_LEN || newPwd.length > PWD_MAX_LEN) {
    return { ok: false, code: 'NEW_PWD_INVALID', message: '新密码长度需为 ' + PWD_MIN_LEN + '-' + PWD_MAX_LEN + ' 位' }
  }
  if (/\s/.test(newPwd)) return { ok: false, code: 'NEW_PWD_INVALID', message: '新密码不能包含空格' }
  if (newPwd === oldPwd) return { ok: false, code: 'NEW_PWD_SAME', message: '新密码不能与原密码相同' }

  const matched = await verifyPassword(oldPwd)
  if (matched === null) {
    return { ok: false, code: 'ADMIN_PWD_NOT_CONFIGURED', message: '管理口令未配置：请先在云函数环境变量设置 ADMIN_PWD 后重试' }
  }
  if (!matched) return { ok: false, code: 'PWD_WRONG', message: '原管理密码错误' }

  await ensureConfigCollection()
  const hashed = hashPassword(newPwd)
  try {
    await db.collection(ADMIN_CONFIG_COLLECTION).doc(ADMIN_PWD_DOC_ID).set({
      data: { salt: hashed.salt, hash: hashed.hash, algo: 'scrypt', updatedAt: db.serverDate() }
    })
  } catch (e) {
    return { ok: false, code: 'PWD_SAVE_FAILED', message: '保存新密码失败：' + ((e && e.message) || '请稍后重试') }
  }

  // 所有管理会话失效（包括当前设备），必须用新密码重新登录
  try {
    await db.collection(SESSION_COLLECTION).where({ openid: _.exists(true) }).remove()
  } catch (e) {}

  return { ok: true, data: { changed: true, message: '管理密码已修改，请重新登录' } }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || 'login'
  try {
    if (action === 'login') return await login(event || {}, OPENID)
    if (action === 'verify') return await verify(event || {})
    if (action === 'logout') return await logout(event || {})
    if (action === 'changePwd') return await changePwd(event || {})
    return { ok: false, message: '未知 action: ' + action }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
