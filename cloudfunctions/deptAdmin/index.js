const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 管理端鉴权：校验 adminLogin 签发的会话 token（admin_sessions 集合，12 小时有效）
async function checkAdmin(event) {
  const token = (event && event.adminToken) ? String(event.adminToken) : ''
  const { OPENID } = cloud.getWXContext()
  if (!token) return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '请先登录管理后台' }
  try {
    const res = await db.collection('admin_sessions')
      .where({ token: token, openid: OPENID, expireAt: db.command.gt(Date.now()) })
      .limit(1).get()
    if (res.data && res.data.length) return null
  } catch (e) { console.error('checkAdmin error', e && e.message) }
  return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '管理登录已过期，请重新登录' }
}

async function fetchAll(makeQuery) {
  const MAX = 100
  let skip = 0
  let all = []
  while (true) {
    const res = await makeQuery().skip(skip).limit(MAX).get()
    all = all.concat(res.data || [])
    if (!res.data || res.data.length < MAX) break
    skip += MAX
    if (skip > 5000) break
  }
  return all
}

function sortList(arr) {
  return arr.sort(function (a, b) {
    if ((a.rootSort || 999) !== (b.rootSort || 999)) return (a.rootSort || 999) - (b.rootSort || 999)
    if (!!a.isRoot !== !!b.isRoot) return a.isRoot ? -1 : 1
    if ((a.sort || 0) !== (b.sort || 0)) return (a.sort || 0) - (b.sort || 0)
    return String(a.pinyin || a.name || '').localeCompare(String(b.pinyin || b.name || ''))
  })
}

exports.main = async (event) => {
  const action = event && event.action
  try {
    // 公开：可选科室（启用、非分类根节点）
    if (action === 'list') {
      const all = await fetchAll(function () {
        return db.collection('departments').where({ enabled: true })
      })
      return { ok: true, data: sortList(all.filter(function (d) { return !d.isRoot })) }
    }

    const deny = await checkAdmin(event)
    if (deny) return deny

    // 管理端：全部科室（含停用、含分类根节点）
    if (action === 'adminList') {
      const all = await fetchAll(function () { return db.collection('departments') })
      return { ok: true, data: sortList(all) }
    }

    if (action === 'create') {
      const name = (event.name || '').trim()
      if (!name) return { ok: false, message: '科室名称不能为空' }
      const all = await fetchAll(function () { return db.collection('departments') })
      let maxCode = 0
      all.forEach(function (d) { const c = Number(d.code); if (c > maxCode) maxCode = c })
      const code = maxCode + 1
      let rootCode = event.rootCode != null ? Number(event.rootCode) : null
      let rootName = event.rootName || ''
      let rootSort = 999
      if (rootCode != null) {
        const rr = await db.collection('departments').where({ code: rootCode }).limit(1).get()
        if (rr.data && rr.data.length) {
          rootName = rr.data[0].name
          rootSort = rr.data[0].rootSort || Number(rr.data[0].sort) || 999
        }
      }
      const id = 'ks_' + code
      const doc = {
        code: code,
        name: name,
        pinyin: (event.pinyin || '').toUpperCase(),
        parentCode: rootCode,
        rootCode: rootCode,
        rootName: rootName || '其他',
        rootSort: rootSort,
        level: 1,
        isRoot: false,
        sort: event.sort != null ? Number(event.sort) : 999999,
        enabled: event.enabled !== false,
        usage: Array.isArray(event.usage) ? event.usage : [],
        createdAt: db.serverDate()
      }
      await db.collection('departments').doc(id).set({ data: doc })
      return { ok: true, data: Object.assign({ _id: id }, doc) }
    }

    if (action === 'update') {
      const id = event.id
      if (!id) return { ok: false, message: '缺少 id' }
      const data = {}
      if (event.name != null) data.name = String(event.name).trim()
      if (event.pinyin != null) data.pinyin = String(event.pinyin).toUpperCase()
      if (event.sort != null) data.sort = Number(event.sort)
      if (event.enabled != null) data.enabled = !!event.enabled
      if (event.rootCode != null) {
        data.rootCode = Number(event.rootCode)
        const rr = await db.collection('departments').where({ code: data.rootCode }).limit(1).get()
        if (rr.data && rr.data.length) { data.rootName = rr.data[0].name; data.rootSort = rr.data[0].rootSort || 999 }
      }
      await db.collection('departments').doc(id).update({ data: data })
      return { ok: true }
    }

    if (action === 'toggle') {
      const id = event.id
      if (!id) return { ok: false, message: '缺少 id' }
      const cur = await db.collection('departments').doc(id).get()
      const enabled = (event.enabled != null) ? !!event.enabled : !cur.data.enabled
      await db.collection('departments').doc(id).update({ data: { enabled: enabled } })
      return { ok: true, data: { enabled: enabled } }
    }

    if (action === 'delete') {
      const id = event.id
      if (!id) return { ok: false, message: '缺少 id' }
      await db.collection('departments').doc(id).remove()
      return { ok: true }
    }

    return { ok: false, message: '未知操作' }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '操作失败' }
  }
}
