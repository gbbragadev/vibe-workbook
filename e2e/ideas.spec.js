const { test, expect } = require('@playwright/test');

test.describe('Ideas Feature', () => {
  test.beforeEach(async ({ page }) => {
    const fs = require('fs');
    const path = require('path');
    let pwd = 'vibe';
    try {
      const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../state/config.json'), 'utf8'));
      if(config.password) pwd = config.password;
    } catch(e) {}

    // Login
    await page.goto('/');
    await page.fill('#login-password', pwd);
    await page.click('#login-btn');
    await expect(page.locator('#app')).toBeVisible();
    
    // Navigate to Ideas
    await page.click('#btn-ideas');
    await expect(page.locator('#view-ideas')).toBeVisible();
    await expect(page.locator('#view-ideas')).toHaveClass(/active/);
  });

  test('should open Ideas and show correct overview', async ({ page }) => {
    await expect(page.locator('.ideas-header h2')).toHaveText('Ideas');
    await expect(page.locator('#btn-new-idea')).toBeVisible();
    await expect(page.locator('#btn-start-discovery')).toBeVisible();
  });

  test('should create a new idea manually', async ({ page }) => {
    await page.click('#btn-new-idea');
    await expect(page.locator('#dialog-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#dialog-title')).toHaveText('New Idea');
    
    const testTitle = `E2E Auto Idea ${Date.now()}`;
    await page.fill('#new-idea-title', testTitle);
    await page.fill('#new-idea-problem', 'We need automated tests for the vibe workspace.');
    
    // Click 'Create'
    await page.locator('#dialog-actions button:has-text("Create")').click();
    
    // Dialog should close
    await expect(page.locator('#dialog-overlay')).toHaveClass(/hidden/);
    
    // New idea should be in the list
    const ideaCard = page.locator(`.idea-card:has-text("${testTitle}")`).first();
    await expect(ideaCard).toBeVisible();
  });

  test('should open discovery dialog', async ({ page }) => {
    await page.click('#btn-start-discovery');
    await expect(page.locator('#dialog-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#dialog-title')).toHaveText('Start Discovery');
    
    // Fill query and start (Discovery runs in background, might take time depending on mock/real)
    // We just check if it dismisses and shows progress bar
    await page.fill('#discovery-query', 'test query');
    await page.locator('#dialog-actions button:has-text("Discover")').click();
    await expect(page.locator('#dialog-overlay')).toHaveClass(/hidden/);
    
    // Check if discovery bar is visible
    const discBar = page.locator('#ideas-discovery-bar');
    await expect(discBar).toBeVisible();
    await expect(discBar).not.toHaveClass(/hidden/);
  });

  test('should select an idea and check detail panel', async ({ page }) => {
    // Wait for ideas to load
    await page.waitForTimeout(1000); // give time for ideas to fetch
    const firstIdea = page.locator('.idea-card').first();
    
    // If there is at least one idea
    if (await firstIdea.isVisible()) {
      await firstIdea.click();
      await expect(firstIdea).toHaveClass(/active/);
      
      const detailHeader = page.locator('.idea-detail-header h2');
      await expect(detailHeader).toBeVisible();
      
      // Try to click "Start Review" if it is in new state
      const reviewBtn = page.locator('.idea-actions button:has-text("Start Review")');
      if (await reviewBtn.isVisible()) {
        await reviewBtn.click();
        await expect(page.locator('.status-badge.status-reviewing').first()).toBeVisible();
      }
      
      const approveBtn = page.locator('.idea-actions button:has-text("Approve")');
      if (await approveBtn.isVisible()) {
        await approveBtn.click();
        await expect(page.locator('.status-badge.status-approved').first()).toBeVisible();
      }
      
      const convertBtn = page.locator('.idea-actions button:has-text("Convert to Product")');
      if (await convertBtn.isVisible()) {
        await convertBtn.click();
        await expect(page.locator('#dialog-title')).toHaveText('Convert to Product');
        await page.locator('#dialog-actions button:has-text("Convert")').click();
        await expect(page.locator('#dialog-overlay')).toHaveClass(/hidden/);
      }
    }
  });
});
