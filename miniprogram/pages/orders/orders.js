const api = require('../../utils/api');
const util = require('../../utils/util');
const STATUS = { pending: '已下单', making: '制作中', ready: '可取出', done: '已完成', cancelled: '已取消' };

Page({
  data: { list: [], loading: true },

  onShow() { this.load(); },

  // 下拉刷新我的订单（页面配置 enablePullDownRefresh）
  onPullDownRefresh() { this.load(); },

  load() {
    this.setData({ loading: true });
    api.myOrders().then(list => {
      (list || []).forEach(o => {
        o.statusText = STATUS[o.status] || o.status || '';
        const t = (o.type || (o.delivery && o.delivery.type) || 'pickup') === 'delivery' ? '配送' : '自取';
        o.typeText = t;
        o.timeText = this.timeText(o);
      });
      this.setData({ list: list || [], loading: false });
      wx.stopPullDownRefresh();
    }).catch(err => {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    });
  },

  timeText(o) {
    const raw = o.createdAt || o.time || o.createTime || o.orderTime;
    if (!raw) return '';
    return util.formatTimeValue(raw) || (raw + '');
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + encodeURIComponent(id) });
  }
});
