const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 管理员会话校验（adminLogin 签发，admin_sessions 集合，12 小时有效）
async function isAdminSession(event) {
  const token = (event && event.adminToken) ? String(event.adminToken) : ''
  if (!token) return false
  const { OPENID } = cloud.getWXContext()
  try {
    const r = await db.collection('admin_sessions')
      .where({ token: token, openid: OPENID, expireAt: db.command.gt(Date.now()) })
      .limit(1)
      .get()
    return !!(r.data && r.data.length)
  } catch (e) {
    return false
  }
}

// 订单详情：本人或已登录的管理端会话可查看
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const orderId = event && event.orderId
  if (!orderId) return { ok: false, message: '缺少 orderId' }
  try {
    const res = await db.collection('orders').doc(orderId).get()
    const order = res.data
    if (!order) return { ok: false, message: '订单不存在' }
    if (order.openid === OPENID) return { ok: true, data: order }
    if (await isAdminSession(event)) return { ok: true, data: order }
    return { ok: false, message: '无权查看该订单' }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '查询失败' }
  }
}
