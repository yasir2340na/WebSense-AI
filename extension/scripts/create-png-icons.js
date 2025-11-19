import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Create a minimal valid PNG file with a solid color
function createMinimalPNG(width, height, r, g, b) {
    const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    
    // IHDR chunk
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0); // Length
    ihdr.write('IHDR', 4);
    ihdr.writeUInt32BE(width, 8);
    ihdr.writeUInt32BE(height, 12);
    ihdr.writeUInt8(8, 16); // Bit depth
    ihdr.writeUInt8(2, 17); // Color type (RGB)
    ihdr.writeUInt8(0, 18); // Compression
    ihdr.writeUInt8(0, 19); // Filter
    ihdr.writeUInt8(0, 20); // Interlace
    const ihdrCrc = crc32(ihdr.slice(4, 21));
    ihdr.writeUInt32BE(ihdrCrc, 21);
    
    // Create pixel data (simple gradient/pattern)
    const pixelData = [];
    for (let y = 0; y < height; y++) {
        pixelData.push(0); // Filter byte
        for (let x = 0; x < width; x++) {
            // Create a simple circular pattern
            const dx = x - width / 2;
            const dy = y - height / 2;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = Math.min(width, height) / 2;
            
            if (dist < maxDist * 0.9) {
                // Inside circle - use the provided color
                const intensity = 1 - (dist / (maxDist * 0.9)) * 0.3;
                pixelData.push(
                    Math.floor(r * intensity),
                    Math.floor(g * intensity),
                    Math.floor(b * intensity)
                );
            } else {
                // Outside - transparent edge
                pixelData.push(r, g, b);
            }
        }
    }
    
    // Compress with zlib (deflate) - simplified version
    const pako = require('pako');
    const compressed = pako.deflate(Buffer.from(pixelData));
    
    // IDAT chunk
    const idat = Buffer.alloc(compressed.length + 12);
    idat.writeUInt32BE(compressed.length, 0);
    idat.write('IDAT', 4);
    compressed.copy(idat, 8);
    const idatCrc = crc32(idat.slice(4, 8 + compressed.length));
    idat.writeUInt32BE(idatCrc, 8 + compressed.length);
    
    // IEND chunk
    const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
    
    return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

// CRC32 calculation
function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

// CRC table
const crcTable = (() => {
    const table = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c;
    }
    return table;
})();

// Try to use pako if available, otherwise create a simpler version
let usePako = true;
try {
    require('pako');
} catch (e) {
    usePako = false;
    console.log('Pako not available, will create simplified icons');
}

if (!usePako) {
    // Create very simple placeholder PNGs using a valid PNG structure
    console.log('Creating simple placeholder icons...');
    
    // Use a simple 1x1 PNG and scale reference
    const simplePNG = (size, r, g, b) => {
        // Valid 1x1 PNG template - we'll just use a colored square
        return Buffer.from([
            137, 80, 78, 71, 13, 10, 26, 10, // PNG signature
            0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, size, 0, 0, 0, size, 8, 2, 0, 0, 0
        ]);
    };
    
    // For a valid workaround, let's just copy a valid small PNG template
    console.log('\n⚠️  Please use the generate-icons.html file in your browser to create proper icons.');
    console.log('    1. Open extension/generate-icons.html in your browser');
    console.log('    2. Click the buttons to download icon16.png, icon48.png, icon128.png');
    console.log('    3. Save them to extension/public/icons/\n');
}

console.log('Icon script completed. Using SVG for now is recommended.');
