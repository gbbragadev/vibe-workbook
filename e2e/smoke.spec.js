const { test, expect } = require('@playwright/test');
const { performLogin } = require('./helpers/auth');

test.describe('Vibe Workbook Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await performLogin(page);
    await expect(page.locator('#view-products')).toBeVisible();
  });

  test('should navigate to products and see the list', async ({ page }) => {
    await expect(page.locator('[data-testid="nav-products"]')).toBeVisible();
    await page.click('[data-testid="nav-products"]');
    await expect(page.locator('#view-products')).toHaveClass(/active/);
    
    await expect(page.locator('.products-header h2')).toHaveText('Products');
  });

  test('should navigate to terminals view', async ({ page }) => {
    await page.click('[data-testid="nav-more"]');
    await expect(page.locator('[data-testid="nav-more-dropdown"]')).not.toHaveClass(/hidden/);
    
    await page.click('[data-testid="nav-terminals"]');
    await expect(page.locator('#view-terminals')).toHaveClass(/active/);
  });

  test('should navigate to history view', async ({ page }) => {
    await page.click('[data-testid="nav-more"]');
    await page.click('[data-testid="nav-history"]');
    await expect(page.locator('#view-history')).toHaveClass(/active/);
    await expect(page.locator('.history-header h2')).toHaveText('Session History');
  });

  test('should navigate to discover view', async ({ page }) => {
    await page.click('[data-testid="nav-more"]');
    await page.click('[data-testid="nav-discover"]');
    await expect(page.locator('#view-discover')).toHaveClass(/active/);
    await expect(page.locator('.discover-header h2')).toHaveText('Discovered Sessions');
  });
});
