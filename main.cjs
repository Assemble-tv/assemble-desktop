const { app, BrowserWindow, ipcMain, Menu, screen, shell, Notification, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const dotenv = require('dotenv');
const log = require('electron-log');
const fs = require('fs');
const Store = require('electron-store');
const { exec } = require('child_process');

// Force immediate logging to verify it's working
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
log.info('=== APPLICATION STARTING ===');
log.info('Time:', new Date().toISOString());
log.info('Platform:', process.platform);
log.info('Electron version:', process.versions.electron);
log.info('Node version:', process.version);

// Try to force a file write
try {
  const logPath = log.transports.file.getFile().path;
  log.info('Log file location:', logPath);
} catch (error) {
  console.error('Error getting log path:', error);
}

// Catch unhandled errors
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  log.error('Unhandled Rejection:', error);
});

dotenv.config();

let mainWindow = null;

// Initialize store
const store = new Store({
  defaults: {
    notificationsEnabled: false
  }
});

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

function playNotificationSound() {
  mainWindow.webContents.executeJavaScript(`console.log('[Sound Debug]: Starting playNotificationSound')`);
  
  try {
    // Use process.resourcesPath instead of __dirname
    const soundPath = path.join(process.resourcesPath, 'assets', 'sounds', 'notification.mp3');
    mainWindow.webContents.executeJavaScript(`console.log('[Sound Debug]: Sound path: ${soundPath}')`);
    
    if (fs.existsSync(soundPath)) {
      mainWindow.webContents.executeJavaScript(`console.log('[Sound Debug]: Sound file found')`);
      
      if (process.platform === 'darwin') {
        mainWindow.webContents.executeJavaScript(`console.log('[Sound Debug]: Attempting to play sound')`);
        
        exec(`afplay "${soundPath}"`, (error, stdout, stderr) => {
          if (error) {
            mainWindow.webContents.executeJavaScript(`console.log('[Sound Error]: ${error.message}')`);
          } else {
            mainWindow.webContents.executeJavaScript(`console.log('[Sound Debug]: Sound played successfully')`);
          }
        });
      }
    } else {
      mainWindow.webContents.executeJavaScript(`console.log('[Sound Error]: Sound file not found at ${soundPath}')`);
      // List contents to debug
      const assetsPath = path.join(process.resourcesPath, 'assets');
      if (fs.existsSync(assetsPath)) {
        const contents = fs.readdirSync(assetsPath);
        mainWindow.webContents.executeJavaScript(`console.log('[Sound Debug]: Assets contents: ${contents.join(", ")}')`);
      }
    }
  } catch (error) {
    mainWindow.webContents.executeJavaScript(`console.log('[Sound Error]: ${error.message}')`);
  }
}

// Check notification permission on macOS
async function checkNotificationPermission() {
  // If Notification is supported, assume we can use it
  // since the system will handle permission checks
  return Notification.isSupported();
}

// Request notification permission
async function requestNotificationPermission() {
  return Notification.isSupported();
}

async function forceNotificationRegistration() {
  if (process.platform === 'darwin') {
    try {
      // Create and show a test notification
      const testNotification = new Notification({
        title: 'Registration Test',
        body: 'Registering with notification system'
      });
      testNotification.show();
      return true;
    } catch (error) {
      console.error('Error forcing notification registration:', error);
      return false;
    }
  }
  return true;
}

// Create notification
async function createNotification(notificationData) {
  try {
    const { creatorName, message, url, icon, info, target, color, date, dateFormat } = notificationData;

    // Step 1: Check app's internal notification setting only
    const notificationsEnabled = store.get('notificationsEnabled');
    console.log('App notifications enabled:', notificationsEnabled);
    if (!notificationsEnabled) {
      console.log('Notifications are disabled in app settings');
      return { success: false, reason: 'app_disabled' };
    }

    // Create notification options
    const options = {
      title: `${creatorName} ${message}`,
      body: `${target}${info ? ` - ${info}` : ''}`,
      silent: true,
      timeoutType: 'default'
    };

    // Add icon if provided
    if (icon) {
      options.icon = icon;
    }

    // Create and show notification with sound
    const notification = new Notification(options);
    playNotificationSound();
    notification.show();

    // Setup click handler
    notification.on('click', () => {
      try {
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
          if (url) {
            mainWindow.loadURL(url);
          }
        }
      } catch (error) {
        console.error('Error handling notification click:', error);
      }
    });

    // Return success
    return { success: true, ...notificationData };
  } catch (error) {
    console.error('Error creating notification:', error);
    return { success: false, reason: 'error', error: error.message, stack: error.stack };
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
            await shell.openExternal('https://electronjs.org');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Configure logging
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';

// Catch unhandled errors
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  log.error('Unhandled Rejection:', error);
});

app.whenReady().then(async () => {
  try {
    log.info('App starting...');
    
    // Now screen module will be available
    await createWindow();
    log.info('Window created successfully');
    
    setupAutoUpdater(mainWindow);
    log.info('Auto updater setup complete');
    
    createMenu();
    log.info('Menu created');

    const lastVisitedUrl = store.get('lastVisitedUrl', 'https://app.assemble.tv');
    log.info('Last visited URL from store:', lastVisitedUrl);

    if (process.platform === 'darwin') {
      forceNotificationRegistration().then(result => {
        log.info('Initial notification registration result:', result);
      }).catch(error => {
        log.error('Error during notification registration:', error);
      });
    }
  } catch (error) {
    log.error('Fatal error during app startup:', error);
    app.quit();  // Added this to ensure app quits on fatal error
  }
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

ipcMain.handle('get-notification-permission', async () => {
  return await checkNotificationPermission();
});

ipcMain.handle('request-notification-permission', async () => {
  return await requestNotificationPermission();
});

ipcMain.handle('show-notification', async (event, { type, data }) => {
  return await createNotification(type, data);
});

ipcMain.handle('get-notifications-enabled', () => {
  const enabled = store.get('notificationsEnabled');
  console.log('Getting notifications enabled state:', enabled);
  return enabled;
});

ipcMain.handle('set-notifications-enabled', async (event, enabled) => {
  console.log('Setting notifications enabled:', enabled);
  
  if (enabled) {
    // If enabling notifications, check/request system permission
    const hasPermission = await checkNotificationPermission();
    if (!hasPermission) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        console.log('System permission not granted');
      }
    }
  }
  
  store.set('notificationsEnabled', enabled);
  return enabled;
});

ipcMain.handle('check-notification-status', async () => {
  try {
    const appEnabled = store.get('notificationsEnabled');
    const systemEnabled = await checkNotificationPermission();
    
    console.log('Notification status check:', {
      appEnabled,
      systemEnabled
    });
    
    return {
      appEnabled,
      systemEnabled,
      effectivelyEnabled: appEnabled && systemEnabled
    };
  } catch (error) {
    console.error('Error checking notification status:', error);
    return {
      appEnabled: false,
      systemEnabled: false,
      effectivelyEnabled: false,
      error: error.message
    };
  }
});

ipcMain.handle('test-notification', async (event, type) => {
  const testData = {
    'dummy': {
      creatorName: 'John Doe',
      message: 'created a new document',
      url: 'https://app.assemble.tv/documents/123',
      icon: path.join(__dirname, 'assets/icons/document.png'),
      info: 'Project X',
      target: 'Design Document',
      color: '#FF0000',
      date: new Date(),
      dateFormat: 'MM/DD/YYYY'
    }
  };

  if (testData[type]) {
    return await createNotification(testData[type]);
  }
  return false;
});

ipcMain.handle('test-notification-setting', () => {
  const storeData = store.store;
  console.log('Full store data:', storeData);
  const enabled = store.get('notificationsEnabled');
  console.log('Current notification setting:', enabled);
  return { enabled, storeData };
});

function getActionText(type) {
  switch (type) {
    case 'new-comment':
      return 'commented on';
    case 'mention':
      return 'mentioned you in';
    case 'reply':
      return 'replied to your comment on';
    case 'task-assigned':
      return 'assigned you to';
    default:
      return '';
  }
}

ipcMain.handle('force-notification-registration', async () => {
  return await forceNotificationRegistration();
});

ipcMain.on('debug-log', (event, message) => {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      console.log('[Debug]:', ${JSON.stringify(message)})
    `).catch(err => {
      console.error('Error logging to renderer:', err);
    });
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