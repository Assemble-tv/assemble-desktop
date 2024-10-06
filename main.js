import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import dotenv from 'dotenv';
import log from 'electron-log';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // Load your website URL here
  win.loadURL('https://app.assemble.tv');

  // Uncomment the line below if you want to open DevTools by default
  // win.webContents.openDevTools();

  return win;
}

function setupAutoUpdater(win) {
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = "info";
  autoUpdater.autoDownload = false;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Checking for Updates',
      message: 'Checking for updates, please wait...',
      buttons: ['OK']
    });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available. Would you like to download it now?`,
      buttons: ['Yes', 'No']
    }).then((result) => {
      if (result.response === 0) { // 'Yes' button
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'No Updates',
      message: 'You are running the latest version.',
      buttons: ['OK']
    });
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error:', error);
    dialog.showErrorBox('Error', `An error occurred while checking for updates: ${error.message}`);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = `Download speed: ${progressObj.bytesPerSecond}`;
    log_message = `${log_message} - Downloaded ${progressObj.percent}%`;
    log_message = `${log_message} (${progressObj.transferred}/${progressObj.total})`;
    log.info(log_message);
    win.webContents.send('download-progress', progressObj.percent);
  });

  autoUpdater.on('update-downloaded', () => {
    log.info('Update downloaded');
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded. The application will quit and restart to install the update.',
      buttons: ['Restart Now', 'Later']
    }).then((result) => {
      if (result.response === 0) { // 'Restart Now' button
        autoUpdater.quitAndInstall();
      }
    });
  });
}

function createMenu(win) {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => {
            log.info('Manually checking for updates...');
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'Checking for Updates',
              message: 'Checking for updates, please wait...',
              buttons: ['OK']
            });
            autoUpdater.checkForUpdates().catch(err => {
              log.error('Error checking for updates:', err);
              dialog.showErrorBox('Error', `An error occurred while checking for updates: ${err.message}`);
            });
          }
        },
        // ... other menu items ...
      ]
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  const mainWindow = createWindow();
  setupAutoUpdater(mainWindow);
  createMenu(mainWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.on('check-for-updates', () => {
  log.info('Manually checking for updates...');
  autoUpdater.checkForUpdates().catch(err => {
    log.error('Error checking for updates:', err);
  });
});

ipcMain.on('download-update', () => {
  log.info('Starting update download...');
  autoUpdater.downloadUpdate().catch(err => {
    log.error('Error downloading update:', err);
  });
});

ipcMain.on('install-update', () => {
  log.info('Installing update...');
  autoUpdater.quitAndInstall();
});
