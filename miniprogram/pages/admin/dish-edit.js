const api = require('../../utils/api.js');
const adminAuth = require('../../utils/adminAuth.js');
const upload = require('../../utils/upload.js');

Page({
  data: {
    ready: false,
    id: '',
    isEdit: false,
    saving: false,
    uploading: false,      // 图片上传中
    uploadProgress: 0,     // 上传进度 %
    imageIsNew: false,     // 当前图片是否为本次新上传（未保存）
    initialImage: '',      // 打开页面时已有的图片（用于保存后清理旧文件）
    categories: [],
    catIndex: -1,
    form: {
      name: '',
      categoryId: '',
      desc: '',
      price: '',
      unit: '份',
      specs: [],
      extras: [],
      stock: '',
      sort: 0,
      available: true,
      image: ''
    }
  },

  onLoad(options) { this.setData({ id: options.id || '' }); },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
    this.init();
  },

  async init() {
    // 分类
    let categories = [];
    try { const r = await api.getMenu(); categories = (r.categories || []); }
    catch (e) { categories = []; }
    this.setData({ categories });

    // 回填菜品
    let raw = null;
    if (this.data.id) {
      raw = wx.getStorageSync('dsh_dish_edit_raw') || null;
      if (!raw) {
        try { raw = await api.dishAdmin('get', { dishId: this.data.id }); } catch (e) { raw = null; }
      }
    }
    if (raw) this.applyDish(raw, categories);
  },

  applyDish(d, categories) {
    const specs = (d.specs || []).map(s => ({ name: s.name || '', price: s.price != null ? String(s.price) : '' }));
    const extras = (d.extras || []).map(x => ({ name: x.name || '', price: x.price != null ? String(x.price) : '' }));
    let catIndex = categories.findIndex(c => c._id === d.categoryId);
    if (catIndex < 0) catIndex = -1;
    this.setData({
      isEdit: true,
      catIndex,
      initialImage: d.image || '',
      imageIsNew: false,
      form: {
        name: d.name || '',
        categoryId: d.categoryId || '',
        desc: d.desc || '',
        price: d.price != null ? String(d.price) : '',
        unit: d.unit || '份',
        specs,
        extras,
        stock: d.stock != null && d.stock !== '' ? String(d.stock) : '',
        sort: d.sort || 0,
        available: d.available !== false,
        image: d.image || ''
      }
    });
  },

  // 简单字段
  onField(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },
  onSwitch(e) { this.setData({ 'form.available': e.detail.value }); },
  onCat(e) {
    const idx = Number(e.detail.value);
    const c = this.data.categories[idx];
    this.setData({ catIndex: idx, ['form.categoryId']: c ? c._id : '' });
  },
  onSort(e) { this.setData({ 'form.sort': Number(e.detail.value) || 0 }); },
  onStock(e) { this.setData({ 'form.stock': e.detail.value }); },

  // 规格动态增删
  onSpecField(e) {
    const { index, key } = e.currentTarget.dataset;
    this.setData({ ['form.specs[' + index + '].' + key]: e.detail.value });
  },
  addSpec() { this.setData({ 'form.specs': this.data.form.specs.concat([{ name: '', price: '' }]) }); },
  delSpec(e) {
    const i = Number(e.currentTarget.dataset.index);
    const specs = this.data.form.specs.slice();
    specs.splice(i, 1);
    this.setData({ 'form.specs': specs });
  },

  // 加料动态增删
  onExtraField(e) {
    const { index, key } = e.currentTarget.dataset;
    this.setData({ ['form.extras[' + index + '].' + key]: e.detail.value });
  },
  addExtra() { this.setData({ 'form.extras': this.data.form.extras.concat([{ name: '', price: '' }]) }); },
  delExtra(e) {
    const i = Number(e.currentTarget.dataset.index);
    const extras = this.data.form.extras.slice();
    extras.splice(i, 1);
    this.setData({ 'form.extras': extras });
  },

  // 图片：选择（压缩）-> 上传云存储 -> 表单保存 fileID
  async onChooseImage() {
    if (this.data.uploading) return;
    this.setData({ uploading: true, uploadProgress: 0 });
    try {
      const fileID = await upload.pickImage({
        dir: 'dishes',
        onProgress: p => this.setData({ uploadProgress: p })
      });
      if (fileID) this.setData({ 'form.image': fileID, imageIsNew: true });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '上传失败', icon: 'none', duration: 2500 });
    } finally {
      this.setData({ uploading: false, uploadProgress: 0 });
    }
  },

  onClearImage() {
    if (this.data.uploading) return;
    const cur = this.data.form.image;
    // 本次新上传、尚未保存的图片：直接删除云文件，避免产生孤儿文件
    if (this.data.imageIsNew && upload.isCloudFile(cur)) upload.remove(cur);
    this.setData({ 'form.image': '', imageIsNew: false });
  },

  async onPreviewImage() {
    const cur = this.data.form.image;
    if (!cur) return;
    const url = await upload.tempUrl(cur);
    wx.previewImage({ urls: [url || cur] });
  },

  buildPayload() {
    const f = this.data.form;
    const specs = f.specs.filter(s => (s.name || '').trim()).map(s => ({ name: s.name.trim(), price: Number(s.price) || 0 }));
    const extras = f.extras.filter(x => (x.name || '').trim()).map(x => ({ name: x.name.trim(), price: Number(x.price) || 0 }));
    let stock = f.stock === '' || f.stock == null ? null : (Number(f.stock) || 0);
    return {
      name: (f.name || '').trim(),
      categoryId: f.categoryId,
      desc: (f.desc || '').trim(),
      price: Number(f.price) || 0,
      unit: (f.unit || '').trim() || '份',
      specs,
      extras,
      stock,
      sort: Number(f.sort) || 0,
      available: f.available !== false,
      image: f.image || ''
    };
  },

  async onSave() {
    const f = this.data.form;
    if (this.data.uploading) return wx.showToast({ title: '图片上传中，请稍候', icon: 'none' });
    if (!(f.name || '').trim()) return wx.showToast({ title: '请填写名称', icon: 'none' });
    if (!f.categoryId) return wx.showToast({ title: '请选择分类', icon: 'none' });
    if (!(Number(f.price) > 0)) return wx.showToast({ title: '请填写价格', icon: 'none' });
    this.setData({ saving: true });
    try {
      const payload = this.buildPayload();
      if (this.data.id) await api.dishAdmin('update', { dishId: this.data.id, ...payload });
      else await api.dishAdmin('create', payload);
      // 保存成功后清理被替换掉的旧云文件（图片换新或删除时）
      if (this.data.initialImage && this.data.initialImage !== payload.image && upload.isCloudFile(this.data.initialImage)) {
        upload.remove(this.data.initialImage);
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
