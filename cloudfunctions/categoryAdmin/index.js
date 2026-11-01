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

function num(v, def) {
  const n = Number(v)
  return isNaN(n) ? def : n
}

// id 兼容 categoryId 与 _id
function idOf(e) {
  if (e && e.categoryId) return e.categoryId
  if (e && e._id) return e._id
  return ''
}

exports.main = async (event, context) => {
  const deny = await checkAdmin(event)
  if (deny) return deny
  const action = event && event.action
  try {
    if (action === 'list') {
      const res = await db.collection('menu_categories').orderBy('sort', 'asc').limit(500).get()
      return { ok: true, data: res.data || [] }
    }
    if (action === 'get') {
      const id = idOf(event)
      if (!id) return { ok: false, message: '缺少分类 id' }
      const res = await db.collection('menu_categories').doc(id).get()
      return { ok: true, data: res.data || null }
    }
    if (action === 'create') {
      if (!(event && event.name)) return { ok: false, message: '分类名不能为空' }
      const doc = { name: String(event.name), sort: num(event.sort, 0) }
      const addRes = await db.collection('menu_categories').add({ data: doc })
      return { ok: true, data: Object.assign({}, doc, { _id: addRes._id }) }
    }
    if (action === 'update') {
      const id = idOf(event)
      if (!id) return { ok: false, message: '缺少分类 id' }
      const patch = {}
      if (event.name !== undefined) patch.name = String(event.name)
      if (event.sort !== undefined) patch.sort = num(event.sort, 0)
      await db.collection('menu_categories').doc(id).update({ data: patch })
      return { ok: true, data: { _id: id } }
    }
    if (action === 'delete') {
      const id = idOf(event)
      if (!id) return { ok: false, message: '缺少分类 id' }
      await db.collection('menu_categories').doc(id).remove()
      return { ok: true, data: { _id: id } }
    }
    return { ok: false, message: '未知 action: ' + action }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
