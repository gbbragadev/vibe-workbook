const http = require('http');

const body = JSON.stringify({ password: '1233' });
const req = http.request({
  hostname: 'localhost',
  port: 3457,
  path: '/api/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const token = JSON.parse(data).token;
    http.get(`http://localhost:3457/api/products/e2e-test-id?token=${token}`, (res2) => {
      let data2 = '';
      res2.on('data', d => data2 += d);
      res2.on('end', () => {
        const prod = JSON.parse(data2);
        console.log(JSON.stringify(prod.readiness.signals, null, 2));
      });
    });
  });
});
req.write(body);
req.end();
