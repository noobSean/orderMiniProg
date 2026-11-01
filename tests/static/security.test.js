'use strict';

/**
 * 静态校验 A3：安全扫描
 *  - 源码/配置/文档中不得出现明文管理口令、GitHub token、私钥、云厂商 AccessKey、AppSecret
 *  - 管理口令必须只从云函数环境变量 process.env.ADMIN_PWD 读取，不得硬编码
 *  - .gitignore 必须忽略 project.private.config.json / .cloudbase/ / node_modules/
 *  - 仓库不得包含私钥/证书类敏感文件
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const project = require('./lib/project.js');

// 口令字面量拼接构造：避免本测试文件自身被敏感信息扫描命中（tests/ 本身不参与发布）
const PLAINTEXT_ADMIN_PWD = '2080' + '31';

const SECRET_PATTERNS = [
  { name: '明文管理口令', re: new RegExp(PLAINTEXT_ADMIN_PWD) },
  { name: 'GitHub token (ghp_)', re: /ghp_[A-Za-z0-9]{20,}/ },
  { name: 'GitHub token (github_pat_)', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: '私钥内容（PRIVATE KEY）', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS AccessKey', re: /AKIA[0-9A-Z]{16}/ },
  { name: '微信 AppSecret 硬编码', re: /appsecret\s*[:=]\s*['"][0-9a-f]{32}['"]/i }
];

// 扫描范围：真正会发布/入库的源码、配置与文档（tests/ 下可能故意出现假密钥，故排除）
function scanFiles() {
  const files = [];
  for (const dir of ['miniprogram', 'cloudfunctions', 'database']) {
    files.push.apply(files, project.listFiles(dir));
  }
  const rootFiles = ['README.md', '.gitignore', 'project.config.json', 'project.private.config.json'];
  for (const name of rootFiles) {
    const abs = path.join(project.ROOT, name);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files.push(abs);
  }
  return files.filter(function (file) {
    return project.isTextFile(file);
  });
}

test('源码/配置/文档中不存在明文口令与密钥', () => {
  const files = scanFiles();
  assert.ok(files.length >= 60, '扫描文件数量异常（实际 ' + files.length + '）');
  const hits = [];
  for (const file of files) {
    const lines = project.readText(file).split(/\r?\n/);
    lines.forEach(function (line, index) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.re.test(line)) {
          hits.push(project.rel(file) + ':' + (index + 1) + ' [' + pattern.name + '] ' + line.trim().slice(0, 120));
        }
      }
    });
  }
  assert.deepEqual(hits, [], '发现疑似敏感信息：\n' + hits.join('\n'));
});

test('adminLogin 口令只从 process.env.ADMIN_PWD 读取，且无硬编码默认值', () => {
  const file = path.join(project.ROOT, 'cloudfunctions/adminLogin/index.js');
  const source = project.readText(file);
  assert.match(source, /process\.env\.ADMIN_PWD/, 'adminLogin 必须从 process.env.ADMIN_PWD 读取口令');
  const literalAssign = /(?:const|let|var)?\s*ADMIN_PWD\s*=\s*['"][^'"]+['"]/;
  assert.doesNotMatch(source, literalAssign, 'adminLogin 不得把管理口令硬编码为字符串字面量');
  assert.match(source, /crypto\.randomBytes\s*\(/, '会话 token 必须用 crypto.randomBytes 生成');
  assert.doesNotMatch(source, /Math\.random\s*\(/, '会话 token 不得使用 Math.random 生成');
  assert.match(source, /SESSION_TTL\s*=\s*12\s*\*\s*60\s*\*\s*60\s*\*\s*1000/, '管理会话有效期应为 12 小时');
});

test('小程序端（前端）不持有管理口令，也不硬编码管理凭据', () => {
  const files = project.listFiles('miniprogram').filter(function (file) {
    return file.endsWith('.js');
  });
  assert.ok(files.length >= 10, '小程序端 JS 数量异常');
  const failures = [];
  for (const file of files) {
    const source = project.readText(file);
    if (/ADMIN_PWD\s*=\s*['"][^'"]+['"]/.test(source)) failures.push(project.rel(file) + ' 硬编码 ADMIN_PWD');
    if (/\badminPwd\s*=/.test(source)) failures.push(project.rel(file) + ' 硬编码 adminPwd');
  }
  assert.deepEqual(failures, [], '小程序端存在硬编码管理口令：\n' + failures.join('\n'));
});

test('前端管理会话与云函数会话有效期配置一致（12 小时）', () => {
  const adminAuth = project.readText(path.join(project.ROOT, 'miniprogram/utils/adminAuth.js'));
  assert.match(adminAuth, /DEFAULT_TTL\s*=\s*12\s*\*\s*60\s*\*\s*60\s*\*\s*1000/, 'adminAuth 本地兜底 TTL 应为 12 小时');
  assert.match(adminAuth, /STORAGE_KEY\s*=\s*'dsh_admin_session'/, '管理会话应保存在 dsh_admin_session');
});

test('.gitignore 必须忽略 project.private.config.json、.cloudbase/、node_modules/', () => {
  const gitignorePath = path.join(project.ROOT, '.gitignore');
  assert.ok(fs.existsSync(gitignorePath), '缺少 .gitignore');
  const entries = project.readText(gitignorePath)
    .split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line && line.charAt(0) !== '#'; })
    .map(function (line) { return line.replace(/^\/+/, '').replace(/\/+$/, ''); });
  const required = ['node_modules', '.cloudbase', 'project.private.config.json'];
  for (const item of required) {
    assert.ok(
      entries.indexOf(item) >= 0,
      '.gitignore 缺少忽略项：' + item + '（当前条目：' + entries.join(', ') + '）'
    );
  }
});

test('仓库不包含私钥/证书/环境变量等敏感文件', () => {
  const forbidden = /^(?:\.env(?:\..*)?|id_rsa|id_dsa|id_ecdsa|id_ed25519|.*\.(?:pem|key|p12|pfx|jks|keystore))$/i;
  const allow = /\.env\.example$/i;
  const found = [];
  for (const file of project.walk(project.ROOT)) {
    const base = path.basename(file);
    if (project.rel(file).indexOf('tests/') === 0) continue;
    if (allow.test(base)) continue;
    if (forbidden.test(base)) found.push(project.rel(file));
  }
  assert.deepEqual(found, [], '发现敏感文件：\n' + found.join('\n'));
});

test('云函数 adminLogin 响应不泄露内部错误堆栈（仅返回 message）', () => {
  const source = project.readText(path.join(project.ROOT, 'cloudfunctions/adminLogin/index.js'));
  assert.match(source, /ok:\s*false/, 'adminLogin 失败时应返回 { ok: false }');
  assert.match(source, /NEED_ADMIN_LOGIN|ADMIN_PWD_NOT_CONFIGURED|PWD_WRONG/, 'adminLogin 应返回明确的错误码');
  assert.doesNotMatch(source, /stack\s*:/, '管理云函数不应向前端返回 stack');
});
