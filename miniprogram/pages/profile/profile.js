const adminAuth = require('../../utils/adminAuth');
const api = require('../../utils/api');

Page({
  data: {
    profile: null,
    state: 'loading',     // loading | bound | unbound | logged_out | error
    loading: true,
    loggingIn: false,
    errorMsg: '',
    adminSession: false,
    showAdmin: false,     // 仅管理员微信显示管理入口；首次无管理员时 bootstrap=true 临时显示
    adminBootstrap: false
  },

  onShow() {
    this.setData({ adminSession: adminAuth.isValid() });
    this.loadProfile();
    this.checkAdminEntry();
  },

  // 服务端判断当前微信是否为管理员；普通员工/用户看不到管理后台入口
  checkAdminEntry() {
    api.adminWhoami().then(r => {
      this.setData({
        showAdmin: !!(r && (r.isAdmin || r.bootstrap)),
        adminBootstrap: !!(r && r.bootstrap)
      });
    }).catch(() => {
      // 查询失败时保守隐藏入口
      this.setData({ showAdmin: false, adminBootstrap: false });
    });
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
    // 首次初始化（还没有任何管理员）强制走登录：确保首位管理员被绑定到白名单，
    // 而不是用旧会话直接进入后台导致 bootstrap 窗口一直存在。
    if (this.data.adminBootstrap) {
      adminAuth.clear();
      wx.navigateTo({ url: adminAuth.loginUrl('/pages/admin/home') });
      return;
    }
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
