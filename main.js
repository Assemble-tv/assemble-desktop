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

function isGoogleAuthPage(url) {
  console.log('Checking URL:', url);  // Debug log
  const isGoogle = url.includes('accounts.google.com') || 
                  url.includes('google.com/signin') || 
                  url.includes('google.com/oauth');
  console.log('Is Google URL:', isGoogle);  // Debug log
  return isGoogle;
}

function isErrorPage(url) {
  return url.includes('/error') || 
         url.includes('/404') || 
         url === 'about:blank' || 
         isGoogleAuthPage(url);  // Treat Google auth pages like error pages for last visited URL
}

function ensureWindowWithinBounds(bounds) {
  const { width: maxWidth, height: maxHeight } = screen.getPrimaryDisplay().workAreaSize;
  const x = bounds.x < 0 ? 0 : (bounds.x + bounds.width > maxWidth ? maxWidth - bounds.width : bounds.x);
  const y = bounds.y < 0 ? 0 : (bounds.y + bounds.height > maxHeight ? maxHeight - bounds.height : bounds.y);
  return { x, y };
}

async function clearGoogleAuth() {
  const session = mainWindow.webContents.session;
  
  // Clear cookies
  const cookies = await session.cookies.get({ domain: '.google.com' });
  for (const cookie of cookies) {
      await session.cookies.remove(cookie.domain, cookie.name);
  }
  
  // Clear storage data for Google domains
  await session.clearStorageData({
      origin: 'https://accounts.google.com',
      storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'serviceworkers']
  });
}

function injectNavigationButton(win, shouldShow = false) {
  try {
      console.log('Injecting navigation button with shouldShow:', shouldShow);
      win.webContents.executeJavaScript(`
          // Create and inject Inter font
          if (!document.getElementById('inter-font')) {
              const fontLink = document.createElement('link');
              fontLink.id = 'inter-font';
              fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
              fontLink.rel = 'stylesheet';
              document.head.appendChild(fontLink);
          }

          // Remove existing button if it exists
          const existingNav = document.getElementById('navigation-button');
          if (existingNav) {
              existingNav.remove();
          }

          // Create container for button and tooltip
          const container = document.createElement('div');
          container.id = 'navigation-button';
          container.style.position = 'fixed';
          container.style.top = '20px';
          container.style.left = '20px';
          container.style.zIndex = '2147483647';
          container.style.display = ${shouldShow ? "'block'" : "'none'"};

          // Create button
          const button = document.createElement('button');
          button.textContent = '←';
          button.style.background = 'transparent';    // Changed from 'white' to 'transparent'
          button.style.color = 'black';
          button.style.border = 'none';
          button.style.padding = '4px 8px';
          button.style.borderRadius = '2px';
          button.style.cursor = 'pointer';
          button.style.fontSize = '24px';
          button.style.fontWeight = '200';
          button.style.fontFamily = '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto';
          button.style.boxShadow = 'none';
          button.style.transition = 'background-color 0.2s ease-in-out';

          // Create tooltip elements
          const tooltip = document.createElement('div');
          tooltip.style.display = 'none';
          tooltip.style.position = 'absolute';
          tooltip.style.left = 'calc(100% + 8px)';
          tooltip.style.top = 'calc(50% + 0px)';
          tooltip.style.transform = 'translateY(-50%)';
          tooltip.style.whiteSpace = 'nowrap';
          tooltip.style.fontFamily = 'Inter, sans-serif';

          const tooltipArrow = document.createElement('div');
          tooltipArrow.style.position = 'absolute';
          tooltipArrow.style.left = '-4px';
          tooltipArrow.style.top = '50%';
          tooltipArrow.style.transform = 'translateY(-50%)';
          tooltipArrow.style.width = '0';
          tooltipArrow.style.height = '0';
          tooltipArrow.style.borderTop = '4px solid transparent';
          tooltipArrow.style.borderRight = '4px solid black';
          tooltipArrow.style.borderBottom = '4px solid transparent';

          const tooltipText = document.createElement('div');
          tooltipText.textContent = 'Back to Assemble';
          tooltipText.style.background = 'black';
          tooltipText.style.color = 'white';
          tooltipText.style.padding = '3px 8px';
          tooltipText.style.borderRadius = '4px';
          tooltipText.style.fontSize = '12px';
          tooltipText.style.fontWeight = '300';

          tooltip.appendChild(tooltipArrow);
          tooltip.appendChild(tooltipText);

          // Add hover events
          button.addEventListener('mouseover', () => {
              button.style.backgroundColor = '#F4F3F4';
              tooltip.style.display = 'block';
          });

          button.addEventListener('mouseout', () => {
              button.style.backgroundColor = 'transparent';  // Changed from 'white' to 'transparent'
              tooltip.style.display = 'none';
          });

          button.addEventListener('click', () => {
              window.location.href = 'https://app.assemble.tv/#/login';
          });

          // Assemble the elements
          container.appendChild(button);
          container.appendChild(tooltip);
          document.body.appendChild(container);
      `);
      
      console.log('Navigation button injection complete');
  } catch (error) {
      console.error('Error injecting navigation button:', error);
  }
}

function injectUI(win) {
  try {
      // Inject update banner
      const bannerHTML = fs.readFileSync(path.join(__dirname, 'updateBanner.html'), 'utf8');
      win.webContents.executeJavaScript(`
          const updateDiv = document.createElement('div');
          updateDiv.innerHTML = ${JSON.stringify(bannerHTML)};
          document.body.appendChild(updateDiv);
          console.log('Update banner injected');
      `);
      const bannerJS = fs.readFileSync(path.join(__dirname, 'updateBanner.js'), 'utf8');
      win.webContents.executeJavaScript(bannerJS);

      // Initial navigation button injection - hidden by default
      injectNavigationButton(win, false);
  } catch (error) {
      console.error('Error injecting UI elements:', error);
  }
}

async function createWindow() {
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load last visited URL or default to home page
  const lastVisitedUrl = store.get('lastVisitedUrl', 'https://app.assemble.tv');
  mainWindow.loadURL(lastVisitedUrl);

  // Clear Google cookies on startup
  await clearGoogleAuth();

  // Navigation Event Handlers
  mainWindow.webContents.on('did-navigate', async (event, url) => {  // Added async here
    console.log('Navigation occurred:', url);
    const isGoogleUrl = isGoogleAuthPage(url);
    
    // Check if this is a logout (navigation to login page)
    if (url.includes('app.assemble.tv/#/login')) {
        console.log('Detected logout, clearing Google cookies...');
        await clearGoogleAuth();
    }
    
    if (isGoogleUrl) {
        console.log('On Google page, injecting navigation...');
        injectNavigationButton(mainWindow, true);
    } else {
        console.log('Not on Google page, removing navigation...');
        mainWindow.webContents.executeJavaScript(`
            const nav = document.getElementById('navigation-button');
            if (nav) nav.remove();
        `);
    }

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

  // Window Event Handlers
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

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

  injectUI(mainWindow);
  return mainWindow;
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

// App Event Handlers
app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater(mainWindow);
  createMenu();

  console.log('Last visited URL from store:', store.get('lastVisitedUrl', 'https://app.assemble.tv'));
});

// IPC Event Handlers
ipcMain.on('nav-back', () => {
  if (mainWindow.webContents.canGoBack()) {
    mainWindow.webContents.goBack();
  } else {
    mainWindow.loadURL('https://app.assemble.tv');
  }
});

ipcMain.on('update-last-visited-url', (event, url) => {
  console.log('Updating last visited URL:', url);
  store.set('lastVisitedUrl', url);
});

ipcMain.on('start-download', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

// App lifecycle handlers
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

// Single instance lock
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