const { getProductService } = require('./src/core/product-service.js');
const ps = getProductService();
const detail = ps.getProductDetail('e2e-test-id', [], []);
console.log(JSON.stringify(detail.readiness, null, 2));
