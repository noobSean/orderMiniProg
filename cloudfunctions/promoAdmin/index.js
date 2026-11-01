const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTION = 'promotions'
const PWD_SCOPE = ['all', 'category', 'dish']

// 管理端鉴权：校验 adminLogin 签发的会话 token（admin_sessions 集合，12 小时有效）
async function checkAdmin(event) {
  const token = (event && event.adminToken) ? String(event.adminToken) : ''
  if (!token) return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '请先登录管理后台' }
  try {
    const res = await db.collection('admin_sessions')
      .where({ token: token, expireAt: db.command.gt(Date.now()) })
      .limit(1).get()
    if (res.data && res.data.length) return null
  } catch (e) { console.error('checkAdmin error', e && e.message) }
  return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '管理登录已过期，请重新登录' }
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

// 集合不存在时尝试自动创建；无权限时忽略，由 add 报错提示
async function ensureCollection() {
  if (typeof db.createCollection !== 'function') return
  try { await db.createCollection(COLLECTION) } catch (e) {}
}

function toTs(v) {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : NaN
  const t = new Date(v).getTime()
  return isNaN(t) ? NaN : t
}

function normalizeIds(v, max) {
  const arr = Array.isArray(v) ? v : []
  const out = []
  arr.forEach(function (x) {
    const s = String(x === undefined || x === null ? '' : x).trim()
    if (s && out.indexOf(s) < 0 && out.length < (max || 100)) out.push(s)
  })
  return out
}

// 校验并规范化保存参数
function normalizePayload(event) {
  const name = (event && event.name !== undefined && event.name !== null) ? String(event.name).trim() : ''
  if (!name) return { error: '请输入活动名称' }
  if (name.length > 20) return { error: '活动名称最多 20 个字' }

  const discount = Number(event && event.discount)
  if (!isFinite(discount) || discount < 1 || discount > 9.9) return { error: '折扣需在 1-9.9 之间（如 8.5 表示 8.5 折）' }
  const rate = round2(discount / 10)

  const scopeType = (event && event.scopeType) ? String(event.scopeType) : 'all'
  if (PWD_SCOPE.indexOf(scopeType) < 0) return { error: '活动范围不合法' }
  const categoryIds = scopeType === 'category' ? normalizeIds(event.categoryIds, 100) : []
  const dishIds = scopeType === 'dish' ? normalizeIds(event.dishIds, 100) : []
  if (scopeType === 'category' && !categoryIds.length) return { error: '请选择至少一个分类' }
  if (scopeType === 'dish' && !dishIds.length) return { error: '请选择至少一个菜品' }

  const startAt = toTs(event && event.startAt)
  const endAt = toTs(event && event.endAt)
  if (startAt !== null && isNaN(startAt)) return { error: '开始时间不合法' }
  if (endAt !== null && isNaN(endAt)) return { error: '结束时间不合法' }
  if (startAt !== null && endAt !== null && startAt >= endAt) return { error: '结束时间需晚于开始时间' }

  return {
    data: {
      name: name,
      scopeType: scopeType,
      categoryIds: categoryIds,
      dishIds: dishIds,
      discount: discount,
      rate: rate,
      startAt: startAt,
      endAt: endAt,
      enabled: event && event.enabled === false ? false : true
    }
  }
}

exports.main = async (event, context) => {
  const deny = await checkAdmin(event)
  if (deny) return deny
  const action = event && event.action
  try {
    if (action === 'list') {
      await ensureCollection()
      const res = await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(100).get()
      return { ok: true, data: res.data || [] }
    }

    if (action === 'save') {
      const norm = normalizePayload(event || {})
      if (norm.error) return { ok: false, message: norm.error }
      await ensureCollection()
      const id = (event && event._id) ? String(event._id) : ''
      if (id) {
        await db.collection(COLLECTION).doc(id).update({
          data: Object.assign({}, norm.data, { updatedAt: db.serverDate() })
        })
        return { ok: true, data: { _id: id, updated: true } }
      }
      const saved = Object.assign({}, norm.data, { createdAt: db.serverDate(), updatedAt: db.serverDate() })
      const addRes = await db.collection(COLLECTION).add({ data: saved })
      return { ok: true, data: { _id: addRes._id, created: true } }
    }

    if (action === 'toggle') {
      const id = (event && event._id) ? String(event._id) : ''
      if (!id) return { ok: false, message: '缺少活动 _id' }
      const enabled = event && event.enabled === true
      await db.collection(COLLECTION).doc(id).update({
        data: { enabled: enabled, updatedAt: db.serverDate() }
      })
      return { ok: true, data: { _id: id, enabled: enabled } }
    }

    if (action === 'remove') {
      const id = (event && event._id) ? String(event._id) : ''
      if (!id) return { ok: false, message: '缺少活动 _id' }
      await db.collection(COLLECTION).doc(id).remove()
      return { ok: true, data: { _id: id, removed: true } }
    }

    return { ok: false, message: '未知 action: ' + action }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
