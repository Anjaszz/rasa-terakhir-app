const fs = require('fs');
const path = require('path');

// Read .env file locally if present
try {
  require('dotenv').config();
} catch (e) {
  // dotenv is optional in production/CI
}

const isProduction = process.env.NODE_ENV === 'production';

const supabaseUrl = process.env.SUPABASE_URL || 'https://xirssaobzgkmdooujnim.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpcnNzYW9iemdrbWRvb3VqbmltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjk2NDMsImV4cCI6MjEwNTgwNTY0M30.Pm2kjGDtYFMGQ7KLS_6eMQDM4UdHbqWMwvZ7ZEoBjd0';
const midtransClientKey = process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-6CGa60nWIQAPV2ct';
const midtransServerKey = process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-5GNd5d-l2ak2pKTfl0UABBAq';
const midtransIsProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const midtransSnapUrl = process.env.MIDTRANS_SNAP_URL || 'https://app.sandbox.midtrans.com/snap/snap.js';

const envConfigFile = `export const environment = {
  production: ${isProduction},
  supabaseUrl: '${supabaseUrl}',
  supabaseAnonKey: '${supabaseAnonKey}',
  midtransClientKey: '${midtransClientKey}',
  midtransServerKey: '${midtransServerKey}',
  midtransIsProduction: ${midtransIsProduction},
  midtransSnapUrl: '${midtransSnapUrl}'
};
`;

const envDir = path.join(__dirname, '../src/environments');
if (!fs.existsSync(envDir)) {
  fs.mkdirSync(envDir, { recursive: true });
}

fs.writeFileSync(path.join(envDir, 'environment.ts'), envConfigFile);
fs.writeFileSync(path.join(envDir, 'environment.prod.ts'), envConfigFile);

console.log('✅ Environment files generated successfully from .env / Vercel environment variables!');
