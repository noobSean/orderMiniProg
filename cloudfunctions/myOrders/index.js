const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 返回调用者全部订单，按 createdAt 倒序
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const res = await db.collection('orders')
      .where({ openid: OPENID })
      .orderBy('createdAt', 'desc')
      .get()
    return { ok: true, data: res.data || [] }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '查询失败' }
  }
}
