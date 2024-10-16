import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import log from 'electron-log';
import fs from 'fs';
import Store from 'electron-store';

dotenv.config();

let mainWindow = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize store
const store = new Store();


function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Set default window size to 80% of the screen size
  const defaultWidth = Math.floor(width * 0.8);
  const defaultHeight = Math.floor(height * 0.8);

  // Calculate default position (centered)
  const defaultX = Math.floor((width - defaultWidth) / 2);
  const defaultY = Math.floor((height - defaultHeight) / 2);

  // Load the previous state with fallback to new defaults
  let { bounds } = store.get('windowState', { 
    bounds: { 
      width: defaultWidth, 
      height: defaultHeight,
      x: defaultX,
      y: defaultY
    }
  });

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    title: '',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // Ensure the window is within the screen bounds
  const { x, y } = ensureWindowWithinBounds(bounds);
  if (x !== bounds.x || y !== bounds.y) {
    mainWindow.setPosition(x, y);
  }

  // Add this new event listener for opening links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open all URLs in the user's default browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load last visited URL or default to home page
  const lastVisitedUrl = store.get('lastVisitedUrl', 'https://app.assemble.tv');
  mainWindow.loadURL(lastVisitedUrl);

  // Listen for URL changes
  mainWindow.webContents.on('did-navigate', (event, url) => {
    console.log('Navigation occurred:', url);
    if (!isErrorPage(url)) {
      store.set('lastVisitedUrl', url);
    }
  });

  mainWindow.webContents.on('did-navigate-in-page', (event, url) => {
    console.log('In-page navigation occurred:', url);
    if (!isErrorPage(url)) {
      store.set('lastVisitedUrl', url);
    }
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // Handle error loading page
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.log(`Failed to load: ${validatedURL}`);
    console.log(`Error: ${errorDescription}`);
    const homeUrl = 'https://app.assemble.tv';
    mainWindow.loadURL(homeUrl);
    store.set('lastVisitedUrl', homeUrl);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const currentUrl = mainWindow.webContents.getURL();
    console.log('Finished loading:', currentUrl);
    if (!isErrorPage(currentUrl)) {
      store.set('lastVisitedUrl', currentUrl);
      console.log('Saved URL after successful load:', currentUrl);
    }
  });

  // Save window size and position when closing the window
  mainWindow.on('close', () => {
    if (!mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      store.set('windowState', {
        bounds: mainWindow.getBounds()
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  injectUpdateBanner(mainWindow);
  return mainWindow;
}

// Helper function to ensure window is within screen bounds
function ensureWindowWithinBounds(bounds) {
  const { width: maxWidth, height: maxHeight } = screen.getPrimaryDisplay().workAreaSize;
  const x = bounds.x < 0 ? 0 : (bounds.x + bounds.width > maxWidth ? maxWidth - bounds.width : bounds.x);
  const y = bounds.y < 0 ? 0 : (bounds.y + bounds.height > maxHeight ? maxHeight - bounds.height : bounds.y);
  return { x, y };
}

function isErrorPage(url) {
  return url.includes('/error') || url.includes('/404') || url === 'about:blank';
}

function handleInvalidSavedUrl() {
  console.log('Saved URL is invalid. Redirecting to home page.');
  const homeUrl = 'https://app.assemble.tv';
  mainWindow.loadURL(homeUrl);
  store.set('lastVisitedUrl', homeUrl);
}

function injectUpdateBanner(win) {
  try {
    const bannerHTML = fs.readFileSync(path.join(__dirname, 'updateBanner.html'), 'utf8');
    win.webContents.executeJavaScript(`
      const div = document.createElement('div');
      div.innerHTML = ${JSON.stringify(bannerHTML)};
      document.body.appendChild(div);
    `);

    const bannerJS = fs.readFileSync(path.join(__dirname, 'updateBanner.js'), 'utf8');
    win.webContents.executeJavaScript(bannerJS);
  } catch (error) {
    console.error('Error injecting update banner:', error);
  }
}

function setupAutoUpdater(win) {
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = "debug";
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-available', info);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    win.webContents.send('download-progress', progressObj);
  });

  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-downloaded');
  });

  autoUpdater.on('error', (error) => {
    win.webContents.send('update-error', error.message);
  });

  // Check for updates every 30 seconds
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 30 * 1000);
}

function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Speech',
          submenu: [
            { role: 'startSpeaking' },
            { role: 'stopSpeaking' }
          ]
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://electronjs.org');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater(mainWindow);
  createMenu();

  console.log('Last visited URL from store:', store.get('lastVisitedUrl', 'https://app.assemble.tv'));
});

ipcMain.on('update-last-visited-url', (event, url) => {
  console.log('Updating last visited URL:', url);
  store.set('lastVisitedUrl', url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.on('start-download', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}