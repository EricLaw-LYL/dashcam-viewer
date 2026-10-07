import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 2200 } });
try {
 await page.goto('http://127.0.0.1:5174');
 await page.locator('input[webkitdirectory]').setInputFiles('/private/tmp/dashcam-fixtures');
 await expect(page.locator('video').first()).toHaveJSProperty('readyState', 4);
 await page.getByRole('button', {name:'Add range to export'}).click();
 await page.getByRole('button', {name:'Export Studio', exact:false}).click();
 await page.getByLabel('Range 1 out').fill('0.2');
 await page.getByLabel('Range 1 out').blur();
 await page.getByRole('group', {name:'Cabin export position'}).dragTo(page.getByRole('group', {name:'Rear export position'}));
 await expect(page.locator('.export-preview > div').first()).toHaveAttribute('aria-label','Cabin export position');
 await expect(page.locator('.output-resolution')).toContainText('1920 × 3240');
 await page.getByLabel('Include front audio').uncheck();
 await page.evaluate(() => window.showSaveFilePicker = undefined);
 const download = page.waitForEvent('download', {timeout:90000});
 await page.getByRole('button', {name:'Export video'}).click();
 await (await download).saveAs('/private/tmp/dashcam-stacked-test.mp4');
 await page.getByLabel('Include front audio').check();
 await page.getByRole('checkbox', {name:'Front', exact:true}).uncheck();
 await page.getByRole('checkbox', {name:'Cabin', exact:true}).uncheck();
 await expect(page.getByLabel('Include front audio')).toBeChecked();
 const withAudio = page.waitForEvent('download', {timeout:90000});
 await page.getByRole('button', {name:'Export video'}).click();
 await (await withAudio).saveAs('/private/tmp/dashcam-front-audio-test.mp4');
 console.log('PASS reordered muted export and rear-only video with front audio');
} finally { await browser.close(); }
