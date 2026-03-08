const { getProductService } = require('./src/core/product-service.js');
const ps = getProductService();
const products = ps.getProducts();
const e2e = products.find(p => p.name === 'E2E Test Product');
console.log(JSON.stringify(e2e.readiness, null, 2));
