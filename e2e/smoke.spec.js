const { test, expect } = require('@playwright/test');

test.describe('Vibe Workbook Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    const fs = require('fs');
    const path = require('path');
    let pwd = 'vibe';
    try {
      const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../state/config.json'), 'utf8'));
      if(config.password) pwd = config.password;
    } catch(e) {}
    
    await page.goto('/');
    // Login
    await page.fill('#login-password', pwd);
    await page.click('#login-btn');
    // Wait for app to be visible
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#view-products')).toBeVisible();
  });

  test('should navigate to products and see the list', async ({ page }) => {
    await expect(page.locator('#btn-products')).toBeVisible();
    // Click on products (even though it's default)
    await page.click('#btn-products');
    await expect(page.locator('#view-products')).toHaveClass(/active/);
    
    // Check elements
    await expect(page.locator('.products-header h2')).toHaveText('Products');
    await expect(page.locator('#btn-new-product')).toBeVisible();
  });

  test('should navigate to terminals view', async ({ page }) => {
    // Open the dropdown first
    await page.click('#btn-more');
    await expect(page.locator('#nav-more-dropdown')).not.toHaveClass(/hidden/);
    
    // Click terminals
    await page.click('#btn-terminals');
    await expect(page.locator('#view-terminals')).toHaveClass(/active/);
    await expect(page.locator('#btn-new-session')).toBeVisible();
  });

  test('should navigate to history view', async ({ page }) => {
    await page.click('#btn-more');
    await page.click('#btn-history');
    await expect(page.locator('#view-history')).toHaveClass(/active/);
    await expect(page.locator('.history-header h2')).toHaveText('Session History');
  });

  test('should navigate to discover view', async ({ page }) => {
    await page.click('#btn-more');
    await page.click('#btn-discover');
    await expect(page.locator('#view-discover')).toHaveClass(/active/);
    await expect(page.locator('.discover-header h2')).toHaveText('Discovered Sessions');
  });
});
