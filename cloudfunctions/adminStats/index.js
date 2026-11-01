const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

exports.main = async (event, context) => {
  const deny = await checkAdmin(event)
  if (deny) return deny
  const mode = (event && event.mode) || 'today'
  try {
    let from, to
    const now = new Date()
    if (mode === 'range') {
      from = event && event.from ? new Date(event.from) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
      to = event && event.to ? new Date(event.to) : now
      if (isNaN(from.getTime())) from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (isNaN(to.getTime())) to = now
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    }

    // 排除已取消订单（可选计入）
    const res = await db.collection('orders')
      .where({ createdAt: _.gte(from).and(_.lt(to)) })
      .limit(1000)
      .get()
    const orders = res.data || []

    const byStatus = {}
    const byType = { pickup: 0, delivery: 0 }
    const dishAgg = {}
    let orderCount = 0
    let totalAmount = 0

    for (const o of orders) {
      if (o.status === 'cancelled') continue
      orderCount += 1
      totalAmount += Number(o.total) || 0
      byStatus[o.status] = (byStatus[o.status] || 0) + 1
      byType[o.type] = (byType[o.type] || 0) + 1
      if (Array.isArray(o.items)) {
        for (const it of o.items) {
          const key = it.dishId || it.name
          if (!key) continue
          if (!dishAgg[key]) dishAgg[key] = { name: it.name || key, qty: 0, amount: 0 }
          dishAgg[key].qty += Number(it.qty) || 0
          dishAgg[key].amount += (Number(it.qty) || 0) * (Number(it.price) || 0)
        }
      }
    }

    const topDishes = Object.keys(dishAgg)
      .map(function (k) {
        const d = dishAgg[k]
        return { name: d.name, qty: d.qty, amount: Math.round(d.amount * 100) / 100 }
      })
      .sort(function (a, b) { return (b.qty - a.qty) || (b.amount - a.amount) })
      .slice(0, 10)

    return {
      ok: true,
      data: {
        orderCount: orderCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        byStatus: byStatus,
        byType: byType,
        topDishes: topDishes
      }
    }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '统计失败' }
  }
}
