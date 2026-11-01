const adminAuth = require('../../utils/adminAuth');

Page({
  data: {
    profile: null,
    state: 'loading',     // loading | bound | unbound | logged_out | error
    loading: true,
    loggingIn: false,
    errorMsg: '',
    adminSession: false
  },

  onShow() {
    this.setData({ adminSession: adminAuth.isValid() });
    this.loadProfile();
  },

  onPullDownRefresh() {
    this.loadProfile().then(() => wx.stopPullDownRefresh());
  },

  // 静默登录：同一微信自动恢复员工档案
  async loadProfile() {
    const app = getApp();
    this.setData({ loading: true });
    const r = await app.ensureLogin();
    const profile = (r && r.profile) || app.getCachedProfile();
    this.setData({
      loading: false,
      state: profile ? 'bound' : (r && r.state) || 'unbound',
      profile: profile || null,
      errorMsg: (r && r.state === 'error') ? ((r.error && r.error.message) || '网络异常') : ''
    });
    return r;
  },

  goBind() { wx.navigateTo({ url: '/pages/bind/bind' }); },

  // 主动「重新登录」：清除退出标记后向云端确认 openid 对应的员工档案
  async onLogin() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });
    try {
      const r = await getApp().loginNow();
      if (r && r.profile) {
        this.setData({ profile: r.profile, state: 'bound', errorMsg: '' });
        wx.showToast({ title: '登录成功', icon: 'success' });
      } else if (r && r.state === 'unbound') {
        wx.showToast({ title: '该微信尚未绑定工号，请先绑定', icon: 'none' });
      } else {
        wx.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
      }
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  onRetry() { this.loadProfile(); },

  // 管理后台入口：与员工绑定完全解耦，未登录管理端则先跳到口令登录页
  openAdmin() {
    if (adminAuth.isValid()) {
      wx.navigateTo({ url: '/pages/admin/home' });
      return;
    }
    wx.navigateTo({ url: adminAuth.loginUrl('/pages/admin/home') });
  },

  logout() {
    getApp().logout();
    this.setData({ profile: null, state: 'logged_out', adminSession: adminAuth.isValid() });
    wx.showToast({ title: '已退出登录', icon: 'none' });
  }
});
