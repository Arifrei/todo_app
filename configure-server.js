#!/usr/bin/env node

/**
 * Helper script to configure the server URL for the mobile app
 * Usage: node configure-server.js <server-url>
 * Example: node configure-server.js http://192.168.1.100:5000
 */

const fs = require('fs');
const path = require('path');

const serverUrl = process.argv[2];

if (!serverUrl) {
    console.error('\n❌ Error: Server URL is required\n');
    console.log('Usage: node configure-server.js <server-url>');
    console.log('\nExamples:');
    console.log('  Local:      node configure-server.js http://192.168.1.100:5000');
    console.log('  Production: node configure-server.js https://your-domain.com\n');
    process.exit(1);
}

// Validate URL
try {
    new URL(serverUrl);
} catch (error) {
    console.error('\n❌ Error: Invalid URL format\n');
    console.log('Please provide a valid URL starting with http:// or https://\n');
    process.exit(1);
}

const configPath = path.join(__dirname, 'capacitor.config.json');

try {
    // Read current config
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Determine if it's HTTP or HTTPS
    const isHttps = serverUrl.startsWith('https://');

    // Update server configuration
    config.server = {
        url: serverUrl,
        cleartext: !isHttps,
        androidScheme: isHttps ? 'https' : 'http'
    };

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('\n✅ Server URL configured successfully!\n');
    console.log(`   Server URL: ${serverUrl}`);
    console.log(`   Protocol:   ${isHttps ? 'HTTPS (secure)' : 'HTTP (cleartext)'}\n`);
    console.log('Next steps:');
    console.log('  1. Run: npx cap sync');
    console.log('  2. Rebuild your APK\n');

} catch (error) {
    console.error('\n❌ Error updating configuration:', error.message);
    console.error('Please check that capacitor.config.json exists and is valid JSON\n');
    process.exit(1);
}
