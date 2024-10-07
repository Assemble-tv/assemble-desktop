import { notarize } from '@electron/notarize';
import dotenv from 'dotenv';
import path from 'path';

// Manually load the .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default async function notarizing(context) {
  // Log environment variables for debugging
  console.log('APPLE_ID:', process.env.APPLE_ID);
  console.log('APPLE_TEAM_ID:', process.env.APPLE_TEAM_ID);
  console.log('APPLE_APP_SPECIFIC_PASSWORD:', process.env.APPLE_APP_SPECIFIC_PASSWORD ? 'Set' : 'Not set');

  const { electronPlatformName, appOutDir } = context;  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const { appBundleId } = context.packager.config.mac.notarize;

  console.log('Notarizing app...');
  console.log('App path:', appPath);
  console.log('App Bundle ID:', appBundleId);

  if (!appBundleId) {
    console.error('App Bundle ID is not defined in package.json');
    return;
  }

  if (!process.env.APPLE_TEAM_ID) {
    console.error('APPLE_TEAM_ID is not set in the environment variables');
    return;
  }

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appBundleId,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    });
    console.log('Notarization completed successfully');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
}