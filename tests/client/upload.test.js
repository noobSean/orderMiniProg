'use strict';

/**
 * 小程序端工具模块单元测试：miniprogram/utils/upload.js
 * 覆盖：pickImage 成功/取消/超大小/上传失败、chooseMedia 降级 chooseImage、
 *       进度回调、remove 忽略外链、tempUrl、常量与工具函数。
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createWxMock } = require('../helpers/mockWx.js');
const upload = require('../../miniprogram/utils/upload.js');

let mock = null;

function setup(options) {
  mock = createWxMock(options || {}).install();
  return mock;
}

afterEach(() => {
  if (mock) {
    mock.restore();
    mock = null;
  }
});

// 让 chooseMedia 返回指定临时文件路径
function chooseMediaFile(tempFilePath, size) {
  mock.setHandler('chooseMedia', function () {
    return { tempFiles: [{ tempFilePath: tempFilePath, size: size === undefined ? 1024 : size }] };
  });
}

test('pickImage：成功选图并上传，返回云文件 ID', async () => {
  setup();
  const fileID = await upload.pickImage({ dir: 'dishes' });
  assert.equal(fileID, 'cloud://mock.example/uploaded.jpg');

  const choose = mock.lastCall('chooseMedia');
  assert.ok(choose, '应优先使用 wx.chooseMedia');
  assert.equal(choose.args.count, 1);
  assert.deepEqual(choose.args.mediaType, ['image']);
  assert.deepEqual(choose.args.sizeType, ['compressed']);
  assert.deepEqual(choose.args.sourceType, ['album', 'camera']);

  const uploadCall = mock.lastCall('cloud.uploadFile');
  assert.equal(uploadCall.args.filePath, 'wxfile://tmp/choose-media.jpg');
  assert.match(uploadCall.args.cloudPath, /^dishes\/\d{13}-[a-z0-9]+\.jpg$/);
  assert.equal(mock.callCount('cloud.uploadFile'), 1);
});

test('pickImage：dir 缺省为 misc，斜杠会被去掉', async () => {
  setup();
  await upload.pickImage();
  assert.match(mock.lastCall('cloud.uploadFile').args.cloudPath, /^misc\//);

  setup();
  await upload.pickImage({ dir: '/banners/' });
  assert.match(mock.lastCall('cloud.uploadFile').args.cloudPath, /^banners\//);
});

test('pickImage：进度回调透传', async () => {
  setup({ uploadProgress: [10, 55, 100] });
  const progress = [];
  await upload.pickImage({ onProgress: function (p) { progress.push(p); } });
  assert.deepEqual(progress, [10, 55, 100]);
});

test('pickImage：用户取消返回空串，不上传', async () => {
  setup();
  mock.setHandler('chooseMedia', function () {
    return { __fail: { errMsg: 'chooseMedia:fail cancel' } };
  });
  assert.equal(await upload.pickImage(), '');
  assert.equal(mock.callCount('cloud.uploadFile'), 0);
});

test('pickImage：选图成功但没有临时文件时返回空串', async () => {
  setup();
  mock.setHandler('chooseMedia', function () { return { tempFiles: [] }; });
  assert.equal(await upload.pickImage(), '');
  assert.equal(mock.callCount('cloud.uploadFile'), 0);
});

test('pickImage：图片超过 10MB 时拒绝上传', async () => {
  setup();
  chooseMediaFile('wxfile://tmp/big.jpg', 10 * 1024 * 1024 + 1);
  await assert.rejects(upload.pickImage(), /超过 10MB/);
  assert.equal(mock.callCount('cloud.uploadFile'), 0);
});

test('pickImage：恰好 10MB 允许上传', async () => {
  setup();
  chooseMediaFile('wxfile://tmp/limit.jpg', 10 * 1024 * 1024);
  assert.equal(await upload.pickImage(), 'cloud://mock.example/uploaded.jpg');
});

test('pickImage：上传失败错误友好化（权限 / 网络 / 其它）', async () => {
  setup();
  mock.setHandler('uploadFile', function () {
    return { __fail: { errMsg: 'uploadFile:fail permission denied 403' } };
  });
  await assert.rejects(upload.pickImage(), /云存储权限不足/);

  setup();
  mock.setHandler('uploadFile', function () {
    return { __fail: { errMsg: 'uploadFile:fail network timeout' } };
  });
  await assert.rejects(upload.pickImage(), /网络异常，请重试/);

  setup();
  mock.setHandler('uploadFile', function () {
    return { __fail: { errMsg: 'some unknown error' } };
  });
  await assert.rejects(upload.pickImage(), /上传失败：some unknown error/);
});

test('pickImage：上传成功但未返回 fileID 时报错', async () => {
  setup();
  mock.setHandler('uploadFile', function () { return {}; });
  await assert.rejects(upload.pickImage(), /未获取到文件 ID/);
});

test('pickImage：环境不支持云存储时给出提示', async () => {
  setup();
  delete mock.wx.cloud;
  await assert.rejects(upload.pickImage(), /当前环境不支持云存储上传/);
});

test('pickImage：基础库无 chooseMedia 时降级到 chooseImage', async () => {
  setup();
  delete mock.wx.chooseMedia;
  mock.setHandler('chooseImage', function () {
    return {
      tempFilePaths: ['wxfile://tmp/fallback.PNG'],
      tempFiles: [{ tempFilePath: 'wxfile://tmp/fallback.PNG', size: 2048 }]
    };
  });
  const fileID = await upload.pickImage({ dir: 'dish' });
  assert.equal(fileID, 'cloud://mock.example/uploaded.jpg');
  assert.equal(mock.callCount('chooseImage'), 1);
  assert.equal(mock.callCount('chooseMedia'), 0);
  assert.match(mock.lastCall('cloud.uploadFile').args.cloudPath, /^dish\/\d{13}-[a-z0-9]+\.png$/);
});

test('pickImage：云存储路径扩展名识别（大小写/query/未知/无扩展名）', async () => {
  const cases = [
    { path: 'wxfile://tmp/x.WEBP?t=1', ext: 'webp' },
    { path: 'wxfile://tmp/x.tiff', ext: 'jpg' },
    { path: 'wxfile://tmp/noext', ext: 'jpg' }
  ];
  for (const item of cases) {
    setup();
    chooseMediaFile(item.path);
    await upload.pickImage({ dir: 'x' });
    assert.match(
      mock.lastCall('cloud.uploadFile').args.cloudPath,
      new RegExp('\\.' + item.ext + '$'),
      item.path + ' 的扩展名应为 ' + item.ext
    );
  }
});

test('remove：仅删除 cloud:// 文件；非云文件直接忽略', async () => {
  setup();
  await upload.remove('cloud://env.bucket/a.jpg');
  assert.equal(mock.callCount('cloud.deleteFile'), 1);
  assert.deepEqual(mock.lastCall('cloud.deleteFile').args.fileList, ['cloud://env.bucket/a.jpg']);

  setup();
  await upload.remove('https://example.com/a.jpg');
  await upload.remove('');
  await upload.remove(null);
  assert.equal(mock.callCount('cloud.deleteFile'), 0);
});

test('remove：删除失败/环境不支持时静默（不影响主流程）', async () => {
  setup();
  mock.setHandler('deleteFile', function () { return { __fail: { errMsg: 'deleteFile:fail' } }; });
  await assert.doesNotReject(upload.remove('cloud://env/a.jpg'));

  setup();
  delete mock.wx.cloud;
  await assert.doesNotReject(upload.remove('cloud://env/a.jpg'));
});

test('tempUrl：云文件换临时链接；非云文件原样返回；失败返回空串', async () => {
  setup();
  assert.equal(await upload.tempUrl('cloud://env/a.jpg'), 'https://tmp.example.com/0.jpg');
  assert.equal(await upload.tempUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(await upload.tempUrl(''), '');

  setup();
  mock.setHandler('getTempFileURL', function () { return { __fail: { errMsg: 'getTempFileURL:fail' } }; });
  assert.equal(await upload.tempUrl('cloud://env/a.jpg'), '');

  setup();
  delete mock.wx.cloud;
  assert.equal(await upload.tempUrl('cloud://env/a.jpg'), '');
});

test('常量与 isCloudFile', () => {
  assert.equal(upload.MAX_MB, 10);
  assert.equal(upload.CLOUD_PREFIX, 'cloud://');
  assert.equal(upload.isCloudFile('cloud://env/a.jpg'), true);
  assert.equal(upload.isCloudFile('https://example.com/a.jpg'), false);
  assert.equal(upload.isCloudFile(''), false);
  assert.equal(upload.isCloudFile(null), false);
  assert.equal(upload.isCloudFile(undefined), false);
});
