const api = require('../../utils/api.js');
const adminAuth = require('../../utils/adminAuth.js');

Page({
  data: {
    ready: false,
    loading: false, // 列表加载中
    saving: false,
    list: [],
    filtered: [],
    keyword: '',
    roots: [],
    rootNames: [],
    showForm: false,
    isEdit: false,
    form: { id: '', name: '', pinyin: '', rootIndex: 0, sort: '', enabled: true }
  },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const list = await api.deptAdmin('adminList', {});
      const roots = (list || []).filter(d => d.isRoot);
      this.setData({
        roots: roots,
        rootNames: roots.map(r => r.name),
        list: (list || []).filter(d => !d.isRoot)
      });
      this.applyFilter();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilter() {
    const kw = (this.data.keyword || '').trim().toUpperCase();
    let arr = this.data.list;
    if (kw) arr = arr.filter(d => (d.name || '').toUpperCase().indexOf(kw) >= 0 || (d.pinyin || '').indexOf(kw) >= 0);
    this.setData({ filtered: arr });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.applyFilter());
  },

  openAdd() {
    this.setData({ showForm: true, isEdit: false, form: { id: '', name: '', pinyin: '', rootIndex: 0, sort: '', enabled: true } });
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const d = this.data.list.find(x => x._id === id);
    if (!d) return;
    let ri = this.data.rootNames.indexOf(d.rootName);
    if (ri < 0) ri = 0;
    this.setData({
      showForm: true,
      isEdit: true,
      form: { id: d._id, name: d.name || '', pinyin: d.pinyin || '', rootIndex: ri, sort: d.sort != null ? String(d.sort) : '', enabled: d.enabled !== false }
    });
  },

  closeForm() { this.setData({ showForm: false }); },
  onFormField(e) { const k = e.currentTarget.dataset.key; this.setData({ ['form.' + k]: e.detail.value }); },
  onFormSwitch(e) { this.setData({ 'form.enabled': e.detail.value }); },
  onRootPick(e) { this.setData({ 'form.rootIndex': Number(e.detail.value) }); },

  async save() {
    const f = this.data.form;
    if (!(f.name || '').trim()) return wx.showToast({ title: '请输入科室名称', icon: 'none' });
    const root = this.data.roots[f.rootIndex];
    this.setData({ saving: true });
    try {
      if (this.data.isEdit) {
        await api.deptAdmin('update', {
          id: f.id, name: f.name.trim(), pinyin: f.pinyin,
          rootCode: root ? root.code : null, rootName: root ? root.name : '',
          enabled: !!f.enabled, sort: f.sort === '' ? undefined : Number(f.sort)
        });
      } else {
        await api.deptAdmin('create', {
          name: f.name.trim(), pinyin: f.pinyin,
          rootCode: root ? root.code : null, rootName: root ? root.name : '',
          enabled: !!f.enabled, sort: f.sort === '' ? undefined : Number(f.sort)
        });
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showForm: false });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async toggle(e) {
    const id = e.currentTarget.dataset.id;
    const d = this.data.list.find(x => x._id === id);
    if (!d) return;
    try {
      await api.deptAdmin('toggle', { id: id, enabled: !(d.enabled !== false) });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    }
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    const d = this.data.list.find(x => x._id === id);
    wx.showModal({
      title: '删除科室',
      content: '确定删除「' + (d ? d.name : '') + '」？删除后不可恢复。',
      success: async res => {
        if (!res.confirm) return;
        try {
          await api.deptAdmin('delete', { id: id });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
        }
      }
    });
  }
});
