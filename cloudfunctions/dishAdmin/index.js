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

// id 兼容 dishId 与 _id
function idOf(e, extra) {
  if (e && e.dishId) return e.dishId
  if (e && e._id) return e._id
  return (extra && extra.dishId) || (extra && extra._id) || ''
}

exports.main = async (event, context) => {
  const deny = await checkAdmin(event)
  if (deny) return deny
  const action = event && event.action
  try {
    if (action === 'list') {
      const res = await db.collection('dishes').orderBy('sort', 'asc').limit(1000).get()
      return { ok: true, data: res.data || [] }
    }
    if (action === 'get') {
      const id = idOf(event)
      if (!id) return { ok: false, message: '缺少菜品 id' }
      const res = await db.collection('dishes').doc(id).get()
      return { ok: true, data: res.data || null }
    }
    if (action === 'create') {
      const d = event || {}
      if (!d.name) return { ok: false, message: '菜品名不能为空' }
      const doc = {
        categoryId: d.categoryId || '',
        name: String(d.name),
        desc: d.desc || '',
        image: d.image || '',
        price: num(d.price, 0),
        specs: Array.isArray(d.specs) ? d.specs : [],
        extras: Array.isArray(d.extras) ? d.extras : [],
        stock: (d.stock === null || d.stock === undefined) ? null : num(d.stock, 0),
        unit: d.unit || '份',
        sort: num(d.sort, 0),
        available: d.available !== false,
        createdAt: db.serverDate()
      }
      const addRes = await db.collection('dishes').add({ data: doc })
      return { ok: true, data: Object.assign({}, doc, { _id: addRes._id }) }
    }
    if (action === 'update') {
      const id = idOf(event)
      if (!id) return { ok: false, message: '缺少菜品 id' }
      const patch = {}
      if (event.name !== undefined) patch.name = String(event.name)
      if (event.categoryId !== undefined) patch.categoryId = event.categoryId
      if (event.desc !== undefined) patch.desc = event.desc
      if (event.image !== undefined) patch.image = event.image
      if (event.price !== undefined) patch.price = num(event.price, 0)
      if (event.specs !== undefined) patch.specs = Array.isArray(event.specs) ? event.specs : []
      if (event.extras !== undefined) patch.extras = Array.isArray(event.extras) ? event.extras : []
      if (event.stock !== undefined) patch.stock = (event.stock === null) ? null : num(event.stock, 0)
      if (event.unit !== undefined) patch.unit = event.unit || '份'
      if (event.sort !== undefined) patch.sort = num(event.sort, 0)
      if (event.available !== undefined) patch.available = event.available !== false
      await db.collection('dishes').doc(id).update({ data: patch })
      return { ok: true, data: { _id: id } }
    }
    if (action === 'toggle') {
      const id = idOf(event)
      if (!id) return { ok: false, message: '缺少菜品 id' }
      let available
      if (typeof event.available === 'boolean') {
        available = event.available
      } else {
        const cur = await db.collection('dishes').doc(id).get()
        available = !(cur.data && cur.data.available === true)
      }
      await db.collection('dishes').doc(id).update({ data: { available: available } })
      return { ok: true, data: { _id: id, available: available } }
    }
    if (action === 'delete') {
      const id = idOf(event)
      if (!id) return { ok: false, message: '缺少菜品 id' }
      // 软删除：置为不可售
      await db.collection('dishes').doc(id).update({ data: { available: false } })
      return { ok: true, data: { _id: id } }
    }
    return { ok: false, message: '未知 action: ' + action }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
