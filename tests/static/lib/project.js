'use strict';

// 项目根目录与文件遍历工具（静态测试共用）
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..'); // tests/static/lib -> 项目根
const SKIP_DIRS = new Set(['.git', 'node_modules', 'miniprogram_npm', '.cloudbase']);
const TEXT_EXT = new Set(['.js', '.json', '.wxml', '.wxss', '.md', '.jsonl', '.txt', '.yml', '.yaml']);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push.apply(out, walk(abs));
    } else {
      out.push(abs);
    }
  }
  return out;
}

function rel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function readText(abs) {
  return fs.readFileSync(abs, 'utf8');
}

function isTextFile(abs) {
  const base = path.basename(abs);
  if (base === '.gitignore' || base === '.env.example') return true;
  return TEXT_EXT.has(path.extname(abs).toLowerCase());
}

function listFiles(subdir) {
  return walk(path.join(ROOT, subdir));
}

function dirSize(dir) {
  let total = 0;
  let fileCount = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) {
        total += fs.statSync(abs).size;
        fileCount++;
      }
    }
  }
  return { bytes: total, fileCount: fileCount };
}

function readJson(abs) {
  return JSON.parse(readText(abs));
}

module.exports = {
  ROOT: ROOT,
  SKIP_DIRS: SKIP_DIRS,
  walk: walk,
  rel: rel,
  readText: readText,
  readJson: readJson,
  isTextFile: isTextFile,
  listFiles: listFiles,
  dirSize: dirSize,
  path: path
};
