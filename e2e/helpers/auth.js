const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

/**
 * Helper to perform login dynamically reading the local config.
 * @param {import('@playwright/test').Page} page
 */
export async function performLogin(page) {
  let pwd = 'vibe';
  try {
    // Navigate up to find the state directory
    const configPath = path.join(__dirname, '../../state/config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.password) pwd = config.password;
    }
  } catch (e) {
    console.warn('Could not read dynamic password from state/config.json', e);
  }

  await page.goto('/');
  await page.fill('input[data-testid="login-password"]', pwd);
  await page.click('button[data-testid="login-submit"]');
  
  // Verify login success
  await expect(page.locator('[data-testid="app-layout"]')).toBeVisible();
}
