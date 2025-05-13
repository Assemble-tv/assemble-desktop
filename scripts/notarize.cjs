require('dotenv').config();
const { notarize } = require('@electron/notarize');
const fs = require('fs');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization for non-macOS platform');
    return;
  }

  // Force read from .env file to ensure we have the latest values
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envConfig = require('dotenv').parse(fs.readFileSync(envPath));
      for (const k in envConfig) {
        process.env[k] = envConfig[k];
      }
      console.log('Successfully loaded .env file');
    }
  } catch (err) {
    console.error('Error loading .env file:', err);
  }

  // Make sure we have all the required environment variables
  if (!process.env.APPLE_ID || !process.env.APPLE_TEAM_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.error('❌ Missing required environment variables for notarization');
    console.error('Required: APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD');
    console.error('Current values:', {
      APPLE_ID: process.env.APPLE_ID ? 'set' : 'missing',
      APPLE_TEAM_ID: process.env.APPLE_TEAM_ID ? 'set' : 'missing',
      APPLE_APP_SPECIFIC_PASSWORD: process.env.APPLE_APP_SPECIFIC_PASSWORD ? 'set' : 'missing'
    });
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔐 Notarizing ${appPath} with:`, {
    appleId: process.env.APPLE_ID,
    teamId: process.env.APPLE_TEAM_ID,
    hasPassword: !!process.env.APPLE_APP_SPECIFIC_PASSWORD,
  });

  try {
    console.log('Starting notarization process...');
    await notarize({
      tool: 'notarytool',
      appPath,
      teamId: process.env.APPLE_TEAM_ID,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    });
    console.log('✅ Notarization completed successfully');
  } catch (error) {
    console.error('❌ Notarization failed:', error);
    throw error;
  }
};