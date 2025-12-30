#!/usr/bin/env node

/**
 * Helper script to get the local IP address for mobile app configuration
 * Usage: node get-local-ip.js
 */

const os = require('os');

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push({
                    name: name,
                    address: iface.address
                });
            }
        }
    }

    return addresses;
}

const addresses = getLocalIpAddress();

console.log('\n🌐 Local IP Addresses Found:\n');

if (addresses.length === 0) {
    console.log('❌ No network interfaces found.');
    console.log('   Make sure you are connected to WiFi.\n');
    process.exit(1);
}

addresses.forEach((addr, index) => {
    console.log(`${index + 1}. ${addr.name}`);
    console.log(`   IP: ${addr.address}`);
    console.log(`   URL: http://${addr.address}:5000\n`);
});

const primaryIp = addresses[0].address;

console.log('💡 Quick Setup:\n');
console.log(`   node configure-server.js http://${primaryIp}:5000\n`);
console.log('📱 Make sure your phone is on the same WiFi network!\n');
