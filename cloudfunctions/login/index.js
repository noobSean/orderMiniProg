const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 返回调用者 openid 与已绑定员工档案
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const res = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
    const profile = (res.data && res.data[0]) || null
    return { ok: true, data: { openid: OPENID, profile } }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '查询失败' }
  }
}
