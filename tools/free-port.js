/** 释放本地端口占用：node tools/free-port.js 8899 */
const { execSync } = require('child_process');
const port = process.argv[2] || '8899';
let out = '';
try {
  out = execSync('netstat -ano', { shell: 'cmd.exe' }).toString();
} catch (e) {
  console.log('netstat 执行失败：' + e.message);
  process.exit(0);
}
const pids = [
  ...new Set(
    out
      .split(/\r?\n/)
      .filter((l) => l.includes(':' + port) && l.toUpperCase().includes('LISTENING'))
      .map((l) => l.trim().split(/\s+/).pop())
      .filter((p) => /^\d+$/.test(p))
  ),
];
if (!pids.length) {
  console.log(`端口 ${port} 未被占用`);
} else {
  pids.forEach((p) => {
    try {
      execSync('taskkill /F /PID ' + p, { shell: 'cmd.exe', stdio: 'ignore' });
      console.log(`已结束占用 ${port} 的进程 PID ${p}`);
    } catch (e) {
      console.log(`结束 PID ${p} 失败：` + e.message);
    }
  });
}
