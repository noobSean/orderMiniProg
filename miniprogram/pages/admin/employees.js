const api = require('../../utils/api');
const util = require('../../utils/util');
const adminAuth = require('../../utils/adminAuth');

const PAGE_SIZE = 20;

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 绑定时间格式化（云函数返回的 Date / ISO 字符串 / 时间戳都兼容）
function fmtTime(v) {
  if (!v) return '';
  return util.formatTimeValue(v) || '';
}

function decorate(item) {
  var it = item || {};
  var deptText = it.dept || '未填科室';
  if (it.location) deptText += ' · ' + it.location;
  return {
    _id: it._id,
    empNo: it.empNo || '',
    name: it.name || '',
    deptText: deptText,
    timeText: fmtTime(it.createdAt) || '未知',
    openidMask: it.openidMask || '',
    admin: it.admin === true
  };
}

// 员工绑定管理：搜索（工号/姓名/科室）+ 分页 + 解绑（释放工号）
// 员工端提示「工号已被绑定」但自己无法绑定时，管理端可在此搜到记录并解绑，作为自助恢复手段。
Page({
  data: {
    ready: false,
    keyword: '',
    list: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    hasMore: false,
    loading: false,
    loadingMore: false,
    fallback: false,
    error: ''
  },

  onShow() {
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.load(true);
  },

  onKeyword(e) { this.setData({ keyword: e.detail.value }); },

  onSearch() { this.load(true); },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.load(true);
  },

  onLoadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.load(false);
  },

  onReachBottom() { this.onLoadMore(); },

  // reset=true 重新从第 1 页加载；否则加载下一页
  load(reset) {
    if (reset && this.data.loading) return;
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    if (!this._seq) this._seq = 0;
    var seq = ++this._seq;
    var page = reset ? 1 : (this.data.page + 1);
    var keyword = String(this.data.keyword || '').trim();
    this.setData({ loading: !!reset, loadingMore: !reset, error: '' });
    api.employeeAdmin('list', { keyword: keyword, page: page, pageSize: this.data.pageSize }).then(function (data) {
      if (seq !== this._seq) return;
      var res = data || {};
      var rows = (res.list || []).map(decorate);
      var list = reset ? rows : this.data.list.concat(rows);
      var total = res.total != null ? res.total : list.length;
      this.setData({
        list: list,
        total: total,
        page: res.page || page,
        pageSize: res.pageSize || this.data.pageSize,
        hasMore: list.length < total,
        fallback: !!res.fallback,
        loading: false,
        loadingMore: false
      });
    }.bind(this)).catch(function (err) {
      if (seq !== this._seq) return;
      var msg = (err && err.message) || '加载失败';
      this.setData({ loading: false, loadingMore: false, error: msg });
      wx.showToast({ title: msg, icon: 'none' });
      // 云端会话失效：api.js 已清空本地 token，这里跳转登录页
      if (!adminAuth.isValid()) adminAuth.ensure();
    }.bind(this));
  },

  // 设为/取消管理员：把该员工的微信 openid 加入管理白名单
  onToggleAdmin(e) {
    var ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    var id = ds.id;
    if (!id) return;
    var isAdmin = ds.admin === true || ds.admin === 'true';
    var label = (ds.no || '') + (ds.name ? ' ' + ds.name : '');
    wx.showModal({
      title: isAdmin ? '取消管理员' : '设为管理员',
      content: isAdmin
        ? '确定取消「' + label + '」的管理员权限？取消后该微信将看不到管理后台入口。'
        : '确定把「' + label + '」设为管理员？该微信将能看到管理后台入口，并使用管理口令登录。',
      confirmText: isAdmin ? '取消权限' : '设为管理员',
      confirmColor: isAdmin ? '#fa5151' : '#ff6b35',
      success: function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        api.employeeAdmin('setAdmin', { employeeId: id, admin: !isAdmin }).then(function () {
          wx.hideLoading();
          wx.showToast({ title: isAdmin ? '已取消管理员' : '已设为管理员', icon: 'none' });
          this.load(true);
        }.bind(this)).catch(function (err) {
          wx.hideLoading();
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
        });
      }.bind(this)
    });
  },

  onRelease(e) {
    var ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    var id = ds.id;
    if (!id) return;
    var label = ds.no || '';
    if (ds.name) label += (label ? ' ' : '') + ds.name;
    wx.showModal({
      title: '解绑确认',
      content: '确定解绑「' + label + '」？解绑后该微信可重新绑定任意工号，该工号将被释放。',
      confirmText: '解绑',
      confirmColor: '#fa5151',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return;
        this.release(id);
      }.bind(this)
    });
  },

  release(id) {
    if (this._releasing) return;
    this._releasing = true;
    wx.showLoading({ title: '解绑中', mask: true });
    api.employeeAdmin('release', { employeeId: id }).then(function (data) {
      this._releasing = false;
      wx.hideLoading();
      var d = data || {};
      wx.showToast({ title: '已解绑' + (d.empNo ? ' ' + d.empNo : ''), icon: 'none' });
      this.load(true);
    }.bind(this)).catch(function (err) {
      this._releasing = false;
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '解绑失败', icon: 'none' });
      if (!adminAuth.isValid()) adminAuth.ensure();
    }.bind(this));
  }
});
