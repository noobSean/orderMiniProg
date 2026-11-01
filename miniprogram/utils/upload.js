/**
 * 静态资源上传（图片等）—— 微信云存储
 *
 * 用法：
 *   const upload = require('<项目根>/utils/upload');
 *   const fileID = await upload.pickImage({ dir: 'dishes', onProgress: p => console.log(p) }); // 用户取消返回 ''
 *   await upload.remove(fileID);        // 删除云存储文件（非 cloud:// 文件自动忽略）
 *   const url = await upload.tempUrl(fileID); // 需要 http(s) 链接时（如 wx.previewImage）
 *
 * 说明：
 *  - 选择图片时已要求压缩图（sizeType: compressed），默认限制 10MB；
 *  - 返回的 fileID（cloud://...）可直接用于 <image src>，也可以直接存进数据库字段；
 *  - 上传目录 dir 决定云存储路径前缀（如 dishes/、banners/、logo/），便于分类管理；
 *  - 云存储权限请保持默认「所有用户可读，仅创建者可写」，否则员工端看不到菜品图。
 */
const MAX_MB = 10;
const CLOUD_PREFIX = 'cloud://';
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

function isCloudFile(fileID) {
  return typeof fileID === 'string' && fileID.indexOf(CLOUD_PREFIX) === 0;
}

function extOf(filePath) {
  const m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(String(filePath || ''));
  const ext = m ? m[1].toLowerCase() : 'jpg';
  return IMAGE_EXT.indexOf(ext) >= 0 ? ext : 'jpg';
}

function rand() {
  return Math.random().toString(36).slice(2, 10);
}

// 选择一张图片（压缩图）。用户取消时 resolve(null)
function chooseOneImage() {
  return new Promise((resolve, reject) => {
    const onFail = err => {
      const msg = (err && err.errMsg) || '';
      if (msg.indexOf('cancel') >= 0) resolve(null);
      else reject(new Error('选择图片失败：' + (msg || '未知错误')));
    };
    const onOk = (tempFilePath, size) => {
      if (!tempFilePath) return resolve(null);
      resolve({ tempFilePath: tempFilePath, size: Number(size) || 0 });
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: res => {
          const f = (res && res.tempFiles && res.tempFiles[0]) || {};
          onOk(f.tempFilePath || (res.tempFilePaths && res.tempFilePaths[0]), f.size);
        },
        fail: onFail
      });
      return;
    }
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const f = (res && res.tempFiles && res.tempFiles[0]) || {};
        onOk((res && res.tempFilePaths && res.tempFilePaths[0]) || '', f.size);
      },
      fail: onFail
    });
  });
}

function friendlyUploadError(err) {
  const msg = (err && (err.errMsg || err.message)) || '未知错误';
  if (/permission|auth|denied|forbidden|403/i.test(msg)) {
    return '上传失败：云存储权限不足，请检查云开发「存储」权限设置';
  }
  if (/network|timeout|ERR_/i.test(msg)) return '上传失败：网络异常，请重试';
  return '上传失败：' + msg;
}

// 上传单个文件到云存储，返回 fileID
function uploadToCloud(filePath, cloudPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      reject(new Error('当前环境不支持云存储上传，请确认已开通云开发'));
      return;
    }
    let task = null;
    try {
      task = wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath,
        success: res => resolve((res && res.fileID) || ''),
        fail: err => reject(new Error(friendlyUploadError(err)))
      });
    } catch (e) {
      reject(new Error('上传失败：' + ((e && e.message) || '未知错误')));
      return;
    }
    if (task && typeof task.onProgressUpdate === 'function' && typeof onProgress === 'function') {
      task.onProgressUpdate(res => {
        try { onProgress((res && res.progress) || 0); } catch (e) {}
      });
    }
  });
}

/**
 * 选择并上传一张图片，返回云文件 ID（cloud://...）；用户取消返回 ''
 * @param {{dir?: string, onProgress?: (percent:number)=>void}} [opts]
 */
async function pickImage(opts) {
  const o = opts || {};
  const file = await chooseOneImage();
  if (!file || !file.tempFilePath) return '';
  if (file.size && file.size > MAX_MB * 1024 * 1024) {
    throw new Error('图片超过 ' + MAX_MB + 'MB，请压缩后再上传');
  }
  const dir = String(o.dir || 'misc').replace(/^\/+|\/+$/g, '');
  const cloudPath = dir + '/' + Date.now() + '-' + rand() + '.' + extOf(file.tempFilePath);
  const fileID = await uploadToCloud(file.tempFilePath, cloudPath, o.onProgress);
  if (!fileID) throw new Error('上传失败：未获取到文件 ID');
  return fileID;
}

// 删除云存储文件（失败静默，不影响主流程）
function remove(fileID) {
  if (!isCloudFile(fileID)) return Promise.resolve();
  return new Promise(resolve => {
    try {
      wx.cloud.deleteFile({ fileList: [fileID], success: () => resolve(), fail: () => resolve() });
    } catch (e) {
      resolve();
    }
  });
}

// 云文件 ID 转临时 https 链接（用于 previewImage 等场景）
function tempUrl(fileID) {
  if (!isCloudFile(fileID)) return Promise.resolve(fileID || '');
  return new Promise(resolve => {
    try {
      wx.cloud.getTempFileURL({
        fileList: [fileID],
        success: res => resolve(((res.fileList || [])[0] || {}).tempFileURL || ''),
        fail: () => resolve('')
      });
    } catch (e) {
      resolve('');
    }
  });
}

module.exports = {
  pickImage,
  remove,
  tempUrl,
  isCloudFile,
  MAX_MB,
  CLOUD_PREFIX
};
