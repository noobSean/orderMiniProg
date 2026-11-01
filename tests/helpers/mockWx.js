'use strict';

/**
 * 微信小程序 wx 全局对象 mock（测试专用，零依赖）
 *
 * 设计目标：
 *  - 覆盖小程序端工具模块实际用到的 API：本地缓存、云开发、订阅消息、UI 反馈、页面导航；
 *  - 所有调用记录到 mock.calls（{name, args}），便于断言「调用了哪个 API、参数是什么」；
 *  - 每个用例 createWxMock() 一个全新实例，互不干扰；install()/restore() 负责注入/还原 globalThis.wx；
 *  - handlers 可按用例覆盖默认返回值；返回 { __fail: {...} } 表示走 fail 回调。
 *
 * 注意：这是测试替身，不修改任何源码。
 */

function deepClone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch (e) {
    return value;
  }
}

// 极简云数据库替身：只实现 api.js 直读用到的链式查询（默认返回空数组）
function createFakeDatabase() {
  const calls = [];
  function collection(name) {
    const entry = { collection: name, where: null, orderBy: [], limit: null, skip: 0 };
    const chain = {
      where: function (where) { entry.where = deepClone(where); return chain; },
      orderBy: function (field, direction) {
        entry.orderBy.push([field, direction === undefined ? 'asc' : direction]);
        return chain;
      },
      limit: function (n) { entry.limit = n; return chain; },
      skip: function (n) { entry.skip = n; return chain; },
      get: function () { calls.push(deepClone(entry)); return Promise.resolve({ data: [] }); },
      count: function () { calls.push(deepClone(entry)); return Promise.resolve({ total: 0 }); }
    };
    return chain;
  }
  return { collection: collection, calls: calls, command: {} };
}

function createWxMock(options) {
  const opts = options || {};
  const handlers = Object.assign({}, opts.handlers || {});
  const calls = [];
  const storage = new Map();
  const modalResponses = (opts.modalResponses || []).slice();
  let pages = Array.isArray(opts.pages) ? opts.pages.slice() : [];
  const defaultDatabase = createFakeDatabase();

  if (opts.storage) {
    Object.keys(opts.storage).forEach(function (key) {
      storage.set(key, deepClone(opts.storage[key]));
    });
  }

  function record(name, args) {
    calls.push({ name: name, args: args });
    return args;
  }
  function callOpt(opt, kind, payload) {
    if (opt && typeof opt[kind] === 'function') opt[kind](payload);
  }
  function succeed(opt, payload) {
    callOpt(opt, 'success', payload);
    callOpt(opt, 'complete', payload);
  }
  function fail(opt, err) {
    callOpt(opt, 'fail', err);
    callOpt(opt, 'complete', err);
  }

  const mock = {
    calls: calls,
    storage: storage,
    opts: opts,
    wx: null,
    databaseCalls: defaultDatabase.calls
  };

  // 通用「成功型」异步 API：记录调用、支持 handler 返回 { __fail } 模拟失败
  function uiMethod(name) {
    return function (opt) {
      record(name, opt);
      const handler = handlers[name];
      const res = (typeof handler === 'function') ? handler(opt, mock) : handler;
      if (res && res.__fail) {
        fail(opt, res.__fail);
        return;
      }
      succeed(opt, {});
    };
  }

  function makeUploadTask(withProgress) {
    return {
      onProgressUpdate: function (cb) {
        if (!withProgress || typeof cb !== 'function') return;
        const steps = opts.uploadProgress || [45, 100];
        steps.forEach(function (p) { cb({ progress: p }); });
      }
    };
  }

  const wx = {
    /* ---------------- 本地缓存 ---------------- */
    getStorageSync: function (key) {
      record('getStorageSync', key);
      if (typeof handlers.getStorageSync === 'function') return handlers.getStorageSync(key, mock);
      return storage.has(key) ? deepClone(storage.get(key)) : '';
    },
    setStorageSync: function (key, value) {
      record('setStorageSync', { key: key, value: deepClone(value) });
      if (typeof handlers.setStorageSync === 'function') return handlers.setStorageSync(key, value, mock);
      storage.set(key, deepClone(value));
    },
    removeStorageSync: function (key) {
      record('removeStorageSync', key);
      if (typeof handlers.removeStorageSync === 'function') return handlers.removeStorageSync(key, mock);
      storage.delete(key);
    },
    clearStorageSync: function () {
      record('clearStorageSync', undefined);
      storage.clear();
    },
    getStorageInfoSync: function () {
      record('getStorageInfoSync', undefined);
      return { keys: Array.from(storage.keys()) };
    },

    /* ---------------- UI 反馈 ---------------- */
    showToast: function (opt) { record('showToast', opt); },
    showLoading: function (opt) { record('showLoading', opt); },
    hideLoading: function () { record('hideLoading', undefined); },
    showModal: function (opt) {
      record('showModal', opt);
      const handler = handlers.showModal;
      let res = (typeof handler === 'function') ? handler(opt, mock) : handler;
      if (res === undefined || res === null) {
        res = modalResponses.length ? modalResponses.shift() : { confirm: true, cancel: false };
      }
      if (res && res.__fail) {
        fail(opt, res.__fail);
        return;
      }
      succeed(opt, res);
    },
    previewImage: uiMethod('previewImage'),

    /* ---------------- 选择图片 ---------------- */
    chooseMedia: function (opt) {
      record('chooseMedia', opt);
      const handler = handlers.chooseMedia;
      let res = (typeof handler === 'function') ? handler(opt, mock) : handler;
      if (res === undefined) res = { tempFiles: [{ tempFilePath: 'wxfile://tmp/choose-media.jpg', size: 1024 }] };
      if (res && res.__fail) {
        fail(opt, res.__fail);
        return;
      }
      succeed(opt, res);
    },
    chooseImage: function (opt) {
      record('chooseImage', opt);
      const handler = handlers.chooseImage;
      let res = (typeof handler === 'function') ? handler(opt, mock) : handler;
      if (res === undefined) {
        res = {
          tempFilePaths: ['wxfile://tmp/choose-image.jpg'],
          tempFiles: [{ tempFilePath: 'wxfile://tmp/choose-image.jpg', size: 2048 }]
        };
      }
      if (res && res.__fail) {
        fail(opt, res.__fail);
        return;
      }
      succeed(opt, res);
    },

    /* ---------------- 订阅消息 ---------------- */
    requestSubscribeMessage: function (opt) {
      record('requestSubscribeMessage', opt);
      const handler = handlers.requestSubscribeMessage;
      let res = (typeof handler === 'function') ? handler(opt, mock) : handler;
      if (res === undefined) {
        res = { errMsg: 'requestSubscribeMessage:ok' };
        ((opt && opt.tmplIds) || []).forEach(function (id) { res[id] = 'accept'; });
      }
      if (res && res.__fail) {
        fail(opt, res.__fail);
        return;
      }
      succeed(opt, res);
    },

    /* ---------------- 云开发 ---------------- */
    cloud: {
      init: function (opt) { record('cloud.init', opt); },
      callFunction: function (opt) {
        record('cloud.callFunction', opt);
        const handler = handlers.callFunction;
        try {
          let out;
          if (typeof handler === 'function') {
            out = handler(opt, mock);
          } else if (handler && handler.__reject) {
            return Promise.reject(handler.__reject);
          } else {
            out = handler;
          }
          if (out && out.__reject) return Promise.reject(out.__reject);
          if (out === undefined) out = { result: { ok: true, data: null } };
          return Promise.resolve(out);
        } catch (err) {
          return Promise.reject(err);
        }
      },
      uploadFile: function (opt) {
        record('cloud.uploadFile', opt);
        const handler = handlers.uploadFile;
        let res;
        try {
          res = (typeof handler === 'function') ? handler(opt, mock) : handler;
        } catch (err) {
          fail(opt, { errMsg: (err && err.message) || 'uploadFile error' });
          return makeUploadTask(false);
        }
        if (res === undefined) res = { fileID: 'cloud://mock.example/uploaded.jpg' };
        if (res && res.__fail) {
          fail(opt, res.__fail);
          return makeUploadTask(false);
        }
        succeed(opt, res);
        return makeUploadTask(true);
      },
      deleteFile: function (opt) {
        record('cloud.deleteFile', opt);
        const handler = handlers.deleteFile;
        let res = (typeof handler === 'function') ? handler(opt, mock) : handler;
        if (res === undefined) {
          res = {
            fileList: ((opt && opt.fileList) || []).map(function (id) {
              return { fileID: id, status: 0 };
            })
          };
        }
        if (res && res.__fail) {
          fail(opt, res.__fail);
          return;
        }
        succeed(opt, res);
      },
      getTempFileURL: function (opt) {
        record('cloud.getTempFileURL', opt);
        const handler = handlers.getTempFileURL;
        let res = (typeof handler === 'function') ? handler(opt, mock) : handler;
        if (res === undefined) {
          res = {
            fileList: ((opt && opt.fileList) || []).map(function (id, i) {
              return { fileID: id, tempFileURL: 'https://tmp.example.com/' + i + '.jpg' };
            })
          };
        }
        if (res && res.__fail) {
          fail(opt, res.__fail);
          return;
        }
        succeed(opt, res);
      },
      database: function () {
        record('cloud.database', undefined);
        const handler = handlers.database;
        if (typeof handler === 'function') return handler(mock);
        if (handler) return handler;
        return defaultDatabase;
      }
    },

    /* ---------------- 页面导航 / tabBar ---------------- */
    navigateTo: uiMethod('navigateTo'),
    redirectTo: uiMethod('redirectTo'),
    switchTab: uiMethod('switchTab'),
    reLaunch: uiMethod('reLaunch'),
    navigateBack: uiMethod('navigateBack'),
    showTabBar: uiMethod('showTabBar'),
    hideTabBar: uiMethod('hideTabBar'),
    stopPullDownRefresh: uiMethod('stopPullDownRefresh')
  };

  mock.wx = wx;

  mock.install = function () {
    mock.prevWx = globalThis.wx;
    mock.prevGetCurrentPages = globalThis.getCurrentPages;
    globalThis.wx = wx;
    globalThis.getCurrentPages = function () { return pages.slice(); };
    return mock;
  };

  mock.restore = function () {
    if (mock.prevWx === undefined) delete globalThis.wx;
    else globalThis.wx = mock.prevWx;
    if (mock.prevGetCurrentPages === undefined) delete globalThis.getCurrentPages;
    else globalThis.getCurrentPages = mock.prevGetCurrentPages;
    return mock;
  };

  mock.setPages = function (list) { pages = Array.isArray(list) ? list.slice() : []; return mock; };
  mock.callsOf = function (name) { return calls.filter(function (c) { return c.name === name; }); };
  mock.lastCall = function (name) {
    const list = mock.callsOf(name);
    return list.length ? list[list.length - 1] : null;
  };
  mock.callCount = function (name) { return mock.callsOf(name).length; };
  mock.resetCalls = function () { calls.length = 0; return mock; };
  mock.setHandler = function (name, fn) { handlers[name] = fn; return mock; };
  mock.setHandlers = function (map) { Object.keys(map || {}).forEach(function (k) { handlers[k] = map[k]; }); return mock; };
  mock.seedStorage = function (key, value) { storage.set(key, deepClone(value)); return mock; };
  mock.getStorage = function (key) { return storage.has(key) ? deepClone(storage.get(key)) : ''; };
  mock.hasStorage = function (key) { return storage.has(key); };
  mock.clearStorage = function () { storage.clear(); return mock; };
  mock.storageKeys = function () { return Array.from(storage.keys()); };

  return mock;
}

module.exports = { createWxMock: createWxMock, deepClone: deepClone };
