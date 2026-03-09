const { test, expect } = require('@playwright/test');
const { performLogin } = require('./helpers/auth');

test.describe('Ideas Feature', () => {
  test.beforeEach(async ({ page }) => {
    await performLogin(page);
    
    // Navigate to Ideas
    await page.click('[data-testid="nav-ideas"]');
    await expect(page.locator('#view-ideas')).toBeVisible();
    await expect(page.locator('#view-ideas')).toHaveClass(/active/);
  });

  test('should open Ideas and show correct overview', async ({ page }) => {
    await expect(page.locator('[data-testid="ideas-heading"]')).toHaveText('Ideas');
    await expect(page.locator('[data-testid="action-new-idea"]')).toBeVisible();
    await expect(page.locator('[data-testid="action-start-discovery"]')).toBeVisible();
  });

  test('should create a new idea manually', async ({ page }) => {
    await page.click('[data-testid="action-new-idea"]');
    await expect(page.locator('[data-testid="dialog-overlay"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('[data-testid="dialog-title"]')).toHaveText('New Idea');
    
    const testTitle = `E2E Auto Idea ${Date.now()}`;
    await page.fill('#new-idea-title', testTitle);
    await page.fill('#new-idea-problem', 'We need automated tests for the vibe workspace.');
    
    // Click 'Create'
    await page.locator('[data-testid="dialog-actions"] button:has-text("Create")').click();
    
    // Dialog should close
    await expect(page.locator('[data-testid="dialog-overlay"]')).toHaveClass(/hidden/);
    
    // New idea should be in the list
    const ideaCard = page.locator(`[data-testid="idea-card"]:has-text("${testTitle}")`).first();
    await expect(ideaCard).toBeVisible();
  });

  test('should open discovery dialog', async ({ page }) => {
    await page.click('[data-testid="action-start-discovery"]');
    await expect(page.locator('[data-testid="dialog-overlay"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('[data-testid="dialog-title"]')).toHaveText('Start Discovery');
    
    await page.fill('#discovery-query', 'test query');
    await page.locator('[data-testid="dialog-actions"] button:has-text("Discover")').click();
    await expect(page.locator('[data-testid="dialog-overlay"]')).toHaveClass(/hidden/);
    
    // Check if discovery bar is visible
    const discBar = page.locator('[data-testid="discovery-progress-text"]');
    await expect(discBar).toBeVisible();
  });

  test('should select an idea and check detail panel', async ({ page }) => {
    // Wait for ideas to load
    await page.waitForTimeout(1000); 
    const firstIdea = page.locator('[data-testid="idea-card"]').first();
    
    if (await firstIdea.isVisible()) {
      await firstIdea.click();
      await expect(firstIdea).toHaveClass(/active/);
      
      const detailHeader = page.locator('.idea-detail-header h2');
      await expect(detailHeader).toBeVisible();
      
      const reviewBtn = page.locator('[data-testid="action-reviewing"]');
      if (await reviewBtn.isVisible()) {
        await reviewBtn.click();
        await expect(page.locator('[data-testid="status-badge-reviewing"]').first()).toBeVisible();
      }
      
      const approveBtn = page.locator('[data-testid="action-approved"]');
      if (await approveBtn.isVisible()) {
        await approveBtn.click();
        await expect(page.locator('[data-testid="status-badge-approved"]').first()).toBeVisible();
      }
      
      const convertBtn = page.locator('[data-testid="action-convert"]');
      if (await convertBtn.isVisible()) {
        await convertBtn.click();
        await expect(page.locator('[data-testid="dialog-title"]')).toHaveText('Convert to Product');
        await page.locator('[data-testid="dialog-actions"] button:has-text("Convert")').click();
        await expect(page.locator('[data-testid="dialog-overlay"]')).toHaveClass(/hidden/);
      }
    }
  });
});
