const api = require('../../utils/api.js');
const adminAuth = require('../../utils/adminAuth.js');

function money(n) { return (Number(n) || 0).toFixed(2); }

Page({
  data: {
    ready: false,
    stats: { orderCount: 0, revenueText: '0.00', pickupCount: 0, deliveryCount: 0 },
    entries: [
      { url: '/pages/admin/orders', icon: '📋', name: '待处理订单' },
      { url: '/pages/admin/employees', icon: '👥', name: '员工绑定' },
      { url: '/pages/admin/menu-manage', icon: '🍽️', name: '菜单管理' },
      { url: '/pages/admin/dept-manage', icon: '🏥', name: '科室管理' },
      { url: '/pages/admin/settings', icon: '⚙️', name: '门店配置' },
      { url: '/pages/admin/stats', icon: '📊', name: '营业统计' }
    ]
  },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.load();
  },

  async load() {
    try {
      let r = await api.adminStats({ mode: 'today' });
      r = r || {};
      const byType = r.byType || {};
      const revenue = r.revenue != null ? r.revenue
        : (r.totalAmount != null ? r.totalAmount : (r.amount != null ? r.amount : 0));
      this.setData({
        stats: {
          orderCount: r.orderCount != null ? r.orderCount : (r.total || 0),
          revenueText: money(revenue),
          pickupCount: r.pickupCount != null ? r.pickupCount : (byType.pickup || 0),
          deliveryCount: r.deliveryCount != null ? r.deliveryCount : (byType.delivery || 0)
        }
      });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    }
  },

  // 退出管理登录：先注销云端会话（失败也不影响本地清理），回到「我的」
  async onLogout() {
    const res = await new Promise(resolve => {
      wx.showModal({
        title: '退出管理登录',
        content: '退出后需要重新输入管理口令，确定退出？',
        confirmColor: '#fa5151',
        success: resolve,
        fail: () => resolve({ confirm: false })
      });
    });
    if (!res.confirm) return;
    wx.showLoading({ title: '退出中', mask: true });
    try {
      await api.adminLogout();
    } finally {
      adminAuth.clear();
      wx.hideLoading();
      // profile 是 tabBar 页面：优先 switchTab（会关闭所有非 tab 页面），失败再 reLaunch 兜底
      wx.switchTab({
        url: '/pages/profile/profile',
        fail: function () { wx.reLaunch({ url: '/pages/profile/profile' }); }
      });
    }
  },

  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }); }
});
