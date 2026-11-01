'use strict';

/**
 * 小程序端工具模块单元测试：miniprogram/utils/util.js
 * 覆盖 parseTime / formatTime / formatTimeValue / toYmd / money / pad
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const util = require('../../miniprogram/utils/util.js');

const UTC_ISO = '2026-10-29T07:23:27.000Z';
const UTC_MS = Date.UTC(2026, 9, 29, 7, 23, 27);
const UTC_SEC = Math.floor(UTC_MS / 1000);

test('formatTime：固定本地时间格式化为 yyyy-MM-dd HH:mm', () => {
  assert.equal(util.formatTime(new Date(2026, 9, 29, 15, 23, 45)), '2026-10-29 15:23');
  assert.equal(util.formatTime(new Date(2026, 0, 5, 8, 7)), '2026-01-05 08:07');
  assert.equal(util.formatTime(new Date(2026, 11, 31, 23, 59)), '2026-12-31 23:59');
});

test('toYmd：输出 yyyyMMdd', () => {
  assert.equal(util.toYmd(new Date(2026, 9, 29, 15, 23)), '20261029');
  assert.equal(util.toYmd(new Date(2026, 0, 5)), '20260105');
});

test('pad：个位数补零', () => {
  assert.equal(util.pad(0), '00');
  assert.equal(util.pad(9), '09');
  assert.equal(util.pad(10), '10');
  assert.equal(util.pad(99), '99');
});

test('money：统一两位小数，非法值归零', () => {
  assert.equal(util.money(0), '0.00');
  assert.equal(util.money(28), '28.00');
  assert.equal(util.money('12.5'), '12.50');
  assert.equal(util.money(-2.5), '-2.50');
  assert.equal(util.money(null), '0.00');
  assert.equal(util.money(undefined), '0.00');
  assert.equal(util.money('abc'), '0.00');
  assert.equal(util.money(NaN), '0.00');
});

test('parseTime：空值统一返回 null', () => {
  assert.equal(util.parseTime(null), null);
  assert.equal(util.parseTime(undefined), null);
  assert.equal(util.parseTime(''), null);
  assert.equal(util.parseTime('   '), null);
});

test('parseTime：Date 实例（含非法 Date）', () => {
  const date = new Date(2026, 9, 29, 15, 23, 27);
  assert.equal(util.parseTime(date), date);
  assert.equal(util.parseTime(new Date('invalid')), null);
});

test('parseTime：毫秒 / 秒级时间戳（数字与纯数字字符串）', () => {
  assert.equal(util.parseTime(UTC_MS).toISOString(), UTC_ISO);
  assert.equal(util.parseTime(UTC_SEC).toISOString(), UTC_ISO);
  assert.equal(util.parseTime(String(UTC_MS)).toISOString(), UTC_ISO);
  assert.equal(util.parseTime(String(UTC_SEC)).toISOString(), UTC_ISO);
  assert.equal(util.parseTime(NaN), null);
  assert.equal(util.parseTime(Infinity), null);
});

test('parseTime：ISO 字符串（云函数序列化后的 UTC 时间）', () => {
  assert.equal(util.parseTime(UTC_ISO).toISOString(), UTC_ISO);
  assert.equal(util.parseTime('2026-10-29T07:23:27Z').toISOString(), UTC_ISO);
});

test('parseTime：iOS 不认的 "YYYY-MM-DD HH:mm:ss" 也能解析为本地时间', () => {
  const parsed = util.parseTime('2026-10-29 15:23:27');
  assert.ok(parsed instanceof Date, '应解析为 Date');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 9);
  assert.equal(parsed.getDate(), 29);
  assert.equal(parsed.getHours(), 15);
  assert.equal(parsed.getMinutes(), 23);
  assert.equal(parsed.getSeconds(), 27);
});

test('parseTime：微信云数据库 / 序列化对象形式', () => {
  assert.equal(util.parseTime({ $date: UTC_MS }).toISOString(), UTC_ISO);
  assert.equal(util.parseTime({ $date: UTC_ISO }).toISOString(), UTC_ISO);
  assert.equal(util.parseTime({ $numberLong: String(UTC_MS) }).toISOString(), UTC_ISO);
  assert.equal(util.parseTime({ seconds: UTC_SEC }).toISOString(), UTC_ISO);
  assert.equal(util.parseTime({ _seconds: UTC_SEC }).toISOString(), UTC_ISO);
  assert.equal(util.parseTime({ time: UTC_MS }).toISOString(), UTC_ISO);
  assert.equal(util.parseTime({ $date: { $numberLong: String(UTC_MS) } }).toISOString(), UTC_ISO);
  assert.equal(util.parseTime({}), null);
  assert.equal(util.parseTime([]), null);
});

test('parseTime：非法值返回 null', () => {
  assert.equal(util.parseTime('not-a-date'), null);
  assert.equal(util.parseTime('2026-13-45 99:99:99'), null);
  assert.equal(util.parseTime(true), null);
  assert.equal(util.parseTime({ $date: 'bad' }), null);
  assert.equal(util.parseTime({ $numberLong: 'abc' }), null);
});

test('formatTimeValue：解析成功返回格式化字符串，失败返回空串', () => {
  const local = new Date(2026, 9, 29, 15, 23, 27);
  assert.equal(util.formatTimeValue(local), '2026-10-29 15:23');
  assert.equal(util.formatTimeValue(UTC_ISO), util.formatTime(new Date(UTC_ISO)));
  assert.equal(util.formatTimeValue('bad'), '');
  assert.equal(util.formatTimeValue(null), '');
  assert.equal(util.formatTimeValue(undefined), '');
});
