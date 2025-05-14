require('dotenv').config();

// Determine which environment we're in
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local';
console.log(`Loading Firebase config for environment: ${isDevelopment ? 'development' : 'production'}`);

// Process the private keys with proper line breaks
const prodPrivateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\n/g, '\n')
  : undefined;

const devPrivateKey = process.env.DEV_FIREBASE_PRIVATE_KEY
  ? process.env.DEV_FIREBASE_PRIVATE_KEY.replace(/\n/g, '\n')
  : undefined;

// Use the appropriate Firebase config based on environment
const firebaseConfig = isDevelopment
  ? {
      type: process.env.DEV_FIREBASE_SERVICE_ACCOUNT_TYPE,
      project_id: process.env.DEV_FIREBASE_PROJECT_ID,
      private_key_id: process.env.DEV_FIREBASE_PRIVATE_KEY_ID,
      private_key: devPrivateKey,
      client_email: process.env.DEV_FIREBASE_CLIENT_EMAIL,
      client_id: process.env.DEV_FIREBASE_CLIENT_ID,
      auth_uri: process.env.DEV_FIREBASE_AUTH_URI,
      token_uri: process.env.DEV_FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.DEV_FIREBASE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.env.DEV_FIREBASE_CLIENT_CERT_URL,
      vapidKey: process.env.DEV_FIREBASE_VAPID_KEY
    }
  : {
      type: process.env.FIREBASE_SERVICE_ACCOUNT_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: prodPrivateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
      vapidKey: process.env.FIREBASE_VAPID_KEY
    };

// Log some info about the config (without exposing sensitive data)
console.log(`Using Firebase project: ${firebaseConfig.project_id || 'Not configured'}`);
console.log('Private key processed length:', firebaseConfig.private_key ? firebaseConfig.private_key.length : 0);

module.exports = {
  firebase: firebaseConfig
};