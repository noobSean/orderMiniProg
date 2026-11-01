const api = require('../../utils/api');
const util = require('../../utils/util');
const config = require('../../config/index');
const STATUS = { pending: '已下单', making: '制作中', ready: '可取出', done: '已完成', cancelled: '已取消' };

Page({
  data: {
    order: null,
    orderId: '',
    orderNo: '',
    pickupNo: '',
    total: '',
    statusText: '',
    typeText: '',
    isDelivery: false,
    deliveryTarget: '',
    items: [],
    note: '',
    originalTotal: '',
    discountAmount: '',
    createdAt: '',
    canNotify: false   // 当前订单类型是否配置了对应的订阅消息模板
  },

  onLoad(query) {
    query = query || {};
    this.setData({
      canNotify: false,
      orderId: query.id || '',
      orderNo: query.orderNo || '',
      pickupNo: query.pickupNo != null ? query.pickupNo : '',
      total: query.total != null ? query.total : ''
    });
    if (query.id) this.load(query.id);
  },

  load(id) {
    api.orderDetail(id).then(res => {
      const o = res && res.order ? res.order : (res || {});
      const isDelivery = (o.type || (o.delivery && o.delivery.type) || 'pickup') === 'delivery';
      const items = (o.items || []).map(it => (typeof it === 'object' && it !== null) ? it : { name: it });
      const pickupNo = (o.pickupNo != null) ? o.pickupNo : this.data.pickupNo;
      const orderNo = o.orderNo || this.data.orderNo;
      const total = (o.total != null) ? o.total : this.data.total;
      const raw = o.createdAt || o.time || o.createTime || o.orderTime;
      const notifyTemplates = config.subscribeTemplates || {};
      const discountAmount = Number(o.discountAmount) || 0;
      const originalTotal = (o.originalTotal != null) ? Number(o.originalTotal) : (Number(total) + discountAmount);
      this.setData({
        order: o,
        canNotify: !!(isDelivery ? notifyTemplates.deliveryDone : notifyTemplates.pickupReady),
        orderNo,
        pickupNo,
        total: (total != null && total !== '') ? total : '',
        statusText: STATUS[o.status] || o.status || '',
        typeText: isDelivery ? '配送' : '自取',
        isDelivery,
        deliveryTarget: (o.delivery && o.delivery.target) || '',
        items,
        note: o.note || (o.delivery && o.delivery.note) || '',
        discountAmount: discountAmount > 0 ? discountAmount.toFixed(2) : '',
        originalTotal: discountAmount > 0 ? originalTotal.toFixed(2) : '',
        createdAt: util.formatTimeValue(raw) || (raw ? String(raw) : '')
      });
    }).catch(err => {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    });
  }
});
