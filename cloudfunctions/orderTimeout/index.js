const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 未付款订单自动取消时间（分钟），可用云函数环境变量 UNPAID_TIMEOUT_MIN 覆盖
const UNPAID_TIMEOUT_MIN = Math.max(1, Number(process.env.UNPAID_TIMEOUT_MIN) || 15)
const BATCH_LIMIT = 50

// 取消订单回补有限库存（与 orderAdmin 的取消逻辑一致）
async function restoreStockForCancel(order) {
  const items = Array.isArray(order && order.items) ? order.items : []
  for (const it of items) {
    if (!it || !it.dishId) continue
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1))
    try {
      const dres = await db.collection('dishes').doc(it.dishId).get()
      const dish = dres && dres.data
      if (!dish) continue
      if (typeof dish.stock !== 'number') continue
      await db.collection('dishes').doc(it.dishId).update({ data: { stock: dish.stock + qty } })
      console.log('[orderTimeout] stock restored', JSON.stringify({ orderId: order._id, dishId: it.dishId, qty: qty }))
    } catch (e) {
      console.log('[orderTimeout] restore stock failed', JSON.stringify({ orderId: order._id, dishId: it.dishId, err: (e && e.message) || '' }))
    }
  }
}

// 超时未付款订单：取消并回补库存
async function cancelExpiredUnpaid() {
  const cutoff = new Date(Date.now() - UNPAID_TIMEOUT_MIN * 60 * 1000)
  const res = await db.collection('orders')
    .where({ status: 'pending', paymentStatus: 'unpaid', createdAt: _.lt(cutoff) })
    .limit(BATCH_LIMIT)
    .get()
  const list = res.data || []
  let cancelled = 0
  for (const order of list) {
    try {
      // 二次确认，避免与店员收款/手动接单并发冲突
      const cur = await db.collection('orders').doc(order._id).get()
      const o = cur && cur.data
      if (!o || o.status !== 'pending' || o.paymentStatus !== 'unpaid') continue
      const history = Array.isArray(o.statusHistory) ? o.statusHistory : []
      history.push({ status: 'cancelled', time: db.serverDate(), note: '超时未付款，自动取消' })
      await db.collection('orders').doc(order._id).update({
        data: {
          status: 'cancelled',
          statusHistory: history,
          cancelReason: 'unpaid_timeout',
          updatedAt: db.serverDate()
        }
      })
      await restoreStockForCancel(o)
      cancelled += 1
    } catch (e) {
      console.log('[orderTimeout] cancel failed', JSON.stringify({ orderId: order._id, err: (e && e.message) || '' }))
    }
  }
  return { scanned: list.length, cancelled: cancelled, timeoutMin: UNPAID_TIMEOUT_MIN }
}

// 每天凌晨清理「快捷售罄」标记，让新一天自动恢复在售（库存数字不清）
async function resetSoldOut() {
  const res = await db.collection('dishes').where({ soldOut: true }).limit(1000).get()
  const list = res.data || []
  let reset = 0
  for (const d of list) {
    try {
      await db.collection('dishes').doc(d._id).update({ data: { soldOut: false } })
      reset += 1
    } catch (e) {}
  }
  return { reset: reset }
}

exports.main = async (event, context) => {
  // 部署自检：{"action":"ping"}
  if (event && event.action === 'ping') {
    return { ok: true, data: { pong: true, fn: 'orderTimeout', version: 'p0-v1', now: new Date().toISOString() } }
  }
  try {
    const trigger = (event && (event.TriggerName || event.triggerName)) || ''
    // 兼容定时触发器（TriggerName）与控制台手动测试（action）
    if (trigger === 'dailySoldOutReset' || (event && event.action === 'dailySoldOutReset')) {
      return { ok: true, data: Object.assign({ task: 'dailySoldOutReset' }, await resetSoldOut()) }
    }
    return { ok: true, data: Object.assign({ task: 'unpaidTimeout' }, await cancelExpiredUnpaid()) }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '定时任务失败' }
  }
}
