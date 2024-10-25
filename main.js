import { app, BrowserWindow, ipcMain, Menu, screen, shell, Notification, systemPreferences } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import log from 'electron-log';
import fs from 'fs';
import Store from 'electron-store';
import { exec } from 'child_process';

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

dotenv.config();

let mainWindow = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
async function createNotification(type, data) {
  try {
    // Step 1: Check app's internal notification setting only
    const notificationsEnabled = store.get('notificationsEnabled');
    console.log('App notifications enabled:', notificationsEnabled);

    if (!notificationsEnabled) {
      console.log('Notifications are disabled in app settings');
      return { success: false, reason: 'app_disabled' };
    }
    
    let title = '';
    let body = '';
    const icon = path.join(__dirname, 'assets/icons/icon.png');

    switch (type) {
      case 'new-comment':
        if (!data.author || !data.itemTitle) {
          return { success: false, reason: 'invalid_comment_data' };
        }
        title = 'New Comment';
        body = `${data.author} commented on ${data.itemTitle}`;
        break;

      case 'mention':
        if (!data.author || !data.itemTitle) {
          return { success: false, reason: 'invalid_mention_data' };
        }
        title = 'You were mentioned';
        body = `${data.author} mentioned you in ${data.itemTitle}`;
        break;

      case 'reply':
        if (!data.author || !data.itemTitle) {
          return { success: false, reason: 'invalid_reply_data' };
        }
        title = 'New Reply';
        body = `${data.author} replied to your comment on ${data.itemTitle}`;
        break;

      case 'task-assigned':
        if (!data.author || !data.taskTitle) {
          return { success: false, reason: 'invalid_task_data' };
        }
        title = 'Task Assigned';
        body = `${data.author} assigned you to "${data.taskTitle}"`;
        break;

      case 'task-status':
        if (!data.taskTitle || !data.newStatus) {
          return { success: false, reason: 'invalid_status_data' };
        }
        title = 'Task Status Changed';
        body = `"${data.taskTitle}" status changed to ${data.newStatus}`;
        break;

      default:
        return { success: false, reason: 'invalid_notification_type' };
    }

    // Validate URL if provided
    if (data.url && !data.url.startsWith('https://app.assemble.tv')) {
      return { success: false, reason: 'invalid_url' };
    }

    // Create and show notification with sound
    const notification = new Notification({
      title,
      body,
      icon,
      silent: true,
      timeoutType: 'default'
    });
    
    // Play custom sound before showing notification
    mainWindow.webContents.executeJavaScript(`console.log('[Debug]: Before playing sound')`);
    playNotificationSound();
    
    mainWindow.webContents.executeJavaScript(`console.log('[Debug]: After playing sound')`);
    notification.show();

    // Setup click handler
    notification.on('click', () => {
      try {
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
          
          if (data.url) {
            mainWindow.loadURL(data.url);
          }
        }
      } catch (error) {
        console.error('Error handling notification click:', error);
      }
    });

    // Return success
    return { 
      success: true, 
      type,
      title,
      body
    };

  } catch (error) {
    console.error('Error creating notification:', error);
    return { 
      success: false, 
      reason: 'error',
      error: error.message,
      stack: error.stack
    };
  }
}

// Add these test functions to main.js
async function runNotificationTests() {
  console.log('🧪 Starting notification system tests...');
  
  // Test 1: Check if notifications are supported
  console.log('Test 1: Checking notification support...');
  const isSupported = Notification.isSupported();
  console.log(`✓ Notifications ${isSupported ? 'are' : 'are not'} supported`);

  // Test 2: Check system permission
  console.log('Test 2: Checking system permission...');
  const permission = await checkNotificationPermission();
  console.log(`✓ Notification permission is: ${permission ? 'granted' : 'denied'}`);

  // Test 3: Check stored settings
  console.log('Test 3: Checking notification settings...');
  const enabled = store.get('notificationsEnabled');
  console.log(`✓ Notifications are ${enabled ? 'enabled' : 'disabled'} in app settings`);

  // Test 4: Test notification creation
  if (isSupported && permission && enabled) {
    console.log('Test 4: Testing all notification types...');
    const testCases = [
      {
        type: 'new-comment',
        data: {
          author: 'Test User',
          itemTitle: 'Test Document',
          url: 'https://app.assemble.tv/test/comment'
        }
      },
      {
        type: 'mention',
        data: {
          author: 'Test Mentioner',
          itemTitle: 'Test Mention Document',
          url: 'https://app.assemble.tv/test/mention'
        }
      },
      {
        type: 'reply',
        data: {
          author: 'Test Replier',
          itemTitle: 'Test Reply Document',
          url: 'https://app.assemble.tv/test/reply'
        }
      },
      {
        type: 'task-assigned',
        data: {
          author: 'Test Assigner',
          taskTitle: 'Test Task',
          url: 'https://app.assemble.tv/test/task'
        }
      },
      {
        type: 'task-status',
        data: {
          taskTitle: 'Test Status Task',
          newStatus: 'In Progress',
          url: 'https://app.assemble.tv/test/status'
        }
      }
    ];

    // Send test notifications with a delay between each
    for (const testCase of testCases) {
      await createNotification(testCase.type, testCase.data);
      console.log(`✓ Sent test notification: ${testCase.type}`);
      // Wait 2 seconds between notifications
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } else {
    console.log('❌ Cannot test notifications - either not supported, no permission, or disabled in settings');
  }

  console.log('🏁 Notification tests completed');
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
app.whenReady().then(async () => {
  try {
    // Now screen module will be available
    await createWindow();
    
    setupAutoUpdater(mainWindow);
    createMenu();

    console.log('Last visited URL from store:', store.get('lastVisitedUrl', 'https://app.assemble.tv'));

    if (process.platform === 'darwin') {
      forceNotificationRegistration().then(result => {
        console.log('Initial notification registration result:', result);
      });
    }
  } catch (error) {
    console.error('Error during app startup:', error);
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
    'new-comment': {
      author: 'Test User',
      itemTitle: 'Test Document',
      url: 'https://app.assemble.tv/test/comment'
    },
    'mention': {
      author: 'Test Mentioner',
      itemTitle: 'Test Mention Document',
      url: 'https://app.assemble.tv/test/mention'
    },
    'reply': {
      author: 'Test Replier',
      itemTitle: 'Test Reply Document',
      url: 'https://app.assemble.tv/test/reply'
    },
    'task-assigned': {
      author: 'Test Assigner',
      taskTitle: 'Test Task',
      url: 'https://app.assemble.tv/test/task'
    },
    'task-status': {
      taskTitle: 'Test Status Task',
      newStatus: 'In Progress',
      url: 'https://app.assemble.tv/test/status'
    }
  };

  if (testData[type]) {
    // Use createNotification instead of creating notification directly
    return await createNotification(type, testData[type]);
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