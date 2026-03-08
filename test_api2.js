const { getProductService } = require('./src/core/product-service.js');
const { getStore } = require('./src/state/store.js');
const store = getStore();
const ps = getProductService();
const detail = ps.getProductDetail('e2e-test-id', store.getWorkspaces(), store.getSessions());
console.log(JSON.stringify(detail.readiness, null, 2));
