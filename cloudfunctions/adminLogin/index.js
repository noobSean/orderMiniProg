const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ==================== 管理口令与会话配置 ====================
// 管理口令只从云函数「环境变量」读取，不写进代码仓库：
//   云开发控制台 → 云函数 → adminLogin → 配置 → 环境变量 → ADMIN_PWD=你的强口令
// 未配置时管理后台无法登录（会返回 ADMIN_PWD_NOT_CONFIGURED 提示）。
const ADMIN_PWD = process.env.ADMIN_PWD || ''
// 管理会话有效期：12 小时（餐厅一天一个班次，够用；过期重新输入口令即可）
const SESSION_TTL = 12 * 60 * 60 * 1000
const SESSION_COLLECTION = 'admin_sessions'

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

function maskOpenid(openid) {
  if (!openid) return ''
  const s = String(openid)
  return s.length <= 10 ? s : (s.slice(0, 6) + '****' + s.slice(-4))
}

// 登录：校验口令 -> 删除该 openid 的过期会话 -> 签发新 token
async function login(event, OPENID) {
  if (!ADMIN_PWD) {
    return { ok: false, code: 'ADMIN_PWD_NOT_CONFIGURED', message: '管理口令未配置：请在云函数环境变量中设置 ADMIN_PWD 后重试' }
  }
  const pwd = (event && event.pwd !== undefined && event.pwd !== null) ? String(event.pwd).trim() : ''
  if (!pwd) return { ok: false, code: 'PWD_EMPTY', message: '请输入管理口令' }
  if (pwd !== ADMIN_PWD) return { ok: false, code: 'PWD_WRONG', message: '管理口令错误' }

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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || 'login'
  try {
    if (action === 'login') return await login(event || {}, OPENID)
    if (action === 'verify') return await verify(event || {})
    if (action === 'logout') return await logout(event || {})
    return { ok: false, message: '未知 action: ' + action }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
