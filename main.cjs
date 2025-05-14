const { app, BrowserWindow, ipcMain, Menu, screen, shell, Notification, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const dotenv = require('dotenv');
const log = require('electron-log');
const fs = require('fs');
const Store = require('electron-store');
const { exec } = require('child_process');
const { clipboard, MenuItem } = require('electron');
const config = require('./config.js');
const admin = require('firebase-admin');

const LOCAL_URL = 'http://assemble-local.com:3001';
const DEV_URL = 'https://assemble-ci.herokuapp.com';
const PROD_URL = 'https://app.assemble.tv';

const getBaseUrl = () => {
  switch (process.env.NODE_ENV) {
    case 'local':
      return LOCAL_URL;
    case 'development':
      return DEV_URL;
    default:
      return PROD_URL;
  }
};

const API_URL = `${getBaseUrl()}/api`;

const NotificationQueue = {
queue: [],
isProcessing: false,
delay: 250, // Delay between notifications in ms

add(notificationData) {
  this.queue.push(notificationData);
  if (!this.isProcessing) {
    this.processQueue();
  }
},

async processQueue() {
  if (this.queue.length === 0) {
    this.isProcessing = false;
    return;
  }

  this.isProcessing = true;
  const notificationData = this.queue.shift();

  try {
    const result = await createNotification(notificationData);
    console.log('Notification processed:', result);
  } catch (error) {
    console.error('Error processing notification:', error);
  }

  // Wait before processing next notification
  setTimeout(() => {
    this.processQueue();
  }, this.delay);
}
};

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

let mainWindow = null;

// Initialize Firebase Admin
let firebaseInitialized = false;
if (!admin.apps.length) {
  try {
    // Check if firebase config is valid before initializing
    if (config.firebase && typeof config.firebase === 'object' && config.firebase.project_id) {
      admin.initializeApp({
        credential: admin.credential.cert(config.firebase)
      });
      firebaseInitialized = true;
      log.info('Firebase Admin initialized successfully with project:', config.firebase.project_id);
    } else {
      log.warn('Firebase config is missing or invalid. Skipping Firebase initialization.');
    }
  } catch (error) {
    log.error('Firebase Admin initialization error:', error);
  }
}

// Only log project ID if Firebase was successfully initialized
if (firebaseInitialized) {
  try {
    console.log('Firebase Admin initialized with project:', admin.app().options.projectId);
  } catch (error) {
    log.error('Error accessing Firebase project ID:', error);
  }
}

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

function injectNotificationListener(win) {
  win.webContents.executeJavaScript(`
    let lastCount = 0;
    let currentUserId = null;
    
    fetch('/api/me')
      .then(response => response.json())
      .then(data => {
        currentUserId = data?.user?.id;
        console.log('[Debug] User:', currentUserId);
      });

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const clone = response.clone();
      
      try {
        if (args[0].includes('/notifications')) {
          const data = await clone.json();
          if (data.count > lastCount) {
            console.log('[Debug] New notifications detected:', {
              previous: lastCount,
              current: data.count,
              latest: data.notifications[0]
            });
            lastCount = data.count;
          }
        }
      } catch (error) {
        console.error('[Debug] Error:', error);
      }
      return response;
    };
  `);
}

function injectUI(win) {
  try {
    const bannerHTML = fs.readFileSync(path.join(__dirname, 'updateBanner.html'), 'utf8');
    win.webContents.executeJavaScript(`
        const updateDiv = document.createElement('div');
        updateDiv.innerHTML = ${JSON.stringify(bannerHTML)};
        document.body.appendChild(updateDiv);
        console.log('Update banner injected');
    `);
    
    // Single auth token check
    win.webContents.executeJavaScript(`
      function checkAuthToken() {
        const token = localStorage.getItem('token');
        console.log('Found token:', token ? 'exists' : 'missing');
        if (token && window.electronAPI) {
          window.electronAPI.setAuthToken(token)
            .then(() => {
              console.log('Auth token stored successfully');
              return window.electronAPI.registerFCM(token);
            })
            .then(result => console.log('FCM Registration:', result))
            .catch(err => console.error('Token/FCM Error:', err));
        }
      }
      // Check immediately and after page loads
      checkAuthToken();
      document.addEventListener('DOMContentLoaded', checkAuthToken);
    `);

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
  console.log('Checking notification permission');
  return Notification.isSupported();
}

// Request notification permission
async function requestNotificationPermission() {
  return Notification.isSupported();
}

// Create notification
async function createNotification(notificationData) {
  try {
    // Check if app-level notifications are enabled
    const notificationsEnabled = store.get('notificationsEnabled');
    if (!notificationsEnabled) {
      return { success: false, reason: 'disabled' };
    }

    // Create notification options
    const { creatorName, message, url, icon, info, target, date } = notificationData;
    const options = {
      title: `${creatorName} ${message}`,
      body: `${target}${info ? ` - ${info}` : ''}`,
      silent: true,
      timeoutType: 'default'
    };

    if (icon) {
      options.icon = icon;
    }

    return new Promise((resolve, reject) => {
      try {
        // Create notification
        const notification = new Notification(options);
        
        // Play sound
        playNotificationSound();
        
        // Show notification
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

        // Handle close event to know when notification is finished
        notification.on('close', () => {
          resolve({ success: true, ...notificationData });
        });

        // Handle show event for logging
        notification.on('show', () => {
          console.log('Notification shown:', notificationData.title);
        });

        // Fallback resolve in case close event doesn't fire
        setTimeout(() => {
          resolve({ success: true, ...notificationData });
        }, 5000);

      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    return { success: false, reason: 'error', error: error.message, stack: error.stack };
  }
}

async function createWindow() {
  log.info('Creating window...');
  // Define bounds with default values
  let bounds = {
    width: 1024,
    height: 768,
    x: 0,
    y: 0
  };
  
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    log.info(`Primary display size: ${width}x${height}`);
   
    const defaultWidth = Math.floor(width * 0.8);
    const defaultHeight = Math.floor(height * 0.8);
    const defaultX = Math.floor((width - defaultWidth) / 2);
    const defaultY = Math.floor((height - defaultHeight) / 2);
    log.info(`Default window bounds: ${defaultWidth}x${defaultHeight} at ${defaultX},${defaultY}`);
   
    // Get stored bounds or use defaults
    const windowState = store.get('windowState', { 
      bounds: { 
        width: defaultWidth, 
        height: defaultHeight,
        x: defaultX,
        y: defaultY
      }
    });
    
    bounds = windowState.bounds;
    log.info(`Stored window bounds: ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}`);
  } catch (error) {
    log.error('Error getting display info:', error);
    // We'll use the default bounds already defined
    log.info('Using fallback window bounds');
  }
 
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    title: '',
    show: false, // Start hidden and show when ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      spellcheck: true
    }
  });
  
  log.info('BrowserWindow created');
 
  const { x, y } = ensureWindowWithinBounds(bounds);
  if (x !== bounds.x || y !== bounds.y) {
    mainWindow.setPosition(x, y);
  }
 
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menuTemplate = [];
  
    if (params.dictionarySuggestions?.length > 0 && params.isEditable) {
      params.dictionarySuggestions.forEach(suggestion => {
        menuTemplate.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion)
        });
      });
      menuTemplate.push({ type: 'separator' });
    }
  
    menuTemplate.push(
      {
        label: 'Back',
        enabled: mainWindow.webContents.canGoBack(),
        click: () => mainWindow.webContents.goBack()
      },
      {
        label: 'Forward',
        enabled: mainWindow.webContents.canGoForward(),
        click: () => mainWindow.webContents.goForward()
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { role: 'toggleSpellChecker' }
    );
  
    if (params.linkURL) {
      menuTemplate.push({ type: 'separator' });
      menuTemplate.push({
        label: 'Open Link in Browser',
        click: () => shell.openExternal(params.linkURL)
      });
      menuTemplate.push({
        label: 'Copy Link',
        click: () => clipboard.writeText(params.linkURL)
      });
    }
  
    const menu = Menu.buildFromTemplate(menuTemplate);
    menu.popup();
  });
  
  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);
 
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
 
  // Check the build type by examining app version and name
  const appVersion = app.getVersion();
  const appName = app.getName();
  
  // Detect environment based on multiple indicators
  const isLocalBuild = appVersion.includes('local') || 
                      process.env.NODE_ENV === 'local' || 
                      appName.includes('Local');
                      
  const isDevelopmentBuild = appVersion.includes('dev') || 
                            process.env.NODE_ENV === 'development' || 
                            appName.includes('CI');
  
  // Force environment mode if needed
  if (isLocalBuild && process.env.NODE_ENV !== 'local') {
    process.env.NODE_ENV = 'local';
    log.info('Forced NODE_ENV to local based on app version/name');
  } else if (isDevelopmentBuild && process.env.NODE_ENV !== 'development') {
    process.env.NODE_ENV = 'development';
    log.info('Forced NODE_ENV to development based on app version/name');
  }
  
  // Determine which URL to use based on environment
  let baseUrl;
  if (isLocalBuild) {
    baseUrl = LOCAL_URL;
  } else if (isDevelopmentBuild) {
    baseUrl = DEV_URL;
  } else {
    baseUrl = PROD_URL;
  }
  
  log.info(`Using base URL: ${baseUrl}`);
  log.info(`Current NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  log.info(`App version: ${appVersion}, appName: ${appName}`);
  log.info(`isLocalBuild: ${isLocalBuild}, isDevelopmentBuild: ${isDevelopmentBuild}`);
  log.info(`LOCAL_URL: ${LOCAL_URL}, DEV_URL: ${DEV_URL}, PROD_URL: ${PROD_URL}`);
  
  // Load the main URL directly instead of last visited
  mainWindow.loadURL(baseUrl);
  log.info(`Loading main URL: ${baseUrl}`);
  
  // We'll restore the last visited URL after the window is shown and ready, but only if it's for the same environment
  mainWindow.webContents.once('did-finish-load', () => {
    // Now try to load the last visited URL if it exists and differs from the base URL
    try {
      const lastVisitedUrl = store.get('lastVisitedUrl');
      
      // Only restore URLs that match the current environment
      const shouldRestoreUrl = lastVisitedUrl && 
                              lastVisitedUrl.startsWith('http') && 
                              lastVisitedUrl !== baseUrl &&
                              (
                                (isLocalBuild && lastVisitedUrl.includes(LOCAL_URL)) ||
                                (isDevelopmentBuild && lastVisitedUrl.includes(DEV_URL)) ||
                                (!isLocalBuild && !isDevelopmentBuild && lastVisitedUrl.includes(PROD_URL))
                              );
      
      if (shouldRestoreUrl) {
        log.info(`Restoring last visited URL for current environment: ${lastVisitedUrl}`);
        mainWindow.loadURL(lastVisitedUrl);
      } else if (lastVisitedUrl) {
        log.info(`Not restoring last visited URL ${lastVisitedUrl} because it doesn't match current environment`);
        // Store a new environment-specific last visited URL
        store.set('lastVisitedUrl', baseUrl);
      }
    } catch (error) {
      log.error('Error restoring last visited URL:', error);
      // Continue with the base URL that's already loaded
    }
  });
 
  await clearGoogleAuth();
 
  mainWindow.webContents.on('did-navigate', async (event, url) => {
    console.log('Navigation occurred:', url);
    const isGoogleUrl = isGoogleAuthPage(url);
    
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
    log.info(`Failed to load: ${validatedURL}`);
    log.info(`Error: ${errorDescription}`);
    
    // Determine the appropriate home URL based on the detected environment
    let homeUrl;
    if (isLocalBuild) {
      homeUrl = `${LOCAL_URL}/#/login`;
      log.info('Using local home URL due to isLocalBuild');
    } else if (isDevelopmentBuild) {
      homeUrl = `${DEV_URL}/#/login`;
      log.info('Using development home URL due to isDevelopmentBuild');
    } else {
      homeUrl = `${PROD_URL}/#/login`;
      log.info('Using production home URL');
    }
    
    // Only redirect to home if not already trying to load home
    if (validatedURL !== homeUrl) {
      log.info(`Redirecting to: ${homeUrl}`);
      mainWindow.loadURL(homeUrl);
      store.set('lastVisitedUrl', homeUrl);
    }
  });
  
  mainWindow.webContents.on('did-finish-load', () => {
    const currentUrl = mainWindow.webContents.getURL();
    log.info('Finished loading:', currentUrl);
    
    // Show window once content has loaded
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      log.info('Window shown after content loaded');
    }
    
    // Check if page actually loaded successfully
    mainWindow.webContents.executeJavaScript(`
      document.body.innerHTML.length > 0;
    `).then(hasContent => {
      if (hasContent && !isErrorPage(currentUrl)) {
        store.set('lastVisitedUrl', currentUrl);
        log.info('Saved URL after successful load:', currentUrl);
      } else {
        log.warn('Page loaded but appears empty, not saving URL');
        
        // Determine the appropriate home URL based on the detected environment
        let homeUrl;
        if (isLocalBuild) {
          homeUrl = `${LOCAL_URL}/#/login`;
          log.info('Empty page - using local home URL due to isLocalBuild');
        } else if (isDevelopmentBuild) {
          homeUrl = `${DEV_URL}/#/login`;
          log.info('Empty page - using development home URL due to isDevelopmentBuild');
        } else {
          homeUrl = `${PROD_URL}/#/login`;
          log.info('Empty page - using production home URL');
        }
        
        log.info('Redirecting to home URL:', homeUrl);
        mainWindow.loadURL(homeUrl);
      }
    }).catch(error => {
      log.error('Error checking page content:', error);
      // Show window anyway in case of error
      if (!mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
        log.info('Window shown after error');
      }
    });
  });
 
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
    log.info('Environment:', process.env.NODE_ENV || 'production');
    
    // Force production mode if not explicitly set
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = 'production';
      log.info('Forced environment to production mode');
    }
    
    // Now screen module will be available
    await createWindow();
    log.info('Window created successfully');
    
    // Force window to show
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      log.info('Window show and focus called');
      
      // Ensure window is visible
      setTimeout(() => {
        if (mainWindow) {
          log.info('Window visible check timeout fired');
          mainWindow.show();
          mainWindow.focus();
          if (!mainWindow.isVisible()) {
            log.info('Window not visible, forcing show again');
            mainWindow.show();
          }
        }
      }, 1000);
    } else {
      log.error('mainWindow is null after createWindow');
    }
    
    setupAutoUpdater(mainWindow);
    log.info('Auto updater setup complete');
    
    createMenu();
    log.info('Menu created');

    const lastVisitedUrl = store.get('lastVisitedUrl', 'https://app.assemble.tv');
    log.info('Last visited URL from store:', lastVisitedUrl);

    if (process.platform === 'darwin') {
      checkNotificationPermission().then(result => {
        log.info('Initial notification permission check:', result);
      }).catch(error => {
        log.error('Error checking notification permission:', error);
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

ipcMain.handle('show-notification', async (event, notificationData) => {
  console.log('Queueing notification:', notificationData);
  NotificationQueue.add(notificationData);
  return { success: true, queued: true };
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

ipcMain.handle('set-auth-token', async (event, token) => {
  try {
    store.set('authToken', token);
    log.info('Auth token saved successfully');
    return { success: true };
  } catch (error) {
    log.error('Error saving auth token:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('register-fcm-token', async (event, deviceId) => {
  try {
    const authToken = store.get('authToken');
    if (!authToken) {
      log.warn('Cannot register FCM token: No auth token available');
      return { success: false, error: 'No auth token available' };
    }

    if (!firebaseInitialized) {
      log.warn('Cannot register FCM token: Firebase not initialized');
      return { success: false, error: 'Firebase not initialized' };
    }

    // Use the API URL based on the base URL
    const baseUrl = getBaseUrl();
    const apiBaseUrl = `${baseUrl}/api/fcm/register`;

    log.info(`Registering FCM token with API at: ${apiBaseUrl}`);
    
    const response = await fetch(apiBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ 
        deviceId,
        platform: 'desktop',
        projectId: config.firebase.project_id
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    log.info('FCM token registered successfully');
    return { success: true, data };
  } catch (error) {
    log.error('Error registering FCM token:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('register-fcm', async (event, authToken) => {
  try {
    if (authToken) {
      store.set('authToken', authToken);
    } else {
      authToken = store.get('authToken');
      if (!authToken) {
        return { success: false, error: 'No auth token available' };
      }
    }

    // Generate a unique device ID if not already stored
    let deviceId = store.get('deviceId');
    if (!deviceId) {
      deviceId = `electron_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      store.set('deviceId', deviceId);
    }

    // Register the device with the FCM service
    const result = await ipcMain.handle('register-fcm-token', event, deviceId);
    return result;
  } catch (error) {
    log.error('Error in register-fcm handler:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-fcm', async () => {
  try {
    if (!firebaseInitialized) {
      return { success: false, error: 'Firebase not initialized' };
    }

    // Create a test notification using the Firebase Admin SDK
    const testMessage = {
      notification: {
        title: 'Test Notification',
        body: 'This is a test notification from Firebase Cloud Messaging',
      },
      token: 'test-token' // This won't actually work, just for testing the flow
    };

    log.info('Sending test FCM message:', testMessage);
    log.info('Firebase project ID:', config.firebase.project_id);

    // Create a desktop notification as a fallback
    createNotification({
      title: testMessage.notification.title,
      body: testMessage.notification.body,
      type: 'test'
    });

    return { 
      success: true, 
      message: 'Test notification sent successfully',
      projectId: config.firebase.project_id
    };
  } catch (error) {
    log.error('Error sending test FCM message:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('unregister-fcm-token', async (event, deviceId) => {
  try {
    const authToken = store.get('authToken');
    
    // Use the API URL based on the base URL
    const baseUrl = getBaseUrl();
    const apiBaseUrl = `${baseUrl}/api/fcm/unregister`;

    log.info(`Unregistering FCM token with API at: ${apiBaseUrl}`);
    
    await fetch(apiBaseUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ deviceId })
    });
    
    return { success: true };
  } catch (error) {
    log.error('Error unregistering FCM token:', error);
    return { success: false, error: error.message };
  }
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