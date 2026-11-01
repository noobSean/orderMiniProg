const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

function strArr(v) {
  if (Array.isArray(v)) return v.map(function (x) { return String(x) })
  return []
}

exports.main = async (event, context) => {
  const deny = await checkAdmin(event)
  if (deny) return deny
  const action = event && event.action
  try {
    if (action === 'get') {
      const res = await db.collection('settings').limit(1).get()
      return { ok: true, data: (res.data && res.data[0]) || null }
    }
    if (action === 'update') {
      const e = event || {}
      const patch = {}
      if (e.storeName !== undefined) patch.storeName = String(e.storeName)
      if (e.openTime !== undefined) patch.openTime = String(e.openTime)
      if (e.closeTime !== undefined) patch.closeTime = String(e.closeTime)
      if (e.notice !== undefined) patch.notice = String(e.notice)
      if (e.allowSelfPickup !== undefined) patch.allowSelfPickup = e.allowSelfPickup !== false
      if (e.allowDelivery !== undefined) patch.allowDelivery = e.allowDelivery !== false
      if (e.locations !== undefined) patch.locations = strArr(e.locations)
      if (e.departments !== undefined) patch.departments = strArr(e.departments)
      if (e.phone !== undefined) patch.phone = String(e.phone)

      const exist = await db.collection('settings').limit(1).get()
      if (exist.data && exist.data.length) {
        await db.collection('settings').doc(exist.data[0]._id).update({ data: patch })
        return { ok: true, data: Object.assign({}, exist.data[0], patch) }
      }
      patch.createdAt = db.serverDate()
      const addRes = await db.collection('settings').add({ data: patch })
      return { ok: true, data: Object.assign({ _id: addRes._id }, patch) }
    }
    return { ok: false, message: '未知 action: ' + action }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
